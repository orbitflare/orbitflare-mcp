import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, mockRpc, mockServer, RpcError, spawnServer, type Harness, type MockHttp } from './helpers.js';

const OWNER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NFT = 'GJfYbfW7gufzFYfm8gFatrUE71wYsjay6FwzDkTa3vaD';
const SIG = '5'.repeat(88);
const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';

const fungible = {
  interface: 'FungibleToken',
  id: MINT,
  content: { metadata: { name: 'USD Coin', symbol: 'USDC' } },
  ownership: { owner: OWNER, ownership_model: 'token', frozen: false, delegated: false, delegate: null },
  token_info: {
    symbol: 'USDC',
    balance: 2_500_000,
    supply: 9_000_000_000_000,
    decimals: 6,
    token_program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associated_token_address: 'ATA1111111111111111111111111111111111111111',
    price_info: { price_per_token: 1, total_price: 2.5, currency: 'USDC' },
  },
};
const cheap = {
  ...fungible,
  id: 'So11111111111111111111111111111111111111112',
  content: { metadata: { name: 'Wrapped SOL', symbol: 'WSOL' } },
  token_info: { ...fungible.token_info, symbol: 'WSOL', balance: 1, decimals: 9, price_info: { price_per_token: 150, total_price: 0.00000015, currency: 'USDC' } },
};
const nft = {
  interface: 'V1_NFT',
  id: NFT,
  content: { metadata: { name: 'Mad Lad #1', symbol: 'MAD' }, links: { image: 'https://img/1.png' } },
  grouping: [{ group_key: 'collection', group_value: 'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w' }],
  compression: { compressed: true, eligible: false, data_hash: '', creator_hash: '', asset_hash: '', tree: 'Tree1111111111111111111111111111111111111111', seq: 1, leaf_id: 7 },
  ownership: { owner: OWNER, ownership_model: 'single', frozen: false, delegated: false, delegate: null },
  royalty: { basis_points: 500 },
  mutable: true,
  burnt: false,
};

const parsedTx = {
  slot: 300,
  blockTime: 1_700_000_000,
  version: 0,
  meta: {
    err: null,
    fee: 5000,
    computeUnitsConsumed: 450,
    logMessages: ['Program 11111111111111111111111111111111 invoke [1]', 'Program 11111111111111111111111111111111 success'],
    preBalances: [2_000_000_000, 0, 1],
    postBalances: [1_499_995_000, 500_000_000, 1],
    preTokenBalances: [],
    postTokenBalances: [],
  },
  transaction: {
    signatures: [SIG],
    message: {
      accountKeys: [
        { pubkey: OWNER, signer: true, writable: true },
        { pubkey: 'Dest111111111111111111111111111111111111111', signer: false, writable: true },
        { pubkey: '11111111111111111111111111111111', signer: false, writable: false },
      ],
      instructions: [
        {
          program: 'system',
          programId: '11111111111111111111111111111111',
          parsed: { type: 'transfer', info: { source: OWNER, destination: 'Dest111111111111111111111111111111111111111', lamports: 500_000_000 } },
        },
      ],
    },
  },
};

let historySupported = true;

