import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import bs58 from 'bs58';
import { sanitizeUrl } from '@orbitflare/sdk';
import { JetstreamClientBuilder, TransactionFilter, type SubscribeTransactionsResponse } from '@orbitflare/sdk/jetstream/v2';
import { WsClientBuilder, type WsSubscription } from '@orbitflare/sdk/ws';
import {
  defaultJetstreamRegion,
  type JetstreamRegion,
  getApiKey,
  getJetstreamUrl,
  getWsUrl,
  getYellowstoneUrl,
  MissingApiKeyError,
  STREAM_REGIONS,
  toJetstreamRegion,
} from '../config.js';
import { asJson, lamportsToSol } from '../utils/formatters.js';
import { sdkLogger } from '../utils/logger.js';
import { rpcCall } from '../utils/rpc.js';
import { defineTool, READ } from './define.js';

const TIMEOUT = Symbol('timeout');
const sleep = (ms: number) => new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), ms));
const b58 = (bytes: Uint8Array | undefined) => (bytes && bytes.length ? bs58.encode(bytes) : null);

const accountList = (what: string) => z.array(z.string().min(32).max(44)).max(100).optional().describe(what);

function txVersion(tx: NonNullable<SubscribeTransactionsResponse['transaction']>['transaction']) {
  if (!tx) return null;
  return tx.config ? 'v1' : tx.versioned ? 'v0' : 'legacy';
}

function streamConfig(args: {
  service: 'jetstream' | 'yellowstone';
  region?: (typeof STREAM_REGIONS)[number];
  accountInclude?: string[];
  accountExclude?: string[];
  accountRequired?: string[];
  vote?: boolean;
  failed?: boolean;
  commitment?: string;
}) {
  const filter: Record<string, unknown> = {};
  if (args.accountInclude?.length) filter.account_include = args.accountInclude;
  if (args.accountExclude?.length) filter.account_exclude = args.accountExclude;
  if (args.accountRequired?.length) filter.account_required = args.accountRequired;
  const yamlConfig: Record<string, unknown> = { transactions: { my_filter: filter } };
  if (args.service === 'yellowstone') {
    if (args.vote !== undefined) filter.vote = args.vote;
    if (args.failed !== undefined) filter.failed = args.failed;
    if (args.commitment) yamlConfig.commitment = args.commitment;
  }
  yamlConfig.reconnect = { initial_delay_ms: 100, max_delay_ms: 30_000, multiplier: 2.0, max_retries: 0 };
  const jet = args.service === 'jetstream';
  const region = jet ? toJetstreamRegion(args.region ?? defaultJetstreamRegion()) : args.region;
  const grpcEndpoint = jet ? getJetstreamUrl(region as JetstreamRegion) : getYellowstoneUrl(region);
  return {
    service: args.service,
    region: new URL(grpcEndpoint).hostname.split('.')[0],
    grpcEndpoint,
    authNote: jet
      ? 'Jetstream authenticates by IP whitelist or an x-token gRPC metadata header.'
      : 'Authenticate with the x-token gRPC metadata header set to your gRPC token (Dashboard > Licenses).',
    connectionLimitNote: 'Shared plans cap concurrent gRPC connections at 50 per IP across all regions.',
    cliCommand: jet ? 'orbitflare jet --config stream.yml' : 'orbitflare grpc --config stream.yml',
    yamlConfig,
    docs: jet
      ? 'https://docs.orbitflare.com/data-streaming/jetstream'
      : 'https://docs.orbitflare.com/data-streaming/yellowstone',
  };
}

