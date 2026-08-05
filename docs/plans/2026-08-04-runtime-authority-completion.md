# Runtime Authority Completion Plan

| Field | Value |
|---|---|
| Status | Ready for sequential implementation |
| Date | 2026-08-04 |
| Classification | Architecture-critical completion plan |
| Governing design | [`runtime-refactor.md`](../specs/runtime-refactor.md), [ADR 0030](../adr/0030-safe-parallel-subagent-execution.md) |
| Canonical backlog | [`todo-deferred.md`](../todo-deferred.md) |
| Scope | `contracts`, `process`, `host-runtime`, `agent-host`, `session`, `git`, CLI, Desktop |

## 1. Review conclusion

The repository now contains many correct component-level building blocks:

- `JobController`, bounded/redacted Job logs, process-group termination, and
  Run-to-Job cleanup hooks;
- `RunRegistry`, cancellation admission closure, join-aware terminalization,
  and a foreground Run projection;
- `BackendSessionBlueprint`, `BackendPreparedPrompt`, `HostToolExecutionPort`,
  worker JSONL framing, narrow worker environment, descriptor-aware proxy
  tools, and worker session ID aliases;
- `SubagentOrchestrator.startBatch()`, scheduler, worktree leases, exact-base
  three-way integration, conflict retention, and isolated `WorkerTaskRunner`;
- a package-boundary guard and `@piwin/host-runtime` composition-root package.

Those pieces do **not** yet form an executable vertical slice. The production
host still has three blocking composition gaps:

1. `HostRuntime` constructs both the legacy `ProcessRegistry` and the new
   `JobController`; process lifecycle ownership is split.
2. The compiled Host tool manifest is generated from names rather than from
   concrete executors, while the intended parent-owned session tool modules are
   incomplete. A worker can be shown a descriptor that has no real parent
   executor.
3. `SubagentOrchestrator` is tested as a component but is not composed by
   `HostRuntime`; batch IPC deliberately returns a not-ready response.

This plan completes those three gaps in dependency order. It deliberately does
not enable a capability merely because a standalone class exists.

## 2. Non-negotiable invariants

Every task in this plan preserves these invariants:

1. `@piwin/host-runtime` is the only product composition root.
2. `@piwin/agent-host` remains Pi/backend-only and imports no application
   package.
3. `JobController` is the sole authority for non-interactive OS child
   processes. Worker processes remain internal `agent-host` processes, not
   Jobs.
4. `RunRegistry` is the only Run terminal authority. Cancellation requests
   abort work but never terminalize a Run before its owner has cleaned up.
5. The parent Host owns permissions, secrets, filesystem writes, process
   execution, MCP, browser, and every other side effect. Workers only request
   those effects through `HostToolExecutionPort`.
6. Host tool descriptors are compiled from concrete executors. Model-visible
   schemas are never guessed from tool names.
7. The parent validates `(sessionId, runtimeGenerationId, runId, toolName)` at
   the final execution boundary immediately before executing a side effect.
8. Parallel writes require a clean base and one worktree per child. Integration
   is serialized per parent repository; conflicts retain their worktree.
9. Batch start returns its stable `runId` immediately. Completion travels via
   `HostPush`, status, and join APIs rather than holding transport open.
10. No automatic retry, no stock-Pi-RPC fallback for isolated subagents, and
    no compatibility path after its explicit deletion gate.

## 3. Phase A - Complete the immutable session compilation prerequisite

### Goal

Make one Host-owned compiler produce the exact immutable runtime input used by
both SDK and worker backends. This precedes tool and subagent activation
because a mutable or guessed blueprint cannot be safely authorized later.

### Current blockers

- `blueprint-compiler.ts` contains production placeholder input revisions such
  as `'live'`.
- project trust is recorded as `trusted: true` after an assumed upstream
  validation rather than being passed from project authority.
- `SessionToolPolicy.hostTools` is currently produced from name-only helper
  descriptors, with generic descriptions and `{}` schemas.

### Files

- Modify: `packages/host-runtime/src/blueprint-compiler.ts`
- Modify: `packages/host-runtime/src/capabilities/tool-policy-resolver.ts`
- Add: `packages/host-runtime/src/session-blueprint-compiler.ts` if a focused
  replacement makes the ownership boundary clearer
