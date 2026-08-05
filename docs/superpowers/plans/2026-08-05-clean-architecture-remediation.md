# Clean Architecture Authority Remediation Plan

> This is the single repair plan for the remaining Runtime Authority Cutover
> work. It replaces the execution scope in
> `2026-08-05-runtime-authority-gap-closure.md` because a subsequent branch
> review found authority bypasses that the earlier plan did not cover.

| Field | Value |
|---|---|
| Status | Unit A complete; Unit B complete |
| Date | 2026-08-05 |
| Classification | Architecture-critical, sequential migration |
| Implements | `2026-08-04-runtime-authority-cutover.md`, ADR 0030, Runtime Refactor Phases 1-3 |
| Supersedes | `2026-08-05-runtime-authority-gap-closure.md` for all remaining authority-cutover work |
| Primary packages | `contracts`, `host-runtime`, `agent-host`, `process`, `session`, `desktop`, `cli`, docs, scripts |
| Non-goals | New Product Host service, remote gateway, job daemon, worker pool, automatic Git recovery, automatic retry |

## 1. Purpose and review baseline

The current worktree contains valuable partial migrations, but it does not yet
have a clean authority model. The principal problem is not missing types; it
is that old and new lifecycle paths both remain executable.

The repair must restore these invariants before new product work continues:

| Concern | Required single authority |
|---|---|
| Product composition | One `HostRuntime` in the existing Tauri-supervised Node sidecar |
| Runtime generation | `SessionRuntimeController` |
| Run admission, cancellation, join, and terminal state | `RunRegistry` |
| OS child-process lifecycle | One `JobController` per Product Host |
| Subagent batch scheduling | One `SubagentOrchestrator` |
| Worktree integration | One `SubagentIntegrationCoordinator` |
| Worker process lifecycle | One `AgentWorkerSupervisor` |

The reviewed branch already has some correct foundations:

- contracts for `BackendSessionBlueprint`, `BackendPreparedPrompt`, and the
  in-process host tool execution port;
- `@piwin/host-runtime` as the intended product composition root;
- no app import of Pi packages or `@piwin/agent-host`;
- direct `job/*` IPC and top-level `JobHostPush` contracts;
- a `RunRegistry` with useful SC-08 and SC-09 primitives;
- a work-conserving modern subagent scheduler and a single production
  `SubagentOrchestrator` construction;
- descriptor-based worker proxy tool schemas in the active path.

It also has these blockers, which define this plan's scope:

1. `session/reload-runtime` is production-enabled but only detaches a
   generation; it neither disposes nor recreates a backend.
2. `ActiveRunRegistry` and `terminalRunIdsBySession` still own foreground
   lifecycle decisions beside `RunRegistry`.
3. Desktop still invokes direct `session/spawn` and direct worktree merge,
   bypassing the orchestrator and serialized three-way integration.
4. `plan/execute` does not create a `plan-execution` Run or parent its work.
5. the foreground RPC backend owns a shared multi-session worker client while
   subagents use `AgentWorkerSupervisor`; the worker entry is not packaged.
6. worker frames lack real generation and Run identity.
7. standalone CLI Job commands create a second HostRuntime and cannot safely
   inspect, read logs from, or stop Desktop-sidecar Jobs.
8. Job configuration and model-tool `ownerRunId` are not wired to the
   JobController.
9. Blueprint compilation still contains placeholder manifests/revisions and
   lacks a distinct host-owned internal `SessionBlueprint`.

## 2. Locked architectural decisions

### R1. Do not preserve a second live path for compatibility

When a new authority is ready, delete the old executable path in the same
unit. Historical records may be migrated or rendered read-only, but there is
no forwarding handler that keeps old lifecycle commands alive.

In particular, this applies to:

- `ActiveRunRegistry` and `terminalRunIdsBySession`;
- `session/spawn`, `session/complete-subagent`, and
  `session/merge-subagent` as live subagent execution paths;
- `process/*` IPC and `ManagedProcess*` response projections;
- `WorkerRpcSessionBackend` shared-client ownership and the legacy worker
  `session/create` frame;
- `run/phase` and `run/terminal` `AgentEvent` variants.

### R2. Dirty-base parallel writes ask the user; they do not silently refuse or proceed

This records the product decision made during review and supersedes the
hard-reject subsection of ADR 0030 through a new ADR 0031.

The final behavior is:

1. A clean base proceeds normally.
2. A dirty base for a write-capable parallel task raises the existing Host ask
   flow with action `subagent:dirty-base` before a worktree lease is acquired.
3. Desktop and CLI present three explicit choices:
   - **Continue anyway** resolves the ask as a one-run `allow`; it is visible
     in the Run diagnostic/audit trail and is never silently remembered.
   - **Commit or stash first** resolves as `deny`, preserves the current tree,
     and gives the user the required next action. The Host never commits or
     stashes automatically.
   - **Cancel** resolves as `deny` and terminates the pending batch cleanly.
4. The safe persisted default is `ask`.

Do not reuse the generic `PermissionMode` values as a new settings schema:
`auto` and `ask-all` do not state an unambiguous dirty-base policy. Define
one explicit domain value:

```ts
type DirtyBaseParallelWritePolicy = 'ask' | 'bypass';
```