export function registerStreamingTools(server: McpServer): void {
  defineTool(
    server,
    'watchTransactions',
    {
      title: 'Watch Transactions (Jetstream)',
      description:
        'Streams live transactions from OrbitFlare Jetstream (v2, shred-level latency) for a bounded window, then returns what it saw: count, rate, slots, top programs and a sample of transactions (signature, fee payer, programs, compute-unit price, priority fee). Filter by accounts or programs the transaction touches. Stops after durationSeconds or maxEvents. Jetstream authenticates by IP whitelist. configOnly returns a ready-to-run Jetstream or Yellowstone config for long-lived streaming instead of connecting.',
      input: {
        accountInclude: accountList('Match transactions touching ANY of these accounts/programs'),
        accountRequired: accountList('Match transactions touching at least one of these (Jetstream semantics)'),
        accountExclude: accountList('Drop transactions touching any of these'),
        durationSeconds: z.number().min(1).max(60).optional().describe('How long to listen (default 10)'),
        maxEvents: z.number().int().min(1).max(1000).optional().describe('Stop after this many transactions (default 100)'),
        sampleSize: z.number().int().min(0).max(100).optional().describe('Transactions to return in full (default 20)'),
        includeEnrichment: z.boolean().optional().describe('Fee payer, program ids, CU price and priority fee (default true)'),
        region: z
          .enum(STREAM_REGIONS)
          .optional()
          .describe(
            'Jetstream regions: ny, slc, fra, ams, lon, dub, sqq, jp, sgp (va, la and sg map to the nearest one). Yellowstone (configOnly) regions: va, ny, la, slc, ams, fra, lon, jp, sg. Default derived from the RPC region, or ORBITFLARE_JETSTREAM_URL',
          ),
        configOnly: z.boolean().optional().describe('Return a stream config for the OrbitFlare CLI or any client instead of connecting'),
        service: z.enum(['jetstream', 'yellowstone']).optional().describe('configOnly: which service (default jetstream)'),
        vote: z.boolean().optional().describe('configOnly + yellowstone: include vote transactions'),
        failed: z.boolean().optional().describe('configOnly + yellowstone: include failed transactions'),
        commitment: z.enum(['processed', 'confirmed', 'finalized']).optional().describe('configOnly + yellowstone'),
      },
      annotations: READ,
    },
    async (args) => {
      if (args.configOnly) {
        return asJson(
          streamConfig({ ...args, service: args.service ?? 'jetstream' }),
          'Save yamlConfig as stream.yml and run cliCommand to stream continuously.',
        );
      }
      if (!args.accountInclude?.length && !args.accountRequired?.length && !args.accountExclude?.length) {
        throw new Error('Pass at least one of accountInclude, accountRequired or accountExclude (empty filters are rejected).');
      }
      const url = getJetstreamUrl(args.region ? toJetstreamRegion(args.region) : undefined);
      const durationMs = (args.durationSeconds ?? 10) * 1000;
      const maxEvents = args.maxEvents ?? 100;
      const sampleSize = args.sampleSize ?? 20;
      const filter = new TransactionFilter()
        .accountInclude(args.accountInclude ?? [])
        .accountRequired(args.accountRequired ?? [])
        .accountExclude(args.accountExclude ?? [])
        .includeEnrichment(args.includeEnrichment ?? true)
        .withId('mcp');
      const apiKey = getApiKey();
      const builder = new JetstreamClientBuilder()
        .url(url)
        .logger(sdkLogger)
        .timeoutSecs(10)
        .pingIntervalSecs(2)
        .maxMissedPongs(5)
        .retry({ initialDelayMs: 250, maxDelayMs: 2_000, multiplier: 2, maxAttempts: 3 });
      const client = (apiKey ? builder.apiKey(apiKey) : builder).build();

      const started = Date.now();
      const deadline = started + durationMs;
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<typeof TIMEOUT>((r) => (timer = setTimeout(() => r(TIMEOUT), durationMs)));
      const stream = client.subscribeTransactions([filter]);
      const sample: unknown[] = [];
      const programs = new Map<string, number>();
      let count = 0;
      let firstSlot: number | null = null;
      let lastSlot: number | null = null;
      let heartbeats = 0;
      let firstEventAt: number | null = null;
      let filterResult: { accepted: boolean; rejectionReason: string } | null = null;
      let stoppedBy = 'duration';
      let streamError: string | null = null;

      try {
        while (count < maxEvents && Date.now() < deadline) {
          const next = await Promise.race([stream.next(), expired]);
          if (next === TIMEOUT) break;
          if (next === undefined) {
            stoppedBy = 'stream closed';
            await stream.next();
            break;
          }
          if (next.filterValidation) {
            filterResult = { accepted: next.filterValidation.accepted, rejectionReason: next.filterValidation.rejectionReason };
            if (!next.filterValidation.accepted) {
              stoppedBy = 'filter rejected';
              break;
            }
          }
          if (next.heartbeat) heartbeats++;
          const tx = next.transaction?.transaction;
          if (!tx) continue;
          count++;
          firstEventAt ??= Date.now();
          const slot = Number(tx.slot);
          firstSlot = firstSlot === null ? slot : Math.min(firstSlot, slot);
          lastSlot = lastSlot === null ? slot : Math.max(lastSlot, slot);
          const programIds = tx.programIds.map((p) => bs58.encode(p));
          for (const p of programIds) programs.set(p, (programs.get(p) ?? 0) + 1);
          if (sample.length < sampleSize) {
            sample.push({
              signature: b58(tx.signature),
              slot,
              txIndex: tx.txIndex,
              version: txVersion(tx),
              isVote: tx.isVote,
              feePayer: b58(tx.feePayer),
              programIds,
              instructions: tx.instructions.length,
              accounts: tx.accountKeys.length + tx.loadedWritableAddresses.length + tx.loadedReadonlyAddresses.length,
              computeUnitPrice: tx.computeUnitPrice ? Number(tx.computeUnitPrice) : null,
              computeLimit: tx.computeLimit || null,
              priorityFeeLamports: tx.priorityFeeLamports !== undefined ? Number(tx.priorityFeeLamports) : null,
              sizeBytes: tx.txSize || null,
              receivedAt: next.createdAt?.toISOString() ?? new Date().toISOString(),
            });
          }
          if (count >= maxEvents) stoppedBy = 'maxEvents';
        }
      } catch (err) {
        streamError = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
        stream.close();
      }

      if (streamError && count === 0) {
        throw new Error(
          `Jetstream stream failed (${sanitizeUrl(url)}): ${streamError}. Jetstream allows whitelisted IPs only; check the license IP whitelist (manageLicense addIp) or try another region.`,
        );
      }
      const finishedAt = Date.now();
      const elapsedMs = finishedAt - started;
      const streamingMs = firstEventAt === null ? 0 : finishedAt - firstEventAt;
      return asJson({
        endpoint: sanitizeUrl(url),
        protocol: 'jetstream-v2',
        filter: { accountInclude: args.accountInclude ?? [], accountRequired: args.accountRequired ?? [], accountExclude: args.accountExclude ?? [] },
        filterAccepted: filterResult?.accepted ?? null,
        ...(filterResult?.rejectionReason ? { rejectionReason: filterResult.rejectionReason } : {}),
        stoppedBy: streamError ? `error: ${streamError}` : stoppedBy,
        elapsedMs,
        firstEventAfterMs: firstEventAt === null ? null : firstEventAt - started,
        transactionCount: count,
        perSecond: streamingMs > 0 ? +(count / (streamingMs / 1000)).toFixed(2) : 0,
        slots: { first: firstSlot, last: lastSlot },
        heartbeats,
        topPrograms: [...programs.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([program, transactions]) => ({ program, transactions })),
        sample,
      });
    },
  );

  defineTool(
    server,
    'watchAccounts',
    {
      title: 'Watch Accounts',
      description:
        'Subscribes to live changes on up to 20 accounts over the OrbitFlare WebSocket (accountSubscribe) for a bounded window and returns every update seen: lamports, owner and data size per change, plus a per-account summary. Use it to watch a wallet balance, a pool or an oracle. Stops after durationSeconds or maxEvents.',
      input: {
        accounts: z.array(z.string().min(32).max(44)).min(1).max(20),
        durationSeconds: z.number().min(1).max(60).optional().describe('Default 10'),
        maxEvents: z.number().int().min(1).max(500).optional().describe('Default 100'),
        commitment: z.enum(['processed', 'confirmed', 'finalized']).optional().describe('Default confirmed'),
        includeData: z.boolean().optional().describe('Include base64 account data for each update (default false)'),
      },
      annotations: READ,
    },
    async ({ accounts, durationSeconds, maxEvents, commitment, includeData }) => {
      const url = getWsUrl();
      const apiKey = getApiKey();
      if (!apiKey && url.includes('orbitflare.com') && !url.includes('api_key=')) throw new MissingApiKeyError('rpc');
      const limit = maxEvents ?? 100;
      const events: Record<string, unknown>[] = [];
      const initial = await rpcCall<{ value: ({ lamports: number } | null)[] }>('getMultipleAccounts', [
        accounts,
        { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, commitment: commitment ?? 'confirmed' },
      ]).catch(() => null);
      const summary = new Map<string, { updates: number; startLamports: number | null; lastLamports: number | null }>(
        accounts.map((a, i) => {
          const lamports = initial ? (initial.value[i]?.lamports ?? 0) : null;
          return [a, { updates: 0, startLamports: lamports, lastLamports: lamports }];
        }),
      );
      const started = Date.now();
      let client;
      try {
        client = await new WsClientBuilder()
          .url(url)
          .apiKey(apiKey ?? '')
          .logger(sdkLogger)
          .retry({ initialDelayMs: 250, maxDelayMs: 2_000, multiplier: 2, maxAttempts: 2 })
          .build();
      } catch (err) {
        throw new Error(`WebSocket connection to ${sanitizeUrl(url)} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      let stoppedBy = 'duration';
      let done: () => void = () => {};
      const finished = new Promise<void>((r) => (done = r));
      const subs: WsSubscription[] = [];
      try {
        for (const account of accounts) {
          const sub = await client.accountSubscribe(account, commitment ?? 'confirmed');
          subs.push(sub);
          sub.on((value: { lamports: number; owner: string; data: [string, string] | string; executable: boolean; space?: number }) => {
            if (events.length >= limit) return;
            const raw = Array.isArray(value?.data) ? value.data[0] : '';
            const s = summary.get(account)!;
            s.updates++;
            s.lastLamports = value?.lamports ?? null;
            events.push({
              account,
              receivedAt: new Date().toISOString(),
              lamports: value?.lamports,
              sol: lamportsToSol(value?.lamports ?? 0),
              owner: value?.owner,
              dataBytes: value?.space ?? Buffer.from(raw, 'base64').length,
              ...(includeData ? { data: raw } : {}),
            });
            if (events.length >= limit) {
              stoppedBy = 'maxEvents';
              done();
            }
          });
        }
        await Promise.race([finished, sleep((durationSeconds ?? 10) * 1000)]);
      } finally {
        await Promise.allSettled(subs.map((s) => s.unsubscribe()));
        await client.close();
      }
      return asJson({
        endpoint: sanitizeUrl(url),
        stoppedBy,
        elapsedMs: Date.now() - started,
        updateCount: events.length,
        accounts: [...summary.entries()].map(([account, s]) => ({
          account,
          updates: s.updates,
          startLamports: s.startLamports,
          lastLamports: s.lastLamports,
          lamportsChange: s.startLamports !== null && s.lastLamports !== null ? s.lastLamports - s.startLamports : null,
        })),
        events,
      });
    },
  );
}
