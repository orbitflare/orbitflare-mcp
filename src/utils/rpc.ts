import { OrbitflareError, RpcClientBuilder, type RpcClient } from '@orbitflare/sdk';
import { getApiKey, getRpcUrls, MissingApiKeyError } from '../config.js';
import { sdkLogger } from './logger.js';

let cached: { key: string; client: RpcClient } | null = null;

export function rpc(): RpcClient {
  const urls = getRpcUrls();
  const apiKey = getApiKey();
  const needsKey = urls[0].includes('orbitflare.com') && !urls[0].includes('api_key=');
  if (!apiKey && needsKey) throw new MissingApiKeyError('rpc');
  const cacheKey = `${apiKey ?? ''}|${urls.join(',')}`;
  if (cached?.key === cacheKey) return cached.client;
  const client = new RpcClientBuilder()
    .urls(urls)
    .apiKey(apiKey ?? '')
    .commitment('confirmed')
    .timeoutMs(30_000)
    .retry({ initialDelayMs: 200, maxDelayMs: 2_000, multiplier: 2, maxAttempts: 3 })
    .logger(sdkLogger)
    .build();
  cached = { key: cacheKey, client };
  return client;
}

export function friendlyError(err: unknown): Error {
  if (!(err instanceof OrbitflareError)) return err instanceof Error ? err : new Error(String(err));
  const code = err.rpc?.code;
  if (code === -401 || code === -403) {
    return new Error(
      `OrbitFlare RPC rejected the license key (HTTP ${-code}). Check ORBITFLARE_API_KEY or call setApiKey.`,
    );
  }
  if (err.kind === 'rateLimited') {
    return new Error('OrbitFlare RPC rate limit hit (HTTP 429). Slow down or upgrade your plan.');
  }
  if (code === -32601 || code === -404) {
    return new Error(`${err.message}. This endpoint does not support that method.`);
  }
  return err;
}

export async function rpcCall<T = any>(method: string, params: unknown = []): Promise<T> {
  try {
    return await rpc().request<T>(method, params);
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function withRpc<T>(fn: (client: RpcClient) => Promise<T>): Promise<T> {
  try {
    return await fn(rpc());
  } catch (err) {
    throw friendlyError(err);
  }
}

export function isMethodNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /-32601|method not found|does not support that method/i.test(msg);
}