`bypass` is an explicitly configured advanced mode; it is never inferred from
the old boolean. Persisted `requireCleanBaseForParallelWrites: true` and
`false` both migrate to `ask`, because neither legacy value proves that the
user consented to an unconditional bypass. Delete the old boolean and all UI
toggle controls after migration tests pass.

The existing permission request/resolve transport is reused. The
commit-or-stash choice is a denial plus a product-local explanatory result; it
does not require a new global permission decision enum.

### R3. No cross-Host Job management through standalone CLI commands

The current architecture deliberately has no Product Host daemon, socket, or
remote gateway. A new one-shot `HostRuntime` cannot truthfully control Jobs
owned by the Desktop sidecar. It must not reopen the durable Job store and
terminalize another Host's live records during inspection.

Therefore the repair retires standalone `piwin process list|logs|stop` as a
cross-Host control surface. `job/*` remains a HostCommand surface for attached
clients of the same Product Host, including Desktop and long-lived CLI
sessions. CLI help must state that Job inspection/control is Host-local; do
not add a daemon or transport solely to preserve the one-shot commands.

### R4. Model tool names may remain `process_*`; their data model is Job

Model-facing tool names are product vocabulary and may remain
`process_start`, `process_list`, `process_logs`, and `process_stop`. Their
inputs and outputs use `JobRecord`, `jobId`, and `JobLogChunk`; they call only
`JobController`. Delete `ManagedProcess*` contracts and
`job-process-adapter.ts` after the tool schema migration.

### R5. SessionBlueprint ownership is explicit

`host-runtime` owns a non-serializable internal `SessionBlueprint` containing
the exact product decision set, real manifests/revisions, Host registrations,
and resolved permission state. It projects exactly one JSON-safe
`BackendSessionBlueprint` from contracts for `agent-host`.

`agent-host` owns only a worker-protocol encoding of the contracts projection;
it never defines the host's internal Blueprint type or compiles capability
policy from filesystem/settings state.

### R6. Runtime reload remains unavailable until the full Run tree is real

Until Units B through F pass, `session/reload-runtime` returns the stable error
`runtime-reload-not-ready`. Desktop and CLI show that full application of
runtime-bound settings requires a new session. There is no detach-only mode,
no lazy generation mutation, and no hidden auto-reload.

The replacement transaction is implemented and tested before exposure, but is
only enabled after Plans, model tools, Desktop, and CLI subagent operations are
all descendants of the same `RunRegistry` tree and worker conformance passes.

### R7. Agent resources remain where they are

Decision B2 remains in force. Do not create `@piwin/agent-resources` during
this repair. Pure Skills discovery stays in `@piwin/skills`; the current
host-runtime inventory/resolver code remains there until a real second consumer
justifies extraction.

## 3. Execution discipline

1. Implement one unit at a time, with its tests and deletion gate before the
   next unit begins.
2. Do not fix unrelated UX, provider, or tool behavior while moving an
   authority.
3. Every cross-package change starts in `@piwin/contracts`.
4. All new backend/worker frames are JSON-safe. The host execution port and
   internal Blueprint never cross a JSON wire.
5. If a unit reveals a need for another Product Host transport or daemon,
   stop. That is out of scope and needs a separate ADR.
6. Preserve unintegrated worktrees on every failure/conflict. Cleanup must
   never discard work that is not integrated.
7. Fix the known workspace typecheck failure before claiming any later gate:
   `packages/agent-host/src/backends/pi-session-backend.test.ts` supplies
   `subagentCeiling: undefined` under `exactOptionalPropertyTypes`; omit the
   optional property instead.

## 4. Ordered repair units

| Unit | Name | Original plan coverage | Exit gate |
|---|---|---|---|
| A | Freeze unsafe surfaces and correct governing documents | Task 0 / Task 4 prerequisite | no fake reload or unsafe Desktop write path remains executable |
| B | Finish Job authority and remove process compatibility | Task 5 | one Host-local Job authority; no legacy process contracts/IPC |
| C | Make RunRegistry the foreground authority | Task 6 | no ActiveRunRegistry or legacy AgentEvent Run lifecycle |
| D | Build exact Blueprint and internal replacement engine | Task 4 prerequisite / Task 7 | engine passes ordering tests; public reload remains disabled |
| E | Complete Plan and subagent orchestration | Task 8 | every invocation is a single Run tree; dirty-base ask and limits enforced |
| F | Unify worker lifecycle and packaging | Task 9 | supervisor is sole worker authority; real worker conformance passes |
| G | Enable reload and perform final truth pass | Task 8 enablement / Task 10 | all source gates, docs, and workspace verification are green |

No unit may be split into parallel branches if it changes `HostCommand`,
`HostPush`, `RunRegistry`, worker frames, or `HostRuntime` composition.

---

## Unit A: Freeze unsafe surfaces and align the truth documents

**Goal:** stop the current branch from claiming safe behavior while old paths
remain callable. This is a safety correction, not an implementation of the
final architecture.

### A1. Disable fake runtime reload

**Files:**

- `packages/host-runtime/src/commands/session-live-commands.ts`
- `packages/host-runtime/src/commands/session-live-commands.test.ts`
- `apps/desktop/src/settings/pages/session-runtime-page.tsx`
- CLI runtime-status/reload callers, if any

**Steps:**

