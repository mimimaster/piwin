# ADR 0014: MCP lifecycle hybrid gateway (supersedes ADR 0008 MCP lifecycle bits)

## Status

Accepted (2026-07-24) · Implemented in part; lifecycle/exposure details superseded

> **Superseded in part by [ADR 0033](./0033-mcp-supervisor-architecture.md):**
> the gateway/lazy-connect direction and metadata cache remain, while MCP
> process ownership, configuration replacement, default exposure, and
> permission handling are defined by ADR 0033. ADR 0019's former MCP
> server-level permission section is historical and is superseded as well.

## Context

Project open / session create was coupling to MCP process startup and
project-scoped `mcp:connect` permissions. That produced host timeouts and
permission deadlocks. Pi's project trust is an input-loading guard, not an MCP
connection authorization model. Mature Pi ecosystem adapters use lazy connect
and dynamic discovery (`pi-mcp-adapter`, `pi-mcporter`). The remaining lifecycle
ownership and config-reload hazards are handled by ADR 0033.

## Decision

1. MCP configuration remains global: `~/.piwin/mcp.json`.
2. `project/open` and `session/create` perform **zero MCP transport calls**.
3. Session tools are built as:
   - one stable `mcp_gateway` tool (`search | describe | call | status`);
   - optional direct `mcp__server__tool` entries from valid cached metadata only
     when explicitly selected by `McpExposurePolicy.pinnedSelectors`.
4. Direct tool execute and gateway `call` lazy-connect only the selected server
   through the Host-owned `McpSupervisor` defined in ADR 0033.
5. MCP is **outside piwin's permission rule engine**. Enabled/configured
   servers run without per-call prompts; legacy MCP rules in `permissions.json`
   are ignored.
6. Metadata cache lives at `~/.piwin/mcp-metadata.json`, keyed by redacted
   server fingerprint (env names only, never secret values).
7. Project `mcpPolicy` / `all-mcp-project` / `mcp:connect` are removed.

## Consequences

- Opening a project no longer waits on MCP servers.
- Cached search is non-connecting, while a normal model-issued gateway search
  may perform bounded lazy discovery on a cache miss; `discover=false` keeps it
  cache-only. Gateway `describe`/`call` with a known selector also connect
  lazily.
- Pinned direct-tool UX remains available when metadata is cached; automatic
  cached-tool promotion is not part of the default.
- ADR 0008 remains valid for Skills wiring and Pi customTools-at-create; its
  MCP "connect each enabled server in the session bridge" path is superseded.
