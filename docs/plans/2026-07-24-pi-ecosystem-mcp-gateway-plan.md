# Pi-Ecosystem MCP Gateway Plan

| Field | Value |
|---|---|
| Status | Proposed -- successor implementation plan |
| Date | 2026-07-24 |
| Primary reference | Pi Agent Harness extension model and mature Pi MCP adapters |
| Replaces for implementation | `2026-07-24-mcp-lifecycle-permission-redesign.md` (keep as research history only) |
| Required architecture record | New ADR superseding MCP lifecycle portions of ADR 0008 |

## 1. Decision

piwin will implement MCP as a **single stable gateway tool backed by a lazy,
host-owned server manager**.

It will not:

- connect every server while opening a project;
- call `tools/list` for every server while creating a session;
- register every remote MCP tool as a Pi custom tool;
- use project trust or project permissions to authorize global MCP connection;
- persist a server-wide "allow all MCP tools" grant for a project.

The initial Pi custom-tool surface is one gateway:

```text
mcp_gateway({ action: 'search' | 'describe' | 'call' | 'status', ... })
```

The expected agent flow is:

```text
search capability/server -> describe selected tool -> call selected tool
```

This is the design used by the active Pi extension ecosystem, rather than an
invented per-session MCP lifecycle.

## 2. Evidence and adopted practices

### 2.1 Pi's own security boundary

Pi documents project trust as an **input-loading guard** for project-local
settings, extensions, skills, prompts, themes, and packages. It explicitly
states that project trust is not a sandbox and does not restrict tool behavior
after the session starts. Pi also provides a `tool_call` hook and its official
`permission-gate.ts` example asks at the actual dangerous call and blocks when
no interactive UI exists.

Sources:

- <https://pi.dev/docs/latest/security>
- <https://pi.dev/docs/latest/extensions>
- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/permission-gate.ts>

**piwin consequence:** project trust is not an MCP connection permission.
piwin's host policy evaluates an actual gateway `call`, and noninteractive
`ask` resolves to deny.

### 2.2 Pi has no merged first-party MCP runtime

