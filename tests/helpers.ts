import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const SERVER_PATH = resolve(__dirname, '..', 'dist', 'index.js');

const CLEAN_ENV = {
  ORBITFLARE_API_KEY: '',
  ORBITFLARE_LICENSE_KEY: '',
  ORBITFLARE_CUSTOMER_API_KEY: '',
  ORBITFLARE_BEARER_TOKEN: '',
  ORBITFLARE_RPC_URL: '',
  ORBITFLARE_RPC_FALLBACK_URLS: '',
  ORBITFLARE_NETWORK: '',
  ORBITFLARE_REGION: '',
  ORBITFLARE_APEX_API_KEY: '',
  ORBITFLARE_APEX_REGION: '',
  ORBITFLARE_APEX_URL: '',
  ORBITFLARE_JETSTREAM_URL: '',
  ORBITFLARE_CUSTOMER_API_URL: 'http://127.0.0.1:9/customer/v2',
  ORBITFLARE_DOCS_URL: 'http://127.0.0.1:9',
  JUPITER_QUOTE_URL: 'http://127.0.0.1:9/quote',
  ORBITFLARE_LOG: '',
};

export interface Harness {
  client: Client;
  home: string;
  close: () => Promise<void>;
}

export async function spawnServer(env: Record<string, string> = {}): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'orbitflare-mcp-test-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, ...CLEAN_ENV, HOME: home, ...env } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'orbitflare-mcp-tests', version: '0.0.0' });
  await client.connect(transport);
  return {
    client,
    home,
    async close() {
      await client.close().catch(() => undefined);
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export interface CallResult {
  text: string;
  isError: boolean;
  json: any;
  structured: any;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  };
  const text = result.content.map((c) => c.text ?? '').join('\n');
  const match = text.match(/```json\s*([\s\S]*?)```/);
  return {
    text,
    isError: result.isError === true,
    json: match ? JSON.parse(match[1]) : null,
    structured: result.structuredContent ?? null,
  };
}

export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json: any;
}

export type RpcHandler = (params: any, req: Recorded) => unknown;

export interface MockHttp {
  url: string;
  server: Server;
  requests: Recorded[];
  rpc: (method: string) => Recorded[];
  close: () => Promise<void>;
}

export class RpcError {
  constructor(
    public code: number,
    public message: string,
  ) {}
}

export async function mockServer(
  handle: (req: Recorded) => { status?: number; body?: unknown; raw?: string } | undefined,
): Promise<MockHttp> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url ?? '/', 'http://localhost');
      let json: any = null;
      try {
        json = body.length ? JSON.parse(body.toString()) : null;
      } catch {
        json = null;
      }
      const rec: Recorded = { method: req.method ?? '', path: u.pathname, query: u.searchParams, headers: req.headers, body, json };
      requests.push(rec);
      const out = handle(rec) ?? { status: 404, body: { message: 'not found' } };
      res.statusCode = out.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(out.raw ?? JSON.stringify(out.body ?? null));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    server,
    requests,
    rpc: (method) => requests.filter((r) => r.json?.method === method),
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

export function mockRpc(handlers: Record<string, RpcHandler>): Promise<MockHttp> {
  return mockServer((req) => {
    if (req.method !== 'POST' || !req.json?.method) return undefined;
    const { id, method, params } = req.json;
    const handler = handlers[method];
    if (!handler) return { body: { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } } };
    try {
      const result = handler(params, req);
      if (result instanceof RpcError) {
        return { body: { jsonrpc: '2.0', id, error: { code: result.code, message: result.message } } };
      }
      return { body: { jsonrpc: '2.0', id, result } };
    } catch (err) {
      return { status: 500, raw: String(err) };
    }
  });
}

export const BLOCKHASH = {
  context: { slot: 1 },
  value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 },
};
