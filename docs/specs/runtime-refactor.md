# Spec: Runtime Refactor - Job Control, Structured Concurrency, and Worker Isolation

| Field | Value |
|---|---|
| Status | Implemented; deletion gates and runtime replacement are active |
| Date | 2026-08-04 |
| Scope | `contracts`, new `host-runtime`, `agent-host`, `process`, `session`, `git`, `mcp`, `browser`, `desktop`, `cli`, packaging, docs |
| Prerequisite | [`settings-capability-runtime-refactor.md`](./settings-capability-runtime-refactor.md): SettingsService, exact manifests, SessionBlueprint, PromptPreparation, runtime generation identity |
| Supersedes | [`phase7-rpc-worker-parity-plan.md`](./phase7-rpc-worker-parity-plan.md), the runtime portions of W1/W2, and the old foreground-only run/process paths |
| Related | ADR 0003, ADR 0011, ADR 0012, ADR 0013, ADR 0015, ADR 0019, ADR 0024, ADR 0025, ADR 0030, ADR 0031 |
| Binding rule | Implement Phase 1, then Phase 2, then Phase 3. A later phase may depend only on the explicit handoff contracts of the previous phase. |
| Dependency-order note | The Settings prerequisite asks for complete runtime replacement semantics, but full replacement needs Run cancellation and join from Phase 2. Implementation order: before Phase 1, implement Blueprint compilation, initial generation allocation, active publication, and late-generation event filtering. Keep `session/reload-runtime` disabled until Phase 2 is complete and all execution surfaces (including Plan/subagent) are Run descendants. |

---

## 0. Executive summary

piwin currently has several useful runtime pieces, but their ownership is not
clean enough for reliable cancellation, parallel execution, and real RPC
isolation:

- long-running OS processes are tracked separately from Agent run ownership;
- foreground turns, Plans, batches, and subagent tasks use overlapping
  lifecycle state;
- scheduling, cancellation, worktree integration, and resource limits are not
  controlled by one run tree;
- `hostMode=rpc` uses the piwin-owned worker backend;
- Pi session construction, tool registration, Settings interpretation, and
  prompt preparation are spread across adapters and product services;
- one event vocabulary is being asked to represent both Pi-native session
  execution and product-level operational state.

This refactor establishes one small architecture and delivers it in three
strict phases:

```text
Phase 1: Unified Job Control
  OS child processes become Host-owned Jobs with explicit lifetime and cleanup.

Phase 2: Structured Concurrency
  Agent work becomes one Run tree with downward cancellation and bounded resources.

Phase 3: Worker Isolation
  Each live runtime generation may execute in its own Pi worker process with SDK parity.
```

The target package boundary is:

```text
apps/desktop, apps/cli
          |
          v
@piwin/host-runtime
  product composition, Settings compilation, commands/pushes, Runs, Jobs,
  scheduling, permissions, tool authority, prompt preparation
          |
          +--> application packages
          |      session, project, process, mcp, browser, media, Git, web
          |
          +--> @piwin/agent-host
          |      Pi SDK backend, Pi worker backend, Pi event/tool adapters
          |
          +--> @piwin/contracts

application packages --> @piwin/contracts
@piwin/agent-host     --> @piwin/contracts + Pi packages
```

Only `@piwin/agent-host` may import Pi packages. `@piwin/agent-host` must not
import application packages such as `@piwin/process`, `@piwin/mcp`, or
`@piwin/browser`. `@piwin/host-runtime` owns composition and injects
backend-neutral ports into `@piwin/agent-host`.

This is a refactor, not a compatibility exercise. Each phase has an explicit
deletion gate. Replaced paths must be removed before that phase is complete.

---

## 1. Cross-phase architecture

### 1.1 Ownership

| Domain | Single authority |
|---|---|
| Product command routing and push routing | `@piwin/host-runtime` |
| Settings mutation and compilation inputs | Settings services in `@piwin/host-runtime` |
| Live runtime generation identity | `SessionRuntimeController` in `@piwin/host-runtime` |
| Agent/orchestration lifecycle | Phase 2 `RunRegistry` |
| User-visible non-interactive child processes | Phase 1 `JobController` |
| Batch DAG readiness | Pure `SubagentScheduler` used by one orchestrator |
| Worktree integration serialization | `SubagentIntegrationCoordinator` |
| Permission and side-effect tool execution | Parent `@piwin/host-runtime` |
| Pi session creation and Pi event normalization | `@piwin/agent-host` backend |
| Agent worker process lifecycle | `@piwin/agent-host` worker supervisor |
| Interactive terminal | Desktop Tauri PTY, not JobController |

