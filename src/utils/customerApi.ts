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
  /** If true, the request is sent without authentication (used for device/code, wallet/challenge, etc.). */
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

export async function customerApi<T = unknown>(
  path: string,
  opts: CustomerApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (!opts.public) {
    const bearer = getBearerToken();
    const key = getCustomerApiKey();
    if (bearer) {
      headers.Authorization = `Bearer ${bearer}`;
    } else if (key) {
      headers['X-ORBIT-KEY'] = key;
    } else {
      throw new MissingApiKeyError('customer');
    }
  }

  const search = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(
          ([k, v]) =>
            `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
        )
        .join('&')
    : '';

  const url = `${getCustomerApiBase()}${path.startsWith('/') ? path : '/' + path}${search}`;

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
    const msg =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `OrbitFlare Customer API HTTP ${response.status}`;
    throw new CustomerApiError(response.status, parsed, msg);
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    'success' in parsed &&
    (parsed as { success: unknown }).success === false
  ) {
    const obj = parsed as { message?: unknown; error?: unknown };
    const msg =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.error === 'string'
          ? obj.error
          : 'OrbitFlare Customer API returned success: false';
    throw new CustomerApiError(response.status, parsed, msg);
  }

  return parsed as T;
}