- Modify: `packages/host-runtime/src/sessions/session-runtime-controller.ts`
- Modify: `packages/contracts/src/session-capability.ts` only if a contract
  lacks an explicit revision/trust input
- Tests: compiler, settings service, session runtime controller, descriptor
  parity tests

### Implementation steps

1. Define a Host-owned internal `SessionBlueprint` with the immutable values
   that are unsafe or unnecessary to serialize: resolved project trust,
   permission snapshot, concrete tool registrations, provider runtime input,
   and runtime generation identity.
2. Define one compiler input carrying actual settings/project/MCP/resource
   revisions and resolved trusted scope. Do not obtain trust by assuming a
   project scope is trusted.
3. Allocate `runtimeGenerationId` before compilation. Publish it as active
   only after backend session creation succeeds.
4. Generate `BackendSessionBlueprint` only from that internal immutable
   blueprint. It must retain the same session ID, generation ID, capability
   snapshot, model, and thinking level.
5. Replace name-derived Host tool descriptors with descriptors copied from
   actual `HostToolDefinition` registrations assembled in Phase B. Until a
   family has an executor, omit it from the compiled manifest.
6. Preserve the current RPC secret policy: `apiKeyEnv` is an environment-name
   reference; `apiKeyRef` is rejected for RPC until a separate secure channel
   exists. Do not resolve keychain references merely to construct an error.

### Acceptance tests

- A JSON round trip preserves the backend blueprint without creating or
  dropping tool descriptors.
- SDK and worker receive byte-for-byte equivalent descriptor names,
  descriptions, and parameter schemas from one compiler result.
- A project lacking trust cannot compile project write/process capabilities.
- A failed backend creation leaves the new generation non-active.
- No production compiler input contains placeholder revision values.

### Phase A deletion gate

```bash
rg "settingsRevision: 'live'|projectRevision: 'live'|mcpRevision: 'live'|resourceCatalogRevision: 'live'" packages/host-runtime/src
rg "trusted: true" packages/host-runtime/src
rg "Host-owned tool:|parameters: \{\}" packages/host-runtime/src/capabilities
```

Expected: no production placeholder or generated model-visible descriptor
remains. A narrow test fixture is allowed only if its name communicates that
it is a fixture.

## 4. Phase B - Establish one Job authority

### Goal

Remove `ProcessRegistry` from production Host composition. Retain a temporary
`process/*` IPC adapter only if Desktop/CLI migration requires it, but map it
directly to the one `JobController`.

### Files

- Modify: `packages/host-runtime/src/host-runtime.ts`
- Modify: `packages/host-runtime/src/commands/host-command-context.ts`
- Modify: `packages/host-runtime/src/commands/process-commands.ts`
- Modify: `packages/host-runtime/src/process-tools.ts`
- Modify: `packages/host-runtime/src/job-process-adapter.ts`
- Modify: `packages/host-runtime/src/commands/session-live-commands.ts`
- Modify: `packages/host-runtime/src/commands/session-product-commands.ts`
- Modify: `packages/contracts/src/host.ts`, `packages/contracts/src/ipc.ts`,
  `packages/contracts/src/process.ts`
- Modify: Desktop managed-process hooks, host bootstrap, mock transport, and
  process-facing UI labels
- Modify: CLI process/job commands
- Delete: legacy HostRuntime `ProcessRegistry` construction and process-event
  bridge after all callers migrate

### Implementation steps

1. Remove `createProcessRegistry()` and `processRegistry` from `HostRuntime`.
   Construct exactly one `JobController`.
2. Add `getJobController()` to command context. Rewrite `process/*` command
   handlers as a temporary Job-backed adapter:
   - process start -> `JobController.start()`;
   - list/get -> Job records;
   - logs -> cursor-based Job logs;
   - stop -> `JobController.stop()`.
3. Rewrite `process_start/list/logs/stop` model tools to call the same Job
   controller. Map any legacy display record only at a product compatibility
   edge, never in a second lifecycle registry.
4. Move all product transport to `JobHostPush` sibling variants. Desktop and
   CLI must consume `job/started`, `job/updated`, `job/ready`, `job/log`, and
   `job/exited` directly. Do not manufacture `AgentEvent.process/*` events.