No domain may gain a second lifecycle state machine as a cache or convenience
layer. Durable records and UI snapshots are projections of these authorities.

### 1.2 Runtime identity

Three identities remain separate:

```text
product session       sessionId
live Agent runtime    runtimeGenerationId
execution lifecycle  runId
```

Rules:

1. A product session is stable and owns transcript/index state.
2. A product session may have multiple sequential runtime generations.
3. Only one runtime generation is active for a product session at a time.
4. A foreground turn, Plan execution, batch, or task has its own `runId`.
5. A worker process, when used, maps to exactly one
   `(sessionId, runtimeGenerationId)` pair.
6. Transport request IDs are correlation IDs only. They never become product
   session, generation, or run identities.

### 1.3 Session blueprint boundary

The Settings refactor owns the meaning of `SessionBlueprint`. It compiles:

```text
Settings + project trust + resources + contexts + MCP inventory + model route
  -> SessionCapabilitySnapshot
  -> ResourceManifest + ContextManifest + ToolManifest
  -> SessionBlueprint
```

`SessionBlueprint` includes `runtimeGenerationId` and the exact capability
snapshot used to create the runtime. Pi adapters do not read Settings, query
project trust, discover tools, or reconstruct policy.

Host custom and dynamic tools use complete descriptors:

```ts
export type HostToolDescriptor = {
  name: string;
  description: string;
  parameters: JsonSchema;
};
```

Pi built-ins are the explicit exception. They are selected by exact name and
resolved by the same pinned Pi version in both backends. Host tool schemas must
never be guessed from names.

### 1.4 Event boundary

`AgentEvent` is only the normalized Pi/Agent session execution stream:

- session lifecycle emitted by a Pi backend;
- message start/update/end;
- tool start/update/end;
- compaction;
- backend execution error.

Product transport uses a sibling `HostPush` union:

```ts
export type HostPush =
  | { type: 'agent/event'; event: AgentEvent }
  | JobHostPush
  | RunHostPush
  | PlanHostPush
  | SubagentHostPush
  | PermissionHostPush
  | BrowserHostPush
  | DiagnosticHostPush;
```

Jobs, Plans, batches, browser state, permissions, and diagnostics are not
wrapped in fake Pi-native `AgentEvent` variants.

### 1.5 Prompt acceptance

Product commands that start long work return a stable product identity before
the work completes:

- `session/prompt` returns `runId` immediately;
- batch start returns the batch `runId` immediately;
- `job/start` returns a `jobId` after successful spawn;
- worker capacity waiting happens after product acceptance and is cancellable.

Completion is observed through Host pushes, status commands, or internal join
promises. A transport request must not remain open for the full operation.

### 1.6 Runtime replacement order

`SessionRuntimeController` is the generation identity authority. Replacement
uses this order:

1. Compile a new immutable `SessionBlueprint` with a new
   `runtimeGenerationId`.
2. Publish runtime state `rebuilding`; do not publish the new generation as
   active yet.
3. Close admission to the old generation.
4. Cancel and join its active Run descendants.
5. Dispose its backend handle or worker process.
6. Create the new backend from the compiled blueprint.
7. Atomically publish the new generation as active.
8. Drop late events from any previous generation.

---

## 2. Phase 1 - Unified Job Control

### 2.1 Purpose

Replace the current managed-process and shell-preview overlap with one
Host-owned primitive for non-interactive OS child processes.

The phase introduces only two job kinds:

- `command`: expected to terminate, such as tests and builds;
- `service`: expected to stay alive until stopped, such as a dev server.

It does not introduce a generic workflow engine, daemon, restart manager, or
interactive terminal.

### 2.2 Locked decisions