const handlers = {
  getMultipleAccounts: (params: any) => ({
    context: { slot: 77 },
    value: params[0].map((a: string) =>
      a === 'Missing111111111111111111111111111111111111'
        ? null
        : {
            lamports: 1_500_000_000,
            owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            executable: false,
            rentEpoch: 0,
            space: 165,
            data: { program: 'spl-token', parsed: { type: 'account', info: { mint: MINT, tokenAmount: { uiAmount: 2.5 } } } },
          },
    ),
  }),
  getTransaction: (params: any) => (params[0] === SIG ? parsedTx : null),
  getTransactionsForAddress: (params: any) =>
    historySupported
      ? params[1]?.transactionDetails === 'full'
        ? { data: [{ ...parsedTx, transactionIndex: 4 }] }
        : { data: [{ signature: SIG, slot: 300, blockTime: 1_700_000_000, err: null }], paginationToken: '300:1' }
      : new RpcError(-32601, 'Method not found'),
  getSignaturesForAddress: () => [{ signature: SIG, slot: 300, err: null }],
  getRecentPrioritizationFees: (params: any) =>
    Array.from({ length: 20 }, (_, i) => ({ slot: 1000 + i, prioritizationFee: params.length ? (i + 1) * 1000 : i < 15 ? 0 : 100 })),
  getHealth: () => 'ok',
  getVersion: () => ({ 'solana-core': '2.3.0', 'feature-set': 1 }),
  getSlot: () => 12345,
  getBlockHeight: () => 12000,
  getEpochInfo: () => ({ epoch: 800, slotIndex: 216000, slotsInEpoch: 432000, absoluteSlot: 12345 }),
  getLatestBlockhash: () => ({ context: { slot: 1 }, value: { blockhash: 'Hash1111111111111111111111111111111111111111', lastValidBlockHeight: 12150 } }),
  getTokenLargestAccounts: () => ({ context: { slot: 1 }, value: Array.from({ length: 30 }, (_, i) => ({ address: `acc${i}`, amount: '1' })) }),
  getTokenSupply: () => ({ context: { slot: 1 }, value: { amount: '10000000', decimals: 6, uiAmountString: '10' } }),
  getVoteAccounts: () => ({ current: [{ votePubkey: VOTE, activatedStake: 1_000_000_000_000, commission: 5, lastVote: 99 }], delinquent: [] }),
  getAccountInfo: () => ({
    context: { slot: 1 },
    value: {
      lamports: 2_002_282_880,
      owner: 'Stake11111111111111111111111111111111111111',
      data: {
        parsed: {
          type: 'delegated',
          info: {
            meta: { authorized: { staker: OWNER, withdrawer: OWNER } },
            stake: { delegation: { voter: VOTE, stake: '2000000000', activationEpoch: '799', deactivationEpoch: '18446744073709551615' } },
          },
        },
      },
    },
  }),
  getAssetsByOwner: (params: any) => ({ total: 3, limit: params.limit, page: params.page, items: [cheap, nft, fungible], nativeBalance: { lamports: 3_000_000_000, price_per_sol: 150, total_price: 450 } }),
  getAsset: () => nft,
  getAssetWithProof: () => ({ asset: nft, proof: { root: 'Root', proof: ['a', 'b', 'c', 'd'], node_index: 1, leaf: 'Leaf', tree_id: 'Tree' } }),
  getAssetBatch: (params: any) => params.ids.map((id: string) => (id === NFT ? nft : null)),
  getSignaturesForAsset: () => ({ total: 1, limit: 50, page: 1, items: [[SIG, 'Transfer']] }),
  searchAssets: (params: any) => ({ total: 1, limit: params.limit, page: params.page, items: [nft] }),
  getTokenAccounts: (params: any) => ({
    total: 2,
    limit: params.limit,
    page: params.page,
    token_accounts: [
      { address: 'acct1', mint: params.mint, owner: 'small', amount: 1_000_000, delegate: null, delegated_amount: 0, close_authority: null, frozen: false },
      { address: 'acct2', mint: params.mint, owner: 'whale', amount: 5_000_000, delegate: null, delegated_amount: 0, close_authority: null, frozen: false },
    ],
  }),
};

