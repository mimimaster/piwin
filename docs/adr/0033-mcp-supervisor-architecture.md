# ADR 0033: MCP Supervisor Architecture

## Status

Accepted (2026-08-06) — implementation pending

**Supersedes:** MCP permission and lifecycle decisions in ADR 0014 and ADR
0019 §5

**Related:** ADR 0008, ADR 0031

## Context

piwin is a private, local, open-source coding-agent shell. Users install and
configure their own MCP servers and are responsible for the code and commands
those servers run. MCP therefore does not need a second piwin permission model.

The current implementation has already removed the old generation snapshot and
keeps one `McpLifecycleManager` map in `HostRuntime`, but two lifecycle gaps
remain:

1. `refreshConfig()` can replace a server while `startInternal()` is still
   connecting. It drops the old start bookkeeping and schedules client close
   without awaiting the raw connect operation. The child can therefore outlive
   the configuration that created it.
2. A timed-out tool call closes a client, but the next model call can
   immediately spawn the same unhealthy server again. A bad server can produce
   a repeated spawn → timeout → close storm.

There is also an ownership leak in the composition boundary: the session bridge
can create a temporary lifecycle manager when the Host does not inject one.
Production code must have one Host-owned owner; a session must never own an MCP
process.

ADR 0031 fixed the most visible child-process leak by adding abort and hard-kill
behavior. This ADR makes ownership and replacement semantics explicit so the
same class of leak cannot return through configuration reload, cancellation,
crash, or shutdown paths.

## Decision

### 1. MCP is configuration-as-trust

MCP is outside piwin's permission rule engine entirely.

- Adding/enabling a server in `~/.piwin/mcp.json` is the user's trust action.
- MCP calls never produce permission prompts and never consult
  `PermissionRuleSet`, `PermissionMode`, or `PermissionSubject`.
- MCP is not an OS sandbox. A server runs with the Host user's OS permissions.
- `disabled` is an operational availability flag, not a trust state.
- Risk classification and argument redaction may remain as informational
  diagnostics, but they cannot block or prompt.

Legacy `mcp` `deny`/`ask`/`allow` entries in `permissions.json` are silently
ignored. They are not migrated, upgraded, or treated as an error. The loader
may emit one diagnostic `host/log` entry per load, but it must not block or
prompt because of those entries. `mcp.json` is unaffected.

### 2. One Host owns one Supervisor

`@piwin/host-runtime` creates exactly one `McpSupervisor` for a Host process.
The implementation lives in `@piwin/mcp`; it is not an OS daemon or a new
top-level package.

```text
Desktop / CLI
      |
      v
@piwin/host-runtime
      |
      +-- McpConfigStore
      +-- McpSupervisor ---- one ProcessSlot per server
      +-- mcp_gateway
                              |
                              v
                      MCP server process tree
```

Ownership invariants:

- Only the Supervisor may spawn, close, restart, or adopt an MCP process.
- The Supervisor registers a process immediately after `spawn`, before MCP
  `initialize` completes.
- Sessions, gateway tools, UI commands, and Pi adapters hold service handles,
  never clients or child-process handles.
- `McpSupervisor.dispose()` is the only normal Host-wide MCP shutdown entry
  point and is idempotent.
- An independently running Desktop Host and CLI Host do not share processes;
  cross-Host daemons are out of scope.

The production session bridge must require an injected Supervisor. A local
manager fallback is allowed only in an explicitly named unit-test factory; it
must not be reachable from normal Host composition.

### 3. ProcessSlot owns the process before readiness

`Promise<McpTransportClient>` is not sufficient because the promise may remain
pending after the child has been spawned. The transport boundary therefore
returns an owned process handle immediately:

```ts
type OwnedMcpProcess = {
  readonly pid?: number;
  readonly ready: Promise<McpTransportClient>;
  close(reason: string): Promise<void>;
};
```