| ID | Decision |
|---|---|
| JC-01 | `@piwin/process` owns Job implementation. Do not add a generic `jobs` package. |
| JC-02 | `@piwin/host-runtime` constructs one `JobController` and is the only product Job authority. |
| JC-03 | Jobs and Runs remain separate and are linked by owner identities. |
| JC-04 | `run`, `session`, and `host` are the supported automatic-cleanup lifetimes. Project-lifetime Jobs were removed because no real project-close boundary exists to stop them (ADR 0030 Unit B). `ownerProjectPath` remains as project attribution metadata on any Job. |
| JC-05 | Run-lifetime Jobs stop on every Run terminal path, including normal completion. |
| JC-06 | Stop targets the process group/tree with graceful then forceful termination. |
| JC-07 | Logs use monotonic cursors, a bounded memory tail, disk spool, and redaction. |
| JC-08 | Service readiness supports only `none`, `tcp`, and `http`; no restart policy. |
| JC-09 | argv-only spawn is required; shell command strings are forbidden. |
| JC-10 | Interactive PTY remains Tauri-owned. The Node `PtyHost` preview is deleted. |
| JC-11 | Agent exposure is compiled through ToolManifest; manual app access is separate. |
| JC-12 | Jobs are not Agent worker processes. Worker processes remain internal to `agent-host`. |

### 2.3 Contracts

```ts
export type JobKind = 'command' | 'service';

export type JobLifetime = 'run' | 'session' | 'host';

export type JobStatus =
  | 'starting'
  | 'running'
  | 'ready'
  | 'stopping'
  | 'exited'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type JobTerminalReason =
  | 'completed'
  | 'user-stop'
  | 'run-completed'
  | 'run-cancelled'
  | 'session-closed'
  | 'host-shutdown'
  | 'startup-failed'
  | 'readiness-failed'
  | 'stop-failed'
  | 'process-error'
  | 'host-restarted';

export type JobRecord = {
  jobId: string;
  kind: JobKind;
  lifetime: JobLifetime;
  command: string;
  argv: string[];
  cwd: string;
  status: JobStatus;
  ownerRunId?: string;
  ownerSessionId?: string;
  ownerProjectPath?: string;
  label?: string;
  processId?: number;
  processGroupId?: number;
  startedAt: string;
  readyAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  terminalReason?: JobTerminalReason;
  lastError?: string;
  latestLogCursor: number;
};

export type JobCleanupResult = {
  requestedJobIds: string[];
  stoppedJobIds: string[];
  alreadyTerminalJobIds: string[];
  failedJobIds: string[];
};

export type JobStopResult = {
  job: JobRecord;
  cleanup: JobCleanupResult;
};
```

Owner requirements are structural:

- `run` requires `ownerRunId`;
- `session` requires `ownerSessionId`;
- `host` requires no lower owner;
- `env` is input-only and must never be persisted or returned.

### 2.4 Controller surface

```ts
export interface JobController {
  start(input: StartJobInput): Promise<JobRecord>;
  list(filter?: JobListFilter): Promise<JobRecord[]>;
  get(jobId: string): Promise<JobRecord | undefined>;
  readLogs(input: ReadJobLogsInput): Promise<ReadJobLogsResult>;
  wait(input: WaitForJobInput, signal: AbortSignal): Promise<JobRecord>;
  stop(jobId: string, reason: JobTerminalReason): Promise<JobStopResult>;
  stopByRun(runId: string, reason: JobTerminalReason): Promise<JobCleanupResult>;
  stopBySession(sessionId: string, reason: JobTerminalReason): Promise<JobCleanupResult>;
  dispose(): Promise<JobCleanupResult>;
}
```

Public commands are `job/start`, `job/list`, `job/get`, `job/logs`,
`job/wait`, and `job/stop`. Model tools may keep the small `process_*` family
as product language, but they must call the same controller.

Model tools may select `run` or `session` lifetime only. A
Host-lifetime Job requires an explicit product action and is never inferred or
promoted automatically.

### 2.5 Lifecycle and failure rules

1. Successful spawn returns without waiting for command completion or service
   readiness.
2. Service readiness may move `running -> ready`; a command usually stays
   `running` until terminal.
3. Terminal state is immutable.
4. Stop is idempotent.
5. Failure to terminate after the force deadline ends as
   `failed/stop-failed`; it never remains indefinitely `stopping`.
6. Previously active persisted jobs become `interrupted/host-restarted` after
   Host restart. No PID reattachment is attempted.
7. A readiness probe may target loopback by default. Non-loopback HTTP/TCP
   targets pass the existing network permission and SSRF classification.
8. Job logs are operational data, not transcript messages. A transcript may
   store a bounded summary only.

### 2.6 Package migration