- Replace the current detach-only handler with
  `fail(requestId, 'session/reload-runtime', 'runtime-reload-not-ready')`.
- Do not read `when` or attempt a revision check in the disabled path; the
  response must be deterministic while the engine is unavailable.
- Disable both Desktop actions, replace success copy with an honest explanation
  that a new session is currently required, and remove the empty
  `expectedSettingsRevision: ''` request.
- Preserve `session/runtime-status` as observational data only.
- Delete tests that assert lazy reload; replace them with the stable disabled
  response test.

### A2. Remove the unsafe Desktop legacy write-subagent path

**Files:**

- `apps/desktop/src/SubAgentPanel.tsx`
- Desktop wiring that provides its request callback
- `packages/host-runtime/src/commands/session-live-commands.ts`
- `packages/host-runtime/src/commands/session-live-commands.test.ts`

**Steps:**

- Retain historical child-session viewing only if it is read-only and does not
  execute/merge/cancel work.
- Remove the Desktop controls that send `session/spawn`,
  `session/cancel-subagent`, `session/complete-subagent`, or
  `session/merge-subagent`.
- Remove the host handlers and direct `createWorktree` / `applyWorktreeToMain`
  execution path in the same review unit. Do not leave a hidden compatibility
  handler for old Desktop clients.
- Unit E adds the replacement Desktop batch controls after the orchestrator
  has the required API. Temporary unavailability is safer than a second write
  authority.

### A3. Record the dirty-base decision without rewriting history

**Files:**

- Add `docs/adr/0031-dirty-base-parallel-write-consent.md`
- `docs/adr/0030-safe-parallel-subagent-execution.md`
- `docs/specs/runtime-refactor.md`
- `docs/specs/settings-capability-runtime-refactor.md`
- `docs/superpowers/plans/2026-08-04-runtime-authority-cutover.md`
- `docs/superpowers/plans/2026-08-05-runtime-authority-gap-closure.md`

**Steps:**

- ADR 0031 supersedes only ADR 0030's hard-reject dirty-base paragraph.
- Link ADR 0031 from ADR 0030 rather than silently editing historical intent.
- Record the `ask` default, one-run explicit continue, prepare-base/cancel
  denial behavior, schema migration, and removal of the boolean UI toggle.
- Mark the earlier gap-closure plan superseded by this plan. Update the
  original cutover plan's status from a task readiness claim to a historical
  baseline; it remains the authoritative original delivery map.
- Keep Decision B2 recorded: no speculative `agent-resources` package.

### A4. Establish an honest baseline

**Steps:**

- Fix the known `subagentCeiling: undefined` test fixture error first.
- Record the exact output of `pnpm typecheck`, package tests, architecture
  guard, host JSONL E2E, bundle test, and Cargo test before progressing.
- Add no broad test suppression, `as never`, `any`, or ignored failure.

### Unit A exit gate

```bash
rg "detachGeneration\(|clearSessionToolPort" \
  packages/host-runtime/src/commands/session-live-commands.ts
rg "session/(spawn|cancel-subagent|complete-subagent|merge-subagent)" \
  apps/desktop/src packages/host-runtime/src/commands
rg "applyWorktreeToMain|git checkout.*--" packages/host-runtime/src apps/desktop/src
pnpm typecheck
```

Expected:

- no production fake reload mutation;
- no live Desktop legacy subagent lifecycle command;
- no direct legacy worktree apply path;
- workspace typecheck is green.

---

## Unit B: Finish Job authority and remove process compatibility

**Goal:** complete Runtime Refactor Phase 1 with a single Host-local
`JobController`, truthful lifetime ownership, and no `ManagedProcess*`
compatibility model.

### B1. Make Job policy a HostRuntime-composed setting

**Files:**

- `packages/contracts/src/config.ts`
- `packages/host-runtime/src/settings/settings-service.ts`
- `packages/host-runtime/src/host-runtime.ts`
- `packages/process/src/job-registry.ts`
- Job policy/controller tests

**Steps:**

- Define a `JobPolicy` derived from the Settings snapshot, including capacity,
  default limits, and Host/session cleanup behavior.
- Load/refresh policy through the long-lived Settings authority; do not let a
  process tool read config or create another registry.
- Make Jobs respect the configured admission limit. A setting application that
  tightens admission takes effect immediately for new Jobs; it does not kill
  existing Jobs unless an explicit lifecycle rule requires it.
- Remove obsolete `ProcessConfig` fields only after their semantics are mapped
  or consciously retired with persisted-data migration.

### B2. Bind model Jobs to the real Run

**Files:**

- `packages/contracts/src/host-tool.ts`
- `packages/host-runtime/src/tools/session-host-tool-port.ts`
- `packages/host-runtime/src/process-tools.ts`
- `packages/contracts/src/job.ts`
- `packages/host-runtime/src/host-runtime.ts`

**Steps:**

- Propagate `HostToolExecutionInput.runId` to `process_start`.
- For a tool-started command whose intended lifetime is the current turn, set
  `ownerRunId` and `lifetime: 'run'`.
- Ensure Run terminalization joins the provider/tool work and calls
  `stopByRun(runId, reason)` before the Run becomes terminal.
- Return `JobRecord` and `jobId` from all model `process_*` tools. The tool
  names may remain product-friendly; no adapter translates to
  `ManagedProcessRecord`.

### B3. Make CLI Job behavior honest

