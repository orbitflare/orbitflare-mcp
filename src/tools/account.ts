import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  clearBearerToken,
  getApexApiKey,
  getApiKey,
  getBearerToken,
  getCustomerApiKey,
  getNetwork,
  getRegion,
  getRpcUrl,
  parseRegion,
  REGIONS,
  setApexApiKey,
  setApiKey,
  setBearerToken,
  setCustomerApiKey,
  setNetwork,
  setRegion,
  setRpcUrlOverride,
} from '../config.js';
import { sanitizeUrl } from '@orbitflare/sdk';
import { customerApi, CustomerApiError, unwrap } from '../utils/customerApi.js';
import { asJson, asText, needsConfirmation } from '../utils/formatters.js';
import { getActiveSigner, requireSigner, signatureToBase58, signMessageBytes } from '../utils/keypair.js';
import { describeTransaction, signWithLoadedWallet } from '../utils/transactions.js';
import { confirmSchema, defineTool, DESTRUCTIVE, READ, WRITE } from './define.js';

const id = z.union([z.number().int().positive(), z.string().min(1)]);

interface TokenData {
  access_token?: string;
  token?: string;
  user?: unknown;
  expires_in?: number;
}

function storeToken(data: TokenData | undefined, note: string) {
  const token = data?.access_token ?? data?.token;
  if (!token) return null;
  setBearerToken(token);
  return asJson({ signedIn: true, user: data?.user ?? null, expiresIn: data?.expires_in ?? null }, note);
}

async function settle(entries: [string, () => Promise<unknown>][]) {
  const results = await Promise.allSettled(entries.map(([, fn]) => fn()));
  if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
  return Object.fromEntries(
    entries.map(([name], i) => {
      const r = results[i];
      return [name, r.status === 'fulfilled' ? r.value : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) }];
    }),
  );
}

