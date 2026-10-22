import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import bs58 from 'bs58';
import { Server, ServerCredentials, type ServerDuplexStream } from '@grpc/grpc-js';
import { jetstreamV2 } from '@orbitflare/sdk/proto';
import { WebSocketServer } from 'ws';
import { call, mockRpc, spawnServer, type Harness, type MockHttp } from './helpers.js';

const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const WATCHED = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

function key(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function transaction(i: number): jetstreamV2.SubscribeTransactionsResponse {
  return {
    sequence: BigInt(i),
    createdAt: new Date(),
    transaction: {
      filterIds: ['mcp'],
      transaction: {
        slot: BigInt(1000 + i),
        signature: new Uint8Array(64).fill(i + 1),
        txIndex: i,
        signatures: [new Uint8Array(64).fill(i + 1)],
        isVote: false,
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 1,
        recentBlockhash: key(9),
        versioned: true,
        accountKeys: [key(1), bs58.decode(PUMP)],
        instructions: [{ programIdIndex: 1, accounts: new Uint8Array([0]), data: new Uint8Array([1]) }],
        addressTableLookups: [],
        feePayer: key(1),
        writableAccounts: [key(1)],
        programIds: [bs58.decode(PUMP)],
        computeUnitPrice: 1234n,
        computeLimit: 200000,
        txSize: 300,
        loadedWritableAddresses: [],
        loadedReadonlyAddresses: [],
        altResolutionIncomplete: false,
        priorityFeeLamports: 246n,
      },
    },
  };
}

describe('watchTransactions (mock Jetstream v2)', () => {
  let grpc: Server;
  let h: Harness;
  let received: jetstreamV2.SubscribeTransactionsRequest[] = [];
  let tokens: string[] = [];
  let reject = false;
  let port = 0;

  beforeAll(async () => {
    grpc = new Server();
    grpc.addService(jetstreamV2.JetstreamV2Service, {
      subscribeTransactions: (call: ServerDuplexStream<jetstreamV2.SubscribeTransactionsRequest, jetstreamV2.SubscribeTransactionsResponse>) => {
        tokens.push(String(call.metadata.get('x-token')[0] ?? ''));
        call.on('data', (req: jetstreamV2.SubscribeTransactionsRequest) => {
          received.push(req);
          if (req.ping) {
            call.write({ sequence: 0n, pong: { pingId: req.ping.pingId } });
            return;
          }
          const filterId = req.addFilters?.filters[0]?.filterId ?? '';
          if (reject) {
            call.write({ sequence: 0n, filterValidation: { filterId, accepted: false, rejectionReason: 'bad filter' } });
            return;
          }
          call.write({ sequence: 0n, filterValidation: { filterId, accepted: true, rejectionReason: '' } });
          for (let i = 1; i <= 5; i++) call.write(transaction(i));
        });
        call.on('end', () => call.end());
        call.on('error', () => undefined);
      },
      subscribeSlots: () => undefined,
      ping: (_c: unknown, cb: (e: null, r: { count: number }) => void) => cb(null, { count: 1 }),
      getVersion: (_c: unknown, cb: (e: null, r: { version: string }) => void) => cb(null, { version: 'test' }),
    });
    port = await new Promise<number>((res, rej) =>
      grpc.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (e, p) => (e ? rej(e) : res(p))),
    );
    h = await spawnServer({ ORBITFLARE_JETSTREAM_URL: `http://127.0.0.1:${port}` });
  });

  afterAll(async () => {
    await h?.close();
    grpc?.forceShutdown();
  });

  it('sends no x-token without a license key, and the key as x-token with one', async () => {
    tokens = [];
    await call(h.client, 'watchTransactions', { accountInclude: [PUMP], maxEvents: 1, durationSeconds: 10 });
    expect(tokens.every((t) => t === '')).toBe(true);
    const keyed = await spawnServer({ ORBITFLARE_JETSTREAM_URL: `http://127.0.0.1:${port}`, ORBITFLARE_API_KEY: 'ORBIT-TEST-KEY' });
    try {
      tokens = [];
      await call(keyed.client, 'watchTransactions', { accountInclude: [PUMP], maxEvents: 1, durationSeconds: 10 });
      expect(tokens).toContain('ORBIT-TEST-KEY');
    } finally {
      await keyed.close();
    }
  });

  it('collects transactions until maxEvents and summarizes them', async () => {
    received = [];
    const res = await call(h.client, 'watchTransactions', { accountInclude: [PUMP], maxEvents: 3, durationSeconds: 10 });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ protocol: 'jetstream-v2', filterAccepted: true, stoppedBy: 'maxEvents', transactionCount: 3, slots: { first: 1001, last: 1003 } });
    expect(res.json.topPrograms).toEqual([{ program: PUMP, transactions: 3 }]);
    expect(res.json.sample[0]).toMatchObject({
      signature: bs58.encode(new Uint8Array(64).fill(2)),
      version: 'v0',
      feePayer: bs58.encode(key(1)),
      programIds: [PUMP],
      computeUnitPrice: 1234,
      priorityFeeLamports: 246,
    });
    expect(res.json.elapsedMs).toBeLessThan(5000);
    const filter = received.find((r) => r.addFilters)!.addFilters!.filters[0];
    expect(filter.filterId).toBe('mcp');
    expect(filter.filter).toMatchObject({ accountInclude: [PUMP], includeEnrichment: true });
  });

  it('stops at the duration when traffic is quieter than maxEvents', async () => {
    const res = await call(h.client, 'watchTransactions', { accountInclude: [PUMP], maxEvents: 50, durationSeconds: 1, sampleSize: 2 });
    expect(res.json).toMatchObject({ stoppedBy: 'duration', transactionCount: 5 });
    expect(res.json.sample).toHaveLength(2);
  });

  it('reports a rejected filter', async () => {
    reject = true;
    const res = await call(h.client, 'watchTransactions', { accountRequired: [PUMP], durationSeconds: 3 });
    reject = false;
    expect(res.json).toMatchObject({ filterAccepted: false, rejectionReason: 'bad filter', stoppedBy: 'filter rejected', transactionCount: 0 });
  });

  it('requires a filter', async () => {
    const res = await call(h.client, 'watchTransactions', {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/at least one of accountInclude/);
  });

  it('configOnly builds a Jetstream CLI config', async () => {
    const res = await call(h.client, 'watchTransactions', { configOnly: true, region: 'fra', accountInclude: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'] });
    expect(res.json).toMatchObject({ service: 'jetstream', grpcEndpoint: 'http://fra.jetstream.orbitflare.com' });
    expect(res.json.cliCommand).toContain('orbitflare jet');
    expect(res.json.yamlConfig.transactions.my_filter.account_include).toEqual(['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']);
  });

  it('configOnly builds a Yellowstone config with vote/failed/commitment', async () => {
    const res = await call(h.client, 'watchTransactions', { configOnly: true, service: 'yellowstone', region: 'ams', vote: false, failed: false, commitment: 'confirmed' });
    expect(res.json.grpcEndpoint).toBe('http://ams.rpc.orbitflare.com:10000');
    expect(res.json.yamlConfig.commitment).toBe('confirmed');
    expect(res.json.yamlConfig.transactions.my_filter).toMatchObject({ vote: false, failed: false });
  });

  it('configOnly maps regions to hosts that exist for each service', async () => {
    const ys = await call(h.client, 'watchTransactions', { configOnly: true, service: 'yellowstone', region: 'sgp', accountInclude: [PUMP] });
    expect(ys.json).toMatchObject({ region: 'sg', grpcEndpoint: 'http://sg.rpc.orbitflare.com:10000' });
    const bad = await call(h.client, 'watchTransactions', { configOnly: true, service: 'yellowstone', region: 'dub', accountInclude: [PUMP] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/no dub endpoint/);
    const jet = await call(h.client, 'watchTransactions', { configOnly: true, region: 'sqq', accountInclude: [PUMP] });
    expect(jet.json.grpcEndpoint).toBe('http://sqq.jetstream.orbitflare.com');
    const mapped = await call(h.client, 'watchTransactions', { configOnly: true, region: 'sg', accountInclude: [PUMP] });
    expect(mapped.json.grpcEndpoint).toBe('http://sgp.jetstream.orbitflare.com');
  });
});

describe('watchTransactions against an unreachable endpoint', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await spawnServer({ ORBITFLARE_JETSTREAM_URL: 'http://127.0.0.1:9' });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('fails with an IP whitelist hint', async () => {
    const res = await call(h.client, 'watchTransactions', { accountInclude: [PUMP], durationSeconds: 8 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/whitelist/);
  });
});

describe('watchAccounts (mock WebSocket + RPC)', () => {
  let rpc: MockHttp;
  let wss: WebSocketServer;
  let h: Harness;
  const subscribeParams: unknown[] = [];

  beforeAll(async () => {
    rpc = await mockRpc({
      getMultipleAccounts: (params) => ({ context: { slot: 1 }, value: params[0].map(() => ({ lamports: 1000, owner: '11111111111111111111111111111111', data: ['', 'base64'], executable: false })) }),
    });
    wss = new WebSocketServer({ server: rpc.server });
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'accountSubscribe') {
          subscribeParams.push(msg.params);
          const sub = 100 + msg.id;
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: sub }));
          setTimeout(() => {
            for (const lamports of [1500, 2500]) {
              socket.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'accountNotification',
                  params: { subscription: sub, result: { context: { slot: 5 }, value: { lamports, owner: '11111111111111111111111111111111', data: ['AAAA', 'base64'], executable: false, space: 3 } } },
                }),
              );
            }
          }, 50);
        } else if (msg.id !== undefined) {
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: true }));
        }
      });
    });
    h = await spawnServer({ ORBITFLARE_API_KEY: 'ws-key', ORBITFLARE_RPC_URL: rpc.url });
  });

  afterAll(async () => {
    await h?.close();
    for (const c of wss.clients) c.terminate();
    wss.close();
    await rpc?.close();
  });

  it('collects account updates and summarizes lamport changes', async () => {
    const res = await call(h.client, 'watchAccounts', { accounts: [WATCHED], durationSeconds: 1 });
    expect(res.isError).toBe(false);
    expect(res.json.updateCount).toBe(2);
    expect(res.json.accounts).toEqual([{ account: WATCHED, updates: 2, startLamports: 1000, lastLamports: 2500, lamportsChange: 1500 }]);
    expect(res.json.events[0]).toMatchObject({ account: WATCHED, lamports: 1500, dataBytes: 3 });
    expect(subscribeParams[0]).toEqual([WATCHED, { encoding: 'base64', commitment: 'confirmed' }]);
  });

  it('stops early at maxEvents', async () => {
    const res = await call(h.client, 'watchAccounts', { accounts: [WATCHED], durationSeconds: 10, maxEvents: 1, includeData: true });
    expect(res.json).toMatchObject({ stoppedBy: 'maxEvents', updateCount: 1 });
    expect(res.json.events[0].data).toBe('AAAA');
    expect(res.json.elapsedMs).toBeLessThan(5000);
  });
});

describe('mainnet-only services on devnet', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await spawnServer({ ORBITFLARE_NETWORK: 'devnet', ORBITFLARE_API_KEY: 'k' });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('watchTransactions refuses to stream mainnet Jetstream for a devnet session', async () => {
    const res = await call(h.client, 'watchTransactions', { accountInclude: [PUMP], durationSeconds: 1 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/no devnet endpoint/);
  });

  it('sendTransaction via apex is refused on devnet', async () => {
    const res = await call(h.client, 'sendTransaction', { transaction: 'A'.repeat(60), via: 'apex' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/mainnet only/);
  });
});
