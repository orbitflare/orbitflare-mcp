#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { initFromEnv } from './config.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { loadKeypairFromDisk } from './utils/keypair.js';
import { VERSION } from './version.js';

const INSTRUCTIONS = `OrbitFlare MCP Server

OrbitFlare provides Shredstream-optimized Solana infrastructure across 11 global regions:
RPC nodes, Jetstream/Yellowstone gRPC streaming, dedicated nodes, validator staking, and Metis Swap.

This server exposes 53 tools organized by domain — every tool is independently callable:
- RPC reads (balance, accounts, transactions, blocks, slots, epochs, fees, supply, simulation, etc.)
- Customer API (profile, licenses, plans, invoices, top-up, plan purchase)
- Auth flows (device code, wallet challenge — both for sign-in and account creation)
- API key + license management (create, regenerate, delete, IP whitelist)
- Streaming config builder for Jetstream / Yellowstone gRPC
- Wallet helpers (generate / load / clear keypair, sign messages, build SOL transfers,
  build stake delegations to OrbitFlare's validator, sign+send transactions)
- Validator staking info and Metis Swap quotes

Resources under orbitflare://docs/* serve official OrbitFlare documentation pages —
read these to ground your responses.

Auth model:
- ORBITFLARE_API_KEY: RPC license key (required for any RPC tool)
- ORBITFLARE_CUSTOMER_API_KEY or a Bearer token from auth tools: needed for Customer API tools
- ORBITFLARE_NETWORK=mainnet|devnet, ORBITFLARE_RPC_URL=<custom> for endpoint overrides
- Wallet keypair is generated/loaded via tools and persisted at ~/.orbitflare/mcp-keypair.json
  (plaintext — do not store production wallets there).`;

const server = new McpServer(
  { name: 'orbitflare-mcp', version: VERSION },
  { instructions: INSTRUCTIONS },
);

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
