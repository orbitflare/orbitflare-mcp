import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface DocResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  url: string;
  mimeType: string;
}

const DOC_RESOURCES: DocResource[] = [
  {
    uri: 'orbitflare://docs/index',
    name: 'index',
    title: 'OrbitFlare Documentation Index',
    description:
      'Complete index of OrbitFlare documentation pages (llms.txt). Start here to discover available topics.',
    url: 'https://docs.orbitflare.com/llms.txt',
    mimeType: 'text/plain',
  },
  {
    uri: 'orbitflare://docs/quickstart',
    name: 'quickstart',
    title: 'OrbitFlare Quickstart',
    description: 'How to get started with OrbitFlare RPC in minutes.',
    url: 'https://docs.orbitflare.com/quickstart.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/authentication',
    name: 'authentication',
    title: 'Authentication, Endpoints, and Limits',
    description:
      'API key usage, regional endpoint formats, rate limits per plan, and gRPC/WebSocket connection limits.',
    url: 'https://docs.orbitflare.com/authentication.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/products',
    name: 'products',
    title: 'Products & Pricing',
    description:
      'All OrbitFlare RPC plans, gRPC streaming options, dedicated nodes, and historical data.',
    url: 'https://docs.orbitflare.com/products.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/jetstream',
    name: 'jetstream',
    title: 'Jetstream Streaming',
    description:
      'High-performance gRPC service for ultra-low-latency Solana transaction streaming.',
    url: 'https://docs.orbitflare.com/data-streaming/jetstream.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/yellowstone',
    name: 'yellowstone',
    title: 'Yellowstone gRPC',
    description:
      'Geyser-plugin-based real-time Solana streaming with full transaction metadata and inner instructions.',
    url: 'https://docs.orbitflare.com/data-streaming/yellowstone.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/rpc-http',
    name: 'rpc-http',
    title: 'HTTP RPC Reference',
    description:
      'JSON-RPC 2.0 request format, commitment levels, batching, and full method list.',
    url: 'https://docs.orbitflare.com/rpc/http.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/staking',
    name: 'staking',
    title: 'Validator Staking',
    description:
      "Stake SOL with OrbitFlare's high-performance validator. Identity, vote account, and APY details.",
    url: 'https://docs.orbitflare.com/staking.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/metis-swap',
    name: 'metis-swap',
    title: 'Metis Swap API',
    description:
      'Jupiter routing engine for swaps with CPI, custom instructions, and full transaction control.',
    url: 'https://docs.orbitflare.com/trading-apis/metis-swap.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/cli',
    name: 'cli',
    title: 'OrbitFlare CLI',
    description:
      'Command-line interface for streaming, querying, scaffolding, and account management.',
    url: 'https://docs.orbitflare.com/cli.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'orbitflare://docs/customer-api',
    name: 'customer-api',
    title: 'Customer API v2',
    description:
      'Programmatic management of licenses, API keys, profile, invoices, and top-ups.',
    url: 'https://docs.orbitflare.com/api-documentation/welcome.md',
    mimeType: 'text/markdown',
  },
];

async function fetchDoc(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'orbitflare-mcp' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return await res.text();
}

export function registerResources(server: McpServer): void {
  for (const doc of DOC_RESOURCES) {
    server.registerResource(
      doc.name,
      doc.uri,
      {
        title: doc.title,
        description: doc.description,
        mimeType: doc.mimeType,
      },
      async (uri) => {
        try {
          const text = await fetchDoc(doc.url);
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: doc.mimeType,
                text,
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'text/plain',
                text: `Error loading ${doc.url}\n${msg}\n\nView in browser: ${doc.url}`,
              },
            ],
          };
        }
      },
    );
  }
}
