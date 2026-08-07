# MCP Lifecycle and Permission Redesign

| Field | Value |
|---|---|
| Status | Superseded (2026-08-06) by ADR 0033 |
| Date | 2026-07-24 |
| Owners | `@piwin/contracts`, `@piwin/mcp`, `@piwin/agent-host`, `@piwin/project`, Desktop, CLI |
| Supersedes | The project-scoped MCP connection permission behavior added during the project-open freeze investigation |
| Requires ADR | Yes -- update or supersede ADR 0008 before implementation |

> Retained as investigation history. Its project permission and per-call
> approval model is no longer valid. Use [ADR 0033](../adr/0033-mcp-supervisor-architecture.md)
> for the configuration-as-trust and Supervisor design.

> **Pi-first revision (2026-07-24):** The initial delivery is deliberately
> narrower than an abstract "global plus project overlay" design. It supports
> only the existing global `~/.piwin/mcp.json` configuration. Project-provided
> MCP declarations are deferred until a dedicated Pi trust-alignment ADR and
> capability spike exist. Pi 0.80.10 publicly supports SDK `customTools` at
> `createAgentSession()` time; it does not provide a stable
> `AgentSession.registerTool()` API for piwin to depend on. Consequently, a
> session receives a static snapshot of globally ready MCP tools. The host
> prepares that snapshot in the background, never while opening a project.

## 1. Executive decision

**MCP server configuration and lifecycle are global integration concerns. They
must not be authorized, started, or awaited by project-open or session-create
paths.**

Project trust remains a workspace safety boundary for cwd-bound operations:

- local file reads/writes;
- terminal and managed processes;
- Git mutations;
- workspace rules and project-local resources.

MCP has three different concerns that must remain separate:

1. **Server configuration and lifecycle** -- global; owned by `@piwin/mcp` and
   persisted at `~/.piwin/mcp.json`.
2. **Workspace-provided configuration** -- a deferred future capability in
   which a trusted workspace may declare an overlay. This is configuration
   provenance, not a permission grant and not a process lifecycle gate. It is
   deliberately absent from the first delivery.
3. **Tool-call risk** -- host-owned, evaluated at invocation time from the
   stable server/tool identity and risk facts. This is the only place an agent
   permission prompt may occur for MCP.

The immediate correctness rule is:

```text
open project and create/resume session
    MUST NOT wait for an MCP permission prompt.
```

## 2. Why the current behavior is wrong

### 2.1 Current implementation sequence

The desktop project-open happy path is currently:

```text
project/open
  -> project/trust (desktop auto-trusts explicitly opened folders)
  -> session/list
  -> session/create when no prior session exists
  -> PiSdkAdapter.createPiSdkSession
  -> createMcpSessionBridge
  -> for every enabled global MCP server:
       project remembered-permission check
       mcp:connect permission request
       lifecycleManager.ensureStarted
       tools/list
  -> createAgentSession
```

The relevant current files are:

| Concern | Current file |
|---|---|
| Desktop auto-open/create flow | `apps/desktop/src/hooks/use-session-actions.ts` |
| JSONL sidecar loop | `apps/cli/src/index.ts` (`commandHostServe`) |
| Host lifecycle owner | `packages/agent-host/src/host-runtime.ts` |
| SDK session assembly | `packages/agent-host/src/sdk-adapter.ts` |
| Per-session MCP bridge | `packages/agent-host/src/mcp-session-bridge.ts` |
| Global server lifecycle | `packages/mcp/src/mcp-lifecycle-manager.ts` |
| Project MCP state | `packages/contracts/src/project.ts`, `packages/project/src/project-store.ts` |

This gives a routine workspace transition three inappropriate dependencies:

- remote/local integration process startup;
- `tools/list` response timing for every enabled server;
- interactive user permission resolution.

### 2.2 Observed failure modes

The bug investigation established two real host-transport defects:

1. A serial JSONL dispatcher could wait on `session/create` while that operation
   waited for `permission/resolve`; the resolve command then sat behind the
   waiting operation. This is a protocol self-deadlock.
2. Host diagnostics written to stdout contaminated the JSONL protocol, so the
   Tauri bridge could no longer parse a valid response stream.

Those defects must be fixed regardless of the redesign. They are not the
architectural explanation for why an ordinary project open creates an
interactive MCP permission workflow in the first place.

### 2.3 Incorrect emergency model to remove

The current patch sequence introduced or extended these concepts:

- `ProjectMcpPolicy.allowedServerIds` in project state;
- `mcp:connect` / `mcp:tool-call` remembered as project permissions;
- `PermissionRememberScope = 'all-mcp-project'`;
- a desktop button that allows all globally enabled MCP servers for one
  project.

These are not the target design. They turn globally configured integrations
into arbitrary per-workspace process approvals, and they conflate server
identity with all present and future tool capabilities.

**Implementation of this redesign must remove them, not preserve them as a
legacy control plane.** Existing persisted values may be read only for a
transition-release migration notice; they must not affect authorization in the
new mode.

## 3. External design references

### 3.1 Pi Agent Harness is the primary reference

Pi explicitly defines project trust as an **input-loading guard**, not a tool
authorization or sandbox boundary. Its Security documentation states that Pi
runs with the permissions of its launching user and that trusting a project
only permits loading project-local settings, packages, extensions, skills,
prompts, themes, and system-prompt resources. It explicitly does **not** limit
what tools can do after a session starts.

Relevant primary sources:

- <https://pi.dev/docs/latest/security>
- <https://pi.dev/docs/latest/settings>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/sdk>

Pi supplies the following integration points which piwin should reuse:

| Pi capability | Intended Pi meaning | piwin use |
|---|---|---|
| `project_trust` event / `ctx.isProjectTrusted()` | Decide whether project-owned resources may load | Gate project-provided `.pi` resources and any future project MCP declaration. Do not use it to authorize a globally configured server connection. |
| Global vs project extension locations | Distinguish configuration/resource provenance | Keep global piwin MCP configuration separate from a future trusted project override/selection document. |
| `tool_call` hook | Observe/block an actual tool invocation | Preserve the equivalent host permission boundary for MCP custom-tool calls, bash, web, and other side effects. |
| `pi.registerTool()` and SDK `customTools` | Attach tool implementations to a session | Register tools from a ready global catalog snapshot; never make each registration depend on an interactive connection approval. |
| `ctx.hasUI` | Detect whether interactive consent can be requested | Noninteractive `ask` must deny deterministically instead of silently allowing. |
| Containerization/Gondolin/OpenShell guidance | OS or VM boundary provides actual isolation | Treat piwin policy prompts as UX/policy controls, not a security sandbox; offer sandbox integration separately when real isolation is required. |

Pi's own `permission-gate.ts` example follows the intended execution boundary:
it intercepts `tool_call`, checks a dangerous `bash` command, requests UI
confirmation only at that call, and blocks by default when no UI exists. That
is the pattern piwin should adopt for MCP tool risk.

