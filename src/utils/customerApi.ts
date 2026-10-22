import {
  getBearerToken,
  getCustomerApiBase,
  getCustomerApiKey,
  MissingApiKeyError,
} from '../config.js';

export interface CustomerApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  public?: boolean;
}

export class CustomerApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'CustomerApiError';
    this.status = status;
    this.body = body;
  }
}

function errorMessage(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as { message?: unknown; error?: unknown; errors?: unknown };
    const base = typeof obj.message === 'string' ? obj.message : typeof obj.error === 'string' ? obj.error : fallback;
    return obj.errors && typeof obj.errors === 'object' ? `${base} ${JSON.stringify(obj.errors)}` : base;
  }
  return typeof parsed === 'string' && parsed.length < 300 ? parsed : fallback;
}

export async function customerApi<T = any>(path: string, opts: CustomerApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (!opts.public) {
    const bearer = getBearerToken();
    const key = getCustomerApiKey();
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    else if (key) headers['X-ORBIT-KEY'] = key;
    else throw new MissingApiKeyError('customer');
  }

  const search = opts.query
    ? new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const url = `${getCustomerApiBase()}${path.startsWith('/') ? path : '/' + path}${search ? '?' + search : ''}`;

  const response = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    throw new CustomerApiError(
      response.status,
      parsed,
      errorMessage(parsed, `OrbitFlare Customer API HTTP ${response.status}`),
    );
  }
  if (parsed && typeof parsed === 'object' && (parsed as { success?: unknown }).success === false) {
    throw new CustomerApiError(
      response.status,
      parsed,
      errorMessage(parsed, 'OrbitFlare Customer API returned success: false'),
    );
  }
  return parsed as T;
}

export function unwrap<T = any>(response: unknown): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}