The current Pi coding-agent package does not depend directly on
`@modelcontextprotocol/sdk`, and Pi's public docs expose no native MCP runtime
API. Community PR [Pi #3774](https://github.com/earendil-works/pi/pull/3774)
proposed an extension but was closed without merge, so it cannot be a piwin API
dependency.

Pi's public SDK contract piwin can rely on is:

```ts
createAgentSession({ customTools, resourceLoader, cwd, agentDir })
```

Therefore piwin should inject its small, stable MCP gateway in `customTools`.
It must not depend on an unsupported post-create session registration method.

### 2.3 `pi-mcp-adapter`: primary lifecycle reference

[`nicobailon/pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter)
is a mature Pi extension (v2.11.0 at research time, about one thousand GitHub
stars, actively maintained). Its key model is:

- one `mcp` proxy tool, rather than hundreds of direct remote tools;
- search/describe/call proxy modes;
- servers lazy-connect only when actually needed;
- metadata cache makes discovery possible without a live connection;
- per-server request timeouts, including bootstrap requests;
- concurrent connect attempts are single-flight;
- transport fingerprint changes invalidate old connections;
- idle lifecycle management;
- stale Streamable HTTP session recovery: exact session-gone detection,
  one shared reconnect, then one retry only;
- connection identity checks so an old failing call cannot close a newer client.

Sources:

- <https://github.com/nicobailon/pi-mcp-adapter>
- [timeout wired through bootstrap, PR #155](https://github.com/nicobailon/pi-mcp-adapter/pull/155)
- [HTTP session recovery, PR #194](https://github.com/nicobailon/pi-mcp-adapter/pull/194)
- [known remaining stale `-32000` recovery issue #184](https://github.com/nicobailon/pi-mcp-adapter/issues/184)

### 2.4 Independent confirmation: `pi-mcporter` and `pi-mcp-bridge`

[`pi-mcporter`](https://github.com/mavam/pi-mcporter) independently uses one
proxy with `search -> describe -> call`. A configured but unavailable server
stays visible as known/unavailable rather than preventing startup. Its direct
native tool exposure is optional, not the default.

[`pi-mcp-bridge`](https://github.com/qianhuan-lxs/pi-mcp-bridge) independently
uses a small generic tool surface, a metadata registry, lazy connection, and
idle connection cleanup.

**Conclusion:** the Pi ecosystem's established answer is **dynamic discovery
and lazy execution**, not eager all-server startup or project-scoped server
permission.

## 3. Target system

```text
                           ~/.piwin/mcp.json
                                   |
                                   v
                      @piwin/mcp config + metadata store
                                   |
                                   v
       Pi session custom tool: mcp_gateway (always cheap and available)
                                   |
             +---------------------+---------------------+
             |                     |                     |
          search                 describe                call
             |                     |                     |
    cached metadata only   cached/fresh metadata    permission policy
                                                       |
                                                       v
                                       lazy ServerManager.connect(server)
                                                       |
                                  MCP initialize / listTools / callTool
                                                       |
                                  result guard + idle lifecycle + recovery
```

### Invariants

1. `project/open`, `session/list`, `session/create`, and `session/resume` make
   **zero MCP transport calls**.
2. A Pi session has exactly one MCP gateway custom tool, whether zero, one, or
   one hundred servers are configured.
3. MCP metadata discovery never requires all configured servers to be online.
4. A broken, slow, misconfigured, or unauthenticated server affects only the
   corresponding `mcp_gateway` operation.
5. Only `action: 'call'` can cause an MCP side effect or trigger an MCP
   permission decision.
6. Project state stores no MCP server authorization or lifecycle grant.
7. Host stdout remains strict JSONL; diagnostics use stderr.

## 4. Scope and configuration

### Initial scope: global configuration only

`~/.piwin/mcp.json` remains the only MCP server configuration source for this
delivery. It is user-owned and loaded by `@piwin/mcp`.

Do not add `.pi/mcp.json`, `.mcp.json`, config importing, or workspace server
overrides in this change. They are valid future product decisions but unrelated
to repairing the current project-open freeze. Project overlays require a
separate ADR because Pi trust gates loading project resources, but piwin's
host-side config and sidecar semantics must first be designed deliberately.

### Remove wrong persisted policy

Delete after a one-release read-only migration:

```ts
ProjectMcpPolicy
ProjectRecord['mcpPolicy']
allowMcpServer()
allowMcpServers()
PermissionRememberScope = 'all-mcp-project'
```

Old values must be ignored by all runtime decisions immediately. They are not
safe global tool grants and must not be translated into a new permission model.

## 5. Contracts

All cross-boundary types start in `@piwin/contracts`.

### 5.1 Gateway input

Use a discriminated input union, not overloaded strings:

```ts
type McpGatewayInput =
  | {
      action: 'search';
      query: string;
      serverId?: string;
      limit?: number;
    }
  | {
      action: 'describe';
      selector: string; // stable "serverId.toolName"
    }
  | {
      action: 'call';
      selector: string;
      arguments: Record<string, unknown>;
    }
  | {
      action: 'status';
      serverId?: string;
    };
```

The gateway name is `mcp_gateway`; exposed server tool names are not registered
as Pi tools in the baseline.

### 5.2 Metadata and status

```ts
type McpToolMetadata = {
  serverId: string;
  toolName: string;
  selector: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadataFingerprint: string;
  fetchedAt: string;
};

type McpServerConnectionStatus =
  | 'configured'
  | 'connecting'
  | 'connected'
  | 'idle'
  | 'needs-auth'
  | 'error'
  | 'disabled';
```

Persist metadata separately from connection state. Metadata cache entries must
be keyed by a fingerprint of a redacted server definition: command, args,
endpoint, transport type, environment variable names, and config version; never
expanded secret values.

### 5.3 Structured call permission

`mcp_gateway` `search`, `describe`, and `status` are metadata operations. A
gateway `call` produces a structured host permission target:

```ts
type McpGatewayCallTarget = {
  serverId: string;
  toolName: string;
  selector: string;
  risk: 'read' | 'network' | 'external-write' | 'local-write' | 'process' | 'credential' | 'unknown';
  argumentsSummary: string; // redacted + length bounded
};
```

Classification is an advisory host policy, not a security assertion supplied
by the MCP server. Unknown defaults to `ask`; a noninteractive `ask` defaults
to deny. Initial scope has no persistent MCP approval. The UI can approve or
deny the current tool call only.

## 6. Package design

### 6.1 `@piwin/mcp`: server manager and metadata catalog

Replace the eager session bridge responsibility with two focused services.

#### `McpMetadataCatalog`

- loads cached metadata without starting a server;
- supports `search(query, serverId?, limit)` and `describe(selector)`;
- records stale/unknown metadata transparently;
- refreshes one server's metadata only on explicit user action or when a call
  needs an unknown selector;
- validates selected call arguments against cached/live JSON Schema before
  forwarding;
- never injects raw large schemas into the initial agent system prompt.

#### `McpServerManager`

- owns global connections keyed by `serverId` plus redacted transport
  fingerprint;
- `connect(server, signal)` is lazy and single-flight;
- respects per-server `requestTimeoutMs` with a global default;
- applies deadlines to `connect`, `initialize`, `tools/list`, and tool calls;
- closes and removes the client on failed bootstrap/timeout;
- does not exponential-retry known non-transient 401/403 authentication errors;
- tracks `lastUsedAt` and `inFlight` and closes an idle client only when no
  tool call is in flight;
- invalidates/replaces a connection when its transport fingerprint changes;
- reports `configured`, `connected`, `needs-auth`, or `error` independently of
  whether the agent session is usable.

#### Session recovery

Implement only proven, spec-safe recovery:

1. If Streamable HTTP returns the explicit missing-session condition (HTTP 404
   while a session id was attached), share one reconnect for that server.
2. Retry the failed request exactly once after reconnect; the server rejected
   the original request before execution, so no duplicate side effect occurs.
3. Guard every close/replacement by client identity so a late failure cannot
   tear down the replacement client.
4. Do **not** retry arbitrary errors, 401/403, cancellation, malformed calls,
   or ambiguous `-32000` errors until a dedicated safe predicate is established.

### 6.2 `@piwin/agent-host`: one gateway custom tool

Replace `createMcpSessionBridge()` with `buildMcpGatewayTool()`:

- called during `createPiSdkSession()`;
- returns one normal `HostToolDefinition` and uses the existing Pi tool adapter;
- obtains shared `McpMetadataCatalog`, `McpServerManager`, and permission gate
  from `HostRuntime`;
- has no `projectPath`, `projectsFilePath`, or `mcp:connect` code path;
- forwards cancellation `AbortSignal` to catalog and transport operations;
- emits a bounded, actionable tool result on unavailable/auth/timeout states;
- runs output through a bounded output guard and spills large output to a safe
  local file reference rather than overloading model context.

The gateway is always present, so session creation is independent of current
MCP health.

### 6.3 `@piwin/project`

Owns workspace/cwd/trust only. Remove all MCP policy exports and all persisted
MCP allowlists. Future project MCP configuration is explicitly out of scope.

### 6.4 Desktop and CLI

- MCP Settings manages global config, metadata refresh, start/stop/reconnect,
  health, and auth state through host commands.
- It must show `configured`/`needs-auth`/`error` without blocking chat.
- Permission UI shows the actual `server.tool` call plus redacted arguments;
  it has no "allow all project MCP" action.
- CLI uses the same gateway and manager. In noninteractive runs, an `ask`
  result returns a concise denied tool result rather than a hung promise.

## 7. Implementation sequence

### Phase A -- Remove the invalid authorization model

1. Remove `all-mcp-project` and the Desktop bulk-MCP button.
2. Remove project-policy reads from `mcp-session-bridge.ts`.
3. Remove project MCP persistence APIs and schema after a read-only migration.
4. Retain protocol fixes already required independently:
   - JSONL stdout only;
   - diagnostics on stderr;
   - `permission/resolve` and extension UI resolution progress while an awaited
     operation is pending;
   - request-id-safe clearing.

### Phase B -- Add catalog and lazy lifecycle below the current bridge

1. Preserve actual MCP `inputSchema` in `McpListedTool` and metadata cache.
2. Add cached `search` and `describe` operations.
3. Make `ensureConnected` lazy, single-flight, timeout-aware, and
   transport-fingerprint-aware.
4. Add explicit metadata refresh command; do not refresh all servers at host
   boot.
5. Add output truncation/spill policy before bridging results to Pi.

### Phase C -- Replace direct-tool bridge with gateway

1. Add contracts for `McpGatewayInput`, metadata, status, and permission target.
2. Create `buildMcpGatewayTool()` and register it as the sole MCP Pi custom
   tool.
3. Route `search`/`describe` to catalog and `call` to host policy then server
   manager.
4. Remove the loop that calls `ensureStarted()`/`listTools()` for every server
   from `createMcpSessionBridge()`.
5. Delete `mcp:connect` entirely. Replace `mcp:tool-call` string details with
   the structured gateway-call target.

### Phase D -- Reliability and recovery

1. Per-server/global request timeout, including bootstrap.
2. Fail fast for known non-transient auth/configuration errors.
3. Idle cleanup with `inFlight` protection.
4. Exact Streamable HTTP session-gone recovery with one reconnect/one retry.
5. Auth state and explicit reconnect exposed in MCP Settings.

### Phase E -- Product polish, not more architecture

1. Add concise system prompt instructions for `search -> describe -> call`.
2. Add a status action/tool result that tells the agent how to recover from
   known unavailable/auth errors.
3. Consider opt-in direct native exposure for a small reviewed allowlist only
   after gateway behavior is stable. It is not the default and cannot re-create
   eager session startup.

## 8. Test plan

### Unit

- `search` ranks cached metadata without a client connection.
- `describe` returns cached schema and does not connect.
- concurrent `call` requests for one server produce one connection attempt.
- disabled, unknown, auth-failed, timeout, and malformed arguments produce
  deterministic scoped errors.
- config/transport fingerprint change replaces old client safely.
- idle cleanup skips connections with `inFlight > 0`.
- Streamable HTTP missing-session predicate retries once after shared reconnect;
  no retry for cancellation, 401/403, generic 404, or a second failure.
- call-risk classifier redacts secret-like argument fields and defaults unknown
  tools to `ask`.

### Host integration

1. With five enabled servers, `project/open` + `session/create` issue no MCP
   connection and no permission request.
2. The `mcp_gateway` tool exists in every real SDK session regardless of server
   health.
3. Gateway `search` works using cached metadata when a server is offline.
4. Gateway `call` to one server starts only that server.
5. A hung server times out and returns a tool error; the host accepts a second
   request and other servers continue to work.
6. A call requiring approval emits exactly one structured permission request;
   its resolve cannot be blocked behind the tool call in JSONL mode.
7. CLI no-UI path denies `ask` without hanging.

### Desktop E2E

1. Open projects repeatedly while a server is misconfigured: navigation and
   new-session creation remain responsive.
2. Settings shows server state and offers metadata refresh/reconnect without
   blocking the transcript.
3. An MCP destructive call shows server/tool/argument summary, not an
   ambiguous server connection dialog.
4. There is no project-level MCP grant anywhere in Settings or project state.

## 9. Definition of done

- Project selection has no dependency on MCP processes, server permissions, or
  `tools/list`.
- A session always gets one bounded MCP gateway tool, not an unbounded remote
  tool catalog.
- Configured MCPs remain discoverable even when disconnected or unauthenticated.
- Only the requested server starts for a gateway call.
- One server's failure cannot block project open, session create, host JSONL,
  another server, or a user permission response.
- Pi project trust is used only for its documented resource-loading role.
- piwin does not claim policy prompts are a sandbox.

## 10. Explicit non-goals

- Project-provided MCP overlays/imports in this delivery.
- Dynamic runtime registration of individual MCP tools into existing Pi SDK
  sessions.
- Persistent "always allow this MCP server/tool" approvals.
- Treating server descriptions or schemas as proof that a tool is safe.
- Replacing OS/VM sandboxing with UI permission prompts.