**Files:**

- `apps/cli/src/index.ts`
- CLI command tests and help text
- relevant docs

**Steps:**

- Remove standalone `piwin process list|logs|stop` commands that instantiate
  a new Product Host and inspect another Host's durable record store.
- Keep `job/*` as the same-Host JSONL command surface. Any future attached
  long-lived CLI client uses that surface through its owning HostRuntime.
- Do not introduce a socket, remote gateway, daemon, or process-global
  registry as a workaround.

### B4. Complete cleanup and persistence semantics

**Files:**

- `packages/process/src/job-registry.ts`
- `packages/process/src/job-record-store.ts`
- `packages/host-runtime/src/host-runtime.ts`
- session/project lifecycle commands and tests

**Steps:**

- Make `stopByRun`, `stopBySession`, `stopByProject`, and Host disposal report
  only Jobs owned by the requested scope.
- Define how session/project cleanup errors reach a user-visible boundary; do
  not log-and-succeed on a lifecycle transition that promised cleanup.
- Wire `stopByProject` to the real project-close boundary, or remove the
  unsupported project-lifetime option from the public contract.
- Fix record-store disposal so the final terminal transition is flushed before
  the store becomes unavailable.
- Keep restart reconciliation explicit: a new Host must never attempt to
  control an OS child that belongs to a different, unavailable Host.

### B5. Delete the old process model

**Files:**

- delete `packages/host-runtime/src/job-process-adapter.ts`
- `packages/contracts/src/process.ts`
- `packages/contracts/src/index.ts`
- `packages/host-runtime/src/process-tools.ts`
- `apps/desktop/src/hooks/use-managed-processes.ts`
- `apps/desktop/src/host-client-mock.ts`

**Steps:**

- Delete all `ManagedProcess*` contracts and response projections.
- Rename desktop state/helpers to `jobs`, `jobLogsById`, `refreshJobs`, and
  `appendJobLog`; do not preserve misleading process-model names.
- Complete mock support for `job/start`, `job/list`, `job/get`, `job/logs`,
  `job/wait`, and `job/stop`, including `JobHostPush` emissions.
- Keep Tauri Rust PTY intact. Scope the deletion check to TypeScript/Node
  piped-shell code; do not match the intentionally retained Tauri PTY.

### Tests required before B completion

- model `process_start` produces a run-owned Job and stops it for completed,
  failed, cancelled, and interrupted Runs;
- session/project/Host cleanup reporting and cleanup failure behavior;
- Job record final flush and restart reconciliation;
- Desktop same-Host list/read/stop using `job/*` and top-level Job pushes;
- CLI does not create an independent runtime solely for Job management.

### Unit B deletion gate

```bash
rg "createProcessRegistry|ProcessRegistry|ManagedProcessRecord|ManagedProcessStartInput" \
  packages apps --glob '*.{ts,tsx}'
rg "type: 'process/(started|updated|exited|log)'" packages apps --glob '*.{ts,tsx}'
rg "type: 'process/(list|get|start|logs|stop)'" packages apps --glob '*.{ts,tsx}'
rg "applyProcessLogQueryWindow|mapJobRecordToProcessRecord" packages apps --glob '*.{ts,tsx}'
```

Expected: zero matches in production source. `process_*` Host tool names are
allowed; legacy process contracts and IPC are not.

---

## Unit C: Make RunRegistry the foreground authority

**Goal:** complete Runtime Refactor Phase 2's foreground cutover. A Run record
is the single source for foreground admission, phase, cancellation, join, and
terminal state.

### C1. Promote Run state into the contract and push surface

**Files:**

- `packages/contracts/src/run.ts`
- `packages/contracts/src/host.ts`
- `packages/contracts/src/ipc.ts`
- `packages/host-runtime/src/run-registry.ts`

**Steps:**

- Add a normalized Run phase to `ExecutionRunRecord`, or add a separate
  RunRegistry-owned phase projection that is emitted as `RunHostPush`. Do not
  put phase truth back into `AgentEvent`.
- Make `RunRegistry` callbacks emit top-level `run/updated` and
  `run/terminal` pushes from the one Product Host boundary.
- Remove `run/phase` and `run/terminal` from `AgentEvent` only after Desktop
  and CLI consume top-level Run pushes.
- Store `runtimeGenerationId` on every foreground `session-turn` Run.

### C2. Add authoritative foreground admission and provider settlement

**Files:**

- `packages/host-runtime/src/run-registry.ts`
- `packages/host-runtime/src/commands/session-live-commands.ts`
- `packages/host-runtime/src/host-runtime.ts`
- session backend handle abstractions as required

**Steps:**

- Add a RunRegistry-backed foreground index keyed by session ID; it contains
  only nonterminal `session-turn` Runs and is updated by Run transitions.
- Register every provider prompt promise with its Run. `join(runId)` must wait
  for provider settlement, descendant joins, permission/extension UI
  settlement, and run-owned Job cleanup.
- For a superseding prompt: close prior admission, request cancellation,
  `await runRegistry.join(priorRunId)`, then create/start the replacement Run.
  Never overlap two provider prompts for one session.
- Preserve SC-08: cancellation is `cancelling`, not terminal, until all owned
  work has settled.
- Preserve SC-09: the parent cannot emit terminal state until all descendants
  are terminal and required integration cleanup is complete.

