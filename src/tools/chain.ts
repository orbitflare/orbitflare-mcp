import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sanitizeUrl } from '@orbitflare/sdk';
import { getNetwork, getRegion, getRpcUrls } from '../config.js';
import { asJson, lamportsToSol } from '../utils/formatters.js';
import { isMethodNotFound, rpcCall } from '../utils/rpc.js';
import { defineTool, READ } from './define.js';

const commitment = z.enum(['processed', 'confirmed', 'finalized']).optional().describe('Default confirmed');
const encoding = z
  .enum(['jsonParsed', 'base64', 'base58', 'base64+zstd'])
  .optional()
  .describe('Account data encoding (default jsonParsed, which decodes token, stake, nonce, vote and other known accounts)');

interface RpcAccount {
  lamports: number;
  owner: string;
  executable: boolean;
  rentEpoch: number | string;
  space?: number;
  data: unknown;
}

function shapeAccount(address: string, acc: RpcAccount | null) {
  if (!acc) return { address, exists: false };
  const data = acc.data as { parsed?: { type?: string; info?: unknown }; program?: string } | unknown[];
  const parsed = !Array.isArray(data) && data && typeof data === 'object' && 'parsed' in data ? data : null;
  return {
    address,
    exists: true,
    lamports: acc.lamports,
    sol: lamportsToSol(acc.lamports),
    owner: acc.owner,
    executable: acc.executable,
    space: acc.space ?? null,
    ...(parsed
      ? { program: parsed.program ?? null, type: parsed.parsed?.type ?? null, parsed: parsed.parsed?.info ?? parsed.parsed }
      : { data: acc.data }),
  };
}