```text
@piwin/host-runtime
  JobController composition and command/push routing

@piwin/process
  JobRegistry
  ProcessSupervisor
  JobLogStore
  readiness probes
  persistence and restart reconciliation

@piwin/agent-host
  receives a backend-neutral Host tool port
  does not import @piwin/process
```

### 2.7 Deletion gate

Phase 1 is not complete until these are removed:

- public `ManagedProcessRecord` and duplicate process registry aliases;
- adapter-owned ProcessRegistry fallback construction;
- Node Host `PtyHost` piped-shell preview and its capability wording;
- ambiguous log offsets without cursor semantics;
- direct app or adapter process spawn paths outside the Job authority.

### 2.8 Required verification

- command completion and service readiness fixtures;
- graceful and forced process-tree termination on supported platforms;
- stop idempotency and `stop-failed` mapping;
- run/session/project/host lifetime cleanup;
- run-lifetime cleanup on completed, failed, cancelled, and interrupted Runs;
- log cursor ordering, byte bounds, redaction, and restart reconciliation;
- network probe permission/SSRF cases;
- Desktop and CLI command parity.

### 2.9 Phase 1 handoff to Phase 2

Phase 2 may depend only on:

1. `JobController.stopByRun(runId, reason)`;
2. immutable Job terminal records;
3. Host-level Job pushes;
4. one Job resource-count authority;
5. the guarantee that every run-lifetime Job has an owner `runId`.

---

## 3. Phase 2 - Structured Concurrency and Resource Scheduling

### 3.1 Purpose

Create one Host-owned Run tree for foreground turns, Plan execution, subagent
batches, and subagent tasks. Route every batch invocation surface through one
orchestrator and make cancellation, joining, resource limits, persistence, and
worktree integration mechanically consistent.

Phase 2 builds correct orchestration before enabling real parallel Agent
execution. Until Phase 3 reports process isolation, effective Agent concurrency
is clamped to one and the product reports that fact.

### 3.2 Locked decisions

| ID | Decision |
|---|---|
| SC-01 | RunRegistry is the only Run lifecycle and terminal authority. |
| SC-02 | SubagentScheduler is pure DAG readiness state, not a second lifecycle authority. |
| SC-03 | Plan, model tools, Desktop, and CLI call one `SubagentOrchestrator`. |
| SC-04 | Batch start returns a stable `runId` immediately. |
| SC-05 | Scheduling is work-conserving, not fixed Promise waves. |
| SC-06 | Product concurrency above one requires `processIsolation=true`. |
| SC-07 | Isolation is a backend fact; callers do not send a `processPolicy` preference. |
| SC-08 | Parent cancellation closes admission before aborting descendants. |
| SC-09 | A parent cannot become terminal while a descendant is non-terminal. |
| SC-10 | Parallel writes use one worktree per child and serialized integration. |
| SC-11 | Execution, summary merge, and code integration remain separate axes. |
| SC-12 | Integration conflict makes the Run failed with `integration-required`. |
| SC-13 | No automatic task retry. Retry creates new run/task identities. |
| SC-14 | Resource owners count their own resources; the coordinator is not a second counter. |
| SC-15 | Dirty-base admission for write-capable parallel tasks uses the explicit consent flow in ADR 0031; the safe persisted policy is `ask`, and `bypass` is explicit advanced configuration. |

### 3.3 Run contracts

```ts
export type ExecutionRunKind =
  | 'session-turn'
  | 'plan-execution'
  | 'subagent-batch'
  | 'subagent-task';

export type ExecutionRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type ExecutionRunRecord = {
  runId: string;
  kind: ExecutionRunKind;
  status: ExecutionRunStatus;
  rootRunId: string;
  parentRunId?: string;
  sessionId: string;
  planId?: string;
  taskId?: string;
  runtimeGenerationId?: string;
  startedAt?: string;
  endedAt?: string;
  terminalCode?: string;
  error?: string;
};
```

Identity rules:

1. Every Run is its own node; parent IDs are never reused by children.
2. A subagent task Run is the child session's initial foreground turn. Do not
   create another nested `session-turn` Run for the same prompt.
3. Plan and batch Runs use the parent session ID; task Runs use the allocated
   child session ID.
4. Jobs created by a task use the task Run ID as `ownerRunId`.
5. Worker frames carry the product Run ID; request IDs remain correlation only.

### 3.4 Task runner boundary

