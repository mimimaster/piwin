# Dependency policy (piwin)

## Principles

1. Prefer Node stdlib and existing workspace packages before adding deps.
2. No new dependency without a one-line justification in PR/notes.
3. Pin critical kernel versions: `@earendil-works/pi-coding-agent` is pinned (not
   floating `latest`).
4. Only `@piwin/agent-host` may depend on Pi packages.
5. Prefer MIT/Apache-2.0/BSD licenses for product code; review copyleft carefully.

## Allowed by default

- TypeScript toolchain (typescript, vitest, vite, prettier, tsx)
- Playwright (`@playwright/test`) for local desktop UI e2e (browser shell)
- Tauri 2 + React for desktop shell
- `@modelcontextprotocol/sdk` in `@piwin/mcp` (official MCP transport)
- Workspace `@piwin/*` packages

## Requires justification

- New network clients, crypto, keychain/native modules
- Large UI frameworks beyond current React shell
- Additional LLM SDKs (prefer config-driven HTTP protocols)

## Forbidden without ADR

- Electron “just for now”
- Apps importing `@earendil-works/pi-*` directly
- Dependencies that force silent network telemetry

## Audit

```bash
pnpm audit --prod
```

CI may run this as **report-only** (non-blocking) until noise is under control.
