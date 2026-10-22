import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import * as ed25519 from '@noble/ed25519';
import { BLOCKHASH, call, mockRpc, mockServer, spawnServer, type Harness, type MockHttp, type Recorded } from './helpers.js';

const BASE = '/customer/v2';
let devicePolls = 0;

function route(req: Recorded): { status?: number; body?: unknown } | undefined {
  const key = `${req.method} ${req.path.replace(BASE, '')}`;
  switch (key) {
    case 'POST /auth/device/code':
      return { body: { success: true, data: { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: 'https://orbitflare.com/device', expires_in: 600, interval: 5 } } };
    case 'POST /auth/device/token':
      devicePolls++;
      return devicePolls === 1
        ? { status: 428, body: { success: false, message: 'authorization_pending' } }
        : { body: { success: true, data: { token_type: 'Bearer', access_token: 'bearer-from-device', expires_in: 3600, user: { id: 1 } } } };
    case 'POST /auth/wallet/challenge':
      return { body: { success: true, data: { challenge: `Sign in to OrbitFlare: ${req.json.wallet_address}`, expires_in: 300 } } };
    case 'POST /auth/wallet/verify':
    case 'POST /auth/wallet/register':
      return { body: { success: true, data: { token_type: 'Bearer', access_token: 'bearer-from-wallet', expires_in: 3600, user: { id: 2 } } } };
    case 'POST /auth/logout':
      return { body: { success: true } };
    case 'GET /auth/me':
      return { body: { success: true, data: { id: 2, name: 'Test' } } };
    case 'GET /profile':
      return { body: { success: true, data: { name: 'Test', email: 't@example.com' } } };
    case 'PUT /profile':
      return { body: { success: true, data: { ...req.json } } };
    case 'GET /balance':
      return { body: { success: true, data: { balance: 42.5 } } };
    case 'GET /licenses':
      return { body: { success: true, data: { licenses: [{ id: 7, slug: 'growth' }] } } };
    case 'GET /licenses/7':
      return { body: { success: true, data: { id: 7 } } };
    case 'GET /licenses/7/ips':
      return { body: { success: true, data: { ips: ['1.2.3.4'] } } };
    case 'GET /licenses/7/locations':
      return { body: { success: true, data: { locations: [{ id: 3, name: 'Frankfurt' }] } } };
    case 'POST /licenses/7/ips':
    case 'DELETE /licenses/7/ips':
    case 'POST /licenses/7/regenerate-key':
      return { body: { success: true, data: { ok: true } } };
    case 'GET /api-keys':
      return { body: { success: true, data: { api_keys: [{ id: 9, name: 'ci' }] } } };
    case 'POST /api-keys':
      return { body: { success: true, data: { api_key: { id: 10, name: req.json.name, key: 'full-key' } } } };
    case 'GET /api-keys/9':
      return { body: { success: true, data: { id: 9, name: 'ci' } } };
    case 'DELETE /api-keys/9':
      return { body: { success: true, data: null } };
    case 'POST /api-keys/9/regenerate':
      return { body: { success: true, data: { api_key: { id: 9, key: 'new-key' } } } };
    case 'GET /rpc-plans':
      return { body: { success: true, data: { plans: [{ slug: 'growth' }] } } };
    case 'GET /invoices':
      return { body: { success: true, data: { data: [], current_page: Number(req.query.get('page') ?? 1) } } };
    case 'POST /orders/validate':
      return { body: { success: true, data: { total: 99, can_afford: true } } };
    case 'POST /orders/purchase':
      return { body: { success: true, data: { order: { reference: 'ORD-1' } } } };
    case 'POST /topup/prepare':
      return { body: { success: true, data: { transaction: preparedTx, amount_usdc: req.json.amount } } };
    case 'POST /topup/confirm':
      return { body: { success: true, data: { balance: 52.5, amount_credited: req.json.amount } } };
  }
  return undefined;
}

let preparedTx = '';