describe('chain and DAS tools (mock RPC)', () => {
  let rpc: MockHttp;
  let h: Harness;

  beforeAll(async () => {
    rpc = await mockRpc(handlers);
    h = await spawnServer({ ORBITFLARE_API_KEY: 'rpc-test-key', ORBITFLARE_RPC_URL: rpc.url });
  });

  afterAll(async () => {
    await h?.close();
    await rpc?.close();
  });

  beforeEach(() => {
    rpc.requests.length = 0;
    historySupported = true;
  });

  it('sends the license key as api_key on every request', async () => {
    await call(h.client, 'getAccount', { address: OWNER });
    expect(rpc.requests[0].query.get('api_key')).toBe('rpc-test-key');
  });

  it('getAccount returns one decoded account', async () => {
    const res = await call(h.client, 'getAccount', { address: OWNER });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ slot: 77, address: OWNER, exists: true, sol: '1.5', type: 'account', program: 'spl-token' });
    expect(res.json.parsed.mint).toBe(MINT);
    expect(rpc.rpc('getMultipleAccounts')[0].json.params[1]).toMatchObject({ encoding: 'jsonParsed', commitment: 'confirmed' });
  });

  it('getAccount batches and flags missing accounts', async () => {
    const res = await call(h.client, 'getAccount', { addresses: [OWNER, 'Missing111111111111111111111111111111111111'] });
    expect(res.json.accounts).toHaveLength(2);
    expect(res.json.accounts[1]).toEqual({ address: 'Missing111111111111111111111111111111111111', exists: false });
  });

  it('getTransaction summarizes balance changes and instructions', async () => {
    const res = await call(h.client, 'getTransaction', { signature: SIG });
    expect(res.json).toMatchObject({ found: true, status: 'success', feeLamports: 5000, signers: [OWNER] });
    expect(res.json.solChanges).toEqual([
      { account: OWNER, lamports: -500_005_000, sol: '-0.500005' },
      { account: 'Dest111111111111111111111111111111111111111', lamports: 500_000_000, sol: '0.5' },
    ]);
    expect(res.json.instructions[0]).toMatchObject({ program: 'system', type: 'transfer' });
    expect(res.json.raw).toBeUndefined();
  });

  it('getTransaction asks for version 1 transactions', async () => {
    await call(h.client, 'getTransaction', { signature: SIG });
    const [, options] = rpc.rpc('getTransaction').at(-1)!.json.params;
    expect(options).toMatchObject({ maxSupportedTransactionVersion: 1 });
  });

  it('getTransaction reports a missing signature', async () => {
    const res = await call(h.client, 'getTransaction', { signature: '4'.repeat(88) });
    expect(res.json).toEqual({ signature: '4'.repeat(88), found: false });
  });

  it('getTransactionHistory maps filters to getTransactionsForAddress', async () => {
    const res = await call(h.client, 'getTransactionHistory', {
      address: OWNER,
      limit: 50,
      from: '2024-01-01T00:00:00Z',
      to: 1706745600,
      status: 'succeeded',
      tokenAccounts: 'balanceChanged',
      sortOrder: 'asc',
      paginationToken: '100:2',
    });
    expect(res.json).toMatchObject({ count: 1, paginationToken: '300:1', hasMore: true });
    const [, options] = rpc.rpc('getTransactionsForAddress')[0].json.params;
    expect(options).toEqual({
      transactionDetails: 'signatures',
      limit: 50,
      sortOrder: 'asc',
      paginationToken: '100:2',
      filters: { blockTime: { gte: 1704067200, lte: 1706745600 }, status: 'succeeded', tokenAccounts: 'balanceChanged' },
    });
  });

  it('getTransactionHistory asks for full transactions with jsonParsed', async () => {
    const res = await call(h.client, 'getTransactionHistory', { address: OWNER, transactionDetails: 'full', fromSlot: 10 });
    const [, options] = rpc.rpc('getTransactionsForAddress')[0].json.params;
    expect(options).toMatchObject({ transactionDetails: 'full', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, filters: { slot: { gte: 10 } } });
    expect(res.isError).toBe(false);
    expect(res.json.transactions[0]).toMatchObject({ signature: SIG, status: 'success', feeLamports: 5000, transactionIndex: 4 });
    expect(res.json.transactions[0].solChanges).toHaveLength(2);
    expect(res.json.transactions[0].logs).toBeUndefined();

    const raw = await call(h.client, 'getTransactionHistory', { address: OWNER, transactionDetails: 'full', raw: true });
    expect(raw.json.transactions[0].meta.fee).toBe(5000);
  });

  it('getTransactionHistory falls back to getSignaturesForAddress when unsupported', async () => {
    historySupported = false;
    const res = await call(h.client, 'getTransactionHistory', { address: OWNER });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/plain getSignaturesForAddress/);
    expect(rpc.rpc('getSignaturesForAddress')).toHaveLength(1);
  });

  it('getPriorityFees recommends from non-zero samples and fills structured output', async () => {
    const res = await call(h.client, 'getPriorityFees', { accounts: [OWNER], priority: 'high', computeUnits: 100_000 });
    expect(res.structured.recommended).toEqual({
      priority: 'high',
      microLamportsPerCu: 16_000,
      computeUnits: 100_000,
      estimatedPriorityFeeLamports: 1600,
      estimatedPriorityFeeSol: '0.0000016',
    });
    expect(res.structured.microLamportsPerCu.max).toBe(20_000);
    expect(rpc.rpc('getRecentPrioritizationFees')[0].json.params).toEqual([[OWNER]]);
  });

  it('getPriorityFees uses all samples when most slots are zero', async () => {
    const res = await call(h.client, 'getPriorityFees');
    expect(res.structured.basis).toMatch(/all slots/);
    expect(res.structured.recommended.microLamportsPerCu).toBe(0);
  });

  it('getNetworkStatus combines health, slot, epoch and blockhash', async () => {
    const res = await call(h.client, 'getNetworkStatus');
    expect(res.isError).toBe(false);
    expect(res.structured).toMatchObject({
      endpoint: rpc.url,
      health: 'ok',
      slot: 12345,
      blockHeight: 12000,
      epoch: { epoch: 800, progressPct: 50, remainingSlots: 216000 },
      latestBlockhash: { lastValidBlockHeight: 12150 },
    });
  });

  it('rpcRequest passes any method through and caps arrays', async () => {
    const res = await call(h.client, 'rpcRequest', { method: 'getTokenLargestAccounts', params: [MINT], maxItems: 5 });
    expect(res.json.result.value).toHaveLength(5);
    expect(res.json.truncated).toEqual({ total: 30, returned: 5 });
    const named = await call(h.client, 'rpcRequest', { method: 'getAsset', params: { id: NFT } });
    expect(named.json.result.id).toBe(NFT);
    expect(rpc.rpc('getAsset').at(-1)!.json.params).toEqual({ id: NFT });
  });

  it('rpcRequest refuses to send transactions', async () => {
    const res = await call(h.client, 'rpcRequest', { method: 'sendTransaction', params: ['AA=='] });
    expect(res.isError).toBe(true);
    expect(rpc.requests).toHaveLength(0);
  });

  it('rpcRequest surfaces RPC errors', async () => {
    const res = await call(h.client, 'rpcRequest', { method: 'getNothing' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/-32601/);
  });


  it('getWalletPortfolio returns SOL, priced tokens sorted by value, and NFTs', async () => {
    const res = await call(h.client, 'getWalletPortfolio', { owner: OWNER });
    expect(res.isError).toBe(false);
    expect(res.json.sol).toEqual({ lamports: 3_000_000_000, sol: '3', priceUsd: 150, valueUsd: 450 });
    expect(res.json.tokens.map((t: { symbol: string }) => t.symbol)).toEqual(['USDC', 'WSOL']);
    expect(res.json.tokens[0]).toMatchObject({ mint: MINT, balance: 2.5, priceUsd: 1, valueUsd: 2.5 });
    expect(res.json.nfts).toEqual([
      { id: NFT, name: 'Mad Lad #1', interface: 'V1_NFT', collection: 'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w', compressed: true, image: 'https://img/1.png' },
    ]);
    expect(res.json.totals).toMatchObject({ solUsd: 450, tokensUsd: 2.5, totalUsd: 452.5, tokenCount: 2, nftCount: 1 });
    const params = rpc.rpc('getAssetsByOwner')[0].json.params;
    expect(params).toEqual({ ownerAddress: OWNER, page: 1, limit: 200, options: { showFungible: true, showNativeBalance: true, showZeroBalance: false } });
  });

  it('getWalletPortfolio pages by cursor and can omit NFTs', async () => {
    const res = await call(h.client, 'getWalletPortfolio', { owner: OWNER, cursor: 'abc', limit: 3, includeNfts: false });
    expect(res.json.nfts).toBeUndefined();
    expect(res.json.paging).toMatchObject({ limit: 3, returned: 3, hasMore: true });
    expect(rpc.rpc('getAssetsByOwner')[0].json.params).toMatchObject({ cursor: 'abc', limit: 3 });
  });

  it('getAsset returns a compressed NFT with proof and history', async () => {
    const res = await call(h.client, 'getAsset', { id: NFT, withProof: true, canopyDepth: 2, history: true });
    expect(res.json.summary).toMatchObject({ id: NFT, name: 'Mad Lad #1', owner: OWNER, compressed: true, royaltyBps: 500 });
    expect(res.json.proof.proofPath).toEqual(['a', 'b']);
    expect(res.json.history.items).toEqual([{ signature: SIG, instruction: 'Transfer' }]);
    expect(res.json.asset.id).toBe(NFT);
  });

  it('getAsset batch returns summaries and missing ids', async () => {
    const res = await call(h.client, 'getAsset', { ids: [NFT, MINT] });
    expect(res.json.missing).toEqual([MINT]);
    expect(res.json.assets[0].name).toBe('Mad Lad #1');
    expect(res.json.assets[0].content).toBeUndefined();
  });

  it('searchAssets maps collection to grouping', async () => {
    const res = await call(h.client, 'searchAssets', { collection: 'Coll111111111111111111111111111111111111111', tokenType: 'nonFungible', sortBy: 'created', sortDirection: 'desc' });
    expect(res.json.items[0].id).toBe(NFT);
    expect(rpc.rpc('searchAssets')[0].json.params).toEqual({
      grouping: ['collection', 'Coll111111111111111111111111111111111111111'],
      tokenType: 'nonFungible',
      sortBy: { sortBy: 'created', sortDirection: 'desc' },
      limit: 50,
      page: 1,
    });
  });

  it('getTokenHolders sorts the page and computes supply share', async () => {
    const res = await call(h.client, 'getTokenHolders', { mint: MINT });
    expect(res.json.supply).toEqual({ amount: '10000000', decimals: 6, uiAmount: '10' });
    expect(res.json.holders.map((x: { owner: string }) => x.owner)).toEqual(['whale', 'small']);
    expect(res.json.holders[0]).toMatchObject({ uiAmount: 5, sharePct: 50 });
  });
});

