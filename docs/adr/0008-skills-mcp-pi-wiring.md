# ADR 0008: Skills + MCP + custom tools wiring to Pi

## Status

Accepted (2026-07-20) · Partially implemented (SDK path)

> **MCP lifecycle note:** [ADR 0033](./0033-mcp-supervisor-architecture.md)
> supersedes this ADR's MCP process-ownership and exposure details. This ADR
> remains the reference for Pi Skills/resource-loader wiring.

## Context

M4 requires Skills path mapping and MCP tools to reach a live Pi session.
Pi 0.80.10 (`@earendil-works/pi-coding-agent`) exposes:

- `createAgentSession({ customTools?, resourceLoader?, cwd?, agentDir?, ... })`
- `ToolDefinition` with **TypeBox** (`typebox` package) parameter schemas and
  `execute(toolCallId, params, signal, onUpdate, ctx) → AgentToolResult`
- `DefaultResourceLoader({ cwd, agentDir, additionalSkillPaths?, skillsOverride? })`

Earlier piwin code incorrectly used:

- post-create `session.registerTool` probing (not a public AgentSession API)
- `skillsPaths` option on `createAgentSession` (not declared; ignored by Pi)

## Decision

### SDK mode (default)

1. Build host tools (`web_search` / `web_fetch` / MCP proxies) as `@piwin` host
   tool descriptors first. MCP proxies route through the Host Supervisor;
   ordinary permission gating applies only to the non-MCP domains.
2. Convert them with a Pi tool adapter into `customTools` and pass them **at
   createAgentSession time**.
3. Construct `DefaultResourceLoader` with:
   - `additionalSkillPaths`: product `skills/` tree + `~/.piwin/skills` + `config.skills.extraPaths` (+ project skill roots when available)
   - `skillsOverride`: filter out `config.skills.disabledIds`
4. MCP process ownership:
   - `HostRuntime` owns one `McpSupervisor` and injects it into all session/tool
     composition paths.
   - Sessions and Pi adapters do not create fallback managers or own clients.
   - Gateway and explicitly pinned direct tools resolve the current server via
     the Supervisor; `dispose()` is the Host-wide shutdown path.
5. MCP transport: `McpTransportClient` interface with dual implementations —
   **official** `@modelcontextprotocol/sdk` stdio client (default / auto) and
   **handcrafted** NDJSON fallback when official connect fails. Override via
   `PIWIN_MCP_CLIENT=official|handcrafted|auto`. Handcrafted retained until
   official is proven across all user servers.
6. Register the catalog shell `piwin_toolbox` (`search | describe | call | status`) by default for Agent generations ([ADR 0053](./0053-progressive-tool-catalog.md)). Register
   `mcp__<server>__<tool>` only for explicit pinned selectors, with a route
   table that keeps the original tool name (do not reverse-parse sanitized
   names alone).

### RPC mode

Stock `pi --mode rpc` does **not** expose dynamic custom tool registration.
Until a piwin-owned RPC worker or Pi extension channel exists:

- RPC sessions remain available for plain chat/session operations.
- Web/MCP custom tools are **not claimed** for stock RPC mode.
- Do not silently fall back to mock sessions for this reason.

## Consequences

- `typebox` is a direct dependency of `@piwin/agent-host` (same major as Pi).
- `@modelcontextprotocol/sdk` is a direct dependency of `@piwin/mcp`.
- Dual MCP client is temporary; prefer official for Content-Length servers.
- Host-owned permission gate wraps non-MCP tool `execute` before network I/O;
  MCP execution uses the Supervisor's configuration-as-trust boundary.
- Desktop permission modal already resolves `permission/request`; tools must emit
  through HostRuntime.
- Future: bash hard-gate via Pi extension `tool_call` hook (separate from custom tools).

## 2026-09-12 amendment — bundled skills follow the repo

First-party skills are defined in the git tree `skills/` and shipped with the
host as `$PIWIN_BUNDLED_ASSETS_ROOT/skills`. Host/Pi load that tree directly.
`ensureBundledSkillsInstalled` does not copy them into `~/.piwin/skills`.
That directory is only for operator-installed skills. A leftover copy of a
bundled id under the user dir is ignored. `user` means the operator installed
it themselves. The Skills panel groups these separately (应用内置 / 我安装的).
