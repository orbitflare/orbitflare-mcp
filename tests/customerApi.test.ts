import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

// We import the compiled JS to avoid mixing TS source + dist (the rest of the
// test suite drives the built server, but customerApi is small enough to
// import as a module here for direct unit testing).
import {
  customerApi,
  CustomerApiError,
} from '../dist/utils/customerApi.js';

import {
  setBearerToken,
  clearBearerToken,
  setApiKey,
  setCustomerApiKey,
} from '../dist/config.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let baseUrl: string;
let lastReq: Captured | null = null;
let nextResponse: { status: number; body: unknown } = {
  status: 200,
  body: { success: true, data: { ok: true } },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let chunks = '';
    req.on('data', (c) => (chunks += c));
    req.on('end', () => {
      lastReq = {
        url: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: chunks,
      };
      res.statusCode = nextResponse.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(nextResponse.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/customer/v2`;
  // Monkey-patch base URL for the test by stubbing global fetch to redirect
  const realFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input.toString();
    const rewritten = u.replace(
      'https://api.orbitflare.com/customer/v2',
      baseUrl,
    );
    return realFetch(rewritten, init);
  }) as typeof fetch;
});

afterAll(async () => {
  clearBearerToken();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('customerApi auth', () => {
  it('prefers Authorization: Bearer when a Bearer token is set', async () => {
    setBearerToken('test-bearer-xyz');
    setCustomerApiKey('fallback-x-orbit-key');
    nextResponse = { status: 200, body: { success: true, data: 'ok' } };
    await customerApi('/profile');
    expect(lastReq).not.toBeNull();
    expect(lastReq!.headers.authorization).toBe('Bearer test-bearer-xyz');
    expect(lastReq!.headers['x-orbit-key']).toBeUndefined();
  });

  it('falls back to X-ORBIT-KEY when no Bearer token is set', async () => {
    clearBearerToken();
    setCustomerApiKey('only-x-orbit-key');
    nextResponse = { status: 200, body: { success: true } };
    await customerApi('/profile');
    expect(lastReq!.headers['x-orbit-key']).toBe('only-x-orbit-key');
    expect(lastReq!.headers.authorization).toBeUndefined();
  });

  it('omits auth headers when opts.public is true', async () => {
    setBearerToken('should-not-be-sent');
    nextResponse = {
      status: 200,
      body: { success: true, data: { challenge: 'abc' } },
    };
    await customerApi('/auth/wallet/challenge', {
      method: 'POST',
      public: true,
      body: { wallet_address: '11111111111111111111111111111111' },
    });
    expect(lastReq!.headers.authorization).toBeUndefined();
    expect(lastReq!.headers['x-orbit-key']).toBeUndefined();
  });

  it('throws CustomerApiError when the response sets success: false', async () => {
    setBearerToken('test');
    nextResponse = {
      status: 200,
      body: { success: false, message: 'Permission denied' },
    };
    await expect(customerApi('/profile')).rejects.toBeInstanceOf(CustomerApiError);
    try {
      await customerApi('/profile');
    } catch (err) {
      expect((err as CustomerApiError).message).toBe('Permission denied');
    }
  });
});
