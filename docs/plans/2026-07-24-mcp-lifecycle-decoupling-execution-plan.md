# MCP Lifecycle Decoupling Execution Plan

| Field | Value |
|---|---|
| Status | Superseded (2026-08-06) by ADR 0033 |
| Date | 2026-07-24 |
| Scope | Fix project-open/session-create MCP blocking while retaining direct MCP tools where safe |
| Supersedes for implementation | `2026-07-24-mcp-lifecycle-permission-redesign.md` and `2026-07-24-pi-ecosystem-mcp-gateway-plan.md` |
| Required ADR | Supersede MCP lifecycle portions of ADR 0008 before Commit 2 |

> This document is retained as implementation history. Do not implement it as
> written: its automatic cached direct-tool exposure and actual-call MCP
> permission gate are superseded. Use [ADR 0033](../adr/0033-mcp-supervisor-architecture.md)
> and [the ADR 0033 review](../mcp-supervisor-architecture-review.md), which
> define gateway-only default, explicit pinned tools, owned ProcessSlot
> cleanup, config-reload serialization, and failure cooldown.

## 1. Decision

piwin will use a **hybrid MCP exposure model**:

1. The host owns one global MCP runtime based on `~/.piwin/mcp.json`.
2. `project/open`, `session/list`, `session/create`, and `session/resume` make
   **no MCP transport requests**.
3. Sessions expose cached MCP tools directly as normal Pi custom tools when
   their metadata fits the configured direct-tool budget.
4. Every session also exposes one stable `mcp_gateway` custom tool for:
   - servers without cached metadata;
   - tools omitted by the direct-tool budget;
   - search, schema discovery, status, and recovery.
5. Direct-tool execution and gateway `call` both lazy-connect only the selected
   server. They share the same runtime manager and actual-call permission gate.
6. MCP server connection is not a project permission. Only actual tool calls
   may ask for approval.

This retains the expected Cursor-like direct-tool experience for a normal,
known catalog while adopting the mature Pi ecosystem's lazy connection and
dynamic-discovery strategy for first use, large catalogs, and failures.

## 2. Non-negotiable invariants

```text
project/open -> session/create
  MUST NOT call connect, initialize, tools/list, or request mcp:connect.

MCP server failure
  MUST affect only a selected MCP tool/gateway operation.

permission/resolve
  MUST remain processable while a tool call is waiting.
```

| Invariant | Enforcement point |
|---|---|
| No project-scoped MCP permission | Remove project MCP policy and `mcp:connect` entirely. |
| No live catalog work in session creation | `PiSdkAdapter` consumes only persisted metadata; tests fail on any transport call. |
| Direct tools never retain stale client references | Route by `{ serverId, toolName, metadataFingerprint }`; resolve live client through manager at call time. |
| Uncached/oversized tools remain usable | `mcp_gateway` supports `search`, `describe`, `call`, and `status`. |
| MCP is not a sandbox | UI language calls this consent/risk policy; OS/VM isolation remains separate. |

## 3. Target request flow

### 3.1 Project and session path

```text
Desktop: project/open -> trust -> session/list -> session/create
                                      |
                                      v
                         load persisted MCP metadata only
                                      |
                                      v
                         build direct cached tools + mcp_gateway
                                      |
                                      v
                       Pi createAgentSession({ customTools })
```

There is no `ensureStarted()`, `listTools()`, or MCP permission request on this
path.

### 3.2 Direct tool path

```text
model calls mcp__server__tool
  -> validate arguments against cached schema
  -> evaluate structured call risk
  -> ask/allow/deny at actual call boundary
  -> lazy manager ensures only "server" is connected
  -> callTool(toolName, arguments)
  -> bounded result
```

### 3.3 Gateway fallback path

