# ADR 0014: MCP lifecycle hybrid gateway (supersedes ADR 0008 MCP lifecycle bits)

## Status

Accepted (2026-07-24) · Implemented (hybrid gateway + lazy lifecycle + structured call risk)

> **Superseded in part by [ADR 0019](./0019-permission-rule-engine.md) §5:**
> Decision 5's "per-call until a later structured risk policy lands" MCP
> approval is superseded. ADR 0019 makes **server enablement the trust
> boundary** — once an MCP server is enabled in config, its tools run without
> per-call prompts; explicit `deny`/`ask` MCP rules in `permissions.json` still
> apply. ADR 0014's other decisions (hybrid gateway, lazy lifecycle, metadata
> cache, "MCP is not a sandbox") stand.

## Context

Project open / session create was coupling to MCP process startup and
project-scoped `mcp:connect` permissions. That produced host timeouts and
permission deadlocks. Pi's project trust is an input-loading guard, not an MCP
connection authorization model. Mature Pi ecosystem adapters use lazy connect
and dynamic discovery (`pi-mcp-adapter`, `pi-mcporter`).

## Decision

1. MCP configuration remains global: `~/.piwin/mcp.json`.
2. `project/open` and `session/create` perform **zero MCP transport calls**.
3. Session tools are built as:
   - direct `mcp__server__tool` entries from **valid cached metadata** only
     (budgeted hybrid exposure policy);
   - always one `mcp_gateway` tool (`search | describe | call | status`).
4. Direct tool execute and gateway `call` lazy-connect only the selected server
   via host-owned `McpLifecycleManager`.
5. MCP connection is **not** a project permission. Only actual tool calls may
   ask for approval (per-call until a later structured risk policy lands).
6. Metadata cache lives at `~/.piwin/mcp-metadata.json`, keyed by redacted
   server fingerprint (env names only, never secret values).
7. Project `mcpPolicy` / `all-mcp-project` / `mcp:connect` are removed.

## Consequences

- Opening a project no longer waits on MCP servers.
- First-use of an uncached server requires Settings Discover or gateway
  `describe`/`call` (which may connect).
- Direct-tool UX remains available when metadata is cached.
- ADR 0008 remains valid for Skills wiring and Pi customTools-at-create; its
  MCP "connect each enabled server in the session bridge" path is superseded.
