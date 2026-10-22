import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as ed25519 from '@noble/ed25519';
import bs58 from 'bs58';
import { call, spawnServer as spawn, type Harness } from './helpers.js';

const API_KEY = 'apex-test-key';
const TIP_ACCOUNTS = [
  'APeX2oLtjYehgTMUCA971L8htM7tGNqsXHDz5NrivhhX',
  'APeXAKT6spXSmU3uRv2MoEgQ7ckhAS4nexTgaxwLEfJ9',
];
const RECIPIENT = '11111111111111111111111111111112';

interface Captured {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

let mock: Server;
let mockUrl: string;
let requests: Captured[] = [];

function rpcRequests(method: string) {
  return requests
    .filter((r) => r.method === 'POST' && r.body[0] === 0x7b)
    .map((r) => ({ ...r, json: JSON.parse(r.body.toString()) }))
    .filter((r) => r.json.method === method);
}

function rpcResult(method: string, params: unknown[]): unknown {
  switch (method) {
    case 'getTipAccounts':
      return TIP_ACCOUNTS;
    case 'getLatestBlockhash':
      return {
        context: { slot: 1 },
        value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 },
      };
    case 'sendTransaction':
      return 'apexMockSignature';
    case 'getInflightBundleStatuses':
      return {
        context: { slot: 2 },
        value: (params[0] as string[]).map((id) => ({
          bundle_id: id,
          status: 'Landed',
          landed_slot: 42,
        })),
      };
    default:
      return null;
  }
}

beforeAll(async () => {
  mock = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? '').split('?')[0];
      requests.push({ method: req.method ?? '', path, headers: req.headers, body });
      if (req.method === 'GET' && path === '/ping') {
        res.end('pong');
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (path === '/send-bundle') {
        res.end(JSON.stringify({ bundle_id: 'bundle-1', signatures: ['s1', 's2'] }));
        return;
      }
      const { id, method, params } = JSON.parse(body.toString());
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: rpcResult(method, params) }));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all(harnesses.map((h) => h.close()));
  await new Promise<void>((r) => mock.close(() => r()));
});

beforeEach(() => {
  requests = [];
});

const harnesses: Harness[] = [];

async function spawnServer(env: Record<string, string>): Promise<Client> {
  const h = await spawn({
    ORBITFLARE_API_KEY: 'rpc-test-key',
    ORBITFLARE_RPC_URL: mockUrl,
    ORBITFLARE_APEX_URL: mockUrl,
    ...env,
  });
  harnesses.push(h);
  return h.client;
}

