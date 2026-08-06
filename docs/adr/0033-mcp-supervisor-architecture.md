# ADR 0033: MCP Supervisor Architecture

**Status:** Accepted — core implementation landed (2026-08-06)
**Date:** 2026-08-06
**Supersedes when accepted:** MCP-specific parts of ADR 0014 and ADR 0019 §5
**Related:** ADR 0008 (Skills + MCP wiring), ADR 0031 (MCP child process leak fix)

## Context

piwin is a private, local, open-source coding-agent shell. Users install and
configure their own MCP servers and are responsible for the code and commands
they run. piwin therefore does not need to impose a second MCP permission
model on top of the user's configuration.

The current MCP path has three separate concerns coupled together:

1. MCP calls enter the Host-wide permission admission gate.
2. MCP clients are split between ordinary manager entries and
   runtime-generation entries.
3. MCP configuration is persisted separately from the in-memory session tool
   surface and is refreshed through multiple paths.

This makes MCP process ownership difficult to reason about. The critical leak
fixed by ADR 0031 exposed the underlying problem: a child process was spawned
before the MCP initialize promise resolved, but the lifecycle manager only had
an easy cleanup path after a client object had been returned. A timeout rejected
the wrapper promise while the underlying connection remained pending, leaving
the child process alive.

The product needs one clear owner for every MCP child process from spawn until
exit. The owner must cover successful connections, failed connects, timeouts,
configuration changes, crashes, session disposal, and Host shutdown.

## Decision

### 1. MCP uses configuration-as-trust

MCP is not part of piwin's permission rule engine.

- A configured server is trusted by the user who configured it.
- MCP calls do not produce permission prompts.
- MCP calls do not use `PermissionRuleSet`, `PermissionMode`, or
  `PermissionSubject`.
- MCP risk classification, if retained, is informational only.
- `disabled` is an operational availability flag, not a trust state.
- piwin does not sandbox MCP processes; they run with the Host user's OS
  permissions.

piwin is a local, open-source tool: every MCP server is user-configured and
user-owned, and the user alone is responsible for what those servers do.
MCP is deliberately kept outside the permission rule engine entirely. There
is no per-server or per-tool permission state, no MCP rows in permission
modes, and no second trust model layered on top of the user's own
configuration.

Legacy MCP `deny`/`ask`/`allow` rules in `~/.piwin/permissions.json` are
**not honored and silently ignored**. They are not migrated and not upgraded;
users who relied on them must remove them or accept that the tools they used
to block now run. The config loader may emit a single `host/log` diagnostic
warning when it encounters ignored MCP rules; it never blocks or prompts.

The user-facing documentation must state this explicitly. Removing the
permission layer does not make an MCP server safe or isolated.

### 2. One Host owns one MCP Supervisor

`@piwin/host-runtime` creates exactly one `McpSupervisor` for each Host process.
The Supervisor is implemented by `@piwin/mcp`; it is not a new OS daemon or
new top-level package.

```text
Desktop / CLI
      |
      v
@piwin/host-runtime
      |
      +-- McpConfigStore
      +-- McpSupervisor ------------------+
      |       one ProcessSlot per server   |
      +-- mcp_gateway Host tool            |
                                          v
                               MCP server process tree
```

The scope is one Host process. A Desktop Host and an independently running CLI
Host may have separate MCP processes. Cross-Host sharing through a daemon or
socket is explicitly out of scope for this ADR.

Ownership rules:

- `McpSupervisor` is the only component allowed to spawn or close MCP
  processes.
- Sessions, Pi adapters, the gateway tool, and UI commands never own a client
  or child process.
- `McpSupervisor.dispose()` is the only normal global shutdown entry point.
- A process is registered in a `ProcessSlot` immediately after `spawn`, before
  MCP initialization begins.

### 3. ProcessSlot owns the process before MCP is ready

The current `Promise<McpTransportClient>` abstraction is insufficient for
failed or hanging connects. The transport layer must expose an owned process
handle as soon as the child is spawned.

Conceptually:

```ts
type OwnedMcpProcess = {
  readonly pid: number | undefined;
  readonly ready: Promise<McpTransportClient>;
  close(): Promise<void>;
};
```

`close()` is idempotent and awaited. `ready` only describes connection
readiness; it does not define resource ownership.

Each `ProcessSlot` has one runtime state:

```text
stopped → starting → ready → draining → stopping → stopped
                    └──────→ error ───────────────┘
```

The slot contains the process handle, connection abort controller, readiness
promise, close promise, active-call count, config fingerprint, health state, and
last error. Concurrent `ensureReady(serverId)` calls share one readiness
promise and never spawn duplicate processes.

### 4. Supervisor lifecycle

The Supervisor exposes service-level operations:

```ts
type McpSupervisor = {
  getConfig(): McpConfigDocument;
  applyConfig(config: McpConfigDocument): Promise<McpConfigApplyReport>;
  listHealth(): Promise<McpServerHealth[]>;
  discoverTools(serverId: string, signal?: AbortSignal): Promise<McpToolSummary[]>;
  callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  restart(serverId: string): Promise<McpServerHealth>;
  dispose(): Promise<void>;
};
```

