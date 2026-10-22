#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { initFromEnv } from './config.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { loadKeypairFromDisk } from './utils/keypair.js';
import { VERSION } from './version.js';

const INSTRUCTIONS = `OrbitFlare MCP server: Solana data and transaction tools on OrbitFlare's Shredstream-optimized RPC, DAS API, Jetstream streaming and Apex transaction landing, plus OrbitFlare account management.

Choosing tools:
- What a wallet holds: getWalletPortfolio (SOL, tokens with USD prices, NFTs). One asset or mint: getAsset. Find assets by owner/creator/collection: searchAssets. Who holds a token: getTokenHolders.
- Raw accounts and balances: getAccount. One transaction: getTransaction. History of an address: getTransactionHistory (filters + paginationToken).
- Fees: getPriorityFees (pass writable accounts such as a pool; without them the result is usually 0). Cluster/endpoint health, slot, epoch, blockhash: getNetworkStatus. Anything else read-only: rpcRequest.
- Live data for a short window: watchTransactions (Jetstream), watchAccounts (WebSocket).
- Moving funds: buildSolTransfer -> simulateTransaction -> sendTransaction (via "rpc" or "apex"). Apex sends need an Apex API key and exactly one SystemProgram tip (>= 0.001 SOL on the standard tier) to an APeX tip account; buildSolTransfer apexTipLamports adds it.
- Signing keypair: wallet. OrbitFlare account: auth, getOrbitflareAccount, updateProfile, manageApiKeys, manageLicense, billing. Credentials and endpoint: setApiKey.

Safety: tools that send transactions, spend balance, or delete/regenerate credentials do nothing unless called with confirm: true. Call them without it first, show the user what would happen, and only confirm after the user agrees.

Read orbitflare://docs/* resources to ground answers about OrbitFlare products, including those without tools here (Shredstream, dedicated nodes, the OrbitFlare Pass, BNB Chain, Polygon and Robinhood Chain RPC). Prices change; point users to https://orbitflare.com/pricing rather than quoting from memory.

Configuration: ORBITFLARE_API_KEY (RPC license key), ORBITFLARE_NETWORK / ORBITFLARE_REGION / ORBITFLARE_RPC_URL, ORBITFLARE_APEX_API_KEY, ORBITFLARE_JETSTREAM_URL, ORBITFLARE_CUSTOMER_API_KEY (or sign in with auth). The wallet keypair file ~/.orbitflare/mcp-keypair.json is plaintext; never keep meaningful funds in it.`;

const server = new McpServer({ name: 'orbitflare-mcp', version: VERSION }, { instructions: INSTRUCTIONS });

registerTools(server);
registerResources(server);

async function main(): Promise<void> {
  initFromEnv();
  await loadKeypairFromDisk().catch(() => null);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('OrbitFlare MCP failed to start:', err);
  process.exit(1);
});