```ts
export interface SubagentTaskRunner {
  readonly capabilities: {
    processIsolation: boolean;
  };

  runTask(
    input: SubagentTaskRunInput,
    signal: AbortSignal,
  ): Promise<SubagentTaskRunOutput>;
}

export type SubagentTaskRunInput = {
  taskRunId: string;
  parentSessionId: string;
  childSessionId: string;
  runtimeGenerationId: string;
  task: SubagentTaskSpec;
  runtimeSnapshot: SubagentRuntimeSnapshot;
  workspaceLease: SubagentWorkspaceLease;
  sessionBlueprint: SessionBlueprint;
  preparedPrompt: PreparedPromptInput;
};
```

The input is frozen before dispatch. The runner does not re-read Settings,
project trust, profiles, or prompt attachments.

### 3.5 State authority

| Data | Authority |
|---|---|
| Run status, terminal code, cancellation signal | `RunRegistry` |
| Dependency readiness and blocked nodes | pure `SubagentScheduler` |
| Execution/summary/integration result axes | orchestrator result reducer |
| Durable batch manifest | serialized projection |
| Desktop/CLI status | derived projection |

An integration conflict projects as `needs-integration`, but the owning Run is
terminal `failed` with stable code `integration-required`. A Job cleanup
failure produces terminal code `job-cleanup-failed`.

### 3.6 Cancellation and join algorithm

For `cancelRun(targetRunId)`:

1. Atomically mark the target subtree as closed to new child admission.
2. Move non-terminal nodes to `cancelling` where applicable.
3. Walk active nodes in the target subtree from leaves upward and abort each
   node's own AbortController, including the target Run.
4. Stop every run-lifetime Job through `JobController.stopByRun`.
5. Cancel permission/UI waits, tool calls, resource waits, worker capacity
   waits, and integration waits through the same signals.
6. Join every descendant.
7. Apply Job cleanup and integration terminal mapping.
8. Only then transition the parent to its terminal state.

Parent join invariant:

> A Run cannot become terminal while any descendant is non-terminal.

Late child completion may update diagnostics but cannot resurrect or overwrite
a terminal parent.

### 3.7 Scheduling and failure policy

- Validate task identity, dependency references, and cycles before admission.
- Admit ready tasks whenever a slot becomes free.
- `fail-fast` stops new admission and actively cancels running siblings.
- `continue` allows independent branches but cancels dependency-blocked
  descendants.
- Do not retry automatically.
- Effective Agent concurrency is:

```text
backend processIsolation=false -> 1
backend processIsolation=true  -> configured quota; pool admission via residency
```

The UI and CLI report configured and effective values separately.

### 3.8 Resource coordination

`RuntimeResourceCoordinator` provides cancellation-aware acquisition and a
combined status view. Ownership remains:

| Resource | Counter authority |
|---|---|
| Agent execution | coordinator/worker supervisor contract |
| Process Jobs | `JobController` |
| Browser contexts | browser broker |
| MCP calls | MCP manager, per server |

Leases release exactly once. Cancelling a queued Run aborts its lease wait
without consuming a slot.

### 3.9 Worktree and integration rules

1. Readonly tasks may share the parent cwd.
2. Parallel write tasks require one worktree per child.
3. A clean captured base proceeds normally. A dirty base is detected before a
   worktree lease is acquired and raises the Host ask
   `subagent:dirty-base`, unless the user has explicitly configured
   `parallelWrites.dirtyBase = 'bypass'`. The ask and its three choices are
   defined by [ADR 0031](../adr/0031-dirty-base-parallel-write-consent.md).
4. Integration is serialized by normalized repository identity, not session ID.
5. Use three-way diff/apply semantics; do not use concurrent checkout-based
   file copying.
6. Conflicted or failed worktrees with unintegrated changes are retained.
7. Cleanup may never discard unintegrated work.

The legacy `requireCleanBaseForParallelWrites` boolean is migrated to the
safe `ask` policy for both persisted boolean values. The Host never commits or
stashes automatically, and a one-run continue decision is not remembered for
future batches.

### 3.10 Persistence and restart

Batch manifests persist under the session domain. On Host restart:

- active Runs become `interrupted`;
- retained worktree identities remain inspectable;
- no Agent execution is silently resumed;
- manifests are reconciled from Run authority and durable integration data.

### 3.11 Deletion gate

Phase 2 is not complete until these are removed:

- foreground-only `ActiveRunRegistry` authority;
- Plan-specific sequential subagent executor;
- model-tool-specific batch scheduler;
- fixed-wave `Promise.all` dispatch;
- duplicate integration locks or session-keyed repository locks;
- manifest/UI code that writes Run terminal state independently;
- cancellation paths that abort only the parent signal.

### 3.12 Required verification

- DAG validation and work-conserving scheduling fixtures;
- fail-fast and continue failure-policy fixtures;
- parent/descendant join and cancellation ordering;
- cancellation while queued for every resource kind;
- run-lifetime Job cleanup and `job-cleanup-failed` mapping;
- one child session initial Run, with no nested duplicate foreground Run;
- dirty-base rejection, serialized integration, conflict retention;
- restart reconciliation;
- configured versus effective concurrency honesty;
- all invocation surfaces reaching the same orchestrator.

### 3.13 Phase 2 handoff to Phase 3

Phase 3 may depend only on:

1. `SubagentTaskRunner` and its `processIsolation` capability;
2. immutable `SubagentTaskRunInput` with compiled blueprint and prompt;
3. RunRegistry cancellation signals and terminal mapping;
4. worker-capacity acquisition as an Agent execution resource;
5. stable `(sessionId, runtimeGenerationId, runId)` correlation.

---

## 4. Phase 3 - Agent Worker Isolation and Backend Parity

### 4.1 Purpose

Make RPC a real piwin-owned child-process backend while keeping SDK mode
supported. Both backends consume the same SessionBlueprint and pass the same
conformance suite. The parent Host keeps every side-effect authority.

At phase exit there is no stock Pi RPC product path, no in-process SDK fallback
for RPC mode, and no temporary environment switch selecting incomplete paths.

### 4.2 Locked decisions

| ID | Decision |
|---|---|
| WI-01 | Product RPC uses a piwin-owned Node child process, not stock `pi --mode rpc`. |
| WI-02 | One worker owns one `(sessionId, runtimeGenerationId)` pair. |
| WI-03 | A worker is never reused across sessions or generations. |
| WI-04 | Worker lifetime equals runtime-generation lifetime. |
| WI-05 | Parent Host owns permissions and all side-effect tool execution. |
| WI-06 | Worker owns only Pi session execution, streaming, selected Pi resources/extensions, and Pi event mapping. |
| WI-07 | SDK and worker consume the same compiled blueprint and prepared prompt. |
| WI-08 | Worker receives full Host tool descriptors and exact Pi built-in names. |
| WI-09 | Capacity exhaustion waits or fails explicitly; it never changes backend mode. Subagent path waits on residency FIFO (landed 2026-09-02). |
| WI-10 | Prompt acceptance and turn completion are separate protocol phases. |
| WI-11 | Tool and turn cancellation have explicit protocol frames. |
| WI-12 | Pi-native event shapes never cross the worker boundary. |
| WI-13 | Agent worker processes are internal infrastructure, not Phase 1 Jobs. |
| WI-14 | `agent-host` owns worker spawn/termination and does not import `@piwin/process`. |
| WI-15 | ~~No automatic idle eviction ships in this phase.~~ **Superseded by ADR 0040** — Host-owned automatic idle eviction (TTL/LRU/memory) ships via the session runtime residency program. |

### 4.3 Component boundary

```text
@piwin/host-runtime
  SessionRuntimeController
  SessionBlueprintCompiler
  PromptPreparation
  RunRegistry and RuntimeResourceCoordinator
  SessionToolRegistryFactory
  HostToolExecutionRouter per runtime generation
  permissions, Jobs, MCP, browser, media, notes, Git, secrets
       |
       +-- sdk --> @piwin/agent-host PiSdkSessionBackend
       |
       +-- rpc --> @piwin/agent-host AgentWorkerSupervisor
                      |
                      +-- AgentWorkerClient
                              JSONL
                      +-- rpc-sdk-worker-entry
                              one Pi SDK session
```

`@piwin/agent-host` may use local platform-standard child-process helpers for
its internal worker. It must not route worker lifecycle through JobController.

### 4.4 Serializable projection

```ts
export type SerializableToolManifest = {
  piBuiltInToolNames: string[];
  hostTools: HostToolDescriptor[];
};

export type SerializableSessionBlueprint = {
  protocolVersion: number;
  productSessionId: string;
  runtimeGenerationId: string;
  capabilitySnapshotId: string;
  model: SerializableModelRuntimeConfig;
  resources: SerializableResourceManifest;
  contexts: SerializableContextManifest;
  tools: SerializableToolManifest;
  extensions: SerializableExtensionManifest;
  sessionOptions: SerializableSessionOptions;
};
```

