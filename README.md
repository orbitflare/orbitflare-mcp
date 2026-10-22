# OrbitFlare MCP Server

An [MCP](https://modelcontextprotocol.io) server for [OrbitFlare](https://orbitflare.com): Shredstream-optimized Solana RPC in nine regions, the DAS API, full transaction history, Jetstream streaming and Apex transaction landing, exposed as tools your AI assistant can call. Built on the official [`@orbitflare/sdk`](https://www.npmjs.com/package/@orbitflare/sdk), so every RPC call gets retry and endpoint failover.

OrbitFlare also sells Yellowstone gRPC, Shredstream (raw shreds over UDP), dedicated RPC and gRPC nodes, the OrbitFlare Pass, and RPC for BNB Chain, Polygon and Robinhood Chain. The tools here cover Solana; the docs for everything else are served as [resources](#resources). Plans and prices: <https://orbitflare.com/pricing>.

Works in any MCP-compatible client: Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Continue, Gemini CLI, OpenAI Codex CLI, and the like.

---

## Quick Start

### 1. Add the server to your MCP host

Most hosts (Claude Desktop, Claude Code, Cursor, Gemini CLI, Windsurf, VS Code) take the same JSON shape; only the file location differs:

```json
{
  "mcpServers": {
    "orbitflare": {
      "command": "npx",
      "args": ["@orbitflare/mcp@latest"],
      "env": {
        "ORBITFLARE_API_KEY": "your-license-key",
        "ORBITFLARE_NETWORK": "mainnet"
      }
    }
  }
}
```

| Host           | Where to put it                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Windows)   |
| Claude Code    | run `claude mcp add orbitflare -- npx @orbitflare/mcp@latest`, or drop a `.mcp.json` at your project root                             |
| Cursor         | `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json`                                                                         |
| Gemini CLI     | `~/.gemini/settings.json` (global) or `<project>/.gemini/settings.json`                                                               |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json`                                                                                                 |
| VS Code        | depends on extension (Continue, Cline, GitHub Copilot agent mode)                                                                     |

**Codex CLI** uses TOML at `~/.codex/config.toml` (or `<project>/.codex/config.toml`):

```toml
[mcp_servers.orbitflare]
command = "npx"
args = ["@orbitflare/mcp@latest"]
```

### 2. Get a license key

Sign up at [orbitflare.com](https://orbitflare.com) and copy your license key from the **Licenses** section of the dashboard. The Free plan gives you 10 RPS, enough to start building.

If you would rather not put the key in the host config, leave the env var unset and call `setApiKey` from the chat:

> Set my OrbitFlare API key to `xxxx-xxxx-xxxx`.

### 3. Ask questions

- "What does wallet `86xCn…` hold, and what is it worth?"
- "Show this wallet's failed transactions from last week, including token transfers."
- "List the holders of this mint and their share of supply."
- "What priority fee should I use for a transaction that touches this Raydium pool?"
- "Watch pump.fun for 10 seconds and tell me what's happening."
- "Send 0.1 SOL to `7xKXt…` through Apex." (You'll see a preview before anything is sent.)

---

## Design

| Layer | Approach |
|-------|----------|
| Tools | 29 task-shaped tools. Thin RPC wrappers are replaced by richer tools plus one `rpcRequest` escape hatch |
| RPC | `@orbitflare/sdk` `RpcClient`: retry with backoff, failover across regions, DAS and `getTransactionsForAddress` |
| Safety | MCP annotations on every tool (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Anything that sends funds, spends balance or deletes credentials needs `confirm: true` and otherwise returns a preview |
| Streaming | Bounded: `watchTransactions` / `watchAccounts` listen for a few seconds, then return a summary |
| Output | JSON text plus `structuredContent`; `getPriorityFees` and `getNetworkStatus` declare an `outputSchema`. Oversized payloads are summarized |
| Docs | OrbitFlare documentation served as MCP **resources** under `orbitflare://docs/*` |

---

## Tools

### Wallets and assets (DAS)

| Tool | What it does |
|------|--------------|
| `getWalletPortfolio` | SOL, fungible tokens with USD prices and values, NFTs / compressed NFTs / MPL Core assets for a wallet, paginated |
| `getAsset` | One asset (full detail) or a batch (summaries); `withProof` adds the Merkle proof and `history` the transactions for compressed NFTs |
| `searchAssets` | Find assets by owner, creator, authority, collection, token type, name, compression, burnt/frozen state |
| `getTokenHolders` | Token accounts for a mint with balances and share of supply, paginated in account-address order (not a top-holders ranking) |

### Chain reads

| Tool | What it does |
|------|--------------|
| `getAccount` | One or up to 100 accounts: SOL balance, owner, decoded data (token, mint, stake, nonce, vote...) |
| `getTransaction` | Transaction summary: status, fee, compute units, signers, parsed instructions, SOL and token balance changes, logs |
| `getTransactionHistory` | Address history via `getTransactionsForAddress`: time / slot / status filters, token accounts, sort order, summarized or raw full transactions, `paginationToken` |
| `getPriorityFees` | Recent prioritization fees, percentiles and a recommended compute-unit price |
| `getNetworkStatus` | Health, version, slot, block height, epoch progress, latest blockhash and latency |
| `getSwapQuote` | Jupiter Metis routing quote (`SOL` / `USDC` / `USDT` resolve to mints) |
| `rpcRequest` | Any read-only JSON-RPC or DAS method, with array results capped (send methods are refused) |

### Streaming

| Tool | What it does |
|------|--------------|
| `watchTransactions` | Streams Jetstream v2 for N seconds or N transactions and returns count, rate, slots, top programs and a sample; `configOnly` returns a Jetstream or Yellowstone config for the CLI |
| `watchAccounts` | Subscribes to account changes over WebSocket for a bounded window and returns every update |

### Transactions

| Tool | What it does |
|------|--------------|
| `buildSolTransfer` | Unsigned SOL transfer from the loaded wallet; optional priority fee and Apex tip |
| `simulateTransaction` | Simulate signed or unsigned; returns success/error, compute units, logs and a decoded view |
| `sendTransaction` | Signs with the loaded wallet if needed and sends via OrbitFlare RPC or Apex. **Needs `confirm: true`**; without it, decodes and simulates only |

### Apex (transaction landing)

| Tool | What it does |
|------|--------------|
| `apexSendTransaction` | Send an already fully signed transaction through Apex (signatures and tip checked first). **Needs `confirm: true`** |
| `apexSendBundle` | Send 1-4 signed transactions as an atomic, ordered bundle (Jito leaders only). **Needs `confirm: true`** |
| `apexGetBundleStatuses` | Pending / Landed / Failed / Invalid plus landed slot |
| `apexGetTipAccounts` | The `APeX…` tip accounts an endpoint accepts (no key needed) |
| `apexPing` | Latency to one or every Apex region, ranked (no key needed) |

### Signing wallet

| Tool | What it does |
|------|--------------|
| `wallet` | `status`, `generate` (optionally persisted to `~/.orbitflare/mcp-keypair.json`, plaintext, mode `0600`), `load` (base58 secret or Solana CLI keypair file), `signMessage`, `clear` (deleting the file needs `confirm: true`) |

### OrbitFlare account

| Tool | What it does |
|------|--------------|
| `setApiKey` | Store an RPC, Customer API or Apex key; switch network, pin a region or set a custom RPC URL; show current config |
| `auth` | Sign in with a device code or a wallet (one-step with the loaded wallet), check status, log out |
| `getOrbitflareAccount` | Profile, prepaid balance, licenses, API keys, plan catalog, invoices; license details, IPs and locations |
| `updateProfile` | Name and payment wallet |
| `manageApiKeys` | List, create, regenerate, delete (regenerate and delete need `confirm: true`) |
| `manageLicense` | Whitelist or remove an IP, regenerate the license key, or switch between IP Whitelist and API Key Only mode (remove, regenerate and the mode switch need `confirm: true`) |
| `billing` | Prepare and confirm a USDC top-up, purchase an RPC plan (confirming either needs `confirm: true`; an unconfirmed purchase is a dry run with price) |

---

## Flows

### Send SOL

1. `wallet { action: "generate" }` or `wallet { action: "load", filePath }`.
2. `buildSolTransfer { recipient, amountSol }`.
3. `sendTransaction { transaction }` returns a preview: decoded transfers, signers, and a simulation.
4. `sendTransaction { transaction, confirm: true, waitForConfirmation: true }` once the user agrees.

### Send via Apex

Every Apex transaction must contain exactly one top-level SystemProgram transfer to an Apex tip account (`apexGetTipAccounts`, all start with `APeX`), funded by a signer, with the tip account in the static keys and at least 0.001 SOL (1,000,000 lamports) on the standard tier. The tip is only paid if the transaction lands.

1. Set `ORBITFLARE_APEX_API_KEY` (or `setApiKey { kind: "apex" }`) and load a wallet.
2. `buildSolTransfer { recipient, amountSol, apexTipLamports: 1000000 }`.
3. `sendTransaction { transaction, via: "apex", apexRegion: "fra" }` to preview, then again with `confirm: true`.
4. A returned signature means accepted, not landed: check with `getTransaction`.

### Sign in

- Device code: `auth { action: "deviceStart" }`, open the URL and enter the code, then `auth { action: "devicePoll", device_code }`.
- Wallet: with a loaded wallet, `auth { action: "walletLogin" }` (add `register: true, name, email` for a new account).

The Bearer token is stored at `~/.orbitflare/mcp-session.json` and used for all Customer API calls.

### Top up and buy a plan

1. `billing { action: "prepareTopUp", amount: 50 }` builds the USDC transfer.
2. `billing { action: "confirmTopUp", amount: 50, transaction }` previews; add `confirm: true` to sign and submit. OrbitFlare verifies it on chain and credits the balance.
3. `billing { action: "purchasePlan", slug: "developer", period: "monthly" }` shows the price and whether the balance covers it; add `confirm: true` to buy.

---

## Resources

| URI | Page |
|-----|------|
| `orbitflare://docs/index` | Documentation index (`llms.txt`) |
| `orbitflare://docs/quickstart` | Quickstart |
| `orbitflare://docs/recipes` | Complete example programs in TypeScript, Rust, Go and curl |
| `orbitflare://docs/authentication` | Auth, endpoints, rate limits, connection limits |
| `orbitflare://docs/infrastructure` | Regions and server locations |
| `orbitflare://docs/troubleshooting-transactions` | Transaction debugging |
| `orbitflare://docs/troubleshooting-websocket` | WebSocket debugging |
| `orbitflare://docs/troubleshooting-grpc` | gRPC debugging, including IP Whitelist and API Key Only access |
| `orbitflare://docs/products` | Products & pricing |
| `orbitflare://docs/dedicated-nodes` | Dedicated RPC and gRPC nodes |
| `orbitflare://docs/shredstream` | Shredstream |
| `orbitflare://docs/nft-pass` | OrbitFlare Pass |
| `orbitflare://docs/historical-data` | Historical data |
| `orbitflare://docs/rpc-http` | HTTP RPC reference |
| `orbitflare://docs/rpc-websocket` | WebSocket subscriptions |
| `orbitflare://docs/rpc-error-codes` | RPC error codes |
| `orbitflare://docs/transaction-history` | `getTransactionsForAddress` |
| `orbitflare://docs/das` | DAS API overview |
| `orbitflare://docs/das-asset-object` | DAS asset object |
| `orbitflare://docs/das-pagination` | DAS pagination |
| `orbitflare://docs/das-display-options` | DAS display options |
| `orbitflare://docs/jetstream` | Jetstream streaming |
| `orbitflare://docs/jetstream-reference` | Jetstream protocol reference and endpoints |
| `orbitflare://docs/yellowstone` | Yellowstone gRPC |
| `orbitflare://docs/apex` | Apex transaction landing |
| `orbitflare://docs/apex-tips` | Apex tip rule |
| `orbitflare://docs/apex-endpoints` | Apex endpoints and regions |
| `orbitflare://docs/apex-bundles` | Apex bundles |
| `orbitflare://docs/apex-errors` | Apex errors and rate limits |
| `orbitflare://docs/apex-typescript-client` | The Apex client in `@orbitflare/sdk` (HTTP only) |
| `orbitflare://docs/metis-swap` | Metis Swap API |
| `orbitflare://docs/cli` | OrbitFlare CLI |
| `orbitflare://docs/customer-api` | Customer API v2 |
| `orbitflare://docs/bnb-chain` | BNB Chain nodes |
| `orbitflare://docs/polygon` | Polygon RPC nodes |
| `orbitflare://docs/robinhood-chain` | Robinhood Chain nodes |

---

## Configuration

| Env var | Purpose |
|---------|---------|
| `ORBITFLARE_API_KEY` | RPC license key (sent as `?api_key=`); used for RPC, DAS, history and WebSocket |
| `ORBITFLARE_LICENSE_KEY` | Alias for `ORBITFLARE_API_KEY` |
| `ORBITFLARE_NETWORK` | `mainnet` (default) or `devnet` |
| `ORBITFLARE_REGION` | Pin an RPC region: `va`, `ny`, `la`, `slc`, `ams`, `fra`, `lon`, `jp`, `sg`. Default mainnet uses `fra` with `ams` and `ny` as failover |
| `ORBITFLARE_RPC_URL` | Explicit RPC endpoint (e.g. a dedicated node); overrides network and region |
| `ORBITFLARE_RPC_FALLBACK_URLS` | Comma-separated failover endpoints |
| `ORBITFLARE_JETSTREAM_URL` | Jetstream endpoint for `watchTransactions` (default: the region matching your RPC region, e.g. `http://fra.jetstream.orbitflare.com`). `watchTransactions` sends no token, so the machine's IP must be whitelisted on your license |
| `ORBITFLARE_CUSTOMER_API_KEY` | Customer API v2 key (`X-ORBIT-KEY`). This is an account API key (see `manageApiKeys`), not the RPC license key |
| `ORBITFLARE_BEARER_TOKEN` | Customer API Bearer token; normally set by the `auth` tool and persisted at `~/.orbitflare/mcp-session.json` |
| `ORBITFLARE_APEX_API_KEY` | Apex API key, required to send through Apex. Create one under **Dashboard > Apex** |
| `ORBITFLARE_APEX_REGION` | Apex endpoint: `fra`, `ams`, `dub`, `lon`, `nyc`, `slc`, `sgp`, `tyo`, `sqq`, or `global` (nearest, default) |
| `ORBITFLARE_APEX_URL` | Explicit Apex endpoint URL (overrides `ORBITFLARE_APEX_REGION`) |
| `JUPITER_API_KEY` / `JUPITER_QUOTE_URL` | Optional Jupiter key and quote endpoint for `getSwapQuote` |
| `ORBITFLARE_LOG` | `debug`, `info`, `warn` or `error` to log SDK events to stderr (stdout carries only MCP traffic) |

Keys, network, region and RPC URL can also be changed at runtime with `setApiKey`.

---

## Local Development

```bash
git clone https://github.com/orbitflare/orbitflare-mcp.git
cd orbitflare-mcp
npm install
npm test        # builds, then runs the stdio end-to-end suite against local mock servers
```

The repo ships project-scoped configs for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`), Gemini CLI (`.gemini/settings.json`), and Codex CLI (`.codex/config.toml`). Open the folder in any of them after the build and the dev server connects automatically; set `ORBITFLARE_API_KEY` in the `env` block (or call `setApiKey` from chat).

For hosts without project-scoped configs (e.g. Claude Desktop), point them at the absolute path of `dist/index.js`.

---

## System prompts

Pre-built prompts live under [`system-prompts/orbitflare/`](./system-prompts/orbitflare):

- `claude.system.md`: concise system prompt for Claude.
- `openai.developer.md`: concise developer message for OpenAI models.
- `full.md`: long-form operator playbook (flows, confirmation rules, guardrails).

## Project Layout

```
src/
  index.ts             # Server bootstrap, stdio transport, loads the persisted keypair
  config.ts            # Session state: keys, bearer token, network, region, endpoints
  utils/
    rpc.ts             # @orbitflare/sdk RpcClient with failover + retry
    customerApi.ts     # Customer API v2 (Bearer, X-ORBIT-KEY, public routes)
    apex.ts            # Apex client + tip checks
    transactions.ts    # Decode, describe, sign and build transactions
    keypair.ts         # Keypair generate/load/sign + persistence
    formatters.ts      # JSON + structured output, confirmation previews, large-payload summaries
    logger.ts          # SDK logger that writes to stderr only
  tools/
    assets.ts          # getWalletPortfolio, getAsset, searchAssets, getTokenHolders
    chain.ts           # getAccount, getTransaction, getTransactionHistory, getPriorityFees, getNetworkStatus, rpcRequest
    swap.ts            # getSwapQuote
    streaming.ts       # watchTransactions, watchAccounts
    transactions.ts    # buildSolTransfer, simulateTransaction, sendTransaction
    apex.ts            # Apex send, bundles, statuses, tip accounts, ping
    wallet.ts          # wallet
    account.ts         # setApiKey, auth, getOrbitflareAccount, updateProfile, manageApiKeys, manageLicense, billing
    define.ts          # registerTool wrapper, annotations, confirm schema
  resources/
    index.ts           # Doc resources under orbitflare://docs/*
system-prompts/orbitflare/
tests/                 # stdio end-to-end tests with mock RPC, DAS, Apex, Jetstream, WebSocket and Customer API servers
```

---

## Links

- OrbitFlare: <https://orbitflare.com>
- Docs: <https://docs.orbitflare.com>
- Discord: <https://discord.gg/orbitflare>
- GitHub: <https://github.com/orbitflare>
- Status: <https://status.orbitflare.com>

## License

MIT, see [LICENSE](./LICENSE).
