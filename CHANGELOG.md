# Changelog

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