`ready` describes protocol readiness only. It does not define ownership.
`close()` is idempotent, can be called before `ready` settles, and is always
awaited by the Supervisor.

Each server has one slot and one operation token:

```text
stopped → starting → ready → draining → stopping → stopped
                    └──────→ unhealthy ────────┘
```

The slot contains at least:

- `serverId`, validated config, config fingerprint, and revision token;
- current state and last error;
- owned process, client, connect `AbortController`, readiness promise, and
  close promise;
- active-call count and an accepting-calls flag;
- `unhealthyUntil`, failure count, and last failure reason;
- one exit subscription and one crash-restart decision.

No code may clear a pending start promise, abort controller, or close promise
without first awaiting or superseding the corresponding operation token.

### 4. Supervisor API and lazy behavior

The public service is named `McpSupervisor`. A compatibility type alias may
keep existing callers compiling during the migration, but there must be only
one implementation and one runtime instance.

```ts
interface McpSupervisor {
  getConfig(): McpConfigDocument;
  applyConfig(config: McpConfigDocument): Promise<McpConfigApplyReport>;
  listHealth(): Promise<McpServerHealth[]>;
  listTools(serverId: string, signal?: AbortSignal): Promise<McpToolSummary[]>;
  callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  restart(serverId: string): Promise<McpServerHealth>;
  dispose(): Promise<void>;
}
```

`start`, `stop`, and `restart` are diagnostic/Settings operations that
delegate to the same Supervisor. They never create another lifecycle path.

- `status` and cache-only `search` do not connect a server.
- Normal gateway `search` checks cached metadata first and, only after the model explicitly asks, may perform bounded lazy discovery on a cache miss. The gateway bounds one search to at most eight uncached servers and four concurrent discoveries.
- Live `listTools`/`describe` and `callTool` connect lazily.
- Concurrent readiness requests for one server share one promise.
- Calls to a disabled, removed, draining, or disposed server fail with stable
  operational errors (`server-disabled`, `server-restarting`, or
  `host-closing`) and do not spawn a process.

### 5. Configuration replacement is a serialized transaction

`mcp/save` is the only normal refresh path:

```text
validate → atomically write ~/.piwin/mcp.json → await supervisor.applyConfig
```

`applyConfig` is serialized per Supervisor and compares server fingerprints.
The server fingerprint deliberately excludes the document's exposure policy
(`pinnedSelectors`). Exposure changes increment a separate exposure revision;
they must not restart, drain, or reconnect an MCP server.

| Change | Action |
|---|---|
| unchanged server | Retain slot and client |
| new server | Add stopped slot; start lazily |
| disabled server | Stop accepting calls; drain and close |
| removed server | Drain, close, remove metadata and slot |
| command/args/env/cwd changed | Increment revision; drain, abort, close, invalidate metadata, install new config |
| `pinnedSelectors` only | Update exposure revision; keep every server slot unchanged |

The replacement sequence for a starting or ready slot is mandatory:

```text
mark draining / reject new calls
  → abort pending connect
  → stop accepting new calls
  → wait for active calls up to drain deadline
  → await ownedProcess.close()
  → verify old operation token cannot publish a client
  → install new fingerprint and stopped slot
```

The old slot must be closed before the new revision can spawn. The old start
continuation may finish later, but it can only observe the stale token and
perform idempotent cleanup; it must never publish the old client. Do not use
`void close(...)` or delete `startPromise` as a substitute for this sequence.

The persisted document is authoritative. If cleanup reports an error after the
atomic write, `applyConfig` returns a diagnostic failure and leaves the old
slot non-accepting; it must not silently run both old and new configurations.

### 6. Failure cooldown prevents restart storms

Every connect failure and tool-call timeout that invalidates a slot records a
per-server cooldown. The default is 5 seconds; the value is configurable with
a bounded maximum for tests and deployments.

During cooldown:

- `callTool` and implicit lazy start fail immediately with
  `server-unhealthy` and include `unhealthyUntil` in health/diagnostics;
- no child process is spawned;
- repeated model retries do not extend the cooldown indefinitely.

Explicit `start`/`restart` from Settings or a diagnostic command bypasses the
cooldown. A successful ready state clears the failure count. A config revision
change also bypasses the old revision's cooldown. Intentional stop, Host
dispose, and caller cancellation do not count as server failures.

The cooldown applies in addition to the per-operation deadline. It is not a
replacement for killing the owned process.

### 7. Gateway-first exposure with pinned direct tools

The default session surface always exposes one `mcp_gateway` with
`search | describe | call | status`. It does not automatically register every
valid cached tool as a direct Pi tool.

Project creation, session creation, and Host tool-surface composition only read
configuration and metadata cache; they perform zero MCP transport calls. A
transport may be started only while executing an explicit model-issued gateway
search/describe/call, a pinned direct MCP tool, or a diagnostic Settings operation.
Cached search is
non-connecting; normal search may perform bounded lazy discovery only after the
model asks for the search.

Users may pin high-frequency tools in the same global MCP document:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  },
  "pinnedSelectors": ["github.list_repos"]
}
```

`pinnedSelectors` is exposure configuration, not permission or process
configuration. Its rules are:

- selectors are exact `serverId.toolName` strings; wildcards are invalid;
- values are deduplicated and syntax-validated on `mcp/save`;
- an unknown server/tool may be stored as a dormant pin so discovery can happen
  later; it is not allowed to trigger transport I/O while saving;
- the default policy is gateway-only (`pinnedSelectors: []`);
- only explicitly pinned selectors can become direct tools; there is no
  lexical fill, automatic “first N tools”, or cached direct-tool promotion;
- a pinned tool requires metadata whose server fingerprint matches the current
  server config. Missing or stale metadata leaves the pin dormant, emits a
  diagnostic, and keeps the tool callable through gateway `describe`/`call`;
- direct execution and gateway `call` both invoke the same Supervisor
  `callTool` and never own a client or process.

Pinned tools remain first-class direct tools so pinning continues to increase
their selection likelihood. Their model-visible prose is bounded during
descriptor projection: names, JSON Schema structure, constraints, execution,
and trusted MCP admission stay exact, while oversized descriptions are
truncated. The always-on MCP brief likewise contains only proactive routing,
gateway flow, bounded inventory, and pinned names; it does not duplicate the
gateway's full instructions.

The exposure policy has two hard budgets: direct tool count and serialized
schema bytes. Pinned tools consume those budgets. The Settings UI refuses a pin
that would exceed a budget and explains the limit. If a manually edited config
contains too many pins, session composition registers no overflowing direct
tools, keeps `mcp_gateway` available, and emits one actionable diagnostic; it
must not silently choose arbitrary pins.

The contract should represent the policy explicitly:

```ts
type McpExposurePolicy = {
  mode: 'gateway' | 'pinned';
  maxDirectTools: number;
  maxDirectSchemaBytes: number;
  pinnedSelectors: string[];
};
```

`mode: 'gateway'` is the default. `mode: 'pinned'` means “use only the
validated pinned selectors”, not “fill the remaining budget automatically”.

#### Pin UI

The MCP tool catalog shows a per-tool outline pin icon. Clicking it persists the
selector through the normal `mcp/save` path (validate → atomic write →
`applyConfig`); multiple tools may be pinned independently. The filled icon
means the selector is persisted, not that a process is resident.

Use the accessible label/tooltip **“固定为直接调用工具”** rather than
“常驻 MCP”: pinning keeps the tool in the model tool surface, while the
Supervisor remains lazy and may stop the process during shutdown or recovery.
The UI shows dormant/stale pins and the diagnostic reason instead of silently
losing the user's selection.

Pi custom tools are static for a created Agent session in the current host
integration. Therefore v1 applies a pin change to the next session or an
explicit session tool-surface rebuild; the current session keeps using
`mcp_gateway` and does not receive an implicit runtime replacement. Pinning
never starts a server.

This keeps the high-frequency direct-tool UX without creating a second
lifecycle or permission path. A direct tool resolves the current server at
call time, and an exposure-only config change never drains or restarts a
ProcessSlot.

### 8. Host shutdown and terminal state

The Host shutdown order is:

```text
mark Host closing / reject new commands
  → abort active Agent runs and MCP operations
  → await McpSupervisor.dispose()
  → close Pi SDK/RPC workers
  → flush Host state