5. Wire every lifetime:
   - Run terminal -> `stopByRun` before Run terminalization;
   - session abort/archive/delete/dispose -> `stopBySession`;
   - project close/switch -> `stopByProject`;
   - host disposal -> `JobController.dispose()`.
6. A cleanup with failed Job IDs changes the owning Run outcome/code to
   `failed` / `job-cleanup-failed`; it must not publish a successful terminal
   event.
7. Make `job/wait` cancellation-aware and remove timed-out/aborted wait
   resolvers from `JobRegistry`.
8. Add durable record/log retention and host-start reconciliation before
   declaring Phase B complete: previously active persisted records become
   `interrupted` with `host-restarted`; there is no PID reattachment.
9. Delete Node piped-shell preview (`PtyHost`, `pty/*` Node transport,
   `shellPreview`) rather than treating it as another unmanaged child-process
   authority. Tauri remains the interactive-terminal implementation.

### Acceptance tests

- `process/start` and `process_*` tools create the same Job model.
- completed, failed, cancelled, and host-shutdown Runs stop run-lifetime Jobs.
- session archive/delete/dispose and project close stop their Jobs.
- stop failure remains observable and cannot result in a success Run terminal.
- Desktop real transport and mock transport show the same Job lifecycle.
- cursor pagination survives bounded-tail eviction and redacts secrets.
- restart reconciliation marks old active Jobs interrupted.

### Phase B deletion gate

```bash
rg "createProcessRegistry|ProcessRegistry|processRegistry" packages/host-runtime apps
rg "type: 'process/(started|updated|exited|log)'" packages apps
rg "ManagedProcessLogsQuery.*offset|\.offset" packages/host-runtime apps
rg "PtyHost|shellPreview: true" packages/host-runtime apps
```

Expected: no production match. Compatibility response types may remain only
until all released clients use Job IPC, then are deleted in Phase D.

## 5. Phase C - Build the parent-owned session tool authority

### Goal

Create the actual parent execution boundary consumed by both SDK and worker
backends. A descriptor must be executable by exactly one registered parent
tool, or it must not appear in the blueprint.

### Files

- Add: `packages/host-runtime/src/tools/build-session-host-tools.ts`
- Add: `packages/host-runtime/src/tools/session-host-tool-port.ts`
- Modify: `packages/host-runtime/src/host-runtime.ts`
- Modify: `packages/host-runtime/src/product-agent-host.ts`
- Modify: `packages/host-runtime/src/blueprint-compiler.ts`
- Modify: `packages/host-runtime/src/tools/host-tool-execution-router.ts`
- Modify: `packages/agent-host/src/rpc/worker-proxy-tool-factory.ts`
- Modify: `packages/agent-host/src/rpc/worker-session-runtime.ts`
- Modify: `packages/agent-host/src/backends/worker-rpc-session-backend.ts`
- Tests: session tool port, SDK/worker conformance, worker opaque tool-call ID,
  stale generation, permission/cancellation tests

### Concrete design

`buildSessionHostTools()` returns actual `HostToolDefinition[]` for one frozen
session blueprint. It composes existing product builders rather than
re-implementing policy:

- web tools through `buildSessionTools()`;
- `process_*` through the Job-backed `buildProcessTools()`;
- browser tools through `createBrowserToolDefinitions()`;
- MCP through the existing gateway/direct bridge;
- notes and flashcards through their existing tool builders;
- parent-owned filesystem and bash tools through existing permission gates.

The compiler derives `hostTools` descriptors directly from this array, after
trust/profile/ceiling filtering.

`SessionHostToolExecutionPort` owns a map keyed by:

```text
(sessionId, runtimeGenerationId)
```

Its `execute()` method must, in one authority operation:

1. reject an aborted signal;
2. reject unknown session or stale generation;
3. reject a tool absent from the immutable session descriptor set;
4. reject a Run that is no longer admitted/active when appropriate;
5. select the matching concrete executor;
6. execute it with the original AbortSignal;
7. return only stable `HostToolExecutionResult` values.

### Worker corrections included in this phase

1. Bind `productSessionId` when constructing worker proxy tools. Never parse
   a product session ID from a Pi-generated opaque tool-call ID.