### C3. Remove competing foreground state

**Files:**

- delete `packages/host-runtime/src/active-run.ts` and tests
- `packages/host-runtime/src/run-event-correlator.ts`
- `packages/host-runtime/src/host-runtime.ts`
- `packages/host-runtime/src/index.ts`

**Steps:**

- Delete `ActiveRunRegistry`, `createActiveRunRegistry`, its terminal bit, and
  `terminalRunIdsBySession`.
- Keep event correlation only as a projection of `RunRegistry` records. It may
  correlate message/tool events but cannot decide terminality or active-run
  ownership itself.
- Update generation and stale-event filtering to compare both session and
  `runtimeGenerationId`, not only a replaced Run ID.

### C4. Migrate Desktop and CLI

**Files:**

- `apps/desktop/src/hooks/use-host-bootstrap.ts`
- `apps/desktop/src/chat-reducer.ts`
- run-status UI/reducers/tests
- `apps/cli/src/index.ts`
- CLI host-stream formatting/tests

**Steps:**

- Desktop reduces top-level `run/updated` and `run/terminal` pushes.
- CLI tracks completion and status from those same pushes; it does not wait
  only for an event-wrapped legacy terminal.
- Remove old AgentEvent Run lifecycle rendering and worker crash emission.

### Tests required before C completion

- a second prompt cannot begin until the first provider promise settles;
- cancellation enters `cancelling`, closes admission, aborts leaf-first, and
  terminalizes only after all settlement;
- parent terminal push cannot occur before descendant task/integration joins;
- Desktop and CLI receive equivalent top-level Run lifecycle projections;
- late Run and late generation events cannot alter transcript, usage, hooks,
  or UI.

### Unit C deletion gate

```bash
rg "ActiveRunRegistry|createActiveRunRegistry|terminalRunIdsBySession" \
  packages apps --glob '*.{ts,tsx}'
rg "type: 'run/(phase|terminal)'" packages apps --glob '*.{ts,tsx}'
rg "buildRunPhaseEvent|buildRunTerminalEvent" packages apps --glob '*.{ts,tsx}'
```

Expected: no production matches.

---

## Unit D: Build exact Blueprint compilation and the internal replacement engine

**Goal:** make session creation/replacement real without exposing reload yet.
This completes the Settings prerequisite that every runtime is compiled from
exact product facts.

### D1. Separate internal and backend Blueprint representations

**Files:**

- `packages/host-runtime/src/blueprint-compiler.ts`
- add/split `packages/host-runtime/src/session-blueprint.ts`
- `packages/contracts/src/backend-session-blueprint.ts`
- `packages/agent-host/src/rpc/serializable-blueprint.ts`
- backend construction tests

**Steps:**

- Define the host-owned `SessionBlueprint`; it may contain Host tool
  registrations, resolved policy, and nonserializable execution references.
- Project exactly one `BackendSessionBlueprint` into contracts. The projection
  is losslessly JSON round-trippable and contains no raw secret.
- Treat `agent-host` `SerializableBlueprint` as a wire encoding only. It must
  not be the internal Blueprint type returned by the host compiler.
- Delete duplicate compiler logic and reject malformed backend projections
  before Pi/backend session creation.

### D2. Replace placeholder manifests and revisions

**Files:**

- capability/resource/context resolvers
- `packages/host-runtime/src/blueprint-compiler.ts`
- Settings/project/MCP services and tests

**Steps:**

- Compile actual ResourceManifest, ContextManifest, tool descriptors,
  Settings revision, project revision, MCP revision, and resource catalog
  revision from their owning services.
- Do not emit empty context lists, path-derived resource IDs, `'unknown'`,
  `'project-scope'`, `'mcp-static'`, or `'live'` as production identity
  placeholders.
- The compiler receives a trusted resolved scope; it does not infer trust.

### D3. Make initial generation publication atomic

**Files:**

- `packages/host-runtime/src/sessions/session-runtime-controller.ts`
- `packages/host-runtime/src/product-agent-host.ts`
- `packages/host-runtime/src/host-runtime.ts`

**Steps:**

- Add explicit candidate states: `compiling`, `creating-backend`, `rebuilding`,
  `active`, and `failed`.
- Allocate a candidate generation before compilation, but publish it as active
  only after backend creation and event subscription succeed.
- A failed backend creation records failure without a false active generation.
- Create backend handles through a narrow host-owned factory that can create,
  dispose, and subscribe one generation at a time.

### D4. Implement the replacement transaction behind an internal API

**Files:**

- `SessionRuntimeController`
- `HostRuntime` runtime factory and event boundary
- add `session-runtime-replacement.integration.test.ts`

**Required ordering:**

1. coalesce a compatible pending `after-current-run` request, otherwise reject
   a conflicting Settings revision;
2. compile a candidate Blueprint with a new generation ID;
3. publish `rebuilding`, without publishing it active;
4. close old-generation Run admission;
5. cancel and join all old-generation Runs, including descendant Plan and
   subagent Runs once Unit E has migrated them;
6. settle transcript/UI terminal projections and run-owned Jobs;
7. dispose the old backend handle/worker;
8. create the new backend from the candidate Blueprint;
9. atomically publish the candidate as active;
10. reject/drop every late old-generation event before transcript, usage,
    hooks, diagnostics, or UI state;
