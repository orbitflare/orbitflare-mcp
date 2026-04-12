# Contributing to OrbitFlare MCP

Thanks for helping make OrbitFlare easier to drive from AI assistants. This document describes how the project is laid out, how to add a new tool, and the conventions we follow.

## Repo layout

```
src/
  config.ts              session state (RPC key, customer key, bearer token, network, region, wallet)
  index.ts               server entry point
  tools/
    rpc/                 thin JSON-RPC wrappers
    account/             customer-account reads / profile updates
    auth/                device-code + wallet-challenge auth flows
    keys/                API key management
    licenses/            license key + IP whitelist
    billing/             top-up + invoices + plan purchases
    streaming/           Jetstream / Yellowstone config builder
    staking/             validator staking info
    swap/                Metis swap quotes
    wallet/              keypair management, signing, tx building
  resources/             orbitflare://docs/* MCP resources
  utils/
    rpc.ts               JSON-RPC client
    customerApi.ts       REST client for OrbitFlare Customer API
    keypair.ts           Solana keypair helpers (@solana/kit)
    formatters.ts        consistent tool result shaping
system-prompts/orbitflare/   pre-built system prompts for Claude / OpenAI
tests/                   end-to-end tests using the MCP SDK over stdio
```

## Adding a new tool

1. **Pick a folder** under `src/tools/<domain>/`. One file per tool — keep them under ~80 lines.
2. **Use direct-tool pattern.** Each capability is its own tool (we don't multiplex by `action` field). The tool's `description` should tell the model exactly when to use it and what it returns.
3. **Validate inputs with Zod.** Add a `const inputSchema = { ... }` at the top of the file. Model gets the JSON Schema for free.
4. **Return shaped output via `formatters.ts`.** Use `asJson({...})` for structured data, `asText("…")` for short messages, `asError(err)` for failures. Errors should always go through `asError` so the SDK marks the response as an error result.
5. **Wire it up in `src/tools/index.ts`** — import the registrar and call it from `registerTools(server)`.
6. **Add a test in `tests/e2e.test.ts`** — at minimum, assert it appears in `EXPECTED_TOOLS`. For tools that hit a live network, gate them on `SKIP_NETWORK !== '1'`.

### Authentication conventions

- RPC tools call `rpcCall(method, params)`; this throws `MissingApiKeyError('rpc')` if no RPC license key is configured.
- Customer API tools call `customerApi(path, opts)`. By default it requires a bearer token or X-ORBIT-KEY. Pass `opts.public = true` for endpoints that don't require auth (`/auth/device/code`, `/auth/wallet/challenge`).
- Wallet tools rely on a session keypair from `utils/keypair.ts` — surface a clear error when none is loaded.

## Test conventions

We use [`vitest`](https://vitest.dev). Tests spawn the built MCP server over stdio via the official `@modelcontextprotocol/sdk` client.

```bash
npm test                  # build + full suite
npm test -- --watch       # iterate
SKIP_NETWORK=1 npm test   # skip live RPC / Metis calls
```

Add per-tool assertions:
- A "tool is registered" check in the `EXPECTED_TOOLS` list.
- For pure-shape tools, assert the JSON contains the expected top-level keys.
- For network calls, gate behind `SKIP_NETWORK` and assert the response shape, not specific values.

## Code style

- TypeScript, strict mode, no `any`.
- ESM only (`type: "module"` in `package.json`); imports use the `.js` extension that `tsc` rewrites.
- Comments explain *why*, not *what*. Skip narrating obvious code.
- Imports grouped: std lib → third-party → local.
- Tool descriptions are first-person addressed to the model: short, specific, mention failure modes.

## Releasing

1. Bump `package.json` version.
2. Update `CHANGELOG.md` with the new entry.
3. `npm test` must pass with and without `SKIP_NETWORK=1`.
4. `npm run build`, then `npm publish`.