```text
model calls mcp_gateway({ action: 'search' })
  -> cached catalog search; no server transport

model calls mcp_gateway({ action: 'describe', selector })
  -> cached schema when present
  -> otherwise lazy-connect only selector's server, list its tools, persist metadata

model calls mcp_gateway({ action: 'call', selector, arguments })
  -> same actual-call policy and lazy manager as a direct tool
```

## 4. Architecture ownership

| Package | Responsibility | Must not do |
|---|---|---|
| `@piwin/contracts` | Gateway input, metadata, exposure, runtime status, structured permission facts | Depend on host/project/MCP runtime |
| `@piwin/mcp` | Config, metadata persistence, catalog search/describe, single-flight lazy connections, recovery | Know project trust, UI state, or Pi session objects |
| `@piwin/agent-host` | Build Pi custom tools, call host policy, map results/events | Start all configured servers on session creation |
| `@piwin/project` | cwd, project trust, terminal/filesystem/Git policy | Persist MCP allowlists or connection permission |
| Desktop/CLI | Settings/status and permission presentation via host contracts | Connect MCP directly or parse Pi-native payloads |

## 5. Contract design

### 5.1 Remove invalid MCP project-policy types

Delete after the migration described in Commit 1:

```ts
type ProjectMcpPolicy = { allowedServerIds: string[] };
ProjectRecord['mcpPolicy'];
allowMcpServer();
allowMcpServers();
type PermissionRememberScope = 'all-mcp-project';
```

`mcp:connect` is removed. `mcp:tool-call` is replaced by a structured call
target; it is never a project-wide or server-wide remembered permission.

### 5.2 MCP metadata contracts

Add to `packages/contracts/src/mcp.ts`:

```ts
type McpToolMetadata = {
  serverId: string;
  toolName: string;
  selector: string; // `${serverId}.${toolName}`
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

type McpExposure = 'direct' | 'gateway';
```

Persist metadata in a dedicated product file, for example:

```text
~/.piwin/mcp-metadata.json
```

Cache keys must fingerprint a normalized, **redacted** server definition:

- server id;
- command and arguments or transport URL;
- transport kind;
- environment variable names only, never expanded values;
- relevant configuration version.

If fingerprint changes, old metadata is stale and cannot generate direct tools.

### 5.3 Gateway contract

```ts
type McpGatewayInput =
  | { action: 'search'; query: string; serverId?: string; limit?: number }
  | { action: 'describe'; selector: string }
  | { action: 'call'; selector: string; arguments: Record<string, unknown> }
  | { action: 'status'; serverId?: string };
```

The gateway's input schema is static and compact. The initial system/tool
context contains no complete remote tool schema catalog.

### 5.4 Structured permission target

Extend `PermissionRequestContext` rather than parsing `detail` strings:

```ts
type McpToolCallTarget = {
  serverId: string;
  toolName: string;
  selector: string;
  risk: 'read' | 'network' | 'external-write' | 'local-write' | 'process' | 'credential' | 'unknown';
  argumentsSummary: string;
};
```

The `argumentsSummary` is host-generated, bounded, and redacted. Unknown tool
risk defaults to `ask`; a noninteractive `ask` is a deterministic deny.

### 5.5 Direct exposure policy

Introduce an explicit host config policy, owned by `@piwin/mcp` contracts:

```ts
type McpExposurePolicy = {
  mode: 'hybrid';
  maxDirectTools: number;
  maxDirectSchemaBytes: number;
  pinnedSelectors: string[];
};
```

Initial defaults are chosen only after a provider-payload baseline test. The
selection algorithm is deterministic:

1. valid cached metadata only;
2. pinned selectors first;
3. then stable `serverId + toolName` lexical order;
4. stop at the count or serialized-schema-byte budget;
5. all remaining cached tools receive `gateway` exposure.

No tool becomes invisible: the gateway reaches omitted and uncached tools.

## 6. Execution plan

Each commit is independently typechecked and tested. Do not combine unrelated
desktop polish, dependency upgrades, or Pi version upgrades with these commits.

### Commit 1 -- Remove project-scoped MCP authorization