export function registerAccountTools(server: McpServer): void {
  defineTool(
    server,
    'setApiKey',
    {
      title: 'Configure Session',
      description:
        'Stores an OrbitFlare credential for this session and/or switches endpoint. kind "rpc" = license key for RPC/DAS (default), "customer" = Customer API key, "apex" = Apex key. Can also switch network, pin an RPC region (va, ny, la, slc, ams, fra, lon, jp, sg) or set a custom RPC URL such as a dedicated node. Call with no arguments to see the current configuration.',
      input: {
        apiKey: z.string().min(8).optional(),
        kind: z.enum(['rpc', 'customer', 'apex']).optional(),
        network: z.enum(['mainnet', 'devnet']).optional(),
        region: z.string().optional().describe(`One of ${REGIONS.join(', ')}`),
        rpcUrl: z.string().optional().describe('Custom RPC URL (e.g. a dedicated node); empty string clears it'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ apiKey, kind, network, region, rpcUrl }) => {
      const k = kind ?? 'rpc';
      if (apiKey) {
        if (k === 'customer') setCustomerApiKey(apiKey);
        else if (k === 'apex') setApexApiKey(apiKey);
        else setApiKey(apiKey);
      }
      if (network) setNetwork(network);
      if (region) {
        const parsed = parseRegion(region);
        if (!parsed) throw new Error(`Unknown region "${region}". Use one of ${REGIONS.join(', ')}.`);
        setRegion(parsed);
      }
      if (rpcUrl !== undefined) setRpcUrlOverride(rpcUrl || null);
      const changes = [apiKey ? `stored ${k} API key` : null, network ? `network=${network}` : null, region ? `region=${region}` : null, rpcUrl !== undefined ? 'rpcUrl updated' : null].filter(Boolean);
      return asJson(
        {
          network: getNetwork(),
          region: getRegion(),
          rpcEndpoint: sanitizeUrl(getRpcUrl()),
          rpcKey: Boolean(getApiKey()),
          customerCredential: getBearerToken() ? 'bearer token' : getCustomerApiKey() ? 'api key' : null,
          apexKey: Boolean(getApexApiKey()),
        },
        changes.length ? `Updated: ${changes.join(', ')}.` : 'Current configuration.',
      );
    },
  );

  defineTool(
    server,
    'auth',
    {
      title: 'OrbitFlare Sign-in',
      description:
        'Signs in to the OrbitFlare Customer API (the token is stored in ~/.orbitflare/mcp-session.json). Actions: "status"; "deviceStart" then "devicePoll" (browser device-code flow: show the user the URL and code, then poll with device_code); "walletLogin" (with a loaded wallet it requests a challenge, signs and verifies in one step; set register=true with name and email to create a new account; for an external wallet first call "walletChallenge", have the user sign it, then pass wallet_address and signature); "logout".',
      input: {
        action: z.enum(['status', 'deviceStart', 'devicePoll', 'walletChallenge', 'walletLogin', 'logout']),
        device_code: z.string().optional().describe('devicePoll: from deviceStart'),
        wallet_address: z.string().min(32).max(44).optional().describe('walletChallenge / walletLogin with an external wallet'),
        signature: z.string().optional().describe('walletLogin: base58 or base64 signature of the challenge from an external wallet'),
        register: z.boolean().optional().describe('walletLogin: create a new account (needs name and email)'),
        name: z.string().max(255).optional(),
        email: z.string().email().max(255).optional(),
      },
      annotations: WRITE,
    },
    async (args) => {
      switch (args.action) {
        case 'status': {
          const credential = getBearerToken() ? 'bearer token' : getCustomerApiKey() ? 'api key' : null;
          if (!credential) return asJson({ signedIn: false }, 'Not signed in. Use deviceStart or walletLogin.');
          const me = await customerApi('/auth/me').then(unwrap, (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
          return asJson({ signedIn: !(me as { error?: string })?.error, credential, user: me });
        }
        case 'deviceStart': {
          const data = unwrap<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(
            await customerApi('/auth/device/code', { method: 'POST', public: true }),
          );
          return asJson(
            { ...data, nextStep: `Open ${data.verification_uri}, enter ${data.user_code}, then call auth with action "devicePoll" and this device_code.` },
            'Show the verification_uri and user_code to the user.',
          );
        }
        case 'devicePoll': {
          if (!args.device_code) throw new Error('devicePoll needs device_code.');
          try {
            const res = await customerApi('/auth/device/token', { method: 'POST', public: true, body: { device_code: args.device_code } });
            return storeToken(unwrap(res), 'Signed in. Customer API tools are ready.') ?? asJson(res);
          } catch (err) {
            if (err instanceof CustomerApiError && err.status === 428) {
              return asText('authorization_pending: the user has not finished in the browser yet. Wait the interval and poll again.');
            }
            if (err instanceof CustomerApiError && err.status === 429) {
              return asText('slow_down: polling too fast. Wait longer between polls.');
            }
            throw err;
          }
        }
        case 'walletChallenge': {
          const wallet = args.wallet_address ?? requireSigner().address;
          const data = unwrap(await customerApi('/auth/wallet/challenge', { method: 'POST', public: true, body: { wallet_address: wallet } }));
          return asJson({ wallet_address: wallet, ...data }, 'Sign the challenge string, then call walletLogin with wallet_address and signature.');
        }
        case 'walletLogin': {
          let wallet = args.wallet_address;
          let signature = args.signature;
          if (!signature) {
            const signer = getActiveSigner();
            if (!signer) throw new Error('Load a wallet first, or pass wallet_address and signature from walletChallenge.');
            if (wallet && wallet !== signer.address) throw new Error(`Loaded wallet is ${signer.address}, not ${wallet}.`);
            wallet = signer.address;
            const { challenge } = unwrap<{ challenge: string }>(
              await customerApi('/auth/wallet/challenge', { method: 'POST', public: true, body: { wallet_address: wallet } }),
            );
            signature = signatureToBase58(await signMessageBytes(new TextEncoder().encode(challenge)));
          }
          if (!wallet) throw new Error('walletLogin with a signature needs wallet_address.');
          if (args.register && (!args.name || !args.email)) throw new Error('register needs name and email.');
          const res = await customerApi(args.register ? '/auth/wallet/register' : '/auth/wallet/verify', {
            method: 'POST',
            public: true,
            body: { wallet_address: wallet, signature, ...(args.register ? { name: args.name, email: args.email } : {}) },
          });
          return storeToken(unwrap(res), args.register ? 'Account created and signed in.' : 'Signed in.') ?? asJson(res);
        }
        case 'logout': {
          if (!getBearerToken()) return asText('No bearer token in this session; nothing to revoke.');
          await customerApi('/auth/logout', { method: 'POST' }).catch(() => null);
          clearBearerToken();
          return asText('Signed out; bearer token revoked and cleared.');
        }
      }
    },
  );

  defineTool(
    server,
    'getOrbitflareAccount',
    {
      title: 'Get OrbitFlare Account',
      description:
        'Reads the signed-in OrbitFlare account. sections picks what to include: profile, balance (prepaid USD), licenses (RPC plans in use and their keys), apiKeys, plans (catalog with pricing and limits), invoices. Pass licenseId for one license\'s details, whitelisted IPs and allowed locations (location ids are needed for manageLicense).',
      input: {
        sections: z
          .array(z.enum(['profile', 'balance', 'licenses', 'apiKeys', 'plans', 'invoices']))
          .optional()
          .describe('Default profile, balance, licenses'),
        licenseId: id.optional(),
        invoicesPage: z.number().int().positive().optional(),
        invoicesPerPage: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    async ({ sections, licenseId, invoicesPage, invoicesPerPage }) => {
      const wanted = sections ?? (licenseId ? [] : ['profile', 'balance', 'licenses']);
      const loaders: Record<string, () => Promise<unknown>> = {
        profile: () => customerApi('/profile').then(unwrap),
        balance: () => customerApi('/balance').then(unwrap),
        licenses: () => customerApi('/licenses').then(unwrap),
        apiKeys: () => customerApi('/api-keys').then(unwrap),
        plans: () => customerApi('/rpc-plans').then(unwrap),
        invoices: () => customerApi('/invoices', { query: { page: invoicesPage, per_page: invoicesPerPage } }).then(unwrap),
      };
      const entries: [string, () => Promise<unknown>][] = wanted.map((s) => [s, loaders[s]]);
      if (licenseId !== undefined) {
        entries.push(
          ['license', () => customerApi(`/licenses/${licenseId}`).then(unwrap)],
          ['licenseIps', () => customerApi(`/licenses/${licenseId}/ips`).then(unwrap)],
          ['licenseLocations', () => customerApi(`/licenses/${licenseId}/locations`).then(unwrap)],
        );
      }
      return asJson(await settle(entries));
    },
  );

  defineTool(
    server,
    'updateProfile',
    {
      title: 'Update Profile',
      description: 'Updates the display name and/or payment wallet on the signed-in OrbitFlare account.',
      input: {
        name: z.string().max(255).optional(),
        payment_wallet_address: z.string().min(32).max(44).nullable().optional().describe('Solana wallet for payments; null clears it'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async (args) => {
      const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      if (Object.keys(body).length === 0) throw new Error('Provide at least one field to update.');
      return asJson(unwrap(await customerApi('/profile', { method: 'PUT', body })), 'Profile updated.');
    },
  );

  defineTool(
    server,
    'manageApiKeys',
    {
      title: 'Manage API Keys',
      description:
        'Customer API keys on the OrbitFlare account. Actions: "list" (masked), "create" (returns the full key once), "regenerate" (new key, old one stops working) and "delete" (permanent). regenerate and delete need confirm: true.',
      input: {
        action: z.enum(['list', 'create', 'regenerate', 'delete']),
        id: id.optional().describe('regenerate / delete: API key id from list'),
        name: z.string().min(1).max(100).optional().describe('create: label for the key'),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ action, id: keyId, name, confirm }) => {
      if (action === 'list') return asJson(unwrap(await customerApi('/api-keys')));
      if (action === 'create') {
        if (!name) throw new Error('create needs name.');
        return asJson(
          unwrap(await customerApi('/api-keys', { method: 'POST', body: { name } })),
          'Copy the key now: it is shown only once.',
        );
      }
      if (keyId === undefined) throw new Error(`${action} needs id.`);
      if (confirm !== true) {
        const current = await customerApi(`/api-keys/${keyId}`).then(unwrap, () => null);
        return needsConfirmation(
          action === 'delete'
            ? `Would permanently delete API key ${keyId}; anything using it stops working.`
            : `Would regenerate API key ${keyId}; the current key stops working immediately.`,
          { apiKey: current },
        );
      }
      if (action === 'delete') {
        return asJson(unwrap(await customerApi(`/api-keys/${keyId}`, { method: 'DELETE' })) ?? { deleted: true }, 'API key deleted.');
      }
      return asJson(
        unwrap(await customerApi(`/api-keys/${keyId}/regenerate`, { method: 'POST' })),
        'Copy the new key now: it is shown only once. The old key no longer works.',
      );
    },
  );

  defineTool(
    server,
    'manageLicense',
    {
      title: 'Manage License',
      description:
        'Changes an RPC license. Actions: "addIp" (whitelist an IPv4 address at a location), "removeIp" (needs confirm), "regenerateKey" (new license key, old one stops working; needs confirm), "toggleAuthMode" (switch between IP Whitelist and API Key Only; needs confirm). Location ids come from getOrbitflareAccount with licenseId.',
      input: {
        action: z.enum(['addIp', 'removeIp', 'regenerateKey', 'toggleAuthMode']),
        licenseId: id,
        ip: z.string().optional().describe('addIp / removeIp: IPv4 address'),
        locationId: z.number().int().optional().describe('addIp / removeIp: location id'),
        expiresAt: z.string().optional().describe('addIp: optional ISO 8601 expiry'),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ action, licenseId, ip, locationId, expiresAt, confirm }) => {
      if (action === 'regenerateKey') {
        if (confirm !== true) {
          return needsConfirmation(
            `Would regenerate the key for license ${licenseId}. The current key stops working immediately; every client using it must be updated.`,
            { licenseId },
          );
        }
        return asJson(
          unwrap(await customerApi(`/licenses/${licenseId}/regenerate-key`, { method: 'POST' })),
          'New license key issued; the old one no longer works. Update ORBITFLARE_API_KEY / setApiKey.',
        );
      }
      if (action === 'toggleAuthMode') {
        if (confirm !== true) {
          return needsConfirmation(
            `Would switch license ${licenseId} between IP Whitelist and API Key Only. In API Key Only mode anyone with the key can use it from any IP, and gRPC clients must send the key as x-token; in IP Whitelist mode only whitelisted IPs can connect.`,
            { licenseId },
          );
        }
        return asJson(
          unwrap(await customerApi(`/licenses/${licenseId}/toggle-auth-mode`, { method: 'POST' })),
          'Authentication mode switched. Check the new mode with getOrbitflareAccount.',
        );
      }
      if (!ip || locationId === undefined) throw new Error(`${action} needs ip and locationId.`);
      if (action === 'addIp') {
        return asJson(
          unwrap(
            await customerApi(`/licenses/${licenseId}/ips`, {
              method: 'POST',
              body: { ip_address: ip, location_id: locationId, ...(expiresAt ? { expires_at: expiresAt } : {}) },
            }),
          ),
          'IP whitelisted.',
        );
      }
      if (confirm !== true) {
        return needsConfirmation(`Would remove ${ip} from license ${licenseId} at location ${locationId}; that IP loses access.`, {
          licenseId,
          ip,
          locationId,
        });
      }
      return asJson(
        unwrap(
          await customerApi(`/licenses/${licenseId}/ips`, {
            method: 'DELETE',
            body: { ip_address: ip, location_id: locationId },
          }),
        ) ?? { removed: true },
        'IP removed.',
      );
    },
  );

  defineTool(
    server,
    'billing',
    {
      title: 'Billing',
      description:
        'Spends money on the OrbitFlare account. Actions: "prepareTopUp" (builds an unsigned USDC transfer that credits your prepaid balance, $5-$10,000; spends nothing), "confirmTopUp" (signs that transaction with the loaded wallet if needed and submits it; OrbitFlare broadcasts it and credits the balance; needs confirm), "purchasePlan" (buys an RPC plan from the prepaid balance; without confirm it runs a dry-run validation showing price and affordability).',
      input: {
        action: z.enum(['prepareTopUp', 'confirmTopUp', 'purchasePlan']),
        amount: z.number().min(5).max(10000).optional().describe('Top-up amount in USDC'),
        wallet_address: z.string().min(32).max(44).optional().describe('Paying wallet (default: loaded wallet)'),
        transaction: z.string().optional().describe('confirmTopUp: the transaction from prepareTopUp (unsigned or signed)'),
        slug: z.string().optional().describe('purchasePlan: plan slug from getOrbitflareAccount plans (e.g. developer, growth, scale, pro)'),
        period: z.enum(['monthly', 'quarterly', 'semi-annual', 'annual']).optional().describe('purchasePlan: default monthly'),
        coupon: z.string().optional(),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async (args) => {
      if (args.action === 'prepareTopUp') {
        const wallet = args.wallet_address ?? getActiveSigner()?.address;
        if (!args.amount || !wallet) throw new Error('prepareTopUp needs amount and wallet_address (or a loaded wallet).');
        const data = unwrap(await customerApi('/topup/prepare', { method: 'POST', body: { amount: args.amount, wallet_address: wallet } }));
        return asJson(
          { ...data, wallet_address: wallet },
          'Nothing spent yet. To pay, call billing with action "confirmTopUp", this transaction, amount and confirm: true.',
        );
      }
      if (args.action === 'confirmTopUp') {
        const wallet = args.wallet_address ?? getActiveSigner()?.address;
        if (!args.transaction || !args.amount || !wallet) {
          throw new Error('confirmTopUp needs transaction, amount and wallet_address (or a loaded wallet).');
        }
        if (args.confirm !== true) {
          return needsConfirmation(
            `Would sign (if needed) and submit a ${args.amount} USDC payment from ${wallet} to OrbitFlare to top up the prepaid balance.`,
            { transaction: describeTransaction(args.transaction) },
          );
        }
        const { transaction, signedBy } = await signWithLoadedWallet(args.transaction);
        const data = unwrap(
          await customerApi('/topup/confirm', {
            method: 'POST',
            body: { transaction, wallet_address: wallet, amount: args.amount },
          }),
        );
        return asJson({ ...data, signedBy }, 'Top-up confirmed and credited.');
      }
      if (!args.slug) throw new Error('purchasePlan needs slug.');
      const body = { product_slug: args.slug, billing_period: args.period ?? 'monthly', discount_code: args.coupon ?? null };
      if (args.confirm !== true) {
        const validation = unwrap(await customerApi('/orders/validate', { method: 'POST', body }));
        return needsConfirmation(
          `Would buy the ${args.slug} plan (${body.billing_period}) from the prepaid account balance.`,
          { validation },
        );
      }
      return asJson(
        unwrap(await customerApi('/orders/purchase', { method: 'POST', body })),
        'Plan purchased. The new license is listed under getOrbitflareAccount licenses.',
      );
    },
  );
}
