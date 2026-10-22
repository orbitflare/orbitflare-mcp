# Changelog

## v0.2.0

Rebuilt on `@orbitflare/sdk` with a smaller, task-shaped tool set (58 tools down to 29).

### Added

- `watchTransactions` sends the license key to Jetstream as `x-token`, so streaming works for
  licenses in API Key Only mode (via `@orbitflare/sdk` 0.5.1).
- `manageLicense` `toggleAuthMode` switches a license between IP Whitelist and API Key Only.
- Docs resources for recipes, transaction, WebSocket and gRPC troubleshooting, and the Apex
  TypeScript client.
- RPC through the SDK `RpcClient`: retry with backoff and failover across endpoints
  (mainnet defaults to `fra` with `ams` and `ny` as fallbacks; `ORBITFLARE_RPC_FALLBACK_URLS`
  adds more).
- DAS tools: `getWalletPortfolio` (SOL, priced tokens and NFTs in one call), `getAsset`
  (batch, compressed-NFT proof and history), `searchAssets`, `getTokenHolders`.
- `getTransactionHistory` on `getTransactionsForAddress` with time, slot, status and
  token-account filters and pagination.
- `getPriorityFees` with a recommended compute-unit price, `getAccount`, a summarizing
  `getTransaction`, an extended `getNetworkStatus`, and `rpcRequest` for any other read-only
  method.
- Bounded live streaming: `watchTransactions` (Jetstream v2) and `watchAccounts` (WebSocket).
- `sendTransaction` signs with the loaded wallet when needed and sends via RPC or Apex;
  `buildSolTransfer` takes a priority fee.
- Apex transaction landing: `apexSendTransaction`, `apexSendBundle`, `apexGetBundleStatuses`,
  `apexGetTipAccounts`, `apexPing`, with the tip checked before sending.
- One-step wallet sign-in (`auth` `walletLogin` with the loaded wallet).
- Tool annotations on every tool and `outputSchema` on `getPriorityFees` and `getNetworkStatus`.
- `ORBITFLARE_REGION`, `ORBITFLARE_JETSTREAM_URL`, `ORBITFLARE_RPC_FALLBACK_URLS`,
  `ORBITFLARE_APEX_API_KEY`, `ORBITFLARE_APEX_REGION`, `ORBITFLARE_APEX_URL`, `ORBITFLARE_LOG`.
- Docs resources for DAS, transaction history, Jetstream reference, WebSocket, RPC error codes,
  infrastructure, Apex (endpoints, bundles, errors and rate limits), dedicated nodes, Shredstream,
  the OrbitFlare Pass, historical data, and BNB Chain, Polygon and Robinhood Chain nodes.

### Changed

- Sending transactions, spending balance, and deleting or regenerating credentials now
  require `confirm: true`; without it the tool returns a preview (decoded transaction and
  simulation, plan price, the key that would be deleted).
- Customer API calls follow the published v2 spec: base URL `https://orbitflare.com/api/customer/v2`,
  `access_token` from sign-in, `PUT /profile`, `/balance`, `/licenses/{id}/ips`, and the
  documented order and top-up bodies.
- Region codes match the documented RPC endpoints (`va`, `ny`, `la`, `slc`, `ams`, `fra`, `lon`,
  `jp`, `sg`); `ash`, `tok` and `sgp` are accepted as aliases. Jetstream regions are `ny`, `slc`,
  `fra`, `ams`, `lon`, `dub`, `sqq`, `jp`, `sgp`.
- The Customer API no longer falls back to the RPC license key; set `ORBITFLARE_CUSTOMER_API_KEY`
  or sign in with `auth`.
- `getTransactionHistory` with `transactionDetails: "full"` returns per-transaction summaries;
  `raw: true` returns the complete transactions.
- `apexSendTransaction` and `apexSendBundle` refuse transactions that are missing signatures.
- Consolidated tools (old name → new):
  - `getBalance`, `getAccountInfo`, `getMultipleAccounts`, `getTokenAccountBalance` → `getAccount`
  - `getTokenAccountsByOwner` → `getWalletPortfolio`
  - `getSignaturesForAddress` → `getTransactionHistory`
  - `getRecentPrioritizationFees` → `getPriorityFees`
  - `getSlot`, `getEpochInfo`, `getLatestBlockhash` → `getNetworkStatus`
  - `getBlock`, `getFeeForMessage`, `getMinimumBalanceForRentExemption`, `getTokenSupply`,
    `getProgramAccounts` → `rpcRequest`
  - `signAndSendTransaction` → `sendTransaction`
  - `subscribeTransactions` → `watchTransactions { configOnly: true }`
  - `generateKeypair`, `loadKeypair`, `clearKeypair`, `getWalletAddress`, `signMessage` → `wallet`
  - `requestDeviceCode`, `pollDeviceToken`, `requestWalletChallenge`, `verifyWalletSignature`,
    `registerWithWallet`, `revokeToken` → `auth`
  - `getProfile`, `listLicenses`, `listRpcPlans`, `listInvoices` → `getOrbitflareAccount`
  - `listApiKeys`, `createApiKey`, `regenerateApiKey`, `deleteApiKey` → `manageApiKeys`
  - `addLicenseIp`, `removeLicenseIp`, `regenerateLicenseKey` → `manageLicense`
  - `prepareTopUp`, `confirmTopUp`, `purchaseRpcPlan` → `billing`
- Dependencies: `@modelcontextprotocol/sdk` 1.32, `zod` 4, `@solana/kit` 8,
  `@solana-program/system` 0.16; `@solana-program/stake` removed; `@grpc/grpc-js` and `ws`
  added for streaming. Requires Node.js 20.18 or later (needed by `@solana/kit` 8).

### Fixed

- `getTransaction` and full or accounts `getTransactionHistory` ask for transaction version 1.
  Version 1 transactions made `getTransaction` fail with -32015 and were silently missing from
  history.

- The default mainnet endpoint pointed at a host that does not resolve.
- `watchTransactions` `configOnly` for Yellowstone produced hosts that do not exist (e.g.
  `sgp.rpc.orbitflare.com`).
- Sign-in never stored the Bearer token (the API returns `access_token`).
- `updateProfile`, license IP whitelisting, plan purchase and top-up confirmation sent
  requests the Customer API rejects.


### Removed

- Validator staking tools (`getStakeInfo`, `buildStakeDelegation`, `getStakeActivation`) and the
  staking docs resource. OrbitFlare does not offer staking at the moment.

## v0.1.0

Initial public release.

### Added

- 53 MCP tools across RPC reads, Customer API (profile, plans, licenses, invoices,
  top-up), auth (device-code + wallet challenge), API key / license management,
  Jetstream + Yellowstone streaming config builder, validator staking info, Metis
  Swap quotes, and wallet helpers (generate / load / sign / build / send).
- 11 documentation resources served under `orbitflare://docs/*`, fetched live
  from `docs.orbitflare.com`.
- System prompts for Claude (`claude.system.md`), OpenAI
  (`openai.developer.md`), and a long-form operator playbook (`full.md`).
- Stdio transport via the official `@modelcontextprotocol/sdk`. Compatible with
  Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Continue, and any
  other MCP host.