describe('OrbitFlare account tools (mock Customer API)', () => {
  let api: MockHttp;
  let rpc: MockHttp;
  let h: Harness;
  let wallet: string;

  const sent = (method: string, path: string) => api.requests.filter((r) => r.method === method && r.path === BASE + path);

  beforeAll(async () => {
    api = await mockServer(route);
    rpc = await mockRpc({ getLatestBlockhash: () => BLOCKHASH });
    h = await spawnServer({
      ORBITFLARE_CUSTOMER_API_URL: `${api.url}${BASE}`,
      ORBITFLARE_API_KEY: 'rpc-key',
      ORBITFLARE_CUSTOMER_API_KEY: 'customer-key',
      ORBITFLARE_RPC_URL: rpc.url,
    });
    wallet = (await call(h.client, 'wallet', { action: 'generate', persist: false })).json.address;
    preparedTx = (await call(h.client, 'buildSolTransfer', { recipient: '11111111111111111111111111111112', amountSol: 0.01 })).json.transaction;
  });

  afterAll(async () => {
    await h?.close();
    await api?.close();
    await rpc?.close();
  });

  beforeEach(() => {
    api.requests.length = 0;
  });

  it('uses the Customer API key as X-ORBIT-KEY until signed in', async () => {
    const res = await call(h.client, 'getOrbitflareAccount');
    expect(res.json).toEqual({ profile: { name: 'Test', email: 't@example.com' }, balance: { balance: 42.5 }, licenses: { licenses: [{ id: 7, slug: 'growth' }] } });
    expect(api.requests[0].headers['x-orbit-key']).toBe('customer-key');
    expect(api.requests[0].headers.authorization).toBeUndefined();
  });

  it('device flow: start, pending, then stores the bearer token', async () => {
    const start = await call(h.client, 'auth', { action: 'deviceStart' });
    expect(start.json).toMatchObject({ user_code: 'ABCD-EFGH', device_code: 'dev-1' });
    expect(api.requests[0].headers['x-orbit-key']).toBeUndefined();

    const pending = await call(h.client, 'auth', { action: 'devicePoll', device_code: 'dev-1' });
    expect(pending.isError).toBe(false);
    expect(pending.text).toMatch(/authorization_pending/);

    const done = await call(h.client, 'auth', { action: 'devicePoll', device_code: 'dev-1' });
    expect(done.json).toMatchObject({ signedIn: true, expiresIn: 3600 });
    const session = JSON.parse(readFileSync(join(h.home, '.orbitflare', 'mcp-session.json'), 'utf8'));
    expect(session.bearerToken).toBe('bearer-from-device');

    await call(h.client, 'getOrbitflareAccount', { sections: ['profile'] });
    expect(api.requests.at(-1)!.headers.authorization).toBe('Bearer bearer-from-device');
  });

  it('walletLogin signs the challenge with the loaded wallet', async () => {
    const res = await call(h.client, 'auth', { action: 'walletLogin' });
    expect(res.json.signedIn).toBe(true);
    const [verify] = sent('POST', '/auth/wallet/verify');
    expect(verify.json.wallet_address).toBe(wallet);
    const ok = await ed25519.verifyAsync(
      bs58.decode(verify.json.signature),
      new TextEncoder().encode(`Sign in to OrbitFlare: ${wallet}`),
      bs58.decode(wallet),
    );
    expect(ok).toBe(true);
  });

  it('walletLogin register needs name and email and hits /register', async () => {
    const bad = await call(h.client, 'auth', { action: 'walletLogin', register: true });
    expect(bad.isError).toBe(true);
    const ok = await call(h.client, 'auth', { action: 'walletLogin', register: true, name: 'N', email: 'n@example.com' });
    expect(ok.isError).toBe(false);
    expect(sent('POST', '/auth/wallet/register')[0].json).toMatchObject({ wallet_address: wallet, name: 'N', email: 'n@example.com' });
  });

  it('auth status and logout', async () => {
    const status = await call(h.client, 'auth', { action: 'status' });
    expect(status.json).toMatchObject({ signedIn: true, credential: 'bearer token' });
    const out = await call(h.client, 'auth', { action: 'logout' });
    expect(out.text).toMatch(/Signed out/);
    expect(sent('POST', '/auth/logout')).toHaveLength(1);
  });

  it('getOrbitflareAccount loads requested sections and license details', async () => {
    const res = await call(h.client, 'getOrbitflareAccount', { sections: ['plans', 'apiKeys', 'invoices'], licenseId: 7, invoicesPage: 2 });
    expect(Object.keys(res.json).sort()).toEqual(['apiKeys', 'invoices', 'license', 'licenseIps', 'licenseLocations', 'plans']);
    expect(res.json.invoices.current_page).toBe(2);
    expect(res.json.licenseLocations.locations[0].id).toBe(3);
  });

  it('updateProfile uses PUT', async () => {
    const res = await call(h.client, 'updateProfile', { name: 'New' });
    expect(res.json).toEqual({ name: 'New' });
    expect(sent('PUT', '/profile')).toHaveLength(1);
  });

  it('manageApiKeys create and list need no confirm', async () => {
    const created = await call(h.client, 'manageApiKeys', { action: 'create', name: 'bot' });
    expect(created.json.api_key.key).toBe('full-key');
    const listed = await call(h.client, 'manageApiKeys', { action: 'list' });
    expect(listed.json.api_keys).toHaveLength(1);
  });

  it('manageApiKeys delete and regenerate are gated by confirm', async () => {
    const preview = await call(h.client, 'manageApiKeys', { action: 'delete', id: 9 });
    expect(preview.json).toMatchObject({ confirmed: false, apiKey: { id: 9, name: 'ci' } });
    const regen = await call(h.client, 'manageApiKeys', { action: 'regenerate', id: 9 });
    expect(regen.json.confirmed).toBe(false);
    expect(sent('DELETE', '/api-keys/9')).toHaveLength(0);
    expect(sent('POST', '/api-keys/9/regenerate')).toHaveLength(0);

    const deleted = await call(h.client, 'manageApiKeys', { action: 'delete', id: 9, confirm: true });
    expect(deleted.isError).toBe(false);
    expect(sent('DELETE', '/api-keys/9')).toHaveLength(1);
    const regenerated = await call(h.client, 'manageApiKeys', { action: 'regenerate', id: 9, confirm: true });
    expect(regenerated.json.api_key.key).toBe('new-key');
  });

  it('manageLicense addIp sends the documented body; removeIp and regenerateKey need confirm', async () => {
    await call(h.client, 'manageLicense', { action: 'addIp', licenseId: 7, ip: '5.6.7.8', locationId: 3 });
    expect(sent('POST', '/licenses/7/ips')[0].json).toEqual({ ip_address: '5.6.7.8', location_id: 3 });

    const rm = await call(h.client, 'manageLicense', { action: 'removeIp', licenseId: 7, ip: '5.6.7.8', locationId: 3 });
    expect(rm.json.confirmed).toBe(false);
    const regen = await call(h.client, 'manageLicense', { action: 'regenerateKey', licenseId: 7 });
    expect(regen.json.confirmed).toBe(false);
    expect(sent('DELETE', '/licenses/7/ips')).toHaveLength(0);
    expect(sent('POST', '/licenses/7/regenerate-key')).toHaveLength(0);

    await call(h.client, 'manageLicense', { action: 'removeIp', licenseId: 7, ip: '5.6.7.8', locationId: 3, confirm: true });
    expect(sent('DELETE', '/licenses/7/ips')[0].json).toEqual({ ip_address: '5.6.7.8', location_id: 3 });
    await call(h.client, 'manageLicense', { action: 'regenerateKey', licenseId: 7, confirm: true });
    expect(sent('POST', '/licenses/7/regenerate-key')).toHaveLength(1);
  });

  it('manageLicense toggleAuthMode needs confirm, then calls toggle-auth-mode', async () => {
    const preview = await call(h.client, 'manageLicense', { action: 'toggleAuthMode', licenseId: 7 });
    expect(preview.json.confirmed).toBe(false);
    expect(sent('POST', '/licenses/7/toggle-auth-mode')).toHaveLength(0);
    await call(h.client, 'manageLicense', { action: 'toggleAuthMode', licenseId: 7, confirm: true });
    expect(sent('POST', '/licenses/7/toggle-auth-mode')).toHaveLength(1);
  });

  it('billing purchasePlan dry-runs without confirm and buys with it', async () => {
    const preview = await call(h.client, 'billing', { action: 'purchasePlan', slug: 'growth', period: 'annual' });
    expect(preview.json).toMatchObject({ confirmed: false, validation: { total: 99, can_afford: true } });
    expect(sent('POST', '/orders/validate')[0].json).toEqual({ product_slug: 'growth', billing_period: 'annual', discount_code: null });
    expect(sent('POST', '/orders/purchase')).toHaveLength(0);

    const bought = await call(h.client, 'billing', { action: 'purchasePlan', slug: 'growth', coupon: 'X', confirm: true });
    expect(bought.json.order.reference).toBe('ORD-1');
    expect(sent('POST', '/orders/purchase')[0].json).toEqual({ product_slug: 'growth', billing_period: 'monthly', discount_code: 'X' });
  });

  it('billing top-up: prepare, gated confirm, then signs and submits', async () => {
    const prepared = await call(h.client, 'billing', { action: 'prepareTopUp', amount: 10 });
    expect(prepared.json.wallet_address).toBe(wallet);
    expect(sent('POST', '/topup/prepare')[0].json).toEqual({ amount: 10, wallet_address: wallet });

    const preview = await call(h.client, 'billing', { action: 'confirmTopUp', amount: 10, transaction: prepared.json.transaction });
    expect(preview.json.confirmed).toBe(false);
    expect(preview.json.transaction.willSignWithLoadedWallet).toBe(true);
    expect(sent('POST', '/topup/confirm')).toHaveLength(0);

    const done = await call(h.client, 'billing', { action: 'confirmTopUp', amount: 10, transaction: prepared.json.transaction, confirm: true });
    expect(done.json).toMatchObject({ balance: 52.5, signedBy: wallet });
    const body = sent('POST', '/topup/confirm')[0].json;
    expect(body).toMatchObject({ wallet_address: wallet, amount: 10 });
    expect(body.transaction).not.toBe(prepared.json.transaction);
  });

  it('surfaces Customer API errors', async () => {
    const res = await call(h.client, 'manageLicense', { action: 'addIp', licenseId: 8, ip: '1.1.1.1', locationId: 1 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/);
  });
});

describe('Customer API with only an RPC license key', () => {
  let h: Harness;
  let api: MockHttp;

  beforeAll(async () => {
    api = await mockServer(() => ({ body: { success: true, data: {} } }));
    h = await spawnServer({ ORBITFLARE_CUSTOMER_API_URL: `${api.url}${BASE}`, ORBITFLARE_API_KEY: 'rpc-key' });
  });

  afterAll(async () => {
    await h?.close();
    await api?.close();
  });

  it('does not send the license key as a Customer API key', async () => {
    const res = await call(h.client, 'getOrbitflareAccount');
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/ORBITFLARE_CUSTOMER_API_KEY/);
    expect(api.requests).toHaveLength(0);
  });
});
