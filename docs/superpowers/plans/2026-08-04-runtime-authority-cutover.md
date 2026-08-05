# Runtime Authority and Package Boundary Cutover Plan

> **Execution requirement:** implement this plan sequentially. Do not run the
> package extraction, Run cutover, and worker cutover in parallel branches that
> modify the same contracts or `HostRuntime`. Finish each deletion gate before
> starting the next authority migration.

| Field | Value |
|---|---|
| Status | Historical baseline; remaining execution is governed by `2026-08-05-clean-architecture-remediation.md` |
| Date | 2026-08-04 |
| Classification | Long, architecture-critical |
| Primary packages | `contracts`, new `host-runtime`, `agent-host`, `process`, `session`, `cli`, `desktop` |
| Implements | ADR 0030, `settings-capability-runtime-refactor.md`, `runtime-refactor.md` |
| Does not supersede | The behavior decisions in those documents |

## 1. Goal

Complete five related architecture corrections without turning piwin into a
multi-service system:

1. eliminate duplicate lifecycle authorities;
2. finish the SessionBlueprint prerequisite;
3. move product composition from `@piwin/agent-host` to
   `@piwin/host-runtime`;
4. preserve exactly one Tauri-supervised Node Product Host sidecar;
5. delete transitional compatibility paths after each cutover.

The final runtime topology is:

```text
Tauri WebView / React
  UI + HostClient only
          |
          | HostCommand / HostResponse / HostPush
          v
Tauri Rust shell
  windowing, native dialogs, sidecar supervision, interactive PTY
          |
          | JSONL over stdio
          v
one main Node sidecar: `piwin host serve`
  |
  +-- @piwin/host-runtime
  |     product composition, Settings/Blueprint, commands/pushes,
  |     RunRegistry, JobController, permissions, prompt preparation,
  |     SubagentOrchestrator, application-service composition
  |
  +-- @piwin/agent-host
        Pi SDK backend, worker backend, Pi event/tool adapters,
        worker protocol and supervisor
              |
              | only when process isolation is required
              v
        zero or more per-generation internal Node worker processes
```

`@piwin/host-runtime` and `@piwin/agent-host` are package boundaries inside
the same main Node sidecar. They are not independent daemons. Worker child
processes are internal execution backends spawned by that sidecar, not extra
Product Hosts supervised by Tauri.

## 2. Non-goals

- No second Product Host sidecar or `host-runtime serve` executable.
- No HTTP server, WebSocket server, Unix socket, or remote gateway work.
- No worker pool, cross-session worker reuse, or automatic backend switching.
- No dirty-working-tree snapshot system. Parallel writes use the consent flow
  in ADR 0031; an explicit bypass does not create a product snapshot.
- No automatic retry or automatic Git conflict resolution.
- No generic workflow engine.
- No Tauri/Rust rewrite of product commands, permissions, Runs, Jobs, or
  Settings.
- No redesign of the Tauri JSONL bridge or bundle entry.
- No package beyond what the binding Settings prerequisite requires. If that
  spec still requires `@piwin/agent-resources` after Task 0 reconciliation,
  implement it before the Task 5 prerequisite gate; do not invent additional
  inventory packages.

## 3. Locked decisions

### D1. One product composition root

`@piwin/host-runtime` is the only product composition root. It owns product
commands, pushes, runtime generations, Run/Job orchestration, permissions,
tool execution, prompt preparation, and application-service wiring.

### D2. One backend boundary

`@piwin/agent-host` owns only Pi-facing behavior. It may depend on:

- `@piwin/contracts`;
- pinned Pi packages;
- backend-only third-party dependencies such as `typebox`.

It must not depend on `@piwin/process`, `@piwin/session`, `@piwin/mcp`,
`@piwin/browser`, or other product/application packages.

### D3. One authority per lifecycle

| Lifecycle | Final authority |
|---|---|
| Product session/runtime generation | `SessionRuntimeController` |
| Agent execution tree | `RunRegistry` |
| Non-interactive OS child process | `JobController` |
| Subagent batch scheduling | one `SubagentOrchestrator` using `RunRegistry` |
| Git integration serialization | mandatory `SubagentIntegrationPort`, with one production `SubagentIntegrationCoordinator` |
| Pi worker lifecycle | one `AgentWorkerSupervisor` |

Persisted manifests, UI state, scheduler readiness, and transcript records are
projections. They do not independently write lifecycle terminal state.

### D4. Internal Blueprint and backend projection are distinct

`SessionBlueprint` remains the binding internal `host-runtime` object. It may
contain non-serializable Host registrations, model runtime state, and resolved
permission state.

`BackendSessionBlueprint` is the JSON-safe cross-package projection in
`@piwin/contracts`. Executable Host tool registrations remain internal to
`host-runtime` and are represented to `agent-host` through complete
descriptors plus an execution port.

This avoids a dependency cycle:

```text
host-runtime -> agent-host -> contracts
```

`agent-host` must never import the internal `SessionBlueprint` type from
`host-runtime`; it consumes only `BackendSessionBlueprint` from contracts.

### D5. No compatibility layer after a deletion gate

Temporary old/new paths may coexist only inside the current review unit. Do
not retain:

- forwarding files from `agent-host` to `host-runtime`;
- `agent-host` re-exports of `HostRuntime`;
- old registries synchronized with new registries;
- old RPC selectors after worker conformance passes;
- deprecated request fields after all in-repo callers are migrated.

## 4. Dependency-order correction

The current specs contain a practical cycle:

- the Settings prerequisite asks for complete runtime replacement semantics;
- complete replacement needs cancellation and join from Phase 2 `RunRegistry`;
- Runtime Phase 2 is documented after Phase 1 Job Control.

Resolve this without introducing a temporary lifecycle service:

1. **Before Phase 1:** implement Blueprint compilation, initial generation
   allocation, successful-backend active publication, and late-generation
   event filtering.
2. Keep `session/reload-runtime` unavailable or return a stable
   `runtime-reload-not-ready` error while foreground execution still uses
   `ActiveRunRegistry`.
3. **During Phase 2:** after foreground execution uses `RunRegistry`, implement
   full stop/cancel/join/dispose/recreate replacement ordering behind the
   disabled command. Enable runtime reload only after Plan and subagent work
   are also Run descendants and the complete Phase 2 deletion gate passes.

Update the two governing specs to state this split before implementation. Do
not preserve the current fake reload behavior that only changes a generation
ID.

## 5. Current baseline to remove

At the start of this plan, the repository contains these transitional paths:

- `packages/agent-host/src/host-runtime.ts` is the product composition root.
- `ActiveRunRegistry` is the production foreground authority.
- `RunRegistry` exists but is not the production authority.
- `ProcessRegistry` and `JobController` are both constructed.
- `PlanExecutionState` and direct subagent commands own lifecycle state outside
  `RunRegistry`.
- `SubagentOrchestrator` is not the single production entry point.
- `sessionBlueprint` may be `undefined` and runtime generation may be
  `'unknown'` in task runner input.
- the SDK adapter still reads Settings/trust and builds product tools.
- the worker may guess Host tool schemas from names.
- CLI imports and calls `@piwin/agent-host` directly.
- RPC fallback and stock RPC selectors remain.

Every phase below includes a deletion gate for the relevant items.

## 6. Delivery map

| Order | Deliverable | Authority established |
|---|---|---|
| 0 | Documentation and baseline lock | one execution truth |
| 1 | Contracts and backend ports | exact Blueprint/tool/prompt seam |
| 2 | `host-runtime` package shell | package boundary without a new process |
| 3 | Agent backend inversion | backend consumes exact inputs and ports |
| 4 | Composition/Blueprint/CLI cutover | one product composition root and session input |
| 5 | Unified Job Control | one OS process authority |
| 6 | Unified foreground Run Control | one foreground execution authority |
| 7 | Runtime replacement engine | replacement logic staged; command remains disabled |
| 8 | ADR 0030 orchestrator cutover | one complete Run tree; enable runtime replacement |
| 9 | Worker isolation cutover | one worker authority |
| 10 | Final compatibility deletion | architecture enforced mechanically |

Task 5 corresponds to Runtime Refactor Phase 1, Tasks 6-8 complete Phase 2,
and Task 9 completes Phase 3. Do not reorder them.

---

## Task 0: Freeze the baseline and align the governing documents

**Files:**

- Modify: `docs/specs/settings-capability-runtime-refactor.md`
- Modify: `docs/specs/runtime-refactor.md`
- Reference: `docs/adr/0030-safe-parallel-subagent-execution.md`

### Steps

- [ ] Wait until the other ADR 0030 implementation session has stopped or its
      changes are integrated. Re-read every file listed in this plan before
      editing; do not assume this snapshot is still current.
- [ ] Add the dependency-order correction from §4 to both specs.
- [ ] Reconcile the stale request for
      `docs/adr/0030-session-capability-blueprints.md` in the Settings spec.
      ADR 0030 is already Safe Parallel Subagent Execution. Allocate the next
      unused ADR number or remove the extra ADR request if the updated spec is
      sufficient.
- [ ] Resolve the clean-base inconsistency: Runtime Refactor historically
      required a clean captured base, while ADR 0030/config still expose
      `requireCleanBaseForParallelWrites`. Record the current consent decision,
      including persisted config migration and Desktop/CLI behavior, in ADR
      0031 and the governing specs.
- [ ] Confirm whether the binding Settings program still requires
      `@piwin/agent-resources`. If yes, keep it in the prerequisite gate; if
      not, amend the spec explicitly rather than silently skipping it.
- [ ] Confirm ADR 0030 still states:
  - one Host-owned orchestrator;
  - `RunRegistry` is the only Run authority;
  - isolation is a backend fact;
  - no automatic retry;
  - worktree-only parallel writes with explicit dirty-base consent.
- [ ] Record the current focused test baseline without modifying code.

### Baseline commands

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/process typecheck
pnpm --filter @piwin/process test
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/cli typecheck
pnpm --filter @piwin/cli test
pnpm e2e:host-jsonl
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### Exit gate

- The two specs describe the same executable ordering.
- Pre-existing failures are recorded before the first code change.
- No implementation phase is active concurrently in another session.

---

## Task 1: Define the exact cross-package contracts

**Goal:** make `agent-host` consumable without importing any product package.

**Files:**

- Add: `packages/contracts/src/host-tool.ts`
- Add: `packages/contracts/src/backend-session-blueprint.ts`
- Add: `packages/contracts/src/backend-prepared-prompt.ts`
- Add: `packages/contracts/src/extension-ui.ts`
- Modify: `packages/contracts/src/session-capability.ts`
- Modify: `packages/contracts/src/subagent-orchestration.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/ipc.ts` only if imports move; do not change
  JSON wire shapes in this task
- Test: add focused contract tests beside the new files

### Required contracts

Use plain JSON-schema objects; do not add a schema library to contracts.

```ts
export type HostToolDescriptor = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type HostToolExecutionInput = {
  sessionId: string;
  runtimeGenerationId: string;
  runId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type HostToolExecutionResult =
  | { ok: true; output: string }
  | {
      ok: false;
      code:
        | 'tool-not-available'
        | 'tool-disabled'
        | 'permission-denied'
        | 'aborted'
        | 'execution-failed';
      message: string;
    };

export interface HostToolExecutionPort {
  execute(
    input: HostToolExecutionInput,
    signal: AbortSignal,
  ): Promise<HostToolExecutionResult>;
}
```

`HostToolExecutionPort` is an in-process TypeScript port. It never crosses the
Tauri or worker JSON wire. Worker tool calls use existing JSONL frames and are
handled by an adapter in `agent-host`.

Define one exact JSON-safe backend projection without duplicating manifests or
tool lists already contained in the capability snapshot:

```ts
export type BackendSessionBlueprint = {
  version: 1;
  sessionId: string;
  runtimeGenerationId: string;
  capabilitySnapshot: SessionCapabilitySnapshot;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};
```

Provider credentials remain a separate ephemeral backend input. Do not put raw
secrets in `SessionBlueprint`, persisted manifests, status output, or logs.

Define one backend-prepared prompt projection:

```ts
export type BackendPreparedPrompt = {
  text: string;
  images?: Array<{ dataBase64: string; mimeType: string }>;
  streamingBehavior?: 'steer' | 'followUp';
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};
```

Update the binding `SessionToolPolicy` to carry descriptors rather than only
names:

```ts
export type SessionToolPolicy = {
  hostTools: HostToolDescriptor[];
  piBuiltinToolNames: string[];
  enabledMcpServerIds: string[];
  enabledFamilies: SessionToolFamily[];
};
```

Keep `SessionCapabilitySnapshot.tools` as `SessionToolPolicy`, matching the
binding Settings spec. Remove the duplicate name-only `ToolManifest` type once
all callers migrate; do not keep two structurally equivalent tool authorities.
Resource, context, and subagent ceiling values remain available through the
snapshot.

Define the extension UI in-process port in contracts alongside the existing
JSON request/response types:

```ts
export interface ExtensionUiPort {
  request(
    input: ExtensionUiRequest,
    signal: AbortSignal,
  ): Promise<ExtensionUiResponse>;
}
```

Remove `SubagentProcessPolicy` and
`SubagentBatchRequest.processPolicy`. All in-repo callers must use
`SubagentTaskRunner.capabilities.processIsolation`.

Change `SubagentTaskRunInput.sessionBlueprint` from `unknown` to
`BackendSessionBlueprint` and `preparedPrompt` to
`BackendPreparedPrompt`.

### Tests to write first

- [ ] Backend Blueprint survives `JSON.parse(JSON.stringify(value))` without
      loss.
- [ ] Empty built-in and Host tool arrays remain exact empty arrays.
- [ ] Tool descriptor parameters survive JSON round-trip.
- [ ] Batch request has no caller-controlled process policy.
- [ ] Extension UI request/response types import from contracts without wire
      shape changes.

### Verification

```bash
pnpm --filter @piwin/contracts exec vitest run \
  src/backend-session-blueprint.test.ts \
  src/host-tool.test.ts \
  src/backend-prepared-prompt.test.ts \
  src/subagent-orchestration.test.ts \
  src/ipc.test.ts
pnpm --filter @piwin/contracts typecheck
```

### Deletion gate

```bash
rg "SubagentProcessPolicy|processPolicy" packages apps
```

Expected: no runtime/request field remains. Historical docs may be updated in
the final truth pass rather than retained as compatibility guidance.

---

## Task 2: Add `@piwin/host-runtime` without adding a process

**Goal:** establish the package and enforce the one-process topology before
moving behavior.

**Files:**

- Add: `packages/host-runtime/package.json`
- Add: `packages/host-runtime/tsconfig.json`
- Add: `packages/host-runtime/src/index.ts`
- Modify: root `tsconfig.json`
- Modify: `pnpm-lock.yaml` through `pnpm install`

### Package rules

- `@piwin/host-runtime` is private and ESM.
- It has no `bin` field.
- It depends on `@piwin/agent-host`, contracts, and application packages.
- `@piwin/agent-host` never depends on `@piwin/host-runtime`.
- The only Product Host executable entry remains `apps/cli/src/index.ts` and
  `piwin host serve`. Task 9 may add a non-user-facing packaged worker entry
  spawned only by the Product Host.

Use the same package scripts and TS configuration pattern as existing
packages. Do not add a new dependency for architecture checking.

### Tests

- [ ] `host-runtime` typechecks as an empty/public-shell package.

### Verification

```bash
pnpm install
pnpm --filter @piwin/host-runtime typecheck
```

### One-process proof

The following files must remain behaviorally unchanged in this task:

- `apps/desktop/src-tauri/src/host_bridge.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `scripts/bundle-host.mjs`

The bundle entry stays `apps/cli/src/index.ts`.

---

## Task 3: Invert `agent-host` around Blueprint and execution ports

**Goal:** make the Pi backend usable by the future composition root without
passing product services into adapters.

Task 3 and Task 4 are one non-mergeable review unit. Task 3 may use temporary
internal overloads on its implementation branch, but it has no standalone
completion state: do not merge it until Task 4 deletes the old product-facing
path and passes the package deletion gate.

**Files:**

- Modify: `packages/agent-host/src/backends/pi-session-backend.ts`
- Modify: `packages/agent-host/src/backends/in-process-sdk-session-backend.ts`
- Modify: `packages/agent-host/src/backends/worker-rpc-session-backend.ts`
- Modify: `packages/agent-host/src/sdk-adapter.ts`
- Modify: `packages/agent-host/src/rpc-adapter.ts`
- Modify: `packages/agent-host/src/create-host.ts`
- Modify: `packages/agent-host/src/pi-tool-adapter.ts`
- Modify: `packages/agent-host/src/rpc/worker-proxy-tool-factory.ts`
- Modify: `packages/agent-host/src/agent-worker-supervisor.ts`
- Modify: `packages/agent-host/src/worker-task-runner.ts`
- Modify: `packages/agent-host/src/index.ts`
- Tests: backend and worker descriptor/conformance tests

### Backend input

Replace worker-specific and SDK-context-specific creation input with one
backend-neutral shape:

```ts
export type CreateBackendSessionInput = {
  blueprint: BackendSessionBlueprint;
  providers: SerializableProviderRuntime[];
  hostToolExecution: HostToolExecutionPort;
  extensionUi?: ExtensionUiPort;
};
```

Keep provider runtime data separate from Blueprint. Do not persist or log
inline credentials.

Move backend prompt input ownership to contracts as
`BackendPreparedPrompt`. Keep the binding product `PreparedPrompt` internal
to `host-runtime`.

### Adapter responsibilities after this task

Adapters may:

- translate exact Blueprint resources/contexts/tool descriptors into Pi;
- register providers from the supplied ephemeral runtime envelope;
- route Host tool calls through `HostToolExecutionPort`;
- create/drop backend handles;
- map Pi events;
- abort/steer/follow-up.

Adapters may not:

- load `~/.piwin/config.json`;
- query project trust;
- discover Skills, Extensions, Prompts, or context files;
- build Browser/MCP/Process/Notes/Flashcard product tools;
- resolve capability profiles;
- apply product permission policy;
- prepare media prompts.

### Descriptor rule

Delete schema guessing from worker proxy construction. Both SDK and worker use
the complete descriptor supplied in
`BackendSessionBlueprint.capabilitySnapshot.tools.hostTools`.

Unknown tool names are rejected; they do not receive a generic `Type.Any()`
schema.

### Transitional rule

The old product-facing `createAgentHost()` path may remain only until Task 4
switches `HostRuntime` to the new backend input. Mark it internal/deprecated;
do not add new callers. Delete it in Task 4 if no backend-only use remains.

Product session listing, indexing, resume policy, and runtime reconstruction
must not remain on the final `agent-host` API. `host-runtime` owns those
operations through `@piwin/session`; `agent-host` exposes backend session
create/drop/use only.

### Tests to write first

- [ ] SDK backend receives exact empty built-in and Host tool lists.
- [ ] Worker backend receives the same descriptor array as SDK.
- [ ] Dynamic MCP descriptor schema is not guessed or replaced.
- [ ] SDK creation does not call Settings/trust/scanner callbacks.
- [ ] Prepared native images reach both backends with the same shape.
- [ ] Backend creation rejects malformed Blueprint before Pi session creation.

### Focused verification

```bash
pnpm --filter @piwin/agent-host exec vitest run \
  src/backends/pi-session-backend.test.ts \
  src/backends/conformance/backend-conformance.test.ts \
  src/rpc/serializable-blueprint.test.ts \
  src/rpc/worker-proxy-tool-factory.test.ts \
  src/rpc/worker-pi-session-factory.test.ts \
  src/worker-task-runner.test.ts