describe('Apex tools (mocked endpoint)', () => {
  let client: Client;

  const secret = ed25519.utils.randomSecretKey();

  beforeAll(async () => {
    client = await spawnServer({ ORBITFLARE_APEX_API_KEY: API_KEY });
    await call(client, 'wallet', { action: 'load', base58Secret: bs58.encode(secret) });
  });

  async function buildTransfer(apexTipLamports?: number) {
    const built = await call(client, 'buildSolTransfer', {
      recipient: RECIPIENT,
      amountSol: 0.000000001,
      ...(apexTipLamports ? { apexTipLamports } : {}),
    });
    expect(built.isError).toBe(false);
    return built.json;
  }

  async function buildSigned(apexTipLamports?: number) {
    const built = await buildTransfer(apexTipLamports);
    const wire = Buffer.from(built.transaction, 'base64');
    expect(wire[0]).toBe(1);
    const sig = await ed25519.signAsync(new Uint8Array(wire.subarray(65)), secret);
    Buffer.from(sig).copy(wire, 1);
    return { ...built, transaction: wire.toString('base64') };
  }

  it('apexGetTipAccounts returns the endpoint tip accounts and a suggestion', async () => {
    const { isError, json } = await call(client, 'apexGetTipAccounts');
    expect(isError).toBe(false);
    expect(json.tipAccounts).toEqual(TIP_ACCOUNTS);
    expect(TIP_ACCOUNTS).toContain(json.suggested);
    expect(json.minTipLamports).toBe(1_000_000);
  });

  it('sendTransaction via apex previews the tip without sending', async () => {
    const built = await buildTransfer(1_000_000);
    const preview = await call(client, 'sendTransaction', { transaction: built.transaction, via: 'apex' });
    expect(preview.isError).toBe(false);
    expect(preview.json.confirmed).toBe(false);
    expect(preview.json.wouldDo).toMatch(/OrbitFlare Apex/);
    expect(preview.json.apexTip.tip).toMatchObject({ account: built.apexTip.account, lamports: '1000000' });
    expect(rpcRequests('sendTransaction').length).toBe(0);
  });

  it('buildSolTransfer adds an Apex tip and sendTransaction sends it via Apex', async () => {
    const built = await buildTransfer(1_000_000);
    expect(TIP_ACCOUNTS).toContain(built.apexTip.account);
    expect(built.apexTip.lamports).toBe('1000000');

    const sent = await call(client, 'sendTransaction', {
      transaction: built.transaction,
      via: 'apex',
      mevProtect: true,
      confirm: true,
    });
    expect(sent.isError).toBe(false);
    expect(sent.json.signature).toBe('apexMockSignature');
    expect(sent.json.tip).toEqual(built.apexTip);
    expect(sent.json.warning).toBeUndefined();

    const [req] = rpcRequests('sendTransaction');
    expect(req.headers['x-api-key']).toBe(API_KEY);
    expect(req.json.params[1]).toEqual({ encoding: 'base64' });
    expect(req.json.params[2]).toBe(true);
    expect(rpcRequests('sendTransaction').length).toBe(1);
  });

  it('apexSendTransaction refuses a transaction without a tip before sending', async () => {
    const built = await buildSigned();
    const { isError, text } = await call(client, 'apexSendTransaction', {
      signedTransaction: built.transaction,
      confirm: true,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/no Apex tip/);
    expect(text).toMatch(/APeX/);
    expect(rpcRequests('sendTransaction').length).toBe(0);
  });

  it('apexSendTransaction needs confirm', async () => {
    const built = await buildSigned(1_000_000);
    const { isError, json } = await call(client, 'apexSendTransaction', { signedTransaction: built.transaction });
    expect(isError).toBe(false);
    expect(json.confirmed).toBe(false);
    expect(json.tip.lamports).toBe('1000000');
    expect(rpcRequests('sendTransaction').length).toBe(0);
  });

  it('apexSendTransaction warns on a tip below the standard floor', async () => {
    const built = await buildSigned(5_000);
    const { isError, json } = await call(client, 'apexSendTransaction', {
      signedTransaction: built.transaction,
      confirm: true,
    });
    expect(isError).toBe(false);
    expect(json.tip.lamports).toBe('5000');
    expect(json.warning).toMatch(/below the standard-tier floor/);
    expect(json.endpoint).toBe(mockUrl);
  });

  it('apexSendBundle without confirm checks the bundle only', async () => {
    const plain = await buildSigned();
    const tipped = await buildSigned(1_000_000);
    const { isError, json } = await call(client, 'apexSendBundle', {
      transactions: [plain.transaction, tipped.transaction],
    });
    expect(isError).toBe(false);
    expect(json.confirmed).toBe(false);
    expect(json.tip.transactionIndex).toBe(1);
    expect(json.transactions).toHaveLength(2);
    expect(requests.some((r) => r.path === '/send-bundle')).toBe(false);
  });

  it('apexSendBundle sends framed transactions with exactly one tip', async () => {
    const plain = await buildSigned();
    const tipped = await buildSigned(1_000_000);
    const { isError, json } = await call(client, 'apexSendBundle', {
      transactions: [plain.transaction, tipped.transaction],
      confirm: true,
    });
    expect(isError).toBe(false);
    expect(json.bundleId).toBe('bundle-1');
    expect(json.tip.transactionIndex).toBe(1);

    const req = requests.find((r) => r.path === '/send-bundle')!;
    expect(req.headers['x-api-key']).toBe(API_KEY);
    const firstLen = req.body.readUInt16BE(0);
    const secondLen = req.body.readUInt16BE(2 + firstLen);
    expect(req.body.length).toBe(4 + firstLen + secondLen);
  });

  it('apexSendBundle rejects a bundle with two tips', async () => {
    const tipped = await buildSigned(1_000_000);
    const { isError, text } = await call(client, 'apexSendBundle', {
      transactions: [tipped.transaction, tipped.transaction],
      confirm: true,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/2 Apex tip transfers/);
    expect(requests.some((r) => r.path === '/send-bundle')).toBe(false);
  });

  it('apexSendTransaction refuses an unsigned transaction', async () => {
    const built = await buildTransfer(1_000_000);
    const { isError, text } = await call(client, 'apexSendTransaction', { signedTransaction: built.transaction, confirm: true });
    expect(isError).toBe(true);
    expect(text).toMatch(/missing signatures/);
    expect(text).toMatch(/via "apex"/);
    expect(rpcRequests('sendTransaction').length).toBe(0);
  });

  it('apexGetBundleStatuses maps bundle states', async () => {
    const { isError, json } = await call(client, 'apexGetBundleStatuses', {
      bundleIds: ['bundle-1'],
    });
    expect(isError).toBe(false);
    expect(json.statuses).toEqual([{ bundleId: 'bundle-1', state: 'Landed', landedSlot: 42 }]);
  });

  it('apexPing pings the configured endpoint', async () => {
    const { isError, json } = await call(client, 'apexPing');
    expect(isError).toBe(false);
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({ endpoint: mockUrl, ok: true });
    expect(requests.filter((r) => r.path === '/ping').length).toBe(2);
  });
});

describe('Apex tools without an Apex key', () => {
  let client: Client;

  beforeAll(async () => {
    client = await spawnServer({ ORBITFLARE_APEX_API_KEY: '' });
  });

  it('apexSendTransaction explains how to configure the key', async () => {
    const { isError, text } = await call(client, 'apexSendTransaction', {
      signedTransaction: 'A'.repeat(60),
      confirm: true,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/ORBITFLARE_APEX_API_KEY/);
    expect(requests.length).toBe(0);
  });

  it('apexGetTipAccounts works without a key', async () => {
    const { isError, json } = await call(client, 'apexGetTipAccounts');
    expect(isError).toBe(false);
    expect(json.tipAccounts).toEqual(TIP_ACCOUNTS);
  });

  it('setApiKey stores an Apex key', async () => {
    const { isError, text, json } = await call(client, 'setApiKey', { apiKey: API_KEY, kind: 'apex' });
    expect(isError).toBe(false);
    expect(text).toMatch(/stored apex API key/);
    expect(json.apexKey).toBe(true);
  });
});
