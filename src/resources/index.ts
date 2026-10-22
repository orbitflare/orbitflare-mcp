import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface DocResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  url: string;
  mimeType: string;
}

const DOCS = (process.env.ORBITFLARE_DOCS_URL ?? 'https://docs.orbitflare.com').replace(/\/+$/, '');

function doc(name: string, path: string, title: string, description: string): DocResource {
  const text = path.endsWith('.txt');
  return {
    uri: `orbitflare://docs/${name}`,
    name,
    title,
    description,
    url: `${DOCS}/${path}`,
    mimeType: text ? 'text/plain' : 'text/markdown',
  };
}

const DOC_RESOURCES: DocResource[] = [
  doc('index', 'llms.txt', 'OrbitFlare Documentation Index', 'Index of every OrbitFlare documentation page (llms.txt). Start here to discover topics.'),
  doc('quickstart', 'quickstart.md', 'OrbitFlare Quickstart', 'Get started with OrbitFlare RPC in minutes.'),
  doc('recipes', 'recipes.md', 'Recipes', 'Complete TypeScript, Rust, Go and curl programs: check a key, watch an account, wait for a transaction, stream a program, read wallet history.'),
  doc('authentication', 'authentication.md', 'Authentication, Endpoints, and Limits', 'License keys, the IP Whitelist and API Key Only modes, regional endpoints, rate limits per plan, and gRPC connection limits.'),
  doc('infrastructure', 'infrastructure.md', 'Global Infrastructure', 'Server locations and region-pinned endpoints.'),
  doc('troubleshooting-transactions', 'troubleshooting/transactions.md', 'Transaction Debugging', 'Why a transaction failed, was rejected before sending, or never landed: simulation errors, program logs, blockhash expiry, priority fees.'),
  doc('troubleshooting-websocket', 'troubleshooting/websocket.md', 'WebSocket Debugging', 'Refused, silent or dropping WebSocket connections: handshake errors, subscriptions that never fire, idle disconnects and keepalive.'),
  doc('troubleshooting-grpc', 'troubleshooting/grpc.md', 'gRPC Debugging', 'Jetstream and Yellowstone access in IP Whitelist and API Key Only modes, x-token errors, ports, filters that match nothing.'),
  doc('products', 'products.md', 'Products & Pricing', 'RPC plans, gRPC streaming, dedicated nodes, historical data and the OrbitFlare Pass. Live prices: https://orbitflare.com/pricing.'),
  doc('dedicated-nodes', 'dedicated-nodes.md', 'Dedicated Nodes', 'Dedicated RPC and gRPC nodes: hardware, client choice, regions and limits.'),
  doc('shredstream', 'shredstream.md', 'Shredstream', 'Raw Solana shreds over UDP from top-of-turbine validators in 8 regions: premium and standard regions, trials and setup.'),
  doc('nft-pass', 'nft-pass.md', 'OrbitFlare Pass', 'The OrbitFlare Pass NFT: Pro, Elite and Mega monthly access tiers and what they include.'),
  doc('historical-data', 'fetching-data/historical-data.md', 'Historical Data', 'Full archive access from genesis through standard RPC methods.'),
  doc('rpc-http', 'rpc/http.md', 'HTTP RPC Reference', 'JSON-RPC 2.0 request format, commitment levels, batching and the method list.'),
  doc('rpc-websocket', 'rpc/websocket.md', 'WebSocket RPC', 'accountSubscribe, logsSubscribe, slotSubscribe and other subscriptions.'),
  doc('rpc-error-codes', 'rpc/error-codes.md', 'RPC Error Codes', 'JSON-RPC and HTTP error codes returned by OrbitFlare RPC and what to do about each.'),
  doc('transaction-history', 'fetching-data/getTransactionsForAddress.md', 'getTransactionsForAddress', 'Full transaction history for an address in one call: filters, sorting, token accounts and pagination.'),
  doc('das', 'das-api/overview.md', 'DAS API', 'Digital Asset Standard methods for NFTs, compressed NFTs, MPL Core assets and SPL tokens.'),
  doc('das-asset-object', 'das-api/asset-object.md', 'DAS Asset Object', 'Every field of a DAS asset: content, ownership, compression, royalty, token_info and prices.'),
  doc('das-pagination', 'das-api/pagination.md', 'DAS Pagination', 'Page, cursor and before/after paging for DAS list methods.'),
  doc('das-display-options', 'das-api/display-options.md', 'DAS Display Options', 'showFungible, showNativeBalance, showZeroBalance and other response options.'),
  doc('jetstream', 'data-streaming/jetstream.md', 'Jetstream Streaming', 'Low-latency transaction streaming with dynamic filters, enrichment and slot events.'),
  doc('jetstream-reference', 'data-streaming/jetstream-reference.md', 'Jetstream Protocol Reference', 'Jetstream v2 protobuf, regional endpoints and code generation.'),
  doc('yellowstone', 'data-streaming/yellowstone.md', 'Yellowstone gRPC', 'Geyser-based streaming with full transaction metadata, accounts, slots and blocks.'),
  doc('apex', 'apex/overview.md', 'Apex Transaction Landing', 'Apex races each transaction to upcoming leaders over stake-weighted connections, Jito and direct TPU at once. Endpoints, transports, bundles.'),
  doc('apex-tips', 'apex/tips.md', 'Apex Tips', 'The Apex tip rule: one top-level SystemProgram transfer to a published APeX tip account, 0.001 SOL standard floor.'),
  doc('apex-endpoints', 'apex/endpoints.md', 'Apex Endpoints and Regions', 'Apex hostnames and region codes: HTTP on port 80 and QUIC on UDP 7001.'),
  doc('apex-bundles', 'apex/bundles.md', 'Apex Bundles', 'Atomic bundles of 1-4 transactions: Jito leaders only, rate limits, statuses.'),
  doc('apex-errors', 'apex/errors-and-rate-limits.md', 'Apex Errors and Rate Limits', 'Apex error codes and per-key rate limits (standard 5 tx/s, pro 50 tx/s).'),
  doc('apex-typescript-client', 'apex/typescript-client.md', 'Apex TypeScript Client', 'ApexClient in @orbitflare/sdk: HTTP JSON-RPC sends, batches and bundles, region failover and tip helpers. No QUIC in TypeScript.'),
  doc('metis-swap', 'trading-apis/metis-swap.md', 'Metis Swap API', 'Jupiter routing engine for swaps with full transaction control.'),
  doc('cli', 'cli.md', 'OrbitFlare CLI', 'Command-line interface for streaming, querying, scaffolding and account management.'),
  doc('customer-api', 'api-documentation/welcome.md', 'Customer API v2', 'Programmatic management of licenses, API keys, profile, invoices, top-ups and orders.'),
  doc('bnb-chain', 'bnb-chain.md', 'BNB Chain Nodes', 'OrbitFlare BNB Smart Chain RPC endpoints and plans.'),
  doc('polygon', 'polygon.md', 'Polygon RPC Nodes', 'OrbitFlare Polygon PoS RPC and WebSocket endpoints and plans.'),
  doc('robinhood-chain', 'robinhood-chain.md', 'Robinhood Chain Nodes', 'OrbitFlare Robinhood Chain RPC and WebSocket endpoints, methods and limits.'),
];

async function fetchDoc(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'orbitflare-mcp' },
    signal: AbortSignal.timeout(15_000),
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