11. if creation fails, record `failed` without restoring a disposed old handle
    or inventing a live generation.

The internal API may be tested in this unit. The public command remains
disabled until Unit G.

### Tests required before D completion

- active generation never publishes before backend creation success;
- old Runs join before old backend disposal;
- old backend disposal happens before new backend creation;
- failed creation leaves an explicit failed state;
- late old-generation message, usage, hook, error, and tool events are all
  dropped;
- `after-current-run` executes once after the terminal join.

### Unit D gate

```bash
rg "settingsRevision: 'live'|projectRevision: 'live'|mcpRevision: 'live'|resourceCatalogRevision: 'live'" \
  packages --glob '*.{ts,tsx}'
rg "project-scope|mcp-static|capabilitySnapshotId = 'stale'" \
  packages/host-runtime/src --glob '*.{ts,tsx}'
rg "attachGeneration\(" packages/host-runtime/src/commands --glob '*.{ts,tsx}'
```

Expected: no production identity placeholders and no command handler directly
attaches or detaches a generation.

---

## Unit E: Complete Plan and subagent orchestration

**Goal:** complete ADR 0030 routing and create one complete Run tree before
public runtime replacement can be enabled.

### E1. Finalize the orchestrator API and persistence

**Files:**

- `packages/contracts/src/subagent-orchestration.ts`
- `packages/host-runtime/src/subagent-orchestrator.ts`
- add `packages/host-runtime/src/commands/subagent-commands.ts`
- run-store composition/tests

**Required API:**

```ts
startBatch(
  request: SubagentBatchRequest,
  parentRunId?: string,
): Promise<{ runId: string; acceptedAt: string }>;

getBatch(runId: string): Promise<SubagentBatchResult | undefined>;
cancelBatch(runId: string): Promise<void>;
joinBatch(runId: string): Promise<SubagentBatchResult>;
```

**Steps:**

- Acceptance validates, creates/starts the batch Run, and writes a durable
  accepted projection before returning.
- `RunRegistry` is required. Remove UUID/optional-registry fallbacks.
- Use RunRegistry cancellation signals only; remove the batch-specific
  AbortController as a competing cancellation source.
- Persist terminal batch projections so status/cancel works in the owning
  long-lived Host after the active in-memory batch has settled.
- Route `subagent/batch-start`, `subagent/batch-status`, and
  `subagent/batch-cancel` through one command module and one orchestrator.

### E2. Enforce capability, capacity, project, and integration invariants

**Files:**

- subagent config/contracts/migration
- `subagent-workspace-service.ts`
- scheduler/orchestrator/integration coordinator
- task runner preparation

**Steps:**

- Enforce hard `MAX_SUBAGENT_TASKS_PER_BATCH = 8` at Host admission.
  Settings may select a lower per-profile cap but can never raise it.
- Resolve requested concurrency from the selected profile/Settings, then clamp
  it to runner isolation and resource capacity. Return configured and effective
  values in the batch projection.
- Pass the parent session's resolved project/repository identity to workspace
  allocation; do not use the general workspace as a universal repo.
- Keep readonly tasks in the parent resolved cwd; write tasks receive one
  worktree under the actual parent repository.
- Implement R2's dirty-base ask before worktree allocation, then delete the
  boolean config, false branch, and checkbox UI.
- Integration failure or conflict must make the prerequisite unusable for
  dependents. Close downstream admission according to the batch failure policy
  and retain worktrees for inspection.
- `SubagentIntegrationPort` is mandatory; construct exactly one production
  coordinator. No direct checkout/apply fallback remains.

### E3. Preserve Run and worker identity end to end

**Files:**

- worker task runner and protocol contracts
- host tool execution bridge
- subagent task preparation

**Steps:**

- Allocate the child session before task Run creation; task Run uses that child
  session ID and the real parent batch Run ID.
- Carry the actual task `runId` and `runtimeGenerationId` through prompt,
  worker event, worker tool-call, permission, Job, and diagnostic paths.
- Do not use a transport correlation ID as a Run ID.
- Pass real typed backend Blueprint, capability snapshot, and prepared prompt;
  delete `undefined`, `unknown`, and empty placeholder fallback values.

### E4. Migrate every invocation surface

**Files:**

- `packages/host-runtime/src/commands/plan-commands.ts`
- `packages/host-runtime/src/subagent-run-tool.ts`
- Desktop SubAgentPanel replacement controls
- `apps/cli/src/index.ts`
- CLI command lane

**Steps:**

- `plan/execute` creates a `plan-execution` Run and returns `runId`.
- Inline plan turns and subagent batches are descendants of that Plan Run.
- Persisted Plan execution state stores the source `runId` as a projection.
- `plan/abort` calls `RunRegistry.cancelRun(planRunId)`; it never loops child
  session IDs as its lifecycle authority.
- Model `piwin_subagent_run` starts a one-task batch using the same production
  orchestrator.
- Desktop starts/cancels/observes one-task or multi-task batches through
  `subagent/batch-*`; it has no direct session lifecycle fallback.
- CLI batch/status/cancel commands target the owning long-lived Host command
  surface. Do not fake cross-process batch control.
- Classify `subagent/batch-cancel` and `plan/abort` as control-lane commands.

### Tests required before E completion