`ensureReady`, `ProcessSlot`, `closeSlot`, and transport ownership are
internal. `start` and `stop` are not model-facing capabilities. They may remain
as explicit Host commands for diagnostics and Settings UI, but they delegate to
the same Supervisor and never implement a second lifecycle.

#### Lazy start

`callTool` and live `discoverTools` start a server lazily. Status and cached
search do not start a server.

#### Connect failure

Every connect failure follows the same path:

```text
spawn and register slot
  → initialize with deadline
  → timeout/error/abort
  → await slot.close()
  → SIGTERM
  → wait for exit
  → SIGKILL the process tree if needed
  → remove or mark slot error
```

The timeout implementation must cancel the underlying operation and await
cleanup. A `Promise.race` that only rejects an outer promise is not sufficient.

#### Tool-call failure

A tool-call timeout marks the slot unhealthy and closes the underlying MCP
connection. A later call can create a fresh slot. A single crash restart may be
supported as an explicit server configuration, but restart loops are forbidden.

Caller cancellation should use MCP request cancellation when the transport
supports it. If safe cancellation cannot be guaranteed, the Supervisor closes
the affected slot rather than leaving an unknown in-flight process state.

### 5. Configuration is applied through the Supervisor

The source of truth is the validated document at `~/.piwin/mcp.json`.

`mcp/save` performs:

```text
validate
  → atomically write mcp.json
  → supervisor.applyConfig(document)
```

The Supervisor compares server fingerprints:

| Change | Action |
|---|---|
| unchanged server | Keep its ProcessSlot and client |
| new server | Add stopped slot; start lazily |
| disabled server | Drain and close its slot |
| removed server | Drain, close, remove metadata and slot |
| command/args/env/cwd changed | Drain, close, invalidate metadata, replace slot |

Configuration changes do not create new MCP runtime generations and do not
require rebuilding every session's tool surface. A changed server stops
accepting new calls, drains active calls until its deadline, then closes.
The stable gateway therefore remains usable while the server inventory changes;
only optional pinned direct-tool exposure is considered when a later runtime
surface is compiled.

Project-level MCP configuration is not automatic in this version. If it is
added later, it must be explicit opt-in and must still flow through the same
Host Supervisor.

### 6. MCP exposes one stable gateway by default, with pinned direct tools

Every active Host registers one `mcp_gateway` Host tool when the Supervisor is
available, even when no server is currently configured. The gateway supports:

- `search`: metadata cache only;
- `describe`: cache first, then live discovery;
- `call`: resolve and invoke one server tool;
- `status`: return health without starting servers.

The default session surface does not register every MCP tool as a direct Pi
tool. This avoids tool-surface rebuilds, schema-budget management, and a large
number of permission/admission entries. Users can opt individual high-frequency
tools into direct exposure with exact, top-level `pinnedSelectors`:

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

Pins are exact `serverId.toolName` strings: no wildcards, no implicit
server-wide pinning. A pinned tool is still executed through the Supervisor and
does not own a process. Stale pins remain dormant until matching metadata exists;
they are not errors. Direct exposure is bounded by the current 48-tool /
48,000-schema-byte budgets; overflow remains gateway-only with a diagnostic.
Changing only pins changes the next session's exposure revision and does not
drain or restart a running server. The Desktop tool catalog uses an empty/solid
pin icon with the tooltip “固定为直接调用工具”.

The gateway always resolves the current Supervisor configuration. It must not
close over a session-owned MCP config or client.

### 7. Transport implementation

The default implementation uses the official MCP SDK `Client` over piwin's
`OwnedMcpStdioTransport`. The SDK remains responsible for MCP protocol
behavior, while piwin's transport owns the spawned process group. The SDK's
stock `StdioClientTransport` is not used because it only closes its direct PID
and clears that PID during close.

If a compatibility transport is needed later, it must implement the same owned
process contract beneath the Supervisor. The Supervisor must never have two
separate cleanup paths for official and handcrafted clients.

The transport must:

- capture the child/process-group identity at spawn;
- expose a close operation before initialization resolves;
- await graceful exit;
- escalate to hard kill after a deadline;
- report unexpected exit exactly once;
- redact secret environment values and arguments from diagnostics.

Official and compatibility stdio transports share the same process-tree close
helper. On Unix they launch a detached process group; on Windows the close
path uses recursive process termination. Auto fallback awaits closure of the
official candidate before spawning the compatibility candidate.

Where the platform permits it, cleanup targets the MCP process group/tree, not
only the immediate PID. A JavaScript `dispose()` cannot run after `SIGKILL`,
power loss, or an OS crash; an external OS-level reaper is required for that
stronger guarantee and is out of scope here.

### 8. Host shutdown order

The Product Host owns shutdown ordering:

```text
mark Host closing and reject new requests
  → abort active Agent runs and MCP operations
  → await McpSupervisor.dispose()
  → close Pi SDK/RPC workers
  → flush transcripts and Host state
```