**Objective:** eliminate the incorrect coupling immediately, while preserving
the already-fixed JSONL control-plane behavior.

**Changes**

1. Remove `ProjectMcpPolicy`, `mcpPolicy`, `getProjectMcpPolicy`,
   `allowMcpServer`, `allowMcpServers`, and their project-store tests.
2. Remove `all-mcp-project` from `PermissionRememberScope`, IPC, host resolver,
   Desktop dialogs, reducer callers, and remembered-permissions UI.
3. Remove `mcp:connect` and project remembered checks from
   `createMcpSessionBridge()`.
4. Remove the existing `mcp:tool-call` server-wide remembered check. Keep a
   temporary per-call `ask` behavior only until Commit 4 replaces it with
   structured facts.
5. Delete existing persisted `mcpPolicy` fields during the next write of
   `projects.json`; before write, runtime ignores them entirely.
6. Keep these independent fixes unchanged:
   - host stdout carries JSONL only;
   - diagnostics use stderr;
   - `permission/resolve` and `extension/ui_resolve` bypass a blocked normal
     command queue;
   - Desktop clears a permission by request id only.

**Files**

- `packages/contracts/src/host.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/ipc.ts`
- `packages/project/src/project-store.ts`
- `packages/project/src/project-store.test.ts`
- `packages/project/src/index.ts`
- `packages/agent-host/src/mcp-session-bridge.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/commands/resolve-commands.ts`
- `apps/desktop/src/app-dialogs.tsx`
- `apps/desktop/src/RememberedPermissionsSection.tsx`
- `apps/desktop/src/hooks/use-session-actions.ts`

**Tests**

- project store migration removes legacy MCP policy on a write;
- MCP bridge does not request `mcp:connect`;
- no desktop permission dialog contains an all-project-MCP action;
- existing web project permission behavior remains unchanged.

### Commit 2 -- Add metadata catalog and split lazy lifecycle operations

**Objective:** make metadata and live transport separate runtime concerns.

**Changes**

1. Extend `McpListedTool` / `McpToolSummary` to preserve JSON Schema.
2. Add `McpMetadataCatalog` in `@piwin/mcp`:
   - read/write cache atomically;
   - `searchCached()`;
   - `describeCached()`;
   - `replaceServerMetadata()`;
   - stale fingerprint detection;
   - schema validation utility.
3. Split current `McpLifecycleManager.startInternal()` semantics:
   - `ensureConnected(serverId, signal)` performs only transport connect and
     initialize;
   - `discoverTools(serverId, signal)` uses a live connection, calls
     `tools/list`, and updates catalog;
   - `callTool(serverId, toolName, arguments, signal)` obtains live client at
     call time.
4. Add single-flight maps for both connect and discovery. Never let two callers
   spawn the same server concurrently.
5. Thread an abort signal and timeout through handcrafted and official clients.
   On timeout, close/discard the client and settle all pending requests.
6. Preserve the existing explicit Start/Stop UI operations, but make Start a
   live connection operation rather than an unconditional all-tool discovery.

**Files**

- `packages/contracts/src/mcp.ts`
- `packages/mcp/src/mcp-transport.ts`
- `packages/mcp/src/mcp-client.ts`
- `packages/mcp/src/mcp-client-official.ts`
- `packages/mcp/src/mcp-lifecycle-manager.ts`
- `packages/mcp/src/mcp-metadata-catalog.ts` (new)
- `packages/mcp/src/mcp-metadata-store.ts` (new)
- `packages/mcp/src/index.ts`
- `packages/agent-host/src/paths.ts` for cache path only if it owns product
  paths; otherwise add the path under `@piwin/mcp` without importing host.

**Tests**

- cached search/describe perform zero client calls;
- changed command/args/URL fingerprint invalidates metadata;
- concurrent connect and discovery are single-flight;
- connect, initialize, tools/list, and call time out and close the client;
- disabled server never connects;
- failed discovery leaves cached prior metadata marked stale, not silently
  current.