The projection contains no raw provider secrets. `apiKeyEnv` is injected only
for the selected provider generation; `apiKeyRef` uses a bounded one-shot fd 3
bootstrap channel whose JSONL envelope contains only an opaque secret id.
Bootstrap material is never emitted in protocol logs, argv, environment,
blueprints, or durable state.

### 4.5 Worker protocol

The JSONL protocol is versioned, incrementally framed, byte-bounded, and
backpressure-aware. Required frame families are:

```text
parent -> worker
  worker/initialize
  session/create
  turn/prompt
  turn/cancel
  session/steer
  session/follow-up
  tool/result
  tool/cancel
  extension-ui/result
  session/drop
  worker/shutdown

worker -> parent
  worker/ready
  session/created
  turn/accepted
  agent/event
  turn/completed
  turn/cancelled
  tool/call
  tool/cancelled
  extension-ui/request
  session/dropped
  protocol/error
```

Every relevant frame carries:

- protocol version;
- product session ID;
- runtime generation ID;
- product run ID for turn work;
- request or tool-call correlation ID where needed.

`turn/accepted` confirms worker admission only. It does not wait for provider
completion. `turn/completed` carries the terminal backend outcome.

### 4.6 Parent tool proxy

For Host custom tools:

1. Worker registers proxy definitions from exact Host tool descriptors.
2. Pi invokes the proxy tool.
3. Worker sends `tool/call` with session/generation/run/tool correlation.
4. Parent resolves the runtime-generation `HostToolExecutionRouter`.
5. Parent applies current capability gates and permission policy.
6. Parent invokes the owning service.
7. Parent sends a bounded serializable result or stable structured error.
8. Cancellation sends `tool/cancel` and aborts the real parent operation.

Workers never start MCP servers, Jobs, browsers, Git mutations, media writes,
or secret resolution directly.

### 4.7 Worker supervisor

Internal policy is not user `PiwinConfig`:

```ts
export type AgentWorkerRuntimeSettings = {
  maxActiveWorkers: number;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
  maxFrameBytes: number;
};
```

Defaults:

```text
maxActiveWorkers = deriveSupervisorMaxWorkers(subagents.maxConcurrency)
                 = deriveWorkerPoolSize(N) + 1 replacement headroom
startupTimeoutMs = 5_000
shutdownTimeoutMs = 2_000
maxFrameBytes = 8 MiB
```

Rules:

1. Product `session/prompt` returns `runId` before capacity acquisition.
2. Capacity waiting is represented as a cancellable Run phase.
3. Explicit runtime disposal terminates the worker.
4. Worker startup timeout fails that generation only.
5. Worker crash fails active Runs for that generation using their real Run IDs.
6. Late frames from a disposed generation are dropped and recorded as
   diagnostics.
7. Shutdown is graceful then forceful within the configured deadline.

### 4.8 Turn cancellation

1. RunRegistry abort sends `turn/cancel` for the active Run.
2. Worker aborts the Pi prompt and any local read-only operation.
3. Parent aborts proxied Host tools and permission/UI waits.
4. Worker returns `turn/cancelled` after local join.
5. Parent joins tool operations and worker acknowledgement before terminalizing
   the Run, subject to bounded crash/timeout failure mapping.
6. A late `turn/completed` cannot overwrite a cancelled or failed terminal Run.

### 4.9 Backend conformance suite

Run the same parameterized suite against `PiSdkSessionBackend` and the worker
backend. Assert:

- same capability snapshot and runtime generation identity;
- same selected resources and explicit contexts;
- same Pi built-in names and Host tool descriptors;
- same prepared text and native image behavior;
- same normalized AgentEvent sequence and terminal outcome;
- same permission and capability-disabled behavior;
- same MCP/Web/Process/browser routing through parent authority;
- same subagent ceiling;
- same abort, steer, follow-up, tool cancellation, and Extension UI semantics;
- one worker crash affects only one runtime generation.

### 4.10 Packaging and status honesty

- Resolve a built worker entry from packaged resources; do not depend on
  source-tree `tsx` in production.
- CLI doctor reports worker entry resolution, protocol compatibility, and
  process isolation capability.
