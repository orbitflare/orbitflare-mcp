# OrbitFlare MCP Server

An [MCP](https://modelcontextprotocol.io) server for [OrbitFlare](https://orbitflare.com) — Shredstream-optimized Solana RPC, gRPC streaming, dedicated nodes, and validator infrastructure across 11 global regions, exposed as tools your AI assistant can call.

Works in any MCP-compatible client: Claude Desktop, Cursor, Windsurf, VS Code, Continue, and the like.

---

## Quick Start

### 1. Add the server to your MCP host

```json
{
  "mcpServers": {
    "orbitflare": {
      "command": "npx",
      "args": ["orbitflare-mcp@latest"],
      "env": {
        "ORBITFLARE_API_KEY": "your-license-key",
        "ORBITFLARE_NETWORK": "mainnet"
      }
    }
  }
}
```

### 2. Get a license key

Sign up at [orbitflare.com](https://orbitflare.com) and copy your license key from the **Licenses** section of the dashboard. The free tier gives you 10 RPS — enough to start building immediately.

If you would rather not put the key in the host config, leave the env var unset and call `setApiKey` from the chat:

> Set my OrbitFlare API key to `xxxx-xxxx-xxxx`.

### 3. Ask questions

The model picks the right tool automatically:

- "What is the SOL balance of `Gh9ZwEm…`?"
- "Show me the last 20 transactions for `7xKXt…`."
- "What is a competitive priority fee right now for an account that touches Raydium?"
- "Build me a Yellowstone gRPC config that streams Jupiter swap transactions from Frankfurt."
- "Quote 1 SOL → USDC with 0.3% slippage."
- "What is OrbitFlare's validator vote account, and what would 250 SOL earn per year?"

---

## Design Philosophy

Each capability is its own MCP tool with a focused input schema — no internal action routers, no result-id pagination dance. Models discover and call tools directly the way the MCP spec intends. Large RPC payloads are summarized server-side rather than chunked behind a separate `expandResult` call.

| Layer | Approach |
|-------|----------|
| Tools | One tool per capability, grouped into domain folders |
| Auth | Env vars at startup, or `setApiKey` at runtime (RPC license key + Customer API key tracked separately) |
| Network | `ORBITFLARE_NETWORK=mainnet|devnet`, or pin a specific region (e.g. `fra`, `sgp`) via `setApiKey` |
| Docs | Served as MCP **resources** under `orbitflare://docs/*` so models can ground answers in official content |

---

## Tools

51 tools, grouped by domain. Every tool is independently callable — no internal `action` routers.

### RPC reads

| Tool | What it does |
|------|--------------|
| `getBalance` | SOL balance for a pubkey, in lamports and SOL |
| `getAccountInfo` | Full account info (owner, lamports, data) with `jsonParsed` decoding when available |
| `getMultipleAccounts` | Batch up to 100 accounts in one call |
| `getProgramAccounts` | Accounts owned by a program (filters + dataSlice required for popular programs; soft-capped result) |
| `getTokenAccountsByOwner` | All SPL token accounts a wallet owns, with mint and uiAmount |
| `getTokenAccountBalance` | Balance of a specific SPL token account |
| `getTokenSupply` | Total supply for an SPL mint |
| `getTransaction` | Parsed transaction by signature |
| `getSignaturesForAddress` | Recent signatures for an address (paginated via `before`/`until`) |
| `getBlock` | Block metadata + transactions at a slot |
| `getSlot` | Current slot |
| `getEpochInfo` | Epoch number, slot index, slots-in-epoch, progress percentage |
| `getNetworkStatus` | Health + version + identity + slot in one call |
| `getLatestBlockhash` | Recent blockhash + lastValidBlockHeight (for transaction building) |
| `getFeeForMessage` | Lamport fee for a compiled message |
| `getMinimumBalanceForRentExemption` | Min lamports an account needs to be rent-exempt for a given data size |
| `getStakeActivation` | Active/inactive lamports + state for a stake account |
| `getRecentPrioritizationFees` | Priority-fee samples + P50/P75/P90/P99 percentiles |
| `simulateTransaction` | Simulate a tx (signed/unsigned base64); returns logs + units consumed |
| `sendTransaction` | Submits an already-signed base-64 transaction |

### Account / Profile / Plans

| Tool | What it does |
|------|--------------|
| `setApiKey` | Stores an RPC or Customer API key for the session, optionally switches network/region |
| `getProfile` | Authenticated user profile + account balance |
| `updateProfile` | Update name, email, payment wallet |
| `listLicenses` | All RPC licenses on the account |
| `listRpcPlans` | Catalog of available plans with pricing |

### Auth (device code + wallet challenge)

| Tool | What it does |
|------|--------------|
| `requestDeviceCode` | Start device-authorization flow; returns `verification_uri` + `user_code` |
| `pollDeviceToken` | Poll for completion; auto-stores Bearer token on success |
| `revokeToken` | Logout / clear Bearer token |
| `requestWalletChallenge` | Get a one-time challenge string for a Solana wallet |
| `verifyWalletSignature` | Sign in an existing account by signature |
| `registerWithWallet` | Create a new account from a wallet signature |

### API keys & licenses

| Tool | What it does |
|------|--------------|
| `listApiKeys` | List all API keys (masked) |
| `createApiKey` | Create a new API key (full key returned **once**) |
| `regenerateApiKey` | Regenerate by id (old key invalidated immediately) |
| `deleteApiKey` | Permanently delete an API key |
| `addLicenseIp` | Whitelist an IP on an IP-mode license |
| `removeLicenseIp` | Remove a whitelisted IP |
| `regenerateLicenseKey` | Rotate a license's RPC key |

### Billing

| Tool | What it does |
|------|--------------|
| `prepareTopUp` | Build an unsigned USDC top-up transaction |
| `confirmTopUp` | Submit the signed top-up; OrbitFlare verifies on-chain and credits balance |
| `listInvoices` | Paginated invoice list |
| `purchaseRpcPlan` | Purchase or `validateOnly`-dry-run a plan from your account balance |

### Streaming / Staking / Swap

| Tool | What it does |
|------|--------------|
| `subscribeTransactions` | Builds a ready-to-use Jetstream or Yellowstone gRPC config for the OrbitFlare CLI |
| `getStakeInfo` | OrbitFlare validator identity, vote account, commission, est. APY, optional reward calculator |
| `getSwapQuote` | Jupiter Metis routing quote (auto-resolves `SOL`/`USDC`/`USDT` symbols) |

### Wallet & write

| Tool | What it does |
|------|--------------|
| `generateKeypair` | Generate Ed25519 keypair, optionally persist to `~/.orbitflare/mcp-keypair.json` (mode `0600`, plaintext) |
| `loadKeypair` | Load from base58 secret or Solana CLI keypair file |
| `clearKeypair` | Remove from session (and optionally disk) |
| `getWalletAddress` | Returns the loaded wallet's address |
| `signMessage` | Ed25519-sign an arbitrary message (utf8/base58/base64) |
| `buildSolTransfer` | Build an unsigned versioned tx transferring SOL |
| `buildStakeDelegation` | Build an unsigned tx delegating to OrbitFlare's vote account (or any vote account) |
| `signAndSendTransaction` | Sign a base64 unsigned tx with the session keypair, broadcast via OrbitFlare RPC |

---

## Flows

### Auth (device code)

1. `requestDeviceCode` — get `verification_uri` + `user_code`. Show them to the user.
2. `pollDeviceToken { device_code }` — repeat every `interval` seconds until success. The Bearer token is stored automatically and used for all subsequent Customer API calls.
3. `revokeToken` to log out.

### Auth (wallet)

1. `generateKeypair` (or `loadKeypair`).
2. `requestWalletChallenge { wallet_address }`.
3. `signMessage { message: <challenge> }`.
4. `verifyWalletSignature` (existing account) or `registerWithWallet` (new account).

### Wallet send

1. `generateKeypair` or `loadKeypair`.
2. `buildSolTransfer { recipient, amountSol }` — returns a base64 unsigned tx.
3. `signAndSendTransaction { transaction }` — signs with the session keypair, broadcasts, returns signature + Solscan link.

### Top-up

1. `prepareTopUp { amount, wallet_address }` — returns a base64 unsigned USDC transfer + memo.
2. Sign it (with the loaded wallet via `signAndSendTransaction`, or externally).
3. `confirmTopUp { transaction: <signed-base64> }`. OrbitFlare verifies on-chain and credits your balance.

---

## Resources

The server exposes OrbitFlare's documentation as MCP resources, so the model can pull current docs on demand:

| URI | Page |
|-----|------|
| `orbitflare://docs/index` | Documentation index (`llms.txt`) |
| `orbitflare://docs/quickstart` | Quickstart |
| `orbitflare://docs/authentication` | Auth, endpoints, rate limits, connection limits |
| `orbitflare://docs/products` | Products & pricing |
| `orbitflare://docs/rpc-http` | HTTP RPC reference |
| `orbitflare://docs/jetstream` | Jetstream streaming |
| `orbitflare://docs/yellowstone` | Yellowstone gRPC |
| `orbitflare://docs/staking` | Validator staking |
| `orbitflare://docs/metis-swap` | Metis Swap API |
| `orbitflare://docs/cli` | OrbitFlare CLI |
| `orbitflare://docs/customer-api` | Customer API v2 |

---

## Configuration

| Env var | Purpose |
|---------|---------|
| `ORBITFLARE_API_KEY` | RPC license key (used as `?api_key=` for JSON-RPC) |
| `ORBITFLARE_LICENSE_KEY` | Alias for `ORBITFLARE_API_KEY` |
| `ORBITFLARE_CUSTOMER_API_KEY` | Customer API v2 key (`X-ORBIT-KEY` header) — falls back to `ORBITFLARE_API_KEY` if unset |
| `ORBITFLARE_NETWORK` | `mainnet` (default) or `devnet` |
| `ORBITFLARE_RPC_URL` | Optional explicit RPC endpoint URL (overrides region/network). Useful for dedicated nodes. |
| `ORBITFLARE_BEARER_TOKEN` | Bearer token for the Customer API (alternative to `ORBITFLARE_CUSTOMER_API_KEY`). Auto-populated by `pollDeviceToken` / `verifyWalletSignature` and persisted at `~/.orbitflare/mcp-session.json`. |

All values can be overridden at runtime via the `setApiKey` tool — handy when you want to switch networks or pin a regional endpoint without restarting the host.

### Regional endpoints

`mainnet` (auto-routed) is the default. To pin a region, call `setApiKey` with one of:

`ash`, `ny`, `la`, `slc`, `ams`, `fra`, `lon`, `dub`, `siau`, `tok`, `sgp`

---

## Local Development

```bash
git clone https://github.com/orbitflare/orbitflare-mcp.git
cd orbitflare-mcp
npm install
npm run build
node dist/index.js     # speaks MCP over stdio
```

Point your MCP host at the local build:

```json
{
  "mcpServers": {
    "orbitflare-dev": {
      "command": "node",
      "args": ["/absolute/path/to/orbitflare-mcp/dist/index.js"],
      "env": { "ORBITFLARE_API_KEY": "..." }
    }
  }
}
```

---

## System prompts

Pre-built system / developer prompts live under [`system-prompts/orbitflare/`](./system-prompts/orbitflare):

- `claude.system.md` — concise system prompt for Claude.
- `openai.developer.md` — concise developer message for OpenAI models.
- `full.md` — long-form operator playbook (auth flows, top-up, hard guardrails).

Drop one into your host config to give the model end-to-end guidance on when to reach for which tool.

## Project Layout

```
src/
  index.ts                 # Server bootstrap + StdioTransport, loads persisted keypair
  config.ts                # Session state (keys, bearer token, network, region, wallet)
  utils/
    rpc.ts                 # JSON-RPC client targeting OrbitFlare
    customerApi.ts         # Customer API v2 REST (Bearer + X-ORBIT-KEY + public)
    keypair.ts             # @solana/kit keypair generate/load/sign + persistence
    formatters.ts          # Response shaping + large-payload summarization
  tools/
    rpc/                   # 20 RPC tools
    account/               # profile, plans, licenses, updateProfile, setApiKey
    auth/                  # device-code + wallet challenge flows
    keys/                  # API key management
    licenses/              # license IP whitelist + key rotation
    billing/               # top-up + invoices + plan purchase
    streaming/             # subscribeTransactions config builder
    staking/               # getStakeInfo
    swap/                  # getSwapQuote
    wallet/                # generate/load/clear keypair, signMessage, buildSolTransfer, …
  resources/
    index.ts               # Doc resources under orbitflare://docs/*
system-prompts/orbitflare/ # Pre-built system prompts (Claude, OpenAI, full)
tests/                     # End-to-end tests via the MCP SDK over stdio
```

---

## Links

- OrbitFlare: <https://orbitflare.com>
- Docs: <https://docs.orbitflare.com>
- Discord: <https://discord.gg/orbitflare>
- GitHub: <https://github.com/orbitflare>
- Status: <https://status.orbitflare.com>

## License

MIT — see [LICENSE](./LICENSE).