`dispose()` is idempotent, has a hard deadline, and reports cleanup failures as
Host diagnostics. No shutdown path may use an unawaited MCP close operation.

### 9. Host tool admission contract

MCP must not be represented as `readOnly: true`, because MCP tools may mutate
external systems. The Host tool contract should have an explicit admission
variant:

```ts
type HostToolAdmission =
  | { kind: 'unrestricted' }
  | {
      kind: 'permission';
      action: string;
      risk: PermissionRiskKind;
      subjectBuilder?: SubjectBuilder;
    };
```

The MCP gateway/direct registrations use
`permissionSpec.admission: 'trusted'`. They still go through the Host tool
router and Supervisor; they simply do not enter the permission rule engine.

MCP-specific permission subjects, rule targets, `mcp:tool-call` policy paths,
and MCP rows in permission modes are removed from the contracts and the
admission gate. The `mcp` rule kind, MCP `PermissionSubject`, and MCP entries
in the permission modes table are deleted; nothing in the permission layer
knows about MCP anymore. MCP tool risk may remain as a display-only
diagnostic type.

### 10. Package ownership

| Concern | Owner |
|---|---|
| Config document and atomic persistence | `@piwin/mcp` |
| Config validation and fingerprinting | `@piwin/mcp` |
| ProcessSlot and MCP Supervisor | `@piwin/mcp` |
| MCP SDK transport | `@piwin/mcp` |
| Metadata catalog | `@piwin/mcp` |
| Host command/push wiring | `@piwin/host-runtime` |
| Gateway tool composition | `@piwin/host-runtime` |
| Pi custom-tool adaptation | `@piwin/agent-host` |
| Desktop/CLI presentation | `apps/desktop`, `apps/cli` |

`@piwin/agent-host` does not import or own MCP lifecycle code. Apps do not read
`mcp.json` or spawn MCP processes directly.

## Consequences

### Positive

- MCP has one process owner and one destruction path.
- A hanging initialize cannot escape the Supervisor's ownership.
- Sessions no longer own MCP clients or generation cleanup.
- MCP configuration changes do not rebuild every Agent runtime.
- The model sees one stable gateway instead of a changing tool surface.
- MCP is consistent between SDK and RPC modes.
- Permission complexity is removed from a user-owned local integration.

### Negative

- MCP server processes are trusted with the Host user's OS permissions.
- Desktop and independently running CLI Hosts do not share MCP processes.
- Gateway discovery adds one model-facing indirection compared with direct
  tools.
- Stateful MCP servers remain alive for the lifetime of the Host and require
  correct shutdown behavior.
- Hard cleanup after an uncatchable Host crash requires a future OS-level
  supervisor.

## Migration plan

1. Add this ADR and update the MCP sections of `AGENTS.md`,
   `docs/architecture.md`, `docs/guides/permissions.md`, ADR 0014, and
   ADR 0019 after the proposal is accepted. The docs state explicitly that
   MCP has no permission layer and that legacy MCP rules in
   `permissions.json` are silently ignored (no migration, no upgrade).
2. Replace the two MCP lifecycle maps with one Host-scoped `ProcessSlot` map.
3. Make the transport return an owned process handle at spawn time.
4. Implement `McpSupervisor.applyConfig()` and make `mcp/save` call it after
   atomic persistence.
5. Remove generation-owned MCP transports; keep immutable generation data only
   for session exposure compatibility. HostRuntime generation release is now a
   lifecycle no-op.
6. Register the stable `mcp_gateway` by default, then add exact pinned direct
   tools from cached metadata only.
7. Remove MCP from the permission rule engine and introduce the explicit
   trusted Host-tool admission variant. Delete the `mcp` rule kind,
   MCP `PermissionSubject`, MCP rows in permission modes, and the
   `mcp:tool-call` policy path from contracts and the admission gate. The
   permission loader ignores legacy MCP rules without blocking or prompting.
8. Prefer the official SDK transport and keep any compatibility adapter below
   the owned-process boundary.
9. Add lifecycle, timeout, shutdown, config-reload, and no-orphan tests.
10. Run `pnpm typecheck` and the touched package tests; keep the ADR's
    acceptance status aligned with the implementation and verification notes.

## Acceptance criteria

The implementation satisfies the following criteria:

- one Host creates one MCP Supervisor;
- concurrent calls to one server create at most one child process;
- a connect timeout leaves no child or descendant process behind;
- shutdown during connect leaves no child or descendant process behind;
- config replacement drains and closes the old server;
- `dispose()` is idempotent and fully awaited;
- MCP calls never create permission requests;
- SDK and RPC use the same Host-owned MCP Supervisor;
- no session or UI component directly owns an MCP client;
- the process-leak regression test passes repeatedly.

## Verification notes

The implementation was verified on 2026-08-06 with:

- `pnpm typecheck` across all workspace projects;
- `@piwin/mcp` typecheck and 26 tests;
- `@piwin/host-runtime` typecheck and 875 tests;
- `@piwin/desktop` typecheck and 780 tests.
