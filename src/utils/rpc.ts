import { getApiKey, getRpcUrl, MissingApiKeyError } from '../config.js';

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class OrbitFlareRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(err: JsonRpcError) {
    super(`OrbitFlare RPC error ${err.code}: ${err.message}`);
    this.name = 'OrbitFlareRpcError';
    this.code = err.code;
    this.data = err.data;
  }
}

let requestId = 0;

export async function rpcCall<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new MissingApiKeyError('rpc');
  }

  const url = `${getRpcUrl()}?api_key=${encodeURIComponent(apiKey)}`;
  const body = {
    jsonrpc: '2.0',
    id: ++requestId,
    method,
    params,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error contacting OrbitFlare RPC: ${cause}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `OrbitFlare RPC auth failed (HTTP ${response.status}). Check your license key. ${text}`,
      );
    }
    if (response.status === 429) {
      throw new Error(
        'OrbitFlare RPC rate limit hit (HTTP 429). Slow down or upgrade your plan tier.',
      );
    }
    throw new Error(`OrbitFlare RPC HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as {
    result?: T;
    error?: JsonRpcError;
  };

  if (json.error) {
    throw new OrbitFlareRpcError(json.error);
  }
  return json.result as T;
}
