# Contributing to OrbitFlare MCP

Thanks for helping make OrbitFlare easier to drive from AI assistants. This document describes how the project is laid out, how to add a new tool, and the conventions we follow.

## Repo layout

```
src/
  config.ts              session state (keys, bearer token, network, region, endpoints)
  index.ts               server entry point and model-facing instructions
  tools/
    define.ts            defineTool wrapper, annotation presets, confirm schema
    assets.ts            DAS: portfolio, assets, search, token holders
    chain.ts             accounts, transactions, history, fees, network status, rpcRequest
    swap.ts              Metis swap quotes
    streaming.ts         Jetstream and WebSocket watchers
    transactions.ts      build, simulate and send
    apex.ts              Apex sends, bundles, tips, ping
    wallet.ts            signing keypair
    account.ts           session config, sign-in, Customer API
  resources/             orbitflare://docs/* MCP resources
  utils/
    rpc.ts               @orbitflare/sdk RpcClient (failover + retry)
    customerApi.ts       REST client for the OrbitFlare Customer API
    transactions.ts      decode, describe, sign and build transactions
    apex.ts              Apex client and tip checks
    keypair.ts           Solana keypair helpers (@solana/kit)
    formatters.ts        result shaping, confirmation previews
    logger.ts            stderr-only SDK logger
system-prompts/orbitflare/   pre-built system prompts for Claude / OpenAI
tests/                   end-to-end tests using the MCP SDK over stdio against local mock servers
```

## Adding a tool

1. **Prefer extending an existing tool.** The tool list is deliberately small. A new RPC method is usually reachable through `rpcRequest`; add a dedicated tool only when it saves the model real work (aggregation, decoding, pagination).
2. **Register with `defineTool`** in the domain file. Give it a `title`, a description that says when to use it and what it returns, a zod `input` shape, and an annotation preset from `define.ts` (`READ`, `WRITE`, `DESTRUCTIVE`, ...).
3. **Gate anything that moves funds, spends balance or deletes data** behind `confirm: confirmSchema`. Without `confirm: true`, return `needsConfirmation(...)` with a preview of what would happen.
4. **Return output via `formatters.ts`.** `asJson` adds `structuredContent`; throw errors and `defineTool` turns them into error results. Add an `output` schema only when the result is bounded.
5. **Never write to stdout.** It carries MCP traffic; SDK logging goes through `utils/logger.ts` to stderr.
6. **Test it** in `tests/` against a mock server from `tests/helpers.ts`, and add the name to the expected list in `tests/e2e.test.ts`.

### Authentication conventions

- RPC tools call `rpcCall(method, params)` or `withRpc(client => ...)`; these throw `MissingApiKeyError('rpc')` if no license key is configured.
- Customer API tools call `customerApi(path, opts)` and `unwrap()` the `data` envelope. Pass `opts.public = true` for endpoints that don't require auth (`/auth/device/code`, `/auth/wallet/challenge`).
- Signing uses the session keypair from `utils/keypair.ts`; `requireSigner()` throws a clear error when none is loaded.

## Test conventions

We use [`vitest`](https://vitest.dev). Tests spawn the built MCP server over stdio via the official `@modelcontextprotocol/sdk` client, with a temporary `HOME` and local mock HTTP, WebSocket and gRPC servers. No test touches the real network.

```bash
npm test                  # build + full suite
npx vitest                # watch mode (after npm run build)
```

## Code style

- TypeScript, strict mode.
- ESM only (`type: "module"` in `package.json`); imports use the `.js` extension that `tsc` rewrites.
- Comments explain *why*, not *what*. Skip narrating obvious code.
- Imports grouped: std lib → third-party → local.
- Tool descriptions are first-person addressed to the model: short, specific, mention failure modes.

## Releasing

1. Bump `package.json` version.
2. Update `CHANGELOG.md` with the new entry.
3. `npm test` must pass.
4. `npm run build`, then `npm publish`.