- start returns before work completes; `joinBatch` returns the final result;
- a free slot immediately admits ready work after another task settles;
- fail-fast closes admission and cancels running descendants; continue allows
  only dependency-independent tasks;
- integration conflict retains the worktree, blocks dependents, and terminalizes
  the batch Run with `integration-required`;
- real batch cancellation aborts a running task through RunRegistry;
- task cap of eight and a lower profile cap are both enforced;
- dirty-base ask displays all three decisions and only explicit allow proceeds;
- plan, model tool, Desktop, and CLI all hit the same orchestrator fixture;
- Plan parent cannot terminalize before batch/task/integration descendants join.

### Unit E deletion gate

```bash
rg "Legacy sequential path|spawnPlanSubagent|mergePlanSubagent|applyWorktreeToMain" packages apps
rg "session/(spawn|cancel-subagent|complete-subagent|merge-subagent)" packages apps
rg "runRegistry\?:|integrationPort\?:|sessionBlueprint: undefined|runtimeGenerationId \?\? 'unknown'" packages
rg "Promise\.all\(dispatches\)" packages
rg "requireCleanBaseForParallelWrites|maxParallelWriteTasks" packages apps
rg "new SubagentOrchestrator" packages --glob '*.{ts,tsx}'
```

Expected: one production orchestrator construction, no legacy subagent write
path, no boolean clean-base toggle, and no placeholder task inputs.

---

## Unit F: Unify worker lifecycle and package the worker

**Goal:** make `AgentWorkerSupervisor` the sole internal worker process
authority for foreground RPC sessions and isolated subagent tasks.

### F1. Replace shared foreground worker ownership

**Files:**

- `packages/agent-host/src/agent-worker-supervisor.ts`
- `packages/agent-host/src/worker-task-runner.ts`
- `packages/agent-host/src/backends/worker-rpc-session-backend.ts`
- `packages/host-runtime/src/product-agent-host.ts`
- worker/backend lifecycle tests

**Steps:**

- Move foreground RPC session acquisition/release behind
  `AgentWorkerSupervisor`; delete `WorkerRpcSessionBackend` if it owns a
  separate shared `RpcSdkWorkerClient`.
- One worker is keyed by exactly `(sessionId, runtimeGenerationId)` and cannot
  be reused for another generation or session.
- The Product Host remains parent authority for Host tools, permissions, Jobs,
  MCP, Browser, Web, and prompt preparation. A worker only hosts Pi/backend
  execution.
- Pass provider credentials via the approved ephemeral environment/envelope
  mechanism to both foreground and subagent workers. Do not rely on an
  accidentally inherited process environment; do not serialize raw secrets.

### F2. Make every worker frame identity complete

**Files:**

- `packages/agent-host/src/rpc-sdk-worker-protocol.ts`
- worker runtime/factory/client
- host worker bridge and tests

**Steps:**

- Define one frame context carrying `sessionId`, `runtimeGenerationId`, and
  optional real `runId` / `toolCallId` as appropriate.
- Add it to create, prompt, abort, steer, follow-up, event, Host tool-call,
  permission, terminal, and diagnostic frames.
- Validate frame context in parent and worker; reject stale/unowned frames.
- A crash fails exactly the active Runs of the crashed generation using their
  real Run IDs. Never fabricate a run ID from a transport request ID.

### F3. Package a separate internal worker artifact

**Files:**

- `scripts/bundle-host.mjs`
- package/resource resolution code
- bundle tests and a packaged-worker smoke

**Steps:**

- Build/copy a dedicated worker artifact beside packaged host resources.
- Resolve it from packaged resources at runtime; source-mode tests may provide
  an explicit test-only worker path but production does not use `tsx` or a
  source-tree `.ts` entry.
- Keep Tauri supervision unchanged: Tauri starts one main Node sidecar; that
  sidecar starts internal worker children.

### F4. Execute real backend conformance

Run a parameterized suite against actual SDK and worker implementations. It
must create sessions, prompt with text and images, route Host tools,
permissions and Extension UI, abort/steer/follow-up, emit normalized events,
and dispose. Constant/schema-only assertions are supporting unit tests, not
backend conformance.

### Unit F deletion gate

```bash
rg "PIWIN_RPC_STOCK|PIWIN_RPC_SDK_FALLBACK|PIWIN_RPC_WORKER|useSdkFallback|rpc-fallback" \
  packages apps scripts
rg "WorkerRpcSessionBackend|handleCreateLegacy|legacy worker session/create" \
  packages --glob '*.{ts,tsx}'
rg "new RpcSdkWorkerClient" packages/agent-host/src --glob '*.{ts,tsx}'
rg "parametersForHostTool|parametersForProxyTool|Type\.Any\(\)" \
  packages/agent-host packages/host-runtime --glob '*.{ts,tsx}'
```

Expected: no fallback selector, no legacy worker request, one supervisor-owned
worker-client construction path, and no name-based generic schema guessing.

---

## Unit G: Enable reload and complete the final architecture truth pass

**Goal:** expose the replacement engine only after every lifecycle can be
cancelled and joined, then mechanically prohibit architectural regression.

### G1. Enable the public replacement command

**Steps:**

- Replace the Unit A `runtime-reload-not-ready` response with the Unit D
  transaction.
- Implement `now` and `after-current-run` exactly once per expected Settings
  revision.