Pi does **not** currently expose a merged, first-party MCP lifecycle manager
through the pinned `@earendil-works/pi-coding-agent` SDK. Its public docs have
no native MCP settings/runtime surface. A community PR, [#3774](https://github.com/earendil-works/pi/pull/3774), proposed an MCP extension but was closed
without merging. It is useful implementation evidence, not a supported Pi API:

- global `~/.pi/agent/mcp.json` plus project `.pi/mcp.json`, with project
  entries overriding global entries by server name;
- register MCP tools at `session_start` and remove them at `session_shutdown`;
- 10-second connect deadline and 5-second `tools/list` deadline;
- close a timed-out transport to prevent subprocess leaks;
- resolve the current client from a map at execution time, avoiding stale client
  closures after session/server restart;
- validate MCP JSON-schema parameters before forwarding calls.

Pi ecosystem evidence also directly confirms the startup-isolation requirement:
issue [#5857](https://github.com/earendil-works/pi/issues/5857) documents stale
MCP HTTP credentials causing roughly 49 seconds of startup retry delay. Its
recommended behavior is fail-fast for non-transient 401/403 responses, with
MCP retry policy independent from model-provider retry policy. piwin must apply
the same principle even though its MCP runtime is product-owned.

### 3.2 Claude Code

Claude Code documents distinct MCP configuration scopes: local/user, project,
and managed configuration. Project-scoped server declarations wait for
workspace trust and explicit approval; user-scoped configuration remains a
user-owned integration setting. Its `/mcp` status UI presents server health and
pending approval separately from a chat/session lifecycle.

Relevant reference:

- <https://code.claude.com/docs/en/mcp>

Takeaways for piwin:

- Scope is a **configuration provenance** decision, not a session-level
  permission loop.
- Workspace trust governs whether a repository-provided integration declaration
  is accepted. It does not cause a configured global server to be repeatedly
  approved per session.
- Connection state is observable in a dedicated MCP surface.

### 3.3 Codex

Codex separates MCP configuration from its approval/sandboxing system. Its
permissions are about tool execution and environment access; MCP is configured
as an integration surface. This reinforces the separation between integration
availability and potentially harmful actions performed by a tool.

Relevant reference:

- <https://developers.openai.com/codex/mcp/>
- <https://developers.openai.com/codex/permissions/>

### 3.4 Cursor

Cursor treats MCP servers as configured integrations, with user and project
configuration locations. Tool approval is an agent/runtime behavior rather
than a prerequisite for every project-open transition.

Relevant reference:

- <https://docs.cursor.com/context/mcp>

### 3.5 Deliberate piwin interpretation

piwin remains local/private and may support user and project MCP declarations
later. That does not imply project-scoped execution permission.

For the first delivery of this redesign:

- `~/.piwin/mcp.json` remains canonical for global configuration.
- There is **no project MCP declaration or overlay**. This prevents a project
  switch from changing the process lifecycle configuration and returns project
  open to a purely workspace/session operation.
- Tool execution is controlled by host policy at the actual call boundary.
- The host policy is an application-level consent mechanism, **not** a claimed
  sandbox. Real filesystem/process/network isolation remains a separate
  container or VM capability, consistent with Pi's own guidance.

When project MCP declarations are eventually added, they must follow Pi's
resource-loading semantics: a project declaration is ignored until trust is
resolved, and a trusted declaration changes configuration provenance only. It
must never become a server-wide execution grant.

## 4. Target architecture

### 4.1 Four independent planes

```text
Configuration provenance plane
  ~/.piwin/mcp.json                 user/global definitions
  <project>/.pi/mcp.json            future project overlay, trust-gated
  -> effective config for one project/session
  -> effective-config fingerprint
      |
      v
Lifecycle plane (host-owned, keyed by effective config)
  McpLifecycleManager
  start / stop / health / retry / tool catalog cache
      |
      v
Session catalog plane
  snapshot of ready/unavailable tools available to a new session
  no user interaction; bounded work only
      |
      v
Execution policy plane
  actual mcp__server__tool invocation
  classify risk -> allow / ask / deny -> execute or reject
```

Pi-compatible project trust is evaluated only while constructing the effective
configuration. An untrusted project contributes no project-local MCP overlay.
It is **not** an authorization check before global-server startup and it is not
re-evaluated at every MCP call.

`McpLifecycleManager` is host-owned, but must not assume that a bare server id
is globally unique. A project-local override may use the same id with different
command, arguments, environment references, or endpoint. Runtime entries must
therefore be keyed by an opaque `effectiveConfigFingerprint` that includes the
normalized server definition and its configuration provenance, never secrets.

### 4.2 Required state machines

#### Effective configuration state

```text
global user config
  + trusted project overlay (if present)
  -> normalized effective config
  -> redacted stable fingerprint
```

Rules:

1. `~/.piwin/mcp.json` is the user-owned default source.
2. A future `<project>/.pi/mcp.json` is a repository-provided overlay; it is
   ignored unless project trust is already resolved as yes.
3. Project entries may add, disable, or replace a global server by id, but they
   never grant execution permission.
4. Environment values remain references. Fingerprints include variable names
   and command/URL shape, never expanded secret values.

#### Server lifecycle state

Owned globally by `@piwin/mcp`:

```text
disabled -> stopped -> starting -> running
                    \-> error -> retrying -> running | error
```

The state belongs to one effective server definition and its config fingerprint,
not to a remembered project permission or a session id.

#### Session tool-registration state

Owned by `@piwin/agent-host`:

```text
host has ready MCP catalog
  -> assemble Pi custom tools from ready routes
  -> create Pi session
  -> session ready
```

Pi's documented SDK integration accepts `customTools` at
`createAgentSession()` time. The plan must not assume a general public
post-create registration API. Therefore the baseline is a snapshot: an
unavailable server is represented in MCP health/status and omitted from a new
session's custom tools. It does not block session creation.

Pi extensions can dynamically call `pi.registerTool()` (the official
`dynamic-tools.ts` example does so during `session_start` and later from a
command), but whether piwin's current SDK resource-loader/extension bridge can
safely use that mechanism for asynchronously discovered MCP tools is **not yet
proven**. It is a capability spike, not a v1 assumption; see Section 6.

#### Tool-call policy state

Owned by `@piwin/agent-host`:

```text
model requests MCP tool
  -> evaluate risk facts
  -> allow -> call tool
  -> ask -> emit permission request, await resolve
  -> deny -> return denied tool result
```

`permission/resolve` is a control-plane command and must always be schedulable
while a tool request waits. The UI must use a FIFO permission queue rather than
one overwriteable `permissionPrompt` slot.

### 4.4 Lifecycle startup policy

The host must choose one explicit policy and document it:

| Policy | Recommendation | Behavior |
|---|---|---|
| Manual | Supported | User starts a server in MCP Settings; sessions see it when ready. |
| Background prewarm | Supported | Host may reconcile only user/global servers after host-ready; it must never delay host-ready or project open. |
| Session catalog prewarm | **Baseline** | When a trusted project is selected, reconcile its effective config in the background; session creation uses whatever is ready. |
| Demand start | Optional later | Explicit UI action or a new-session request starts selected servers with a hard deadline; session gets a degraded snapshot if unavailable. |

Recommended v1 behavior:

1. Host starts and publishes `host/status` before launching any MCP connection.
2. The host may prewarm user/global definitions asynchronously; project-specific
   effective config is reconciled only after its trust decision is available.
3. Each connect/initialize/`tools/list` operation has a bounded deadline and
   closes its client/transport on failure or timeout.
4. It emits MCP health/catalog updates as servers become ready or fail.
5. `session/create` uses the current ready catalog and has **no MCP permission
   prompt**. It does not wait for the entire manager.
6. Until the dynamic-tool capability spike succeeds, a session created before a
   server is ready does not gain that tool; UI offers an explicit "Start a new
   session with ready tools" action rather than pretending the tool exists.

This deliberately favors Pi-supported, deterministic session tools over an
unproven hot mutation path.

## 5. Contracts-first design

All additions begin in `packages/contracts`.

### 5.1 Remove invalid project MCP contracts

Remove after migration:

```ts
type ProjectMcpPolicy = { allowedServerIds: string[] };
ProjectRecord['mcpPolicy'];
createEmptyMcpPolicy();
type PermissionRememberScope = 'all-mcp-project';
```

`PermissionRememberScope` remains only for narrowly defined valid policies,
such as remembered web fetch domains, if retained.

### 5.2 Add effective-config and runtime contracts

In `packages/contracts/src/mcp.ts` add public, transport-neutral data:

```ts
type McpServerRuntimeState = 'disabled' | 'stopped' | 'starting' | 'running' | 'error';

type McpCatalogTool = {
  serverId: string;
  toolName: string;
  exposedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: McpToolRisk;
};

type McpConfigSource = 'user' | 'project';

type McpEffectiveServer = {
  serverId: string;
  source: McpConfigSource;
  runtimeKey: string; // fingerprint of redacted effective definition
};

type McpToolRisk =
  | 'read'
  | 'network'
  | 'external-write'
  | 'local-write'
  | 'process'
  | 'credential'
  | 'unknown';

type McpCatalogSnapshot = {
  effectiveConfigFingerprint: string;
  generatedAt: string;
  tools: McpCatalogTool[];
  unavailableServers: Array<{
    server: McpEffectiveServer;
    state: McpServerRuntimeState;
    message?: string;
  }>;
};
```

`inputSchema` must preserve MCP-provided schema, rather than replacing it with
`additionalProperties: true` in the Pi bridge.

Add an internal `resolveEffectiveMcpConfig()` service in `@piwin/mcp`; its
public result must contain only redacted config facts and provenance. The
service receives an explicit `projectTrusted` boolean from the host. It must
not read a UI trust flag or infer trust by attempting to execute a project
command.

### 5.3 Add structured permission facts

Do not encode a target as a string such as `"server/tool"`. Extend the existing
normalized permission context:

```ts
type McpToolCallTarget = {
  serverId: string;
  toolName: string;
  exposedName: string;
  risk: McpToolRisk;
  argumentsSummary?: string; // redacted/truncated only
};

type PermissionRequestContext = {
  // existing fields
  mcpTool?: McpToolCallTarget;
};
```

The host builds this data. Desktop displays it but never interprets raw MCP
protocol payloads.

### 5.4 Add global runtime events/commands only if needed

Existing `mcp/get`, `mcp/start`, `mcp/stop`, and health commands can evolve
without a second control path. Add a normalized host push only when the UI needs
live health/catalog updates:

```ts
type HostPush =
  | { type: 'mcp/catalog'; snapshot: McpCatalogSnapshot }
  | { type: 'mcp/health'; server: McpServerHealth };
```

Do not send a complete catalog on every process log line.

## 6. Package-by-package implementation plan

### Phase 0 -- Stop compounding the wrong model

**Goal:** remove temporary behavior from the product path before the redesign.

1. Remove `all-mcp-project` from contracts, IPC, Desktop UI, and host handlers.
2. Remove newly added `allowMcpServers()` and its UI affordance, unless retained
   only for an explicit migration cleanup tool.
3. Mark old `mcpPolicy` records as deprecated. Do not consult them for session
   creation or tool execution.
4. Preserve the independent JSONL fixes:
   - stdout is protocol-only JSONL;
   - stderr is diagnostics only;
   - permission resolve can progress while a request waits.
5. Retain the request-id-safe reducer fix, but generalize it to a true permission
   queue in Phase 4.

**Files:**

- `packages/contracts/src/host.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/ipc.ts`
- `packages/project/src/project-store.ts`
- `packages/project/src/index.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/commands/resolve-commands.ts`
- `apps/desktop/src/app-dialogs.tsx`
- `apps/desktop/src/hooks/use-session-actions.ts`

### Phase 1 -- Establish the Pi SDK capability boundary

**Goal:** prove the tool-registration behavior that piwin may depend on before
designing any asynchronous MCP injection.

Create a focused integration spike against the exact pinned Pi version
(`@earendil-works/pi-coding-agent@0.80.10`), isolated under
`packages/agent-host/src/` or a documented test fixture. It must answer:

1. Does a Pi session created through piwin's `createPiResourceLoader()` load a
   global extension whose `session_start` handler calls `pi.registerTool()`?
2. Does that dynamically registered tool become visible to the model after the
   session was created, without replacing the session?
3. Can a dynamically registered tool safely call back through the existing
   extension UI bridge and host permission control plane?
4. What happens if an extension registers a tool after the first prompt is
   already streaming?
5. Are tool additions session-local, and do session disposal/replacement paths
   reliably release extension-owned resources?

**Exit choices:**

| Result | Allowed implementation path |
|---|---|
| Dynamic registration works end-to-end and is stable | Add an optional Pi-extension adapter in a later phase; it may add ready MCP tools to an existing idle session. |
| Dynamic registration is absent, flaky, or cannot use the piwin extension UI bridge | Use the already documented SDK contract only: `customTools` passed at `createAgentSession()`; ready catalog snapshot applies to a newly created session. |

Do not ship a production behavior change from this spike. The baseline in
Phase 3 must remain correct even if the answer is negative.

**Files:**

- `packages/agent-host/src/pi-resource-loader.ts`
- `packages/agent-host/src/extension-ui-bridge.ts`
- `packages/agent-host/src/sdk-adapter.ts`
- a colocated integration fixture/test, without changing public contracts

### Phase 2 -- Effective configuration and bounded lifecycle

**Goal:** `@piwin/mcp` owns configuration resolution, lifecycle, and catalog
state; a broken server cannot block host readiness, project open, or session
creation.

1. Add `resolveEffectiveMcpConfig()`:
   - load `~/.piwin/mcp.json` as the user/global document;
   - in this initial delivery, return that document only;
   - reserve the trusted project overlay merge for Phase 6, so the freeze fix
     does not introduce a new persisted format;
   - return provenance and a redacted effective-config fingerprint.
2. Extend `McpLifecycleManager` with `getCatalogSnapshot(effectiveConfig)` and
   an explicit `reconcile(effectiveConfig)` operation.
3. Key runtime state by `runtimeKey`, not only server id. Never reuse a client
   configured for one effective definition with a different command, URL, or
   environment-reference shape.
4. Define bounded lifecycle operations:
   - connect deadline;
   - protocol initialize deadline;
   - `tools/list` deadline;
   - close timed-out client/process before marking error;
   - fail fast for non-transient authentication/configuration errors; retry only
     transient failures with a small, independently configured budget.
5. Add asynchronous prewarm APIs. `HostRuntime` can schedule background
   reconciliation after host-ready or after project selection, but no caller may
   await it as part of `project/open`.
6. Publish health and catalog updates. One failed runtime entry produces an
   unavailable diagnostic, never a blocked queue.

**Files:**

- `packages/contracts/src/mcp.ts`
- `packages/mcp/src/effective-mcp-config.ts`
- `packages/mcp/src/mcp-lifecycle-manager.ts`
- `packages/mcp/src/mcp-client.ts`
- `packages/mcp/src/mcp-client-official.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/commands/mcp-commands.ts`

### Phase 3 -- Build sessions from Pi-supported catalog snapshots

**Goal:** session creation never launches a permission workflow or waits for
the entire MCP fleet.

1. Replace `createMcpSessionBridge()`'s `load config -> request mcp:connect ->
   ensureStarted -> tools/list` loop with a catalog snapshot passed from the
   host runtime.
2. Construct Pi `customTools` only from ready catalog routes and pass them to
   `createAgentSession()` at creation, as required by ADR 0008 and the public
   SDK contract.
3. Omit unavailable server tools and return session warning/status separately.
   A no-MCP session is still valid.
4. Preserve the effective-config fingerprint and unavailable server ids in
   session metadata for truthful desktop diagnostics.
5. In the baseline, active sessions are static. Configuration or health changes
   affect a new session; UI must say this explicitly and offer "New session with
   current tools". Do not silently advertise unavailable tools.
6. Only if Phase 1 proves the dynamic Pi extension path, add it as a separate,
   capability-flagged enhancement for idle sessions. It must use a live client
   lookup at execution time and obey the same policy/cleanup behavior as the
   snapshot path.

**Files:**

- `packages/agent-host/src/sdk-adapter.ts`
- `packages/agent-host/src/mcp-session-bridge.ts`
- `packages/agent-host/src/pi-tool-adapter.ts`
- `packages/agent-host/src/commands/session-live-commands.ts`
- `packages/session/src/session-index-store.ts` if snapshot metadata is stored

### Phase 4 -- Replace server-wide authorization with Pi-aligned tool-call policy

**Goal:** authorize side effects, not connection or server identity.

1. Preserve MCP tool schemas through `McpListedTool`, `McpCatalogTool`, and Pi
   custom tool definitions.
2. Add pure `evaluateMcpToolCallRisk()` in `agent-host`. Its control point is
   equivalent to Pi's `tool_call` hook: it observes an actual invocation before
   MCP I/O and can allow, request confirmation, or block.
3. Start with conservative classification:
   - explicitly known/read-only tools: `read`;
   - unknown tools: `unknown` and `ask`;
   - tools with known mutating/network/process/credential effects: corresponding
     high-risk class and `ask` by default.
4. Do not trust arbitrary server descriptions as a security claim. A server may
   provide hints, but policy defaults unknown to `ask`.
5. On `ask`, emit structured permission context containing server, tool, risk,
   and redacted argument summary.
6. For noninteractive CLI/RPC behavior, `ask` resolves to documented deny unless
   an explicit automation policy exists. Never silently allow due to a missing
   UI callback.

**Files:**

- `packages/contracts/src/mcp.ts`
- `packages/contracts/src/host.ts`
- `packages/agent-host/src/permission-policy.ts`
- `packages/agent-host/src/mcp-session-bridge.ts`
- `packages/agent-host/src/permission-context.ts`
- `apps/desktop/src/permission-request-card.tsx`

### Phase 5 -- Make permissions a real control plane

**Goal:** no permission request can freeze host progress or be lost in UI state.

1. Host keeps a FIFO pending permission registry with explicit terminal states:
   `pending | resolved | timed-out | cancelled`.
2. Give every request a deadline. On timeout or host/session disposal, resolve
   to deny and emit a terminal status.
3. Desktop state changes from one `permissionPrompt` to a queue with one active
   prompt and visible queued count.
4. `permission/resolve` remains a high-priority control-plane request in JSONL
   and Tauri bridge transport.
5. Resolve responses must clear by request id only.
6. Permission UI must remain responsive while a session/tool task waits.

**Files:**

- `packages/contracts/src/host.ts`
- `packages/contracts/src/ipc.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/commands/resolve-commands.ts`
- `apps/cli/src/index.ts`
- `apps/desktop/src/chat-reducer.ts`
- `apps/desktop/src/hooks/use-host-bootstrap.ts`
- `apps/desktop/src/hooks/use-session-actions.ts`
- `apps/desktop/src/app-dialogs.tsx`

### Phase 6 -- Add Pi-compatible project MCP overlays

**Goal:** meet PRD MCP-06 without reintroducing project lifecycle permissions.

Do not implement this in the freeze fix. After Phase 1--5 are stable, define a
project-owned `.pi/mcp.json` overlay to mirror Pi resource provenance. It can:

- add a project-owned server declaration;
- disable a global server for this workspace;
- select a subset of global servers for this workspace.

Rules:

1. Project config is declarative provenance/selection, never a grant of host
   process execution or broad tool-call permission.
2. An untrusted workspace must not load, parse for execution, or activate a
   repository-provided MCP declaration. It is equivalent to Pi refusing to load
   untrusted project extensions/settings.
3. Trust comes from piwin's host-enforced project trust record; its semantics
   must match Pi's canonical-directory/parent-decision model or be explicitly
   documented where it differs. Desktop state alone is never authoritative.
4. Merge rules are deterministic: project entries replace user entries by id;
   an explicit project disable wins; diagnostics display source/provenance.
5. The resulting effective config receives a redacted fingerprint before
   lifecycle reconciliation. Existing user-global clients survive only when the
   effective definition fingerprint matches exactly.

This phase needs its own ADR because it introduces a new persisted scope.

## 7. Testing and acceptance plan

### Unit tests

| Test area | Required cases |
|---|---|
| MCP lifecycle | deadline on connect/initialize/tools-list; one failed server does not prevent other servers becoming ready; retry behavior |
| Catalog | revision changes on config/tool inventory change; unavailable server is represented without blocking snapshot |
| Risk policy | golden cases for known read, unknown, network, mutation, credential, process; redaction of sensitive arguments |
| Permission queue | FIFO, request-id-safe clear, timeout, session dispose, host dispose |
| Project store | no MCP policy is consulted by lifecycle or MCP tool execution |

### Integration tests

1. Host becomes ready with a deliberately hanging MCP server.
2. `project/open` and `session/create` complete without `mcp:connect` prompts.
3. The session catalog contains ready tools and records the unavailable server.
4. A model call to an unknown/mutating MCP tool emits a structured permission
   request; resolving it permits exactly that call.
5. A noninteractive CLI run gets a deterministic deny for `ask` policy.
6. Config removal/disable while a session is active follows the documented
   snapshot rule.

### Desktop E2E tests

1. Opening a project while MCP servers are starting keeps the UI interactive.
2. MCP Settings displays `starting`, `running`, and `error` states without
   blocking project navigation.
3. A tool-call permission opens a dialog while the chat stays usable; queued
   permissions remain visible and resolve in order.
4. No project-open flow renders an MCP permission modal.

### Definition of done

- A project open completes even if every MCP server is unavailable.
- `session/create` never emits `mcp:connect`.
- One broken MCP server cannot block session creation, other MCP servers, the
  JSONL command loop, or Desktop navigation.
- Permission prompts correspond to actual tool invocation risk, not integration
  startup.
- Desktop and CLI obey the same lifecycle semantics; only interaction affordance
  differs.

## 8. Rollout and rollback

### Rollout

1. Land contracts and lifecycle catalog tests first.
2. Implement global lifecycle/catalog behind an explicit config feature flag:
   `mcp.lifecycleMode: 'session-gated' | 'global-catalog'`.
3. Default development builds to `global-catalog` after focused tests pass.
4. Leave old project `mcpPolicy` data readable but ignored in global-catalog
   mode for one release.
5. Remove old data model and feature flag only after a clean migration release.

### Rollback

- `mcp.json` remains unchanged, so no server configuration rollback is needed.
- The old session-gated path can exist only during the feature-flag transition.
- Never roll back to a version that mixes diagnostics into JSONL stdout or
  serializes permission resolve behind a waiting request.

## 9. Documentation changes required with implementation

1. Supersede the MCP lifecycle/permission portions of ADR 0008.
2. Update `docs/architecture.md` permission section to distinguish:
   configuration/lifecycle, project trust, and tool-call risk.
3. Update PRD MCP-06 wording from ambiguous "User vs project override" to
   configuration provenance/selection; explicitly state that it is not an MCP
   execution permission system.
4. Update Settings help text and CLI help for global server start/stop/health.
5. Record the external reference decisions and the snapshot limitation in the
   new ADR.

## 10. Open decisions for ADR review

1. Should enabled global MCP servers auto-start on host boot, or only after an
   explicit reconcile triggered by the MCP Settings panel?
   - Recommendation: background reconcile on host boot, explicit manual restart
     remains available.
2. Should a new session receive tools from only currently running servers, or
   wait a small bounded period for servers in `starting`?
   - Recommendation: zero synchronous wait; catalog snapshot plus warning.
3. Which MCP tool risks can be classified as read-only by built-in policy, and
   which should always be `unknown` without a reviewed provider manifest?
   - Recommendation: allow only a small reviewed read allowlist; default all
     unknown tools to ask.
4. Do we support persistent MCP tool-call approvals in v1?
   - Recommendation: no. Use per-call approval for non-read risks until a stable
     global rule model keyed by server/tool/config fingerprint is designed.
5. How should project-provided MCP declarations be represented and approved?
   - Recommendation: defer to Phase 5; do not overload current project trust
     records.