describe('RPC failover', () => {
  let bad: MockHttp;
  let good: MockHttp;
  let h: Harness;

  beforeAll(async () => {
    bad = await mockServer(() => ({ status: 503, raw: 'unavailable' }));
    good = await mockRpc({ getSlot: () => 42, getMultipleAccounts: handlers.getMultipleAccounts });
    h = await spawnServer({
      ORBITFLARE_API_KEY: 'k',
      ORBITFLARE_RPC_URL: bad.url,
      ORBITFLARE_RPC_FALLBACK_URLS: good.url,
      ORBITFLARE_LOG: 'debug',
    });
  });

  afterAll(async () => {
    await h?.close();
    await bad?.close();
    await good?.close();
  });

  it('retries the primary, then fails over to the fallback endpoint, logging only to stderr', async () => {
    const res = await call(h.client, 'getAccount', { address: OWNER });
    expect(res.isError).toBe(false);
    expect(res.json.exists).toBe(true);
    expect(bad.requests.length).toBe(3);
    expect(good.requests.length).toBe(1);
  });
});

describe('getSwapQuote (mock Jupiter)', () => {
  let jup: MockHttp;
  let h: Harness;

  beforeAll(async () => {
    jup = await mockServer((req) => ({
      body: { inputMint: req.query.get('inputMint'), outputMint: req.query.get('outputMint'), inAmount: req.query.get('amount'), outAmount: '1500000' },
    }));
    h = await spawnServer({ JUPITER_QUOTE_URL: `${jup.url}/swap/v1/quote`, JUPITER_API_KEY: 'jup-key' });
  });

  afterAll(async () => {
    await h?.close();
    await jup?.close();
  });

  it('resolves symbols and forwards the API key', async () => {
    const res = await call(h.client, 'getSwapQuote', { inputMint: 'SOL', outputMint: 'usdc', amount: 10_000_000, slippageBps: 30 });
    expect(res.json.quote).toEqual({ inputMint: 'So11111111111111111111111111111111111111112', outputMint: MINT, inAmount: '10000000', outAmount: '1500000' });
    const req = jup.requests[0];
    expect(req.query.get('slippageBps')).toBe('30');
    expect(req.headers['x-api-key']).toBe('jup-key');
  });
});
