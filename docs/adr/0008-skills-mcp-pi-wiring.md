# ADR 0008: Skills + MCP + custom tools wiring to Pi

## Status

Accepted (2026-07-20) · Partially implemented (SDK path)

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
   tool descriptors first (permission-gated).
2. Convert them with a Pi tool adapter into `customTools` and pass them **at
   createAgentSession time**.
3. Construct `DefaultResourceLoader` with:
   - `additionalSkillPaths`: `~/.piwin/skills` + `config.skills.extraPaths` (+ project skill roots when available)
   - `skillsOverride`: filter out `config.skills.disabledIds`
4. MCP process ownership:
   - `HostRuntime` owns a single `McpLifecycleManager` and injects it into
     `createAgentHost` / `PiSdkAdapter`.
   - Bare `createAgentHost` (CLI) creates a host-owned manager so session tools
     still share one process model.
   - Session bridge reuses `lifecycleManager.ensureStarted` (no double-spawn of
     the same server id for UI Start + session tools).
   - Bridge close does **not** stop host-owned clients; host/manager dispose does.
5. MCP transport: `McpTransportClient` interface with dual implementations —
   **official** `@modelcontextprotocol/sdk` stdio client (default / auto) and
   **handcrafted** NDJSON fallback when official connect fails. Override via
   `PIWIN_MCP_CLIENT=official|handcrafted|auto`. Handcrafted retained until
   official is proven across all user servers.
6. Register `mcp__<server>__<tool>` custom tools with a route table that keeps
   the original tool name (do not reverse-parse sanitized names alone).

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
- Host-owned permission gate wraps tool `execute` before network/MCP I/O.
- Desktop permission modal already resolves `permission/request`; tools must emit
  through HostRuntime.
- Future: bash hard-gate via Pi extension `tool_call` hook (separate from custom tools).