2. Keep the Pi tool-call ID as diagnostics/correlation only. The worker creates
   its own parent request ID for JSONL `tool-call` frames.
3. During RPC worker spawn, inject only explicitly required `apiKeyEnv`
   variable values into the narrow worker environment. Never inherit all host
   environment variables and never put secret values into `session/create`
   JSONL payloads.
4. Register a generation before backend session creation is exposed; unregister
   it before dropping/disposal. Late worker calls must fail at the parent port.

### Acceptance tests

- opaque Pi ID `call_opaque_123` still sends the real product session ID to
  the parent proxy;
- unknown, stale-generation, and descriptor-missing tool calls are rejected;
- a permitted web/process/browser tool executes in the parent with its original
  AbortSignal;
- write/bash policy is rechecked in parent and never runs in worker directly;
- SDK and worker use exactly the same descriptor set;
- RPC worker has a required allowlisted provider environment variable but no
  unrelated host secret;
- `host/status.customTools` is true only after this port is composed.

### Phase C deletion gate

```bash
rg "createNotReadyHostToolExecutionPort|Host-owned tool:" packages apps
rg "extractSessionIdFromToolCallId" packages/agent-host
rg "env: \{ \.\.\.process\.env" packages/agent-host packages/host-runtime
```

Expected: no not-ready port, guessed descriptor, session-ID-from-tool-call-ID,
or broad environment forwarding remains in production.

## 6. Phase D - Compose and enable the production orchestrator

### Goal

Make `HostRuntime` construct exactly one production `SubagentOrchestrator`.
All batch surfaces use it, and it receives real immutable task inputs rather
than placeholders.

### Files

- Modify: `packages/host-runtime/src/host-runtime.ts`
- Modify: `packages/host-runtime/src/subagent-orchestrator.ts`
- Modify: `packages/host-runtime/src/subagent-workspace-service.ts`
- Modify: `packages/host-runtime/src/subagent-integration-coordinator.ts`
- Modify: `packages/host-runtime/src/runtime-resource-coordinator.ts`
- Add: `packages/host-runtime/src/commands/subagent-commands.ts`
- Modify: `packages/host-runtime/src/commands/host-command-context.ts`
- Modify: `packages/host-runtime/src/commands/plan-commands.ts`
- Modify: `packages/host-runtime/src/subagent-run-tool.ts`
- Modify: `packages/agent-host/src/agent-worker-supervisor.ts`
- Modify: `packages/agent-host/src/worker-task-runner.ts`
- Modify: contracts/CLI/Desktop only where batch command response or push
  projection needs explicit typing

### Composition

`HostRuntime` creates exactly one set of production collaborators:

```text
SessionHostToolExecutionPort
  -> AgentWorkerSupervisor(onToolCall = parent port)
       -> WorkerTaskRunner
  -> RuntimeResourceCoordinator
  -> SubagentWorkspaceService
  -> SubagentIntegrationCoordinator
  -> SubagentOrchestrator(runRegistry, task runner, prepareTask, integration)
```

### Required implementation steps

1. Make `RunRegistry`, integration coordinator, and `prepareTask` mandatory in
   the production orchestrator; remove UUID, no-integration, and empty/fake
   blueprint fallbacks from production construction.
2. `prepareTask` compiles a child-specific immutable task package before
   scheduler admission:
   - child session ID;
   - real runtime generation ID;
   - exact backend blueprint;
   - provider envelope;
   - prepared prompt/images;
   - profile/model/thinking constraints;
   - workspace lease and allowed output paths.
3. Extend `WorkerTaskRunner` input so it receives the provider runtime envelope
   and passes it to worker session creation. `providers: []` is forbidden for a
   provider-backed task.
4. Bind supervisor tool calls to the parent session tool port and forward
   normalized worker events into the owning task Run.
5. Implement `subagent/batch-start`, `subagent/batch-status`, and
   `subagent/batch-cancel` in a focused command module. Start returns stable
   `{ runId, acceptedAt }` immediately; status is a projection; cancel awaits
   owner cleanup before returning success.
6. Route Plan execution, `piwin_subagent_run`, Desktop controls, and CLI
   commands to the same orchestrator instance. Delete Plan's sequential
   subagent fallback after this routing is live.