pnpm --filter @piwin/agent-host typecheck
```

### Internal checkpoint before Task 4

The new backend path passes tests, but production may still use the old path
until the composition-root cutover. This is not a phase/review completion
gate. Continue directly to Task 4 on the same branch; do not merge or publish
this intermediate state and do not add unrelated feature work to the old
adapter assembly.

---

## Task 4: Move the product composition root to `host-runtime`

**Goal:** perform the package cutover while preserving product behavior and
the existing single Node process.

This is one review unit. Do not stop after merely moving
`host-runtime.ts`; `agent-host` must also lose its application dependencies.

### Move product-owned directories

```text
packages/agent-host/src/commands/
  -> packages/host-runtime/src/commands/

packages/agent-host/src/settings/
  -> packages/host-runtime/src/settings/

packages/agent-host/src/sessions/
  -> packages/host-runtime/src/sessions/

packages/agent-host/src/capabilities/
  -> packages/host-runtime/src/capabilities/

packages/agent-host/src/tools/
  -> packages/host-runtime/src/tools/

packages/agent-host/src/prompt/
  -> packages/host-runtime/src/prompt/
```

### Move product composition modules

Move these modules and their tests to `host-runtime`:

- `host-runtime*`
- `blueprint-compiler*`
- `config-store*`, `paths*`, `secret-resolver*`
- `permission-*`, `gated-bash-tool*`, `gated-file-tools*`
- `process-tools*`, `browser-tools*`, `notes-tools*`, `flashcard-tools*`
- `mcp-*` product policy/gateway/bridge modules
- `plan-*` product coordination/tool modules
- `subagent-*` orchestration/profile/lifecycle/workspace/integration modules
- `run-registry*`, `active-run*`, `run-abort-reason*`,
  `run-event-correlator*`, `runtime-resource-coordinator*`
- `session-tools*`, `session-scope*`, `session-naming-service*`,
  `transcript-recorder*`
- `vision-delegation*`, `media-decode*`, `usage-map*`
- product walkthrough, automation, marketplace, theme, pet, and provider
  service modules imported by `HostRuntime`

Use this classification rule when resolving transitive imports:

- if a module decides product policy or calls an application package, move it
  to `host-runtime`;
- if it translates an already-compiled value into Pi or worker protocol, keep
  it in `agent-host`.

### Keep in `agent-host`

- backend/adapters and backend handles;
- Pi event normalization;
- Pi tool adaptation;
- Pi ResourceLoader translation from exact manifests;
- extension UI Pi bridge;
- worker protocol, worker session runtime/factory, supervisor and runner;
- bundled Pi extension/prompt assets and their loader bridge;
- backend test fixtures that do not own product policy.

### Compile the Blueprint in `host-runtime`

Create one `SessionBlueprintCompiler` owned by `host-runtime`. It receives
explicit product inputs:

- stable `sessionId`;
- allocated `runtimeGenerationId`;
- Settings snapshot and revision;
- trusted resolved scope;
- resource/context/MCP revisions and exact manifests;
- selected model/thinking route;
- exact tool registrations and permission snapshot;
- immutable subagent ceiling.

It returns:

```ts
type CompiledSessionRuntime = {
  blueprint: SessionBlueprint;
  backendBlueprint: BackendSessionBlueprint;
  providers: SerializableProviderRuntime[];
  hostToolExecution: HostToolExecutionPort;
};
```

`SessionBlueprint` and the execution port remain in the parent Product Host.
Only `backendBlueprint`, provider runtime fields required by the backend, and
per-turn `BackendPreparedPrompt` values cross into `agent-host`/the worker.

### Initial generation semantics

Move `SessionRuntimeController` to `host-runtime` and implement:

1. allocate `runtimeGenerationId` before compile;
2. report `rebuilding` while compiling/creating;
3. create backend from the Blueprint;
4. publish generation active only after backend creation succeeds;
5. tag subscriptions with generation and drop events from older generations;
6. report failed creation without a false active generation.

Do not enable full reload yet. Replace the current fake reload behavior with a
stable `runtime-reload-not-ready` response until Task 8 enables the real
replacement engine.

### Prompt preparation

Consolidate product prompt preparation in `host-runtime` and route Desktop and
CLI prompt commands through it.

- native image path: no absolute path in prompt text;
- delegated description: no absolute path in successful description;
- path fallback: only explicit compatibility behavior;
- no base64 in prompt text;
- the binding internal `PreparedPrompt` records validated media references and
  routing mode;
- projection to `BackendPreparedPrompt` resolves bounded image bytes once;
- both SDK and worker receive the same `BackendPreparedPrompt`.

Delete duplicate preparation helpers once the shared path is active.

### Package metadata

- Move all application dependencies from `agent-host/package.json` to
  `host-runtime/package.json`.
- Narrow `agent-host/src/index.ts` to backend APIs.
- Export `HostRuntime` and product config/path APIs needed by CLI from
  `host-runtime/src/index.ts`.
- Export reusable integration fixtures only through an explicit
  `@piwin/host-runtime/testing` subpath; do not expose them from the production
  package index.
- Do not add re-export shims from `agent-host`.

### Add the package-boundary guard

**Files:**

- Add: `scripts/check-package-boundaries.mjs`
- Modify: root `package.json`

Implement the guard with Node standard library and make every rule a hard
failure from its first committed version. Scan production source separately
from `*.test.*`, `*.fixture.*`, generated output, and explicit persisted-data
migration allowlists. It must reject:

1. an `agent-host` `@piwin/*` dependency other than contracts;
2. an `agent-host/src` import from an application package;
3. an app import from a Pi package;
4. an application package import from `agent-host` or `host-runtime`;
5. a contracts import from another piwin package;
6. a deep import into another package's `src/`;
7. a CLI import from `@piwin/agent-host`;
8. a root TypeScript configuration that omits `host-runtime`;
9. a `HostRuntime` export/re-export or forwarding module in `agent-host`;
10. a product-facing `createAgentHost` export after the backend factory is
    migrated to its narrow final name.

Add:

```json
"test:architecture": "node scripts/check-package-boundaries.mjs"
```

The script itself is the architecture test; do not add a fixture framework or
another dependency.

In Task 8, extend the same script with a hard production-source assertion for
exactly one `new SubagentOrchestrator(...)`. In Task 10, add the final legacy
registry/worker selector rules. The `rg` commands below are human-readable
diagnostics; `test:architecture` is the authoritative production-only gate.

### Migrate CLI

**Files:**

- Modify: `apps/cli/package.json`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/host-serve-dispatcher.ts`
- Modify: `apps/cli/src/host-serve-dispatcher.test.ts`
- Modify: `apps/cli/src/extension-ui-cli.ts`

CLI imports `HostRuntime` and product helpers from `@piwin/host-runtime`.
Extension UI types come from contracts.

Remove direct CLI calls to `createAgentHost()`. Chat and other Agent
operations go through in-process Host commands and pushes. `piwin host serve`
continues to construct exactly one `HostRuntime` in the CLI process.

### Tests to write first

- [ ] SDK and worker receive the same `BackendSessionBlueprint` identity and
      descriptors projected from one internal `SessionBlueprint`.
- [ ] Initial generation is active only after backend creation succeeds.
- [ ] Late event from an old generation is dropped.
- [ ] CLI chat reaches `session/create` and `session/prompt`, not a bare
      `SessionHandle`.
- [ ] `piwin host serve` constructs one `HostRuntime` and disposes it once.
- [ ] Desktop JSONL protocol behavior is unchanged.

### Focused verification

```bash
pnpm install
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/cli typecheck
pnpm --filter @piwin/cli test
pnpm test:architecture
pnpm e2e:host-jsonl
pnpm bundle:host
pnpm test:bundle
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### Package deletion gate

```bash
rg "@piwin/agent-host" apps
rg "@piwin/(automation|browser|doc-rag|flashcards|git|marketplace|mcp|media|notes|pet|process|project|session|skills|theme|tools-web)" packages/agent-host
rg "loadPiwinConfig|listProjects|buildProcessTools|buildNotesTools|buildFlashcardTools|createMcpSessionBridge" packages/agent-host/src
rg "export \{ HostRuntime|export \* from './host-runtime|createAgentHost" packages/agent-host/src
```

Expected: no app imports `agent-host`; no product/application dependency or
product-state read remains in `agent-host`.

Enable hard failures for all checks in `test:architecture` at this gate.

### Binding Settings prerequisite gate before Task 5

Task 5 must not start merely because the new packages and contract types
compile. Verify the prerequisite promised by Runtime Refactor §5.1:

- [ ] one long-lived `SettingsService` is the only writer of product Settings;
- [ ] revisioned `settings/apply` has replaced `config/set` and panel/CLI
      whole-document writes;
- [ ] required persisted-data migrations pass, including the Task 0 clean-base
      decision;
- [ ] exact ResourceManifest, ContextManifest, and descriptor-bearing
      SessionToolPolicy are compiled from real revisions, not `'live'`
      placeholders;
- [ ] project trust is loaded from the project authority, never assumed;
- [ ] no empty ContextManifest or path-based resource IDs are inserted as
      production placeholders;
- [ ] if the reconciled binding spec requires `@piwin/agent-resources`, it is
      implemented and its inventory parity tests pass;
- [ ] one internal `SessionBlueprint` is compiled in `host-runtime` and one
      `BackendSessionBlueprint` is projected from it;
- [ ] parent-owned PromptPreparation and backend prompt projection are active
      for Desktop and CLI;
- [ ] initial runtime generation allocation, active publication, and stale
      generation event filtering are active.

Required diagnostics:

```bash
rg "'config/set'|\"config/set\"|savePiwinConfig\(" apps packages
rg "settingsRevision: 'live'|projectRevision: 'live'|mcpRevision: 'live'|resourceCatalogRevision: 'live'" packages
rg "trusted: true" packages/host-runtime/src
```

Any remaining match must be an explicit migration/test fixture with a narrow
allowlist in `test:architecture`. The prerequisite is incomplete while a
production Settings writer or placeholder revision remains.

---

## Task 5: Cut over all OS process surfaces to `JobController`

**Goal:** complete Runtime Refactor Phase 1 before changing Run authority.

**Files:**

- Modify: `packages/process/src/job-registry.ts`
- Modify: `packages/process/src/job-log-store.ts`
- Modify: `packages/process/src/index.ts`
- Modify/move under `host-runtime`: process command handlers and model tools
- Modify: `packages/contracts/src/process.ts`
- Modify: `packages/contracts/src/job.ts`
- Modify: `packages/contracts/src/host.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `apps/desktop/src/hooks/use-managed-processes.ts`
- Modify: `apps/desktop/src/hooks/use-host-bootstrap.ts`
- Modify: `apps/cli/src/index.ts`
- Delete after migration: Node `PtyHost` preview and old process registry

### Steps

- [ ] Write Job lifecycle tests for command completion, service readiness,
      idempotent stop, forced termination, cursor logs, and restart
      reconciliation.
- [ ] Construct exactly one `JobController` in `HostRuntime`.
- [ ] Make model-facing `process_*` tools call that controller. Tool names may
      remain product language; implementation may not use `ProcessRegistry`.
- [ ] Migrate Desktop and CLI product commands to `job/*`.
- [ ] Map existing process configuration limits into JobController input; do
      not preserve a second registry.
- [ ] Route session/project/host cleanup through JobController.
- [ ] Delete Node piped-shell preview. Interactive terminal remains Tauri PTY.
- [ ] Remove process lifecycle variants from `AgentEvent`; use `JobHostPush`.
- [ ] Delete old contracts and tests after consumers migrate.

### Required integration tests

- [ ] Run-lifetime Job stops on completed, failed, cancelled, and interrupted
      Run outcomes.
- [ ] Session/project/host lifetime cleanup uses the same controller.
- [ ] Cleanup failure maps to `job-cleanup-failed` and never silently reports
      successful Run completion.
- [ ] Desktop and CLI list/read/stop the same Job records.

### Verification

```bash
pnpm --filter @piwin/process test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/cli test
```

### Phase 1 deletion gate

```bash
rg "createProcessRegistry|ProcessRegistry|ManagedProcessRecord|ManagedProcessStartInput" packages apps
rg "PtyHost|shellPreview: true" packages apps
rg "type: 'process/(started|updated|exited|log)'" packages apps
```

Expected: no production matches. Persisted-data migration code may reference an
old serialized field only when clearly isolated and tested.

---

## Task 6: Make `RunRegistry` the only execution lifecycle authority

**Goal:** begin Runtime Refactor Phase 2 by cutting foreground turns to one
Run tree.

**Files under `host-runtime`:**

- `run-registry.ts`
- `run-event-correlator.ts`
- `commands/session-live-commands.ts`
- `host-runtime.ts`
- related tests
- Desktop reducers/hooks consuming Run pushes
- contracts Run/HostPush definitions

### Fix `RunRegistry` semantics before cutover

`cancelRun()` must:

1. validate the Run exists;
2. close admission;
3. move the subtree to `cancelling`;
4. abort descendant signals leaf-first;
5. not immediately mark active work terminal.

Terminalization occurs only after:

- backend/provider execution settles;
- descendant Runs join;
- Run-lifetime Jobs stop;
- permission/Extension UI/tool waits settle;
- required integration cleanup finishes.

Validate a parent exists and has open admission before inserting a child. Do
not leave detached child nodes.

### Foreground cutover

- [ ] Create every `session/prompt` as a `session-turn` Run.
- [ ] Return `runId` immediately after acceptance.
- [ ] Enforce one active session turn using a RunRegistry index, not a second
      registry.
- [ ] A superseding prompt accepts a new Run, cancels and joins the prior Run,
      then starts; provider executions never overlap for one session.
- [ ] Route abort, host shutdown, backend failure, and normal completion
      through one finalizer.
- [ ] Finalizer stops Run Jobs before terminalizing.
- [ ] Emit direct `RunHostPush`; remove product `run/phase` and `run/terminal`
      variants from `AgentEvent` after Desktop/CLI migrate.
- [ ] Keep event correlation as a projection that queries RunRegistry.

### Tests to write first

- [ ] Parent cannot terminalize while a descendant is non-terminal.
- [ ] Cancellation remains `cancelling` until real work and Jobs join.
- [ ] Child creation under missing/closed parent is rejected atomically.
- [ ] Terminal state is immutable.
- [ ] Superseding prompt does not overlap backend execution.
- [ ] Late backend completion cannot overwrite cancelled terminal state.
- [ ] Host shutdown cancels, joins, cleans Jobs, then terminalizes.

### Verification

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/run-registry.test.ts \
  src/run-event-correlator.test.ts \
  src/commands/session-live-commands.test.ts \
  src/active-run.integration.test.ts
pnpm --filter @piwin/desktop test
pnpm e2e:host-jsonl
```

### Foreground deletion gate

```bash
rg "ActiveRunRegistry|createActiveRunRegistry|terminalRunIdsBySession|terminalEmitted" packages apps
rg "buildRunTerminalEvent|event.type === 'run/terminal'" packages apps
```

Delete `active-run.ts` and its old tests. Move still-valuable cases into
RunRegistry and session-command integration tests.

---

## Task 7: Implement the runtime replacement engine behind a disabled command

**Goal:** implement and unit-test replacement ordering now that foreground Run
cancellation and join exist, without exposing reload while Plan/subagent work
is still outside the Run tree.

**Files:**

- Modify: `packages/host-runtime/src/sessions/session-runtime-controller.ts`
- Modify: session runtime command handlers
- Modify: backend handle registry/subscriptions
- Modify: `packages/contracts/src/session-runtime.ts`
- Tests: controller and HostRuntime replacement integration

### Replacement transaction

Implement exactly:

1. verify expected Settings revision;
2. allocate a new `runtimeGenerationId`;
3. compile an immutable Blueprint;
4. publish `rebuilding` without publishing the new generation as active;
5. close old-generation Run admission;
6. cancel and join old-generation Run descendants;
7. flush transcript and settle pending permission/Extension UI requests;
8. dispose the old backend handle or worker;
9. create the new backend from the Blueprint;
10. atomically publish the new generation as active;
11. reject/drop all prior-generation events.

Implement both command modes:

- `now`: begin the transaction immediately;
- `after-current-run`: register one pending replacement and trigger after the
  active turn joins.

Do not queue multiple replacement requests for the same session. The latest
request for the same expected Settings revision may replace the pending one;
otherwise return a revision conflict.

### Production availability gate

Keep `session/reload-runtime` returning `runtime-reload-not-ready` throughout
Task 7. The replacement engine is callable only from controller/integration
tests. Task 8 enables the command after Plan, model tool, Desktop, CLI, and all
subagent work are represented as Run descendants.

### Tests to write first

- [ ] Initial generation and replacement generation IDs are distinct.
- [ ] New generation is never visible as active before backend creation.
- [ ] Old Runs join before old backend disposal.
- [ ] Old backend disposes before new backend creation.
- [ ] Failed new backend creation leaves state `failed`, not falsely `live`.
- [ ] Prior-generation events cannot reach transcript, usage, hooks, or UI.
- [ ] `after-current-run` executes once after terminal join.
- [ ] The production command remains disabled even though the internal engine
      passes.

### Verification

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/sessions/session-runtime-controller.test.ts \
  src/sessions/session-runtime-replacement.integration.test.ts
pnpm e2e:host-jsonl
```

### Internal engine gate

```bash
rg "Date\.now\(\).*gen|\$\{sessionId\}-gen|capabilitySnapshotId = 'stale'" packages
rg "attachGeneration\(" packages/host-runtime/src/commands
```

Expected: command handlers do not invent or directly attach generations.
The only command-handler behavior remains the stable not-ready response.

---

## Task 8: Route Plans, model tools, Desktop, and CLI through one orchestrator

**Goal:** complete ADR 0030 and Runtime Refactor Phase 2.

**Files under `host-runtime`:**

- `subagent-orchestrator.ts`
- `subagent-scheduler.ts`
- `subagent-lifecycle-service.ts`
- `subagent-workspace-service.ts`
- `subagent-integration-coordinator.ts`
- `runtime-resource-coordinator.ts`
- `commands/subagent-commands.ts` (new)
- `commands/plan-commands.ts`
- `subagent-run-tool.ts`
- related tests

**Backend files remaining in `agent-host`:**

- `worker-task-runner.ts`
- `agent-worker-supervisor.ts`
- worker/backend protocol files

### Orchestrator API

Replace completion-blocking `runBatch()` with:

```ts
startBatch(
  request: SubagentBatchRequest,
  parentRunId?: string,
): Promise<{ runId: string; acceptedAt: string }>;

getBatch(runId: string): Promise<SubagentBatchResult | undefined>;
cancelBatch(runId: string): Promise<void>;
joinBatch(runId: string): Promise<SubagentBatchResult>;
```

`startBatch()` returns after validation, Run creation, and durable acceptance.
Capacity waiting and task execution happen afterward.

### Authority cleanup

- [ ] `RunRegistry` is required, not optional.
- [ ] Remove orchestrator UUID fallback.
- [ ] Use only RunRegistry signals; remove separate batch AbortController.
- [ ] Scheduler owns DAG readiness/admission only, not Run terminal authority.
- [ ] Durable manifest records projections; it does not decide terminal state.
- [ ] Make `SubagentIntegrationPort` mandatory. Construct exactly one
      `SubagentIntegrationCoordinator` in `HostRuntime` as its production
      implementation; delete optional/fallback dual-path logic.
- [ ] Task Run uses the allocated child session ID, not parent session ID.
- [ ] Pass real generation, typed `BackendSessionBlueprint`, capability
      snapshot, and `BackendPreparedPrompt`. Delete `'unknown'`,
      `undefined`, and empty placeholder values.
- [ ] Enforce process isolation through runner capability. If false, effective
      concurrency is one.
- [ ] Enforce an absolute Host task cap of eight. A persisted
      `maxTasksPerRun` may choose a lower limit, never a higher one; do not add
      another limit setting in this plan.
- [ ] Enforce the Task 0 clean-base decision. If clean base is the v1
      invariant: migrate persisted
      `requireCleanBaseForParallelWrites: false` to the safe value, update
      Desktop/CLI Settings surfaces, delete the product toggle after migration
      tests pass, and reject dirty-base parallel writes. Do not silently
      reinterpret the field only inside the orchestrator, and do not add
      snapshotting.

### Work-conserving scheduling

Do not await a fixed wave with `Promise.all(dispatches)`. When any active task
settles, immediately recompute readiness and admit the next task if capacity is
available.

Use a small completion queue or `Promise.race` loop. Do not add a general task
executor abstraction.

### Route every invocation surface

All of these call the same production orchestrator instance:

- `subagent/batch-start` command;
- Plan subagent execution;
- model `piwin_subagent_run` as a one-task batch;
- Desktop subagent controls;
- CLI batch/status/cancel commands.

Implement handlers for:

- `subagent/batch-start`;
- `subagent/batch-status`;
- `subagent/batch-cancel`.

Classify `subagent/batch-cancel` and `plan/abort` as control-lane commands.

### Plan migration

- `plan/execute` creates a `plan-execution` Run and returns `runId`.
- Inline turns and batches are descendants of that Run.
- Plan persisted state is a projection containing the source `runId`.
- `plan/abort` cancels the Plan Run; it does not loop through child session IDs.
- Delete the sequential subagent fallback after the orchestrator path is live.

### Tests to write first

- [ ] Batch start returns before task completion.
- [ ] Scheduler fills a slot as soon as one task settles.
- [ ] Fail-fast closes admission and cancels running descendants.
- [ ] Continue policy allows independent tasks after a failure.
- [ ] Real `cancelBatch()` aborts a running task.
- [ ] Parent cannot terminalize before all tasks and integrations join.
- [ ] Integration conflict retains worktree and maps Run terminal to
      `integration-required`.
- [ ] Plan, model tool, Desktop command, and CLI command all hit the same
      orchestrator fixture.
- [ ] Non-isolated runner reports configured versus effective concurrency and
      executes at one.
- [ ] Dirty-base parallel write is rejected.
- [ ] Runtime reload cancels and joins an active Plan/subagent Run tree before
      disposing the old backend.

### Enable runtime replacement only at this gate

After every invocation surface and Plan child is represented in RunRegistry:

- replace `runtime-reload-not-ready` with the Task 7 replacement engine;
- enable `now` and `after-current-run` modes;
- add an integration test with active Plan and subagent descendants;
- prove no untracked old-generation work survives backend disposal.

### Verification

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/subagent-scheduler.test.ts \
  src/subagent-orchestrator.test.ts \
  src/subagent-run-tool.test.ts \
  src/subagent-lifecycle-service.test.ts \
  src/plan-execution-coordinator.test.ts \
  src/commands/plan-commands.test.ts \
  src/commands/subagent-commands.test.ts
pnpm --filter @piwin/session exec vitest run src/subagent-run-store.test.ts
pnpm --filter @piwin/cli exec vitest run \
  src/host-serve-command-lane.test.ts \
  src/host-serve-dispatcher.test.ts
pnpm --filter @piwin/desktop test
```

### Phase 2 deletion gate

```bash
rg "Legacy sequential path|spawnPlanSubagent|mergePlanSubagent" packages
rg "runRegistry\?:|integrationPort\?:|sessionBlueprint: undefined|runtimeGenerationId \?\? 'unknown'" packages
rg "Promise\.all\(dispatches\)" packages
rg "new SubagentOrchestrator" packages
rg "requireCleanBaseForParallelWrites" packages apps
```

Expected construction count: one production `new SubagentOrchestrator(...)`
in `host-runtime`, plus tests.
If clean base became the invariant, production code no longer exposes a
toggleable false path.

---

## Task 9: Unify worker lifecycle and delete backend fallbacks

**Goal:** complete Runtime Refactor Phase 3 without creating another product
service.

**Files under `agent-host`:**

- `agent-worker-supervisor.ts`
- `worker-task-runner.ts`
- `backends/worker-rpc-session-backend.ts`
- `backends/in-process-sdk-session-backend.ts`
- `rpc-sdk-worker-client.ts`
- `rpc-sdk-worker-protocol.ts`
- `rpc/*`
- `rpc-adapter.ts`
- backend conformance tests
- bundle/worker entry resolution code

### Single worker authority

- [ ] `AgentWorkerSupervisor` is the only process lifecycle authority.
- [ ] One worker maps to one `(sessionId, runtimeGenerationId)` pair.
- [ ] Remove shared-client multi-session worker multiplexing.
- [ ] Worker frames carry product session ID, runtime generation ID, and real
      Run ID where the frame belongs to a turn/tool/event.
- [ ] Worker crash fails only Runs for that generation using their real IDs.
- [ ] Late frames from disposed generations are dropped and diagnosed.
- [ ] Parent remains the only Host tool, permission, MCP, Process/Job, Browser,
      and Web execution authority.

### Backend conformance

Run one parameterized suite against SDK and worker backends asserting:

- same Blueprint identity;
  same `BackendSessionBlueprint` identity projected from one internal
  `SessionBlueprint`;
- same resources and contexts;
- same built-in names and Host tool descriptors;
- same `BackendPreparedPrompt` / image behavior;
- same normalized AgentEvent sequence;
- same permission/capability-disabled behavior;
- same subagent ceiling;
- same abort, steer, follow-up, Extension UI and Host tool routing semantics.

Do not call constant checks a conformance suite; execute both implementations.

### Packaging

- Resolve a built worker entry from packaged resources.
- Keep Tauri responsible only for the one main Node sidecar.
- The Node Host sidecar spawns internal workers.
- Do not depend on source-tree `tsx` in packaged mode.

### Delete transitional paths

After conformance and packaged smoke pass, delete:

- RPC-to-SDK fallback;
- stock `pi --mode rpc` product path;
- `PIWIN_RPC_STOCK`;
- `PIWIN_RPC_SDK_FALLBACK`;
- temporary worker-selection flags;
- hard-coded/guessed worker tool schemas;
- duplicate Blueprint compilers;
- source-tree-only worker entry resolution.

### Verification

```bash
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/host-runtime test
pnpm e2e:host-jsonl
pnpm bundle:host
pnpm test:bundle
```

Add one packaged worker smoke that creates a mock isolated runtime, starts one
turn, receives one normalized terminal sequence, and shuts down cleanly.

### Phase 3 deletion gate

```bash
rg "PIWIN_RPC_STOCK|PIWIN_RPC_SDK_FALLBACK|PIWIN_RPC_WORKER|useSdkFallback|rpc-fallback" packages apps scripts
rg "Proxied host tool|parametersForHostTool|parametersForProxyTool" packages
rg "new RpcSdkWorkerClient" packages/agent-host/src
```

Expected: supervisor-owned construction only; no fallback selectors or schema
guessing.

---

## Task 10: Final compatibility deletion and architecture truth pass

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/dev-plan.md`
- Modify: `docs/adr/0003-dual-mode-host.md`
- Modify: `docs/adr/0006-desktop-host-transport.md`
- Modify: `docs/adr/0017-host-sidecar-bundling.md`
- Modify: `docs/specs/settings-capability-runtime-refactor.md`
- Modify: `docs/specs/runtime-refactor.md`
- Modify: `README.md` if it describes runtime topology
- Modify: root `package.json`

### Final source gates

```bash
rg "ActiveRunRegistry|createActiveRunRegistry|terminalRunIdsBySession" packages apps
rg "createProcessRegistry|ProcessRegistry|ManagedProcessRecord" packages apps
rg "Legacy sequential path|spawnPlanSubagent|mergePlanSubagent" packages
rg "runRegistry\?:|integrationPort\?:|sessionBlueprint: undefined|runtimeGenerationId \?\? 'unknown'" packages
rg "PIWIN_RPC_STOCK|PIWIN_RPC_SDK_FALLBACK|PIWIN_RPC_WORKER|useSdkFallback|rpc-fallback" packages apps scripts
rg "@piwin/agent-host" apps
rg "@piwin/(automation|browser|doc-rag|flashcards|git|marketplace|mcp|media|notes|pet|process|project|session|skills|theme|tools-web)" packages/agent-host
```

No production match is allowed. Historical ADR text may mention removed paths
only when clearly marked historical/superseded.

### Desktop mock rule

Do not expand `apps/desktop/src/host-client-mock.ts` with the new Run/Job/
subagent lifecycle. Keep it as a bounded UI fixture. New lifecycle integration
tests use the real Node Host with a mock Agent backend.

Replacing the entire browser mock is a separate cleanup only if it continues
to drift; it is not required to finish this architecture cutover.

### Make architecture guard mandatory

After all migrations pass, include `pnpm test:architecture` in the normal
repository verification path. Do not add a third-party dependency.

### Final verification

```bash
pnpm test:architecture
pnpm typecheck
pnpm test
pnpm format:check
pnpm e2e:host-jsonl
pnpm e2e:smoke
pnpm bundle:host
pnpm test:bundle
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm e2e:desktop
```

Run the existing `automated-prerequisite-gate` last.

## 7. Review boundaries

Use these review units. A later unit starts only after the previous deletion
or prerequisite gate passes.

1. Contracts and backend-neutral ports.
2. Package shell.
3. Agent backend inversion + composition-root/Blueprint/CLI cutover +
   architecture guard. Tasks 3 and 4 are one non-mergeable review unit.
4. Binding Settings prerequisite gate before Job cutover.
5. Job authority cutover.
6. Foreground Run authority cutover.
7. Runtime replacement engine behind the disabled command.
8. ADR 0030 Plan/Subagent orchestrator cutover and runtime reload enablement.
9. Worker conformance and fallback deletion.
10. Final docs and architecture gate.

Do not combine review units 5-9 into one pull request. They alter distinct
lifecycle authorities and need independent deletion evidence. Review unit 3
covers Tasks 3 and 4 as one non-mergeable unit.

## 8. Completion checklist

- [ ] Desktop WebView imports no Node/Pi runtime package.
- [ ] Tauri still starts exactly one main `piwin host serve` Node sidecar;
      workers are Host-spawned internal processes, not Tauri sidecars.
- [ ] `@piwin/host-runtime` is the sole product composition root.
- [ ] `@piwin/agent-host` imports no application package.
- [ ] SDK and worker consume the same `BackendSessionBlueprint` and
      `BackendPreparedPrompt` projected from one internal SessionBlueprint and
      PromptPreparation path.
- [ ] `SessionRuntimeController` is the only generation authority.
- [ ] `JobController` is the only non-interactive child-process authority.
- [ ] `RunRegistry` is the only Run lifecycle/terminal authority.
- [ ] One `SubagentOrchestrator` serves Plan, model tool, Desktop, and CLI.
- [ ] `SubagentIntegrationPort` is mandatory and has one production
      coordinator implementation.
- [ ] One `AgentWorkerSupervisor` owns all Pi workers.
- [ ] Old registries, sequential paths, fallback selectors, schema guessing,
      and compatibility exports are deleted.
- [ ] Package-boundary checks fail on future architectural regressions.
- [ ] Full typecheck, tests, JSONL smoke, bundle smoke, Rust checks, and Desktop
      E2E pass.

## 9. Stop conditions

Stop implementation and update this plan if any of these assumptions are
false after the current ADR 0030 session lands:

1. another production `HostRuntime` or process entry has been introduced;
2. the Blueprint contract has already been finalized elsewhere with a
   materially different shape, including a renamed internal/backend split;
3. `RunRegistry` has already replaced `ActiveRunRegistry` in production;
4. JobController deletion gates have already been completed;
5. worker supervisor ownership or protocol identity has changed;
6. current code changes appear in files being modified by this plan and their
   origin is unclear.

Re-read and amend the plan rather than layering another compatibility path.