```

`HostRuntime` keeps a terminal `closing` flag. `getMcpManager()` must never
recreate a Supervisor after `dispose()` has started or completed; commands
arriving after that point return `host-closing`.

### 9. Host-tool admission

MCP must not be represented as `readOnly`, because an MCP tool may mutate an
external system. The Host tool router uses an explicit admission variant:

```ts
type HostToolAdmission =
  | { kind: 'unrestricted' }
  | { kind: 'permission'; action: string; risk: PermissionRiskKind };
```

`mcp_gateway` and pinned direct MCP tools use `unrestricted`. They still pass
through the Host tool router and Supervisor; they simply do not enter the
permission rule engine. MCP rule kinds, MCP permission subjects, MCP mode-table
rows, and `mcp:tool-call` policy paths are removed from contracts and runtime
admission. Legacy on-disk rules are ignored as described in §1.

### 10. Package ownership

| Concern | Owner |
|---|---|
| Config schema, validation, fingerprinting, atomic persistence | `@piwin/mcp` |
| ProcessSlot, Supervisor, owned transport, cooldown | `@piwin/mcp` |
| Metadata catalog and cache invalidation | `@piwin/mcp` |
| Host command/push wiring and one-instance composition | `@piwin/host-runtime` |
| Gateway and pinned direct tool definitions | `@piwin/host-runtime` |
| Pi custom-tool adaptation | `@piwin/agent-host` |
| Desktop/CLI presentation | `apps/desktop`, `apps/cli` |

`@piwin/agent-host` does not import or own MCP lifecycle code. Apps do not read
`mcp.json` or spawn MCP processes directly.

## Implementation plan

The current repository already has a single manager map, so the implementation
plan does not include deleting generation snapshots that are not present in
`piwin-dev`.

### Phase 1 — contracts and admission boundary

1. Remove MCP target/subject kinds and MCP mode-table fields from
   `packages/contracts/src/permission.ts`.
2. Add/retain `unrestricted` Host-tool admission as an explicit union member;
   do not overload `readOnly`.
3. Keep `McpToolRisk` only if the UI/diagnostic surface needs it, and document
   that it is display-only.
4. Add `McpExposurePolicy` (`gateway` | `pinned`) with gateway-only default,
   exact `pinnedSelectors`, hard count/schema budgets, and validation that
   rejects wildcard selectors.
5. Add `pinnedSelectors` to the top level of `McpConfigDocument`; pin changes
   must be persisted through `mcp/save` and treated as exposure-only changes.

### Phase 2 — owned process and Supervisor

1. Split transport creation from readiness: spawn returns `OwnedMcpProcess`.
2. Make official SDK and compatibility transports implement the same close
   contract, including process-group escalation and PID capture.
3. Refactor `mcp-lifecycle-manager.ts` into the Supervisor/ProcessSlot model.
4. Store the connect abort controller and operation token in the slot.
5. Implement serialized `applyConfig`, drain deadlines, stale-token checks,
   cooldown state, and idempotent `dispose`.
6. Keep compatibility exports only as aliases; do not retain a second manager.

### Phase 3 — Host wiring and tool surface

1. Construct one Supervisor in `HostRuntime` and inject it into every session
   bridge and tool definition.
2. Remove the production session-bridge fallback that creates a manager.
3. Make `mcp/save` validate, atomically persist, then await `applyConfig`;
   exposure-only changes must not drain or restart ProcessSlots.
4. Make gateway status/search/describe/call resolve through the current
   Supervisor; no session-owned config or client is captured.
5. Change cached direct exposure to gateway-only by default and pinned-only
   when explicitly configured; add the per-tool outline/filled pin UI and make
   pin changes take effect on the next session or explicit tool-surface rebuild.
6. Remove `mcp-call-permission.ts` from the call path and make legacy MCP
   permission rules inert at load time.

### Phase 4 — verification

Add tests before changing the public behavior:

- concurrent readiness creates at most one child;
- hanging initialize timeout kills the process tree;
- dispose during initialize kills the process tree and is fully awaited;
- config replacement during `starting` aborts and closes the old process before
  the new revision can start;
- config replacement during active calls drains and rejects new calls;
- timeout/call failure enters cooldown and repeated calls do not spawn;
- explicit restart bypasses cooldown and success clears it;
- stale old operation cannot publish a client after replacement;
- `mcp/save` updates the live Supervisor;
- Host dispose followed by a command cannot recreate a Supervisor;
- no MCP call emits a permission request and legacy MCP rules are ignored;
- gateway-only default, exact pinned selectors, stale/dormant pins, budget
  rejection, no-spawn-on-pin, exposure-only config reload, and shared
  Supervisor routing;
- pin UI persists through `mcp/save` and uses an accessible fixed-tool label;
- ADR 0031 hanging-connect regression passes repeatedly with no orphan.

Run `pnpm typecheck` and the touched package tests after each phase. Keep
transport, lifecycle, permission-boundary, and docs changes in separate commits.

## Consequences

### Positive

- One process owner and one destruction path cover connect, call, reload,
  crash, cancellation, and shutdown.
- A hanging initialize cannot escape before a client object exists.
- A failing server cannot create an unbounded restart storm.
- MCP configuration changes do not create hidden session lifecycles.
- The model gets one stable gateway while high-frequency pinned tools remain
  available.
- MCP behavior is the same in SDK and RPC Host modes.

### Negative

- Enabled MCP servers run with the Host user's OS permissions.
- Gateway calls add indirection compared with direct tools.
- A Host crash or power loss can still leave a process that only an external OS
  reaper can clean up; that reaper is outside this ADR.
- Config persistence can succeed while cleanup reports a diagnostic failure;
  the runtime must remain fail-closed for that server until an explicit repair.

## Acceptance criteria

This ADR is implemented when:

- one Host creates one Supervisor and no session bridge creates a production
  fallback manager;
- concurrent calls to one server create at most one process;
- connect timeout, replacement during connect, call timeout, and shutdown leave
  no MCP child or descendant process;
- old config revisions cannot publish clients after replacement;
- cooldown prevents automatic spawn storms and explicit restart bypasses it;
- `applyConfig` is the only runtime refresh path after `mcp/save`;
- gateway-only is the default; pinned direct tools share Supervisor routing;
  pin-only config changes do not restart or drain a server;
- MCP calls never create permission requests;
- legacy MCP permission rules are ignored without changing `mcp.json` behavior;
- `dispose()` is idempotent and fully awaited;
- ADR 0031's regression test passes repeatedly.

---

## Verification notes (superseded draft, 2026-08-06)

The earlier draft of this ADR (as of 2026-08-06) documented the state after
the supervisor-owned gateway lifecycle landed and recorded the following
verification:

- `pnpm typecheck` across all workspace projects;
- `@piwin/mcp` typecheck and 26 tests;
- `@piwin/host-runtime` typecheck and 875 tests;
- `@piwin/desktop` typecheck and 780 tests.

The remaining gaps captured in this revision (config-reload race, restart
storm, composition-boundary ownership) are tracked in the implementation plan
above.