7. A write task without a successful integration result cannot produce a
   completed batch. Conflict maps to product `needs-integration` and Run
   terminal `failed / integration-required`.
8. Set capability status `subagentWorktree: true` only when this exact
   composition is available and process isolation capability is reported.

### Acceptance tests

- batch start returns before an intentionally delayed task completes;
- all invocation surfaces hit the same orchestrator fixture;
- a non-isolated runner runs one task at a time;
- worker-backed runner receives providers, parent tool port, and child runtime
  blueprint;
- cancellation closes admission, aborts running worker/tool work, joins task
  Runs, then terminalizes batch Run;
- concurrent worktree tasks serialize integration and retain conflicts;
- dirty parent rejects parallel writes;
- no late task result can overwrite cancellation;
- plan root Run cannot terminalize before batch/task descendants.

### Phase D deletion gate

```bash
rg "subagent orchestration is not ready|createTaskBackendSessionBlueprint|runtimeGenerationId: 'unknown'|providers: \[\]" packages apps
rg "Legacy sequential path|spawnPlanSubagent|mergePlanSubagent" packages/host-runtime/src
rg "new SubagentOrchestrator" packages apps
```

Expected: no not-ready/fake task path, no legacy sequential Plan path, and
exactly one production `new SubagentOrchestrator(...)` in `host-runtime`.

## 7. Phase E - Runtime replacement and final compatibility deletion

### Goal

Complete generation replacement after all execution surfaces, including Plan
and subagent work, are represented in the same Run tree.

### Implementation steps

1. Implement the replacement transaction in `SessionRuntimeController`:
   compile new immutable blueprint -> rebuilding -> close admission -> cancel
   and join prior generation Runs -> settle permission/UI -> dispose old backend
   -> create new backend -> atomically publish active -> drop late events.
2. Keep `session/reload-runtime` disabled until the Phase D full Run-tree test
   passes; then enable `now` and `after-current-run` forms.
3. Delete transitional foreground projection machinery once its useful
   test coverage is moved into RunRegistry/session command tests.
4. Delete compatibility Process IPC/types only after Desktop and CLI use Job
   commands and Job pushes exclusively.
5. Remove stock-RPC fallback selectors from product paths. RPC subagent mode
   means piwin-owned isolated worker, never stock Pi RPC or in-process fallback.

### Final deletion gates

```bash
pnpm test:architecture
rg "ActiveRunRegistry|createActiveRunRegistry|terminalRunIdsBySession" packages apps
rg "createProcessRegistry|ProcessRegistry|ManagedProcessRecord|ManagedProcessStartInput" packages apps
rg "useSdkFallback|PIWIN_RPC_STOCK|rpc-fallback" packages apps
rg "createNotReadyHostToolExecutionPort|subagent orchestration is not ready" packages apps
```

Each command must be zero production matches or have an explicit, tested
persisted-data migration allowlist in `scripts/check-package-boundaries.mjs`.

## 8. Verification matrix

Run after each phase, not only at the end:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/process typecheck
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/agent-host typecheck
pnpm test:architecture
```

Final verification:

```bash
pnpm typecheck
pnpm --workspace-concurrency=1 -r run test
pnpm e2e:host-jsonl
pnpm bundle:host
pnpm test:bundle
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/cli test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Manual smoke cases:

1. Start/stop a service from Desktop and CLI; confirm the same Job record,
   cursor log stream, and host/session cleanup.
2. Execute one SDK and one worker-backed allowed tool; verify same schema,
   permission behavior, cancellation, and stale-generation rejection.
3. Start a batch with readonly and worktree tasks; cancel while one tool and
   one integration are active; verify no early terminal event and no orphan.
4. Create a write conflict; verify retained worktree and
   `integration-required` terminal code.
5. Reload a runtime during active work; verify old generation cannot execute a
   delayed tool call or publish a late event.

## 9. Out of scope

- automatic Git conflict resolution or retry;
- a generic workflow engine;
- an additional Node product-host process;
- a worker pool or cross-session worker reuse;
- a dirty-base snapshot system;
- remote/HTTP transport for the Product Host;
- OS sandbox claims beyond the existing permission approval model.