function toUnix(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : value;
  if (/^\d+$/.test(value)) return toUnix(Number(value));
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Cannot parse time "${value}". Use ISO 8601 or unix seconds.`);
  return Math.floor(ms / 1000);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const WRITE_METHODS = new Set(['sendTransaction', 'sendRawTransaction', 'requestAirdrop', 'sendBundle']);

interface ParsedTx {
  slot: number;
  blockTime: number | null;
  version?: number | string;
  meta: {
    err: unknown;
    fee: number;
    computeUnitsConsumed?: number;
    logMessages?: string[];
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: { programId: string; program?: string; parsed?: { type?: string; info?: unknown }; data?: string; accounts?: string[] }[];
    };
  };
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmountString?: string; amount: string; decimals: number };
}

function summarizeTx(signature: string, tx: ParsedTx) {
  const keys = tx.transaction.message.accountKeys;
  const meta = tx.meta;
  const solChanges = meta
    ? keys
        .map((k, i) => ({ account: k.pubkey, change: meta.postBalances[i] - meta.preBalances[i] }))
        .filter((c) => c.change !== 0)
        .map((c) => ({ account: c.account, lamports: c.change, sol: lamportsToSol(c.change) }))
    : [];
  const tokenChanges: { owner: string | null; mint: string; change: number }[] = [];
  if (meta) {
    const pre = new Map((meta.preTokenBalances ?? []).map((b) => [`${b.accountIndex}`, b]));
    const post = new Map((meta.postTokenBalances ?? []).map((b) => [`${b.accountIndex}`, b]));
    for (const idx of new Set([...pre.keys(), ...post.keys()])) {
      const a = pre.get(idx);
      const b = post.get(idx);
      const ref = (b ?? a)!;
      const decimals = ref.uiTokenAmount.decimals;
      const change = (Number(b?.uiTokenAmount.amount ?? 0) - Number(a?.uiTokenAmount.amount ?? 0)) / 10 ** decimals;
      if (change !== 0) tokenChanges.push({ owner: ref.owner ?? null, mint: ref.mint, change });
    }
  }
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    time: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    version: tx.version ?? 'legacy',
    status: meta?.err ? 'failed' : 'success',
    error: meta?.err ?? null,
    feeLamports: meta?.fee ?? null,
    computeUnitsConsumed: meta?.computeUnitsConsumed ?? null,
    signers: keys.filter((k) => k.signer).map((k) => k.pubkey),
    instructions: tx.transaction.message.instructions.map((ix) => ({
      program: ix.program ?? null,
      programId: ix.programId,
      ...(ix.parsed ? { type: ix.parsed.type ?? null, info: ix.parsed.info ?? ix.parsed } : { accounts: ix.accounts?.length ?? 0 }),
    })),
    solChanges,
    tokenChanges,
    logs: meta?.logMessages ?? [],
  };
}

export function registerChainTools(server: McpServer): void {
  defineTool(
    server,
    'getAccount',
    {
      title: 'Get Account',
      description:
        'Reads one or up to 100 Solana accounts: SOL balance, owner program, executable flag, and decoded data (token accounts, mints, stake accounts, nonce, vote and other known types come back parsed). Use it for "balance of X", "who owns this account", or inspecting a token/stake account. For everything a wallet holds use getWalletPortfolio.',
      input: {
        address: z.string().min(32).max(44).optional().describe('One account address'),
        addresses: z.array(z.string()).min(1).max(100).optional().describe('Up to 100 addresses'),
        encoding,
        dataSlice: z
          .object({ offset: z.number().int().nonnegative(), length: z.number().int().nonnegative() })
          .optional()
          .describe('Return only part of the account data (binary encodings only)'),
        commitment,
      },
      annotations: READ,
    },
    async ({ address, addresses, encoding: enc, dataSlice, commitment: c }) => {
      const list = addresses ?? (address ? [address] : null);
      if (!list) throw new Error('Pass address or addresses.');
      const config = {
        encoding: enc ?? 'jsonParsed',
        commitment: c ?? 'confirmed',
        ...(dataSlice ? { dataSlice } : {}),
      };
      const result = await rpcCall<{ context: { slot: number }; value: (RpcAccount | null)[] }>('getMultipleAccounts', [
        list,
        config,
      ]);
      const accounts = list.map((a, i) => shapeAccount(a, result.value[i]));
      return asJson(address && !addresses ? { slot: result.context.slot, ...accounts[0] } : { slot: result.context.slot, accounts });
    },
  );

  defineTool(
    server,
    'getTransaction',
    {
      title: 'Get Transaction',
      description:
        'Fetches a confirmed transaction by signature and returns a readable summary: status and error, fee, compute units, signers, parsed instructions, SOL and token balance changes, and logs. detail: "full" also returns the raw jsonParsed transaction.',
      input: {
        signature: z.string().min(64).max(100).describe('Transaction signature (base-58)'),
        detail: z.enum(['summary', 'full']).optional().describe('Default summary'),
        commitment: z.enum(['confirmed', 'finalized']).optional(),
      },
      annotations: READ,
    },
    async ({ signature, detail, commitment: c }) => {
      const tx = await rpcCall<ParsedTx | null>('getTransaction', [
        signature,
        { encoding: 'jsonParsed', commitment: c ?? 'confirmed', maxSupportedTransactionVersion: 1 },
      ]);
      if (!tx) {
        return asJson(
          { signature, found: false },
          'Transaction not found at this commitment. It may not have landed yet, or try commitment "finalized" or a few seconds later.',
        );
      }
      return asJson({ found: true, ...summarizeTx(signature, tx), ...(detail === 'full' ? { raw: tx } : {}) });
    },
  );

  defineTool(
    server,
    'getTransactionHistory',
    {
      title: 'Get Transaction History',
      description:
        'Transaction history for any address using OrbitFlare\'s getTransactionsForAddress: newest or oldest first, time and slot ranges, success/failed filter, optional inclusion of the wallet\'s token accounts, and full transactions in one call (no N+1 getTransaction calls). transactionDetails "full" returns a per-transaction summary (status, fee, signers, instructions, SOL and token balance changes); add raw: true for the complete transactions, which are large, so keep limit small. Paginate with the returned paginationToken.',
      input: {
        address: z.string().min(32).max(44),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Default 25 (10 for full). Max 1000 for signatures; full and accounts are capped at 100 by the server.'),
        transactionDetails: z
          .enum(['signatures', 'accounts', 'full'])
          .optional()
          .describe('signatures (default): signature, slot, time, status, memo. accounts: plus account keys. full: summarized transactions (see raw).'),
        sortOrder: z.enum(['desc', 'asc']).optional().describe('desc = newest first (default), asc = oldest first'),
        from: z.union([z.string(), z.number()]).optional().describe('Start time (ISO 8601 or unix seconds), inclusive'),
        to: z.union([z.string(), z.number()]).optional().describe('End time (ISO 8601 or unix seconds), inclusive'),
        fromSlot: z.number().int().nonnegative().optional(),
        toSlot: z.number().int().nonnegative().optional(),
        status: z.enum(['succeeded', 'failed']).optional(),
        tokenAccounts: z
          .enum(['none', 'balanceChanged', 'all'])
          .optional()
          .describe('Also include transactions on token accounts the address owns. balanceChanged is the clean wallet view.'),
        paginationToken: z.string().optional().describe('From a previous response, to fetch the next page'),
        raw: z.boolean().optional().describe('For full only: return the complete transactions instead of summaries'),
        encoding: z
          .enum(['json', 'jsonParsed', 'base64', 'base58'])
          .optional()
          .describe('For full only (default jsonParsed). Any other encoding implies raw.'),
        commitment: z.enum(['confirmed', 'finalized']).optional().describe('Default finalized'),
      },
      annotations: READ,
    },
    async (args) => {
      const details = args.transactionDetails ?? 'signatures';
      const blockTime = { gte: toUnix(args.from), lte: toUnix(args.to) };
      const slot = { gte: args.fromSlot, lte: args.toSlot };
      const filters = Object.fromEntries(
        Object.entries({
          blockTime: blockTime.gte !== undefined || blockTime.lte !== undefined ? blockTime : undefined,
          slot: slot.gte !== undefined || slot.lte !== undefined ? slot : undefined,
          status: args.status,
          tokenAccounts: args.tokenAccounts,
        }).filter(([, v]) => v !== undefined),
      );
      const options = Object.fromEntries(
        Object.entries({
          transactionDetails: details,
          limit: args.limit ?? (details === 'full' ? 10 : 25),
          sortOrder: args.sortOrder,
          paginationToken: args.paginationToken,
          commitment: args.commitment,
          encoding: details === 'full' ? (args.encoding ?? 'jsonParsed') : undefined,
          maxSupportedTransactionVersion: details === 'full' || details === 'accounts' ? 1 : undefined,
          filters: Object.keys(filters).length ? filters : undefined,
        }).filter(([, v]) => v !== undefined),
      );
      try {
        const result = await rpcCall<{ data?: unknown[]; paginationToken?: string }>('getTransactionsForAddress', [
          args.address,
          options,
        ]);
        const data = result?.data ?? [];
        const encodingUsed = args.encoding ?? 'jsonParsed';
        const summarize = details === 'full' && !args.raw && encodingUsed === 'jsonParsed';
        return asJson({
          address: args.address,
          count: data.length,
          transactions: summarize
            ? (data as (ParsedTx & { transactionIndex?: number })[]).map((tx) => {
                const { logs: _logs, ...summary } = summarizeTx(tx.transaction.signatures[0], tx);
                return { ...summary, transactionIndex: tx.transactionIndex ?? null };
              })
            : data,
          paginationToken: result?.paginationToken ?? null,
          hasMore: Boolean(result?.paginationToken),
        });
      } catch (err) {
        const simple = details === 'signatures' && !Object.keys(filters).length && !args.sortOrder && !args.paginationToken;
        if (!isMethodNotFound(err) || !simple) throw err;
        const sigs = await rpcCall<unknown[]>('getSignaturesForAddress', [
          args.address,
          { limit: Math.min(args.limit ?? 25, 1000), commitment: args.commitment ?? 'confirmed' },
        ]);
        return asJson(
          { address: args.address, count: sigs.length, transactions: sigs, paginationToken: null, hasMore: false },
          'This endpoint has no getTransactionsForAddress, so this is plain getSignaturesForAddress output.',
        );
      }
    },
  );

  defineTool(
    server,
    'getPriorityFees',
    {
      title: 'Get Priority Fees',
      description:
        'Recent prioritization fees (micro-lamports per compute unit) over the last ~150 slots, with percentiles and a recommended compute-unit price for a ComputeBudget setComputeUnitPrice instruction. Each sample is the lowest fee that landed in that slot among transactions write-locking the given accounts, so without accounts (or with read-only ones such as program ids) it is usually 0. Pass the writable accounts your transaction touches (e.g. a pool, market or bonding-curve account) for a useful local fee-market estimate.',
      input: {
        accounts: z
          .array(z.string())
          .max(128)
          .optional()
          .describe('Writable accounts the transaction will lock (not program ids, which are read-only)'),
        priority: z
          .enum(['low', 'medium', 'high', 'veryHigh'])
          .optional()
          .describe('Which level to recommend: low=p25, medium=p50 (default), high=p75, veryHigh=p95'),
        computeUnits: z.number().int().positive().max(1_400_000).optional().describe('To estimate the priority fee in lamports (default 200000)'),
      },
      output: {
        sampleCount: z.number(),
        slotRange: z.object({ from: z.number().nullable(), to: z.number().nullable() }),
        basis: z.string(),
        microLamportsPerCu: z.object({
          min: z.number(),
          p25: z.number(),
          p50: z.number(),
          p75: z.number(),
          p90: z.number(),
          p95: z.number(),
          p99: z.number(),
          max: z.number(),
        }),
        recommended: z.object({
          priority: z.string(),
          microLamportsPerCu: z.number(),
          computeUnits: z.number(),
          estimatedPriorityFeeLamports: z.number(),
          estimatedPriorityFeeSol: z.string(),
        }),
        note: z.string().optional(),
      },
      annotations: READ,
    },
    async ({ accounts, priority, computeUnits }) => {
      const samples = await rpcCall<{ slot: number; prioritizationFee: number }[]>(
        'getRecentPrioritizationFees',
        accounts?.length ? [accounts] : [],
      );
      const all = samples.map((s) => s.prioritizationFee).sort((a, b) => a - b);
      const nonZero = all.filter((f) => f > 0);
      const useNonZero = nonZero.length >= 10;
      const fees = useNonZero ? nonZero : all;
      const levels = { low: 25, medium: 50, high: 75, veryHigh: 95 } as const;
      const level = priority ?? 'medium';
      const price = percentile(fees, levels[level]);
      const cu = computeUnits ?? 200_000;
      const lamports = Math.ceil((price * cu) / 1_000_000);
      const slots = samples.map((s) => s.slot);
      return asJson({
        sampleCount: samples.length,
        slotRange: { from: slots.length ? Math.min(...slots) : null, to: slots.length ? Math.max(...slots) : null },
        basis: useNonZero
          ? `percentiles over ${nonZero.length} slots with a non-zero fee`
          : 'percentiles over all slots (few non-zero samples)',
        microLamportsPerCu: {
          min: fees[0] ?? 0,
          p25: percentile(fees, 25),
          p50: percentile(fees, 50),
          p75: percentile(fees, 75),
          p90: percentile(fees, 90),
          p95: percentile(fees, 95),
          p99: percentile(fees, 99),
          max: fees[fees.length - 1] ?? 0,
        },
        recommended: {
          priority: level,
          microLamportsPerCu: price,
          computeUnits: cu,
          estimatedPriorityFeeLamports: lamports,
          estimatedPriorityFeeSol: lamportsToSol(lamports),
        },
        ...(nonZero.length === 0
          ? {
              note: accounts?.length
                ? 'No non-zero fees in recent slots for these accounts. If they are program ids or other read-only accounts, pass the writable accounts instead.'
                : 'No non-zero fees in recent slots. Pass the writable accounts your transaction touches for a local fee-market estimate.',
            }
          : {}),
      });
    },
  );

  defineTool(
    server,
    'getNetworkStatus',
    {
      title: 'Get Network Status',
      description:
        'One-call health check of the configured OrbitFlare endpoint and the cluster: node health, version, current slot, block height, epoch progress, latest blockhash (with last valid block height for building transactions), and round-trip latency.',
      input: {},
      output: {
        endpoint: z.string(),
        fallbackEndpoints: z.number(),
        network: z.string(),
        region: z.string(),
        latencyMs: z.number().nullable(),
        health: z.any(),
        version: z.any(),
        slot: z.any(),
        blockHeight: z.any(),
        epoch: z.any(),
        latestBlockhash: z.any(),
      },
      annotations: READ,
    },
    async () => {
      const start = performance.now();
      const settled = await Promise.allSettled([
        rpcCall<string>('getHealth'),
        rpcCall<{ 'solana-core': string; 'feature-set'?: number }>('getVersion'),
        rpcCall<number>('getSlot', [{ commitment: 'confirmed' }]),
        rpcCall<number>('getBlockHeight', [{ commitment: 'confirmed' }]),
        rpcCall<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }>('getEpochInfo', [
          { commitment: 'confirmed' },
        ]),
        rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [
          { commitment: 'confirmed' },
        ]),
      ]);
      const latencyMs = Math.round(performance.now() - start);
      const val = <T,>(s: PromiseSettledResult<T>): T | { error: string } =>
        s.status === 'fulfilled' ? s.value : { error: s.reason instanceof Error ? s.reason.message : String(s.reason) };
      if (settled.every((s) => s.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason;
      const epoch = settled[4];
      const blockhash = settled[5];
      const urls = getRpcUrls();
      return asJson({
        endpoint: sanitizeUrl(urls[0]),
        fallbackEndpoints: urls.length - 1,
        network: getNetwork(),
        region: getRegion(),
        latencyMs,
        health: val(settled[0]),
        version: val(settled[1]),
        slot: val(settled[2]),
        blockHeight: val(settled[3]),
        epoch:
          epoch.status === 'fulfilled'
            ? {
                ...epoch.value,
                progressPct: +((epoch.value.slotIndex / epoch.value.slotsInEpoch) * 100).toFixed(2),
                remainingSlots: epoch.value.slotsInEpoch - epoch.value.slotIndex,
                approxHoursRemaining: +(((epoch.value.slotsInEpoch - epoch.value.slotIndex) * 0.4) / 3600).toFixed(1),
              }
            : val(epoch),
        latestBlockhash: blockhash.status === 'fulfilled' ? blockhash.value.value : val(blockhash),
      });
    },
  );

  defineTool(
    server,
    'rpcRequest',
    {
      title: 'Raw RPC Request',
      description:
        'Calls any read-only Solana JSON-RPC or DAS method on the OrbitFlare endpoint (with failover and retry) when no dedicated tool covers it: getSlot, getBlock, getTokenSupply, getTokenLargestAccounts, getProgramAccounts, getMinimumBalanceForRentExemption, getFeeForMessage, getSignatureStatuses, getVoteAccounts, getInflationReward, getAssetsByGroup, etc. Array results are capped at maxItems. Sending transactions is not allowed here; use sendTransaction.',
      input: {
        method: z.string().min(3).describe('JSON-RPC method name, e.g. "getTokenLargestAccounts"'),
        params: z
          .union([z.array(z.any()), z.record(z.string(), z.any())])
          .optional()
          .describe('Positional array (standard RPC) or named object (DAS methods)'),
        maxItems: z.number().int().min(1).max(5000).optional().describe('Cap for array results (default 100)'),
      },
      annotations: READ,
    },
    async ({ method, params, maxItems }) => {
      if (WRITE_METHODS.has(method)) {
        throw new Error(`${method} is not allowed through rpcRequest. Use sendTransaction (which asks for confirmation).`);
      }
      const result = await rpcCall<unknown>(method, params ?? []);
      const cap = maxItems ?? 100;
      const cut = (arr: unknown[]) => ({ items: arr.slice(0, cap), total: arr.length });
      if (Array.isArray(result) && result.length > cap) {
        const { items, total } = cut(result);
        return asJson({ method, result: items, truncated: { total, returned: items.length } });
      }
      const value = (result as { value?: unknown })?.value;
      if (Array.isArray(value) && value.length > cap) {
        const { items, total } = cut(value);
        return asJson({
          method,
          result: { ...(result as object), value: items },
          truncated: { total, returned: items.length },
        });
      }
      return asJson({ method, result });
    },
  );
}