### Commit 3 -- Introduce cached direct tools plus `mcp_gateway`

**Objective:** eliminate live MCP work from `session/create` without removing
direct-tool UX.

**Changes**

1. Replace `createMcpSessionBridge()` with a focused builder pair:
   - `buildCachedMcpToolDefinitions()`;
   - `buildMcpGatewayToolDefinition()`.
2. `buildCachedMcpToolDefinitions()` reads metadata catalog only and applies the
   deterministic exposure policy. It never calls lifecycle-manager methods that
   cause transport I/O.
3. Each direct tool's executor resolves the active client through the shared
   manager at execution time. It must never close over a session-create client.
4. Register one `mcp_gateway` in every SDK session, even with no cached
   metadata or no configured server.
5. Gateway behavior:
   - `search` reads catalog and lists configured-but-uncached servers;
   - `describe` returns cached schema or lazily discovers only selector's
     server;
   - `call` validates, applies Commit 4 policy, and lazily calls only selector's
     server;
   - `status` returns scoped state without starting a server.
6. Update Pi resource prompt instructions with a compact gateway protocol:
   search before unknown selector, describe before constructing unfamiliar
   arguments, call only after schema is known.
7. Remove the eager server loop from `mcp-session-bridge.ts`. Delete it when no
   code remains; do not leave a compatibility path that can be accidentally
   called by session creation.

**Files**

- `packages/contracts/src/mcp.ts`
- `packages/agent-host/src/mcp-session-bridge.ts` (replace/delete)
- `packages/agent-host/src/mcp-gateway-tool.ts` (new)
- `packages/agent-host/src/mcp-cached-tool-definitions.ts` (new)
- `packages/agent-host/src/sdk-adapter.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/pi-resource-loader.ts`
- `packages/agent-host/src/index.ts`

**Tests**

- session creation with five configured but stopped servers makes zero MCP
  transport calls;
- session contains `mcp_gateway` regardless of catalog state;
- cached metadata creates expected direct tool names/schema without connecting;
- direct tool and gateway call the same manager route;
- a catalog beyond direct-tool budget exposes deterministic direct subset and
  gateway reaches an omitted tool.

### Commit 4 -- Gate actual MCP calls, not server connection

**Objective:** replace ambiguous server-wide permission with precise,
recoverable tool-call policy.

**Changes**

1. Add pure `evaluateMcpToolCallRisk()` and golden cases.
2. Build structured `McpToolCallTarget` in both direct executor and gateway
   `call` path; they must share one helper.
3. Add redaction for common secret-key argument names and enforce a hard size
   limit for permission summaries.
4. Default unknown, external-write, process, credential, and network risks to
   `ask`; initially keep the read-only allowlist small and explicit.
5. Noninteractive CLI/RPC maps `ask` to deny through the shared existing
   noninteractive decision helper.
6. Do not add persistent MCP approval in this delivery. It requires a separate
   global policy design keyed by tool/fingerprint/risk, not project path.

**Files**

- `packages/contracts/src/host.ts`
- `packages/contracts/src/ipc.ts`
- `packages/agent-host/src/permission-policy.ts`
- `packages/agent-host/src/permission-context.ts`
- `packages/agent-host/src/mcp-gateway-tool.ts`
- `packages/agent-host/src/mcp-cached-tool-definitions.ts`
- `packages/agent-host/src/host-runtime.ts`
- `apps/desktop/src/permission-request-card.tsx`
- `apps/desktop/src/app-dialogs.tsx`

**Tests**

- direct and gateway routes produce identical structured permission context;
- unknown tool call asks; no-UI call denies;
- redaction never emits raw keys/tokens in UI event or logs;
- resolving an MCP permission allows exactly the waiting tool call;
- no call result can clear a newer queued permission request.

### Commit 5 -- Harden recovery and MCP Settings

**Objective:** make failure scoped, diagnosable, and recoverable.