- Surface status through `SessionRuntimeController`; Desktop reads actual
  snapshot revision and shows rebuilding/failed/active truthfully.
- Add integration coverage with an active Plan Run, subagent batch/task Runs,
  run-owned Jobs, and a worker-backed generation. Assert no old-generation
  event or work survives disposal.

### G2. Extend the architecture guard

**Files:**

- `scripts/check-package-boundaries.mjs`
- root `package.json`

**Steps:**

- Keep existing package direction checks.
- Add production-only hard failures for all Unit B/C/E/F deletion gates.
- Assert exactly one production `new SubagentOrchestrator(...)`.
- Assert `AgentWorkerSupervisor` is the sole production worker-client owner.
- Exclude tests, fixtures, migration readers, generated output, and the
  intentionally retained Tauri Rust PTY with narrow documented allowlists.
- Include `test:architecture` in the standard `check`/CI verification command,
  not only as an optional script.

### G3. Update documentation and close the plan

**Files:**

- `docs/architecture.md`
- `docs/dev-plan.md`
- ADR 0003, ADR 0006, ADR 0012, ADR 0017, ADR 0030, ADR 0031
- Settings and Runtime specifications
- README when topology is described

**Steps:**

- Describe one Tauri-supervised Product Host and internal per-generation
  workers; do not call host-runtime a separate service.
- Document Host-local Job visibility and removal of standalone cross-Host CLI
  Job commands.
- Document the dirty-base ask policy, explicit continuation, retention, no
  automatic retry, and no automatic conflict resolution.
- Mark this plan complete only when every gate below is green. Do not leave a
  future-work marker on a required authority deletion.

### Final source gates

```bash
rg "ActiveRunRegistry|createActiveRunRegistry|terminalRunIdsBySession" packages apps --glob '*.{ts,tsx}'
rg "createProcessRegistry|ProcessRegistry|ManagedProcessRecord|ManagedProcessStartInput" packages apps --glob '*.{ts,tsx}'
rg "type: 'process/(started|updated|exited|log)'|type: 'run/(phase|terminal)'" packages apps --glob '*.{ts,tsx}'
rg "Legacy sequential path|spawnPlanSubagent|mergePlanSubagent|applyWorktreeToMain" packages apps --glob '*.{ts,tsx}'
rg "session/(spawn|cancel-subagent|complete-subagent|merge-subagent)" packages apps --glob '*.{ts,tsx}'
rg "runRegistry\?:|integrationPort\?:|sessionBlueprint: undefined|runtimeGenerationId \?\? 'unknown'" packages --glob '*.{ts,tsx}'
rg "PIWIN_RPC_STOCK|PIWIN_RPC_SDK_FALLBACK|PIWIN_RPC_WORKER|useSdkFallback|rpc-fallback" packages apps scripts
rg "@piwin/agent-host" apps --glob '*.{ts,tsx}'
rg "@piwin/(automation|browser|doc-rag|flashcards|git|marketplace|mcp|media|notes|pet|process|project|session|skills|theme|tools-web)" \
  packages/agent-host --glob '*.{ts,tsx}'
```

Expected: no production matches. Exceptions require a named migration reader
or fixture allowlist in the architecture script; comments are not exemptions.

### Final verification

```bash
pnpm typecheck
pnpm test
pnpm test:architecture
pnpm e2e:host-jsonl
pnpm bundle:host
pnpm test:bundle
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

## 5. Completion checklist

- [x] Unit A: unsafe fake reload and direct Desktop legacy write path removed;
      ADR 0031 records dirty-base consent.
- [x] Unit B: JobController is the only Host-local OS process authority;
      model tools use Run-owned Jobs; no legacy process contracts or IPC.
- [x] Unit C: RunRegistry is the only foreground Run authority; apps consume
      direct RunHostPush lifecycle updates.
- [x] Unit D: exact internal Blueprint and generation transaction pass internal
      ordering/filtering tests; replacement is now exposed through the Host command.
- [x] Unit E: Plan, model, Desktop, and CLI all use one orchestrator and one
      Run tree; capacity, dirty-base ask, project workspace, and integration
      semantics are enforced.
- [x] Unit F: AgentWorkerSupervisor exclusively owns foreground and subagent
      worker processes; packaged real-worker conformance passes.
- [x] Unit G: public reload is enabled only after complete tree cancellation
      works; source gates, docs, package boundaries, tests, and bundle checks
      are green.

Completion record (2026-08-05): Units A–G are implemented in this worktree.
The final verification set passed `pnpm typecheck`, `pnpm test`,
`pnpm test:architecture`, `pnpm e2e:host-jsonl`, `pnpm bundle:host`,
`pnpm test:bundle`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`,
and `git diff --check`.

## 6. Stop conditions

Stop and return to design review instead of improvising if any of these become
necessary:

- adding a second Product Host sidecar, HTTP server, socket, or remote gateway
  to control another Host's Jobs or batches;
- introducing a worker pool or cross-session worker reuse;
- reintroducing a parallel write path that does not first resolve dirty-base
  policy and allocate an isolated worktree;
- making a model tool, UI projection, persistence store, or worker client the
  terminal authority for a Run;
- retaining an old lifecycle API solely because a UI has not migrated;
- bypassing a failing deletion gate by expanding a broad allowlist.
