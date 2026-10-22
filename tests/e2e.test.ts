import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, mockServer, spawnServer, type Harness, type MockHttp } from './helpers.js';

const READ_ONLY = [
  'getWalletPortfolio',
  'getAsset',
  'searchAssets',
  'getTokenHolders',
  'getAccount',
  'getTransaction',
  'getTransactionHistory',
  'getPriorityFees',
  'getNetworkStatus',
  'rpcRequest',
  'getSwapQuote',
  'watchTransactions',
  'watchAccounts',
  'buildSolTransfer',
  'simulateTransaction',
  'apexGetBundleStatuses',
  'apexGetTipAccounts',
  'apexPing',
  'getOrbitflareAccount',
];

const DESTRUCTIVE = [
  'sendTransaction',
  'apexSendTransaction',
  'apexSendBundle',
  'wallet',
  'manageApiKeys',
  'manageLicense',
  'billing',
];

const WRITES = ['setApiKey', 'auth', 'updateProfile'];

const CONFIRM_GATED = [...DESTRUCTIVE];

const EXPECTED_RESOURCES = [
  'index',
  'quickstart',
  'authentication',
  'infrastructure',
  'products',
  'rpc-http',
  'rpc-websocket',
  'transaction-history',
  'das',
  'das-asset-object',
  'das-pagination',
  'das-display-options',
  'recipes',
  'troubleshooting-transactions',
  'troubleshooting-websocket',
  'troubleshooting-grpc',
  'apex-typescript-client',
  'jetstream',
  'jetstream-reference',
  'yellowstone',
  'apex',
  'apex-tips',
  'metis-swap',
  'cli',
  'customer-api',
  'dedicated-nodes',
  'shredstream',
  'nft-pass',
  'historical-data',
  'rpc-error-codes',
  'apex-endpoints',
  'apex-bundles',
  'apex-errors',
  'bnb-chain',
  'polygon',
  'robinhood-chain',
].map((n) => `orbitflare://docs/${n}`);

describe('tool registry', () => {
  let h: Harness;
  let docs: MockHttp;

  beforeAll(async () => {
    docs = await mockServer((req) =>
      req.path === '/quickstart.md' ? { raw: '# Quickstart\nOrbitFlare quickstart page' } : { status: 404, raw: 'missing' },
    );
    h = await spawnServer({ ORBITFLARE_DOCS_URL: docs.url });
  });

  afterAll(async () => {
    await h?.close();
    await docs?.close();
  });

  it('registers exactly the expected 31 tools', async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_ONLY, ...DESTRUCTIVE, ...WRITES].sort());
    expect(names).toHaveLength(29);
  });

  it('every tool has a title, description, object input schema and annotations', async () => {
    const { tools } = await h.client.listTools();
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description!.length, t.name).toBeGreaterThan(40);
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.annotations, t.name).toBeDefined();
      expect(typeof t.annotations!.readOnlyHint, t.name).toBe('boolean');
      expect(typeof t.annotations!.openWorldHint, t.name).toBe('boolean');
      if (t.outputSchema) expect(t.outputSchema.type, t.name).toBe('object');
    }
  });

  it('marks reads read-only and spends/deletes destructive and non-idempotent', async () => {
    const { tools } = await h.client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations!]));
    for (const name of READ_ONLY) expect(byName.get(name)!.readOnlyHint, name).toBe(true);
    for (const name of DESTRUCTIVE) {
      const a = byName.get(name)!;
      expect(a.readOnlyHint, name).toBe(false);
      expect(a.destructiveHint, name).toBe(true);
      expect(a.idempotentHint, name).toBe(false);
    }
    for (const name of WRITES) {
      expect(byName.get(name)!.readOnlyHint, name).toBe(false);
      expect(byName.get(name)!.destructiveHint, name).toBe(false);
    }
  });

  it('every destructive tool takes a boolean confirm argument', async () => {
    const { tools } = await h.client.listTools();
    for (const t of tools.filter((x) => CONFIRM_GATED.includes(x.name))) {
      const props = t.inputSchema.properties as Record<string, { type?: string }>;
      expect(props.confirm?.type, t.name).toBe('boolean');
      expect(t.inputSchema.required ?? [], t.name).not.toContain('confirm');
    }
  });

  it('declares output schemas for fees and network status', async () => {
    const { tools } = await h.client.listTools();
    const withOutput = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
    expect(withOutput).toEqual(['getNetworkStatus', 'getPriorityFees']);
  });

  it('lists the documentation resources', async () => {
    const { resources } = await h.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([...EXPECTED_RESOURCES].sort());
  });

  it('reads a documentation resource from the docs site', async () => {
    const result = await h.client.readResource({ uri: 'orbitflare://docs/quickstart' });
    expect((result.contents[0] as { text: string }).text).toContain('OrbitFlare quickstart page');
    expect(docs.requests.at(-1)!.path).toBe('/quickstart.md');
  });

  it('reports a docs fetch failure inside the resource instead of failing', async () => {
    const result = await h.client.readResource({ uri: 'orbitflare://docs/apex' });
    expect((result.contents[0] as { text: string }).text).toMatch(/Error loading .*apex\/overview\.md/);
  });

  it('setApiKey reports the configuration and rejects unknown regions', async () => {
    const ok = await call(h.client, 'setApiKey', { apiKey: 'dummy-key-12345678', region: 'ams' });
    expect(ok.isError).toBe(false);
    expect(ok.json).toMatchObject({ region: 'ams', rpcKey: true, rpcEndpoint: 'https://ams.rpc.orbitflare.com' });
    expect(ok.text).toContain('stored rpc API key');

    const bad = await call(h.client, 'setApiKey', { region: 'mars' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Unknown region/);

    const alias = await call(h.client, 'setApiKey', { region: 'tok' });
    expect(alias.json.region).toBe('jp');
  });

  it('validates inputs before calling anything', async () => {
    const res = await call(h.client, 'getAccount', { addresses: [] });
    expect(res.isError).toBe(true);
  });
});

describe('without credentials', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await spawnServer();
  });

  afterAll(async () => {
    await h?.close();
  });

  it('RPC tools explain how to set the license key', async () => {
    const res = await call(h.client, 'getAccount', { address: '11111111111111111111111111111111' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/ORBITFLARE_API_KEY/);
  });

  it('Customer API tools explain how to sign in', async () => {
    const res = await call(h.client, 'getOrbitflareAccount');
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Customer API credential/);
  });

  it('watchAccounts needs the license key too', async () => {
    const res = await call(h.client, 'watchAccounts', { accounts: ['11111111111111111111111111111111'] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/license key/);
  });
});