**Changes**

1. Add bounded MCP output policy: truncate by bytes/lines and persist oversized
   output to a safe product-controlled path with an explicit reference.
2. Add idle cleanup, guarded by `inFlight` count.
3. Implement config fingerprint client replacement.
4. Fail fast for known non-transient auth/config errors; do not apply generic
   exponential retry to 401/403.
5. Add exactly-once Streamable HTTP missing-session recovery only for the MCP
   specification's unambiguous 404-with-session-id case:
   - one shared reconnect promise;
   - one retry only;
   - client identity guard before close/replace.
6. Settings adds explicit actions:
   - Discover tools for server;
   - Refresh cached metadata;
   - Start/Stop/Reconnect;
   - show cached/stale metadata timestamp;
   - show `needs-auth` / timeout / error state.
7. No automatic Discover All occurs on project selection or session creation.

**Files**

- `packages/mcp/src/mcp-lifecycle-manager.ts`
- `packages/mcp/src/mcp-session-recovery.ts` (new)
- `packages/mcp/src/mcp-output-policy.ts` (new)
- `packages/mcp/src/mcp-metadata-catalog.ts`
- `packages/agent-host/src/commands/mcp-commands.ts`
- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/McpPanel.tsx`
- focused MCP settings components/tests as already organized in the desktop app

**Tests**

- an intentionally hanging server times out without blocking a second server;
- 401/403 does not retry/back off;
- stale HTTP session performs one shared reconnect and one retry;
- generic error, cancellation, ordinary 404, and second failure do not retry;
- idle connection with in-flight call stays alive;
- Settings discovery affects only requested server.

### Commit 6 -- Architecture documentation and migration cleanup

**Objective:** make the new boundary durable and remove transitional code.

1. Add ADR superseding MCP lifecycle portions of ADR 0008.
2. Update `docs/architecture.md` permission text:
   - Pi project trust = project resource loading;
   - piwin tool policy = actual side-effect consent;
   - neither is a sandbox;
   - MCP runtime is global and lazy.
3. Update PRD MCP-06 to state that any future user/project override is config
   provenance, never per-project server authorization.
4. Remove migration code after the stated release window and delete all unused
   direct-bridge compatibility exports.

## 7. Verification gates

Run after every commit:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/mcp typecheck
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/mcp test
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/desktop test
```

Run the full repository checks before considering the migration complete:

```bash
pnpm typecheck
pnpm test
cd apps/desktop/src-tauri && cargo check
```

### Required integration fixtures

Create controlled local MCP fixtures; do not depend on production MCP servers:

| Fixture | Proves |
|---|---|
| Normal tool server | direct metadata/cache/call happy path |
| Never-initialize server | session creation has zero transport dependency; call timeout is scoped |
| `tools/list` hang | explicit discovery timeout/cleanup |
| 401/403 HTTP server | fail-fast auth handling |
| HTTP server that forgets session | exact one-reconnect/one-retry recovery |
| Large output server | bounded model context/output spill |
| Two concurrent calls to one cold server | single-flight connect |

### Final acceptance scenario

1. Configure five MCP servers, including one permanently hanging fixture.
2. Restart the Desktop host.
3. Select/open a previously unseen project.
4. Assert `project/open`, `session/list`, and `session/create` finish without
   any MCP connect, `tools/list`, or permission event.
5. Assert the chat can send a normal non-MCP prompt immediately.
6. Call one healthy direct MCP tool and assert only that server starts.
7. Call the hanging MCP tool and assert bounded tool failure while chat, project
   navigation, and the healthy MCP remain usable.

## 8. Explicit non-goals

- A project-local MCP configuration overlay in this migration.
- Importing Cursor/Claude/Codex MCP config automatically.
- A persistent broad MCP allow rule.
- Claiming a UI permission prompt is OS/process/network sandboxing.
- Upgrading Pi or MCP SDK only to obtain an unproven dynamic tool API.