- Host status reports `sdk-in-process` or `rpc-worker-isolated`.
- Do not expose `rpcSdkFallback`, stock RPC, or temporary worker flags after
  the deletion gate.

### 4.11 Deletion gate

Phase 3 is not complete until these are removed:

- RPC-to-SDK in-process fallback;
- stock `pi --mode rpc` product path;
- `PIWIN_RPC_STOCK`, `PIWIN_RPC_SDK_FALLBACK`, temporary worker switches, and
  equivalent hidden selectors;
- worker hard-coded Host tool lists or guessed schemas;
- worker Settings/trust/MCP/process/browser ownership;
- multi-session worker multiplexing;
- source-tree-only worker entry resolution;
- duplicate SDK and worker blueprint compilation paths.

### 4.12 Phase 3 exit state

At final exit:

1. SDK mode remains a supported in-process backend.
2. RPC mode is a real isolated worker backend.
3. Both implement the same backend contract and pass conformance.
4. `SubagentTaskRunner.capabilities.processIsolation` is true only for the
   isolated backend.
5. Phase 2 may use configured concurrency greater than one when worker capacity
   is available.
6. ADR 0011 is superseded and ADR 0012 is implemented.

---

## 5. Implementation sequence

### 5.1 Prerequisite gate

Before Phase 1 begins, the Settings capability refactor must provide:

- one Settings writer and revisioned mutation path;
- exact ResourceManifest, ContextManifest, and ToolManifest outputs;
- complete Host tool descriptors;
- `SessionBlueprint` with `runtimeGenerationId`;
- parent-owned PromptPreparation;
- `SessionRuntimeController` generation replacement semantics.

### 5.2 Phase delivery table

| Order | Deliverable | Must remain stable for next phase |
|---|---|---|
| 1 | Unified Job Control | Job ownership, stop-by-run, terminal mapping, resource count |
| 2 | Structured Concurrency | Run tree, task-runner port, cancellation/join, resource leases |
| 3 | Worker Isolation | isolated backend, protocol, parent tool proxy, conformance |

### 5.3 Suggested package work order

1. `@piwin/contracts`: identities, Job contracts, Run contracts, HostPush
   variants, backend capability ports.
2. `@piwin/host-runtime`: composition root and routing shell.
3. Phase 1 `@piwin/process` implementation and migration.
4. Phase 2 RunRegistry, orchestrator, resources, worktrees, persistence.
5. Phase 3 `@piwin/agent-host` backend split, supervisor, protocol, worker.
6. Desktop/CLI status and command migration per phase.
7. Delete replaced paths before moving to the next phase.

### 5.4 Review boundaries

Prefer separate review units for:

- contracts and ADR alignment;
- composition-root extraction;
- Job implementation and migration;
- RunRegistry and cancellation;
- scheduler/orchestrator and integration;
- worker protocol and supervisor;
- backend conformance and fallback deletion;
- Desktop/CLI honesty surfaces.

Do not combine unrelated UI redesign or dependency upgrades with this runtime
refactor.

---

## 6. Global acceptance criteria

The complete refactor is done only when:

1. `pnpm typecheck` is green with strict TypeScript unchanged.
2. Tests pass for every touched package.
3. Apps and application packages do not import Pi.
4. `@piwin/agent-host` does not import application packages.
5. One HostRuntime composition root owns product runtime services.
6. Job, Run, and runtime-generation identities are not conflated.
7. Every long operation has a stable identity before completion.
8. Cancellation reaches descendants, Jobs, tools, permissions, resource waits,
   and workers, and parents join before terminal state.
9. Product concurrency never exceeds truthful backend isolation or resource
   capacity.
10. Parallel writes use isolated worktrees and serialized integration.
11. SDK and worker backends consume one blueprint and pass conformance.
12. Native images reach Pi as image content rather than path text by default.
13. Product status and doctor surfaces report backend and isolation truthfully.
14. Every phase deletion gate is satisfied; no fallback architecture remains.

---

## 7. Explicit non-goals for the complete program

- distributed execution across machines;
- OS sandboxing or containers;
- a generic workflow engine;
- automatic task retries;
- automatic merge-conflict resolution;
- worker reuse pools across runtime generations;
- automatic idle runtime eviction;
- PID reattachment after Host restart;
- moving interactive PTY into Node Host;
- changing Pi core or forking Pi packages;
- retaining obsolete paths solely to reduce migration diff size.
