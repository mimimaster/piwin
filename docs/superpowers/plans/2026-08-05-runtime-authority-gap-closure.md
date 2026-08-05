# Runtime Authority Cutover - Gap Closure Plan

> Follow-up to the review of the `2026-08-04-runtime-authority-cutover.md`
> implementation. This plan closes the remaining gaps between the current
> worktree and the delivery map of that plan (Tasks 5-10). Execute the units
> sequentially; each unit ends with a deletion or prerequisite gate.

| Field | Value |
|---|---|
| Status | Superseded by `2026-08-05-clean-architecture-remediation.md` |
| Date | 2026-08-05 |
| Classification | Long, architecture-critical |
| Primary packages | `contracts`, `host-runtime`, `agent-host`, `process`, `session`, `cli`, `desktop` |
| Supersedes | nothing; completes `2026-08-04-runtime-authority-cutover.md` |
| Does not supersede | ADR 0030, `settings-capability-runtime-refactor.md`, `runtime-refactor.md` |

## 1. Review baseline (already verified in the worktree)

The following parts of the cutover plan are **complete and verified** (no work
in this plan):

- **Task 0** - both specs carry the dependency-order correction; the stale
  `0030-session-capability-blueprints` ADR reference is reconciled. *Two
  decisions remain open (see section 2).*
- **Task 1** - contracts (`HostToolDescriptor`, `HostToolExecutionPort`,
  `BackendSessionBlueprint`, `BackendPreparedPrompt`, descriptor-bearing
  `SessionToolPolicy`); `SubagentProcessPolicy`/`processPolicy` fully removed.
- **Task 2** - `@piwin/host-runtime` package shell, no `bin`, root tsconfig
  reference present.
- **Task 3+4** - backend inversion around Blueprint + execution ports; product
  composition moved to `host-runtime`; CLI cutover;
  `scripts/check-package-boundaries.mjs` present with `test:architecture`;
  `agent-host` has no application package dependency; no `HostRuntime`/
  `createAgentHost` export from `agent-host`.
- **Task 8 Phase D** - `spawnPlanSubagent`/`mergePlanSubagent` and the
  sequential fallback deleted; Plan subagent work goes through `runBatch`.
- **Task 9 Phase E** - RPC fallback deleted (`PIWIN_RPC_STOCK`,
  `PIWIN_RPC_SDK_FALLBACK`, `useSdkFallback`, `rpc-fallback` all zero-match);
  `PiRpcAdapter` always creates a worker backend.

## 2. Open decisions (record before starting - do not silently assume)

### Decision A - clean-base handling

The cutover plan assumed clean base becomes the v1 invariant. The user
rejected a hard "dirty base => refuse" rule as too passive. The product
decision is to **ask the user, not auto-refuse**. Options:

- **A1 (user-directed, default):** when a parallel write would start on a
  dirty base, the Host raises an ask reusing the existing permission ask
  machinery (`auto` / `ask` / `bypass` policy modes). The user chooses among
  *continue anyway* / *commit-or-stash first* / *cancel*. No silent rejection,
  no silent bypass.
- **A2 (no enforcement yet):** keep the existing toggle behavior; record the
  ask flow as future work.

Implementation under A1: migrate the persisted
`requireCleanBaseForParallelWrites` boolean into a
`parallelWrites.dirtyBase` policy (`auto` / `ask` / `bypass`) and delete the
old toggle after migration tests pass.

### Decision B - `@piwin/agent-resources`

The Settings spec section 6.2 requires a new pure-inventory package
`@piwin/agent-resources`. The worktree instead implemented the inventory
inside `host-runtime`. Research (2026-08-05) shows:

- the inventory logic is **already implemented and pure** (no Pi dependency):
  Skills scanning in `packages/skills/src/skill-scanner.ts`; extension
  scanning in `host-runtime/src/extension-scanner.ts`; bundled prompts/
  extensions in `host-runtime/src/ensure-bundled-*.ts`; context discovery in
  `host-runtime/src/capabilities/context-policy-resolver.ts`;
- there is no architecture conflict preventing extraction and no hard
  requirement forcing it - B1 would be pure code relocation, not a missing
  feature;
- there is no second consumer today, so extraction is speculative.

Options:

- **B1 (spec-literal):** create `packages/agent-resources`, move the pure
  inventory/parity logic there, keep `host-runtime` as consumer. Larger diff,
  speculative.
- **B2 (amend spec, default):** amend `settings-capability-runtime-refactor.md`
  section 6.2 to record that inventory lives in `host-runtime` (the package
  list and dependency graph already exclude it) and that Skills scanning stays
  in `@piwin/skills`; no new package.

Default for this plan: **B2**. Confirm before Unit A.

## 3. Ordered execution units

| Unit | Plan task | Gate |
|---|---|---|
| A | Settings prerequisite completion | prerequisite diagnostics clean |
| B | Task 5 remainder - Job cutover | Phase 1 deletion gate |
| C | Task 6 remainder - RunRegistry foreground authority | foreground deletion gate |
| D | Task 7 - runtime replacement engine (disabled) | internal engine gate |
| E | Task 8 remainder - Plan Run + orchestrator API + caps | Phase 2 deletion gate |
| F | Task 9-10 remainder - schema guessing, final deletion, docs, guard | final source gates |

Do not combine Units B-F into one pull request. They alter distinct lifecycle
authorities and need independent deletion evidence.

---

## Unit A: Settings prerequisite completion

**Goal:** make the binding Settings prerequisite gate honest, then update the
specs for decisions A and B.

### A1. Replace `config/set` with revisioned `settings/apply` in Desktop

> **Status: complete.** Desktop `host-request-adapters.ts` already intercepts
> all `config/set` panel requests and converts them to `settings/apply` with
> revision checking via `applyConfigDraft`. The `config/set` IPC command was
> removed from the `HostCommand` union and the host handler. Desktop panels
> still use `config/set` as a local request type (adapter-internal API), but
> no `config/set` IPC command reaches the host. The mock host `config/set`
> handler was removed.

**Files:**
- `apps/desktop/src/SettingsPanel.tsx`
- `apps/desktop/src/AutomationPanel.tsx`
- `apps/desktop/src/KnowledgeCenterPanel.tsx`
- `apps/desktop/src/host-request-adapters.ts`
- `apps/desktop/src/settings/settings-context.tsx`
- `apps/desktop/src/settings/pages/*` (whole-document writes)
- `apps/desktop/src/host-client-mock.ts`

**Steps:**
- [x] Enumerate every Desktop panel/hook that issues `config/set` or
      whole-document `config` writes; route each through `settings/apply` with
      the revision returned by the previous `settings/get`.
- [x] Keep `config/get` for reads; remove `config/set` from the
      `host-request-adapters.ts` command union only after all callers migrate.
- [x] Mock host: implement `settings/apply` with revision conflict behavior
      mirroring `catalog-commands.ts`.

**Acceptance criteria:** no Desktop production call issues `config/set`.
*(Met: adapter converts all panel `config/set` requests to `settings/apply`.)*

### A2. Replace `config/set` with `settings/apply` in CLI

**Files:**
- `apps/cli/src/host-serve-command-lane.ts`
- `apps/cli/src/index.ts` (settings subcommands if present)

**Steps:**
- [x] Route CLI settings writes through `settings/apply` with revision checks.
- [x] Remove `config/set` from the CLI command lane allowlist.

**Acceptance criteria:** no CLI production call issues `config/set`.

### A3. Record decisions A and B in the governing specs

**Files:**
- `docs/specs/settings-capability-runtime-refactor.md` (section 6.2 and the
  clean-base/prerequisite section)
- `docs/specs/runtime-refactor.md` (clean-base)
- `docs/adr/0030-safe-parallel-subagent-execution.md` (if it names the toggle)

**Steps:**
- [x] If B2: strike `@piwin/agent-resources` from section 6.2 and the package
      list, add a note "inventory is owned by `host-runtime`; parity covered
      by resolver tests".
- [x] Record the clean-base decision (A1: ask flow) with the persisted-config
      migration behavior and Desktop/CLI surface change.

### Prerequisite diagnostics (must be clean for production source)

```bash
rg "'config/set'|\"config/set\"" apps packages
rg "savePiwinConfig\(" apps packages
rg "settingsRevision: 'live'|projectRevision: 'live'|mcpRevision: 'live'|resourceCatalogRevision: 'live'" packages
```

Remaining matches are Desktop adapter-internal request types (not IPC
commands) and tests. The `config/set` IPC command type is removed from
`HostCommand`.

### Exit gate

- [x] One long-lived `SettingsService` is the only writer of product Settings.
- [x] `settings/apply` is the only revisioned whole-document write path for
      Desktop and CLI.
- [x] Decisions A and B are recorded in the specs.

---

## Unit B: Complete the Job cutover (Task 5 remainder)

**Goal:** make `JobController` the only OS-process authority end to end:
Desktop and CLI consume `job/*`; the `ProcessRegistry` module, the
`process/(started|updated|exited|log)` AgentEvent variants, and the legacy
`process/*` IPC commands are deleted.

Verified baseline: `host-runtime` constructs exactly one `JobController`
(`createJobRegistry`) and forwards `JobHostPush`; `process_*` model tools
execute through `JobController` via `job-process-adapter.ts`; production code
no longer constructs `ProcessRegistry` (only its own test does).

### B1. Migrate Desktop process surface to `job/*`

**Files:**
- `apps/desktop/src/hooks/use-managed-processes.ts` - switch `process/list|logs|stop`
  requests to `job/*` commands and `JobRecord`/`JobHostPush` payloads
- `apps/desktop/src/run-status.ts` - replace `ManagedProcessRecord` with
  `JobRecord`
- `apps/desktop/src/host-client-mock.ts` - replace the mock process map with a
  mock job map emitting `job/*` pushes
- `apps/desktop/src/hooks/use-host-bootstrap.ts` - already consumes `job/*`;
  drop any remaining `process/*` push handling

**Steps:**
- [ ] List/read/stop/stream through `job/list`, `job/get`, `job/logs`,
      `job/stop` and `job/*` pushes.
- [ ] Delete the `process/*` request shapes from the Desktop client union.

### B2. Migrate CLI process surface to `job/*`

**Files:**
- `apps/cli/src/index.ts` (lines around `process/list|logs|stop`)

**Steps:**
- [ ] CLI process subcommands issue `job/*` commands and render `JobRecord`.
- [ ] Remove `process/*` from the CLI lane allowlist.

### B3. Delete the legacy process contracts and registry

**Files:**
- `packages/contracts/src/host.ts` - remove `process/(started|updated|exited|log)`
  variants from `AgentEvent`
- `packages/contracts/src/process.ts` - remove `ManagedProcessRecord`,
  `ManagedProcessLogChunk`, `ManagedProcessStartInput`, `ManagedProcessStatus`
  after consumers migrate; keep `Job*` types
- `packages/contracts/src/ipc.ts` - remove `process/*` HostCommand variants and
  re-exports
- `packages/process/src/process-registry.ts` - delete
- `packages/process/src/process-registry.test.ts` - delete (move valuable
  cases into `job-registry.test.ts`)
- `packages/process/src/index.ts` - remove the "Legacy exports" block
- `packages/host-runtime/src/commands/process-commands.ts` - delete (its
  `process/*` handlers were the compatibility adapter)
- `packages/host-runtime/src/job-process-adapter.ts` - delete only if no
  `process_*` tool or test still needs the mapping; otherwise keep the adapter
  but strip `ManagedProcess*` shapes after B1/B2

**Steps:**
- [ ] Remove `process/*` variants from `AgentEvent`.
- [ ] Delete `process-registry.ts` + test + legacy exports.
- [ ] Update `scripts/check-package-boundaries.mjs` with a production-source
      rule rejecting `ProcessRegistry|createProcessRegistry|ManagedProcessRecord`
      in `packages`/`apps`.

### Tests to write first

- [ ] Desktop and CLI list/read/stop the same Job records (fixture-based).
- [ ] `job/*` push shapes match what Desktop reducers consume.
- [ ] No `process/*` variant remains in any `AgentEvent` union test.

### Verification

```bash
pnpm --filter @piwin/process test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/cli test
pnpm --filter @piwin/desktop test
pnpm test:architecture
pnpm typecheck
```

### Phase 1 deletion gate

```bash
rg "createProcessRegistry|ProcessRegistry|ManagedProcessRecord|ManagedProcessStartInput" packages apps
rg "PtyHost|shellPreview: true" packages apps
rg "type: 'process/(started|updated|exited|log)'" packages apps
```

Expected: no production matches.

---

## Unit C: Make `RunRegistry` the only foreground execution authority (Task 6 remainder)

**Goal:** delete the `ActiveRunRegistry` projection and `terminalRunIdsBySession`
guard; publish run lifecycle as direct `RunHostPush`; migrate Desktop and CLI
off the `run/phase` / `run/terminal` AgentEvent variants.

Verified baseline: `RunRegistry` already enforces SC-08 (close admission before
abort), SC-09 (parent terminal only after descendants join), leaf-first
cancellation, immutable terminal states, and `session/prompt` already creates a
`session-turn` Run and returns `runId` immediately.

### C1. Contracts: carry phase on the Run record

**Files:**
- `packages/contracts/src/run.ts`
- `packages/contracts/src/host.ts` (`AgentEvent` run variants)
- `packages/contracts/src/ipc.ts` (HostPush union)
- `packages/contracts/src/ipc.test.ts`

**Design decision (record in the plan):** `RunHostPush` currently carries only
`run/updated` + `run/terminal` with `ExecutionRunRecord`; the old `run/phase`
event carried a `phase` + `detail` string that the Desktop chat reducer uses
(`streaming`, `tool-running`, `waiting-permission`). To preserve UI behavior
after deleting `ActiveRunRegistry.noteAgentEvent`:

- add `phase?: SessionRunPhase` to `ExecutionRunRecord` (contracts),
- the `RunEventCorrelator` continues to derive phase from normalized
  `AgentEvent`s and updates the run record via `onRunUpdated`,
- the Host emits `RunHostPush` (`run/updated`) on every record update and
  `run/terminal` on terminalization.

**Steps:**
- [ ] Add `phase?: SessionRunPhase` (and optionally `phaseDetail?: string`) to
      `ExecutionRunRecord`.
- [ ] Remove `run/phase` and `run/terminal` from `AgentEvent` in `host.ts`.
- [ ] Update `ipc.test.ts` run-shape tests accordingly.

### C2. Replace the ActiveRunRegistry projection with RunRegistry queries

**Files:**
- `packages/host-runtime/src/active-run.ts` - delete
- `packages/host-runtime/src/active-run.test.ts` - delete (move valuable cases
  into `run-registry.test.ts` / `session-live-commands.test.ts`)
- `packages/host-runtime/src/active-run.integration.test.ts` - rework onto
  `RunRegistry` + command handlers
- `packages/host-runtime/src/run-event-correlator.ts` - owns phase derivation
  from `AgentEvent` and writes back into the run record
- `packages/host-runtime/src/host-runtime.ts` - remove `activeRuns` field and
  `terminalRunIdsBySession`; wire `RunRegistry` options `onRunUpdated` /
  `onRunTerminal` to `RunHostPush` emission; expose `getActiveRun` via a
  `RunRegistry` index query
- `packages/host-runtime/src/commands/session-live-commands.ts` - the
  session/prompt, supersede, abort, and finalizer paths call `RunRegistry`
  directly
- `packages/host-runtime/src/index.ts` - stop exporting `ActiveRunRegistry`

**Steps:**
- [ ] Replace `registerActiveRun`/`markActiveRunTerminal`/`clearActiveRun`/
      `requestCancelActiveRun`/`getActiveRun` seam methods with RunRegistry
      calls plus a small "active turn per session" index (one query helper).
- [ ] Finalizer: stop Run-lifetime Jobs before `terminate()` (already present
      via `emitRunTerminal` -> `stopByRun`); keep that ordering.
- [ ] Remove `terminalRunIdsBySession` (the RunRegistry record status is now
      the single source of truth).
- [ ] Keep `buildRunPhaseEvent`/`buildRunTerminalEvent` only if any consumer
      still needs AgentEvent shapes; otherwise delete them.

### C3. Migrate Desktop and CLI to `RunHostPush`

**Files:**
- `apps/desktop/src/chat-reducer.ts` - consume `run/updated` (phase from the
  record) and `run/terminal`
- `apps/desktop/src/stream-event-buffer.ts` - drop `run/phase`, `run/terminal`
  from the AgentEvent buffer; keep `RunHostPush`
- `apps/desktop/src/hooks/use-host-bootstrap.ts`
- `apps/desktop/src/chat-thread.tsx`, `chat-thread.test.tsx`, `chat-reducer.test.ts`
- `apps/desktop/src/host-client-mock.ts` - emit `run/updated`/`run/terminal`
  pushes
- `apps/cli/src/index.ts` - `run/terminal` completion detection switches to
  `RunHostPush`
- `apps/cli/src/host-serve-stream-batcher.test.ts`

**Steps:**
- [ ] The chat reducer tracks active run by `run.updated.run.runId` and phase
      from `run.updated.run.phase`.
- [ ] Terminal detection uses `run/terminal` HostPush only.
- [ ] Remove `run/phase`/`run/terminal` from `stream-event-buffer.ts` and the
      Desktop HostClient event union after migration.

### Tests to write first

- [ ] Parent cannot terminalize while a descendant is non-terminal (exists).
- [ ] Cancellation remains `cancelling` until real work and Jobs join (exists).
- [ ] Terminal state is immutable (exists).
- [ ] Superseding prompt does not overlap backend execution (exists).
- [ ] New: run/updated push carries the derived phase; late backend completion
      cannot overwrite cancelled terminal state.
- [ ] New: host shutdown cancels, joins, cleans Jobs, then terminalizes with a
      single `run/terminal` push.

### Verification

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/run-registry.test.ts \
  src/run-event-correlator.test.ts \
  src/commands/session-live-commands.test.ts \
  src/active-run.integration.test.ts
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/cli test
pnpm e2e:host-jsonl
pnpm test:architecture
```

### Foreground deletion gate

```bash
rg "ActiveRunRegistry|createActiveRunRegistry|terminalRunIdsBySession|terminalEmitted" packages apps
rg "buildRunTerminalEvent|event.type === 'run/terminal'" packages apps
rg "type: 'run/phase'|type: 'run/terminal'" packages/contracts/src packages/host-runtime/src apps
```

Expected: no production matches outside historical docs.

---

## Unit D: Implement the runtime replacement engine behind a disabled command (Task 7)

**Goal:** implement and unit-test the full replacement transaction; change
`session/reload-runtime` to return a stable `runtime-reload-not-ready` response.
The engine is callable only from controller/integration tests.

Verified baseline: `SessionRuntimeController` tracks generation/staleness with
`planReload()`; `session/reload-runtime` currently performs a "lazy reload"
(`detachGeneration` + `clearSessionToolPort`) when `planReload` allows - this is
the fake reload behavior the cutover plan forbids.

### D1. Implement the replacement transaction in `SessionRuntimeController`

**Files:**
- `packages/host-runtime/src/sessions/session-runtime-controller.ts`
- `packages/host-runtime/src/sessions/session-runtime-replacement.integration.test.ts` (new)
- `packages/host-runtime/src/commands/session-live-commands.ts`
- `packages/contracts/src/session-runtime.ts` (status/reload result types)
- backend handle registry/subscriptions in `host-runtime.ts` and
  `product-agent-host.ts`

**Replacement transaction (exact order):**
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

**Command modes:** `now` (begin immediately) and `after-current-run` (register
one pending replacement, trigger after the active turn joins). Do not queue
multiple replacement requests for one session; the latest request for the same
expected revision may replace the pending one, otherwise return a revision
conflict.

### D2. Gate the production command

**Files:**
- `packages/host-runtime/src/commands/session-live-commands.ts`

**Steps:**
- [ ] `session/reload-runtime` returns a stable error/response:
      `runtime-reload-not-ready` (no detach, no generation mutation).
- [ ] Remove the lazy-reload branch and its tests.

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
pnpm test:architecture
```

### Internal engine gate

```bash
rg "Date\.now\(\).*gen|\$\{sessionId\}-gen|capabilitySnapshotId = 'stale'" packages
rg "attachGeneration\(" packages/host-runtime/src/commands
```

Expected: command handlers do not invent or directly attach generations; the
only command-handler behavior for `session/reload-runtime` is the stable
not-ready response.

---

## Unit E: Plan Run, orchestrator API, caps (Task 8 remainder)

**Goal:** route Plan execution through the Run tree, complete the orchestrator
API, enforce the task cap and (if A1) the dirty-base ask flow, then enable
runtime replacement.

Verified baseline: one production `new SubagentOrchestrator(...)`; `startBatch`
+ `cancelBatch` + work-conserving `executeScheduler` (`Promise.race`, no fixed
waves); `SubagentIntegrationCoordinator` constructed once and mandatory;
`piwin_subagent_run` routes through the orchestrator as a one-task batch via
`getSubagentSeam`; `subagent/batch-start|status|cancel` handlers exist.

### E1. Plan execution becomes a `plan-execution` Run

**Files:**
- `packages/host-runtime/src/commands/plan-commands.ts`
- `packages/host-runtime/src/subagent-orchestrator.ts`
- `packages/host-runtime/src/host-runtime.ts` (`PlanExecutionSeam`)
- `packages/host-runtime/src/commands/host-command-context.ts`

**Steps:**
- [ ] `plan/execute` creates a `plan-execution` Run (`parentRunId` = the
      active `session-turn` Run when present) and returns `runId`.
- [ ] Inline turns (`seam.promptSession`) and subagent batches
      (`seam.runBatch`/`startBatch`) are created as descendants of that Plan
      Run (`parentRunId: planRunId`).
- [ ] `plan/abort` cancels the Plan Run via `RunRegistry.cancelRun`; it does
      not loop through child session IDs.
- [ ] Plan persisted state is a projection containing the source `runId`.

### E2. Complete the orchestrator API

**Files:**
- `packages/host-runtime/src/subagent-orchestrator.ts`
- `packages/host-runtime/src/subagent-orchestrator.test.ts`

**Steps:**
- [ ] Add `getBatch(runId)` and `joinBatch(runId)` to the orchestrator public
      API; keep `startBatch` returning `{ runId, acceptedAt }` after durable
      acceptance.
- [ ] `plan/execute` uses `startBatch` (non-blocking) + `joinBatch` instead of
      completion-blocking `runBatch`; keep `runBatch` only for internal
      callers or delete it after migration.
- [ ] Remove any remaining orchestrator UUID fallback (`getRuntimeGenerationId`
      synthetic fallback in `host-runtime.ts` is a candidate for removal once
      every batch is parented to a live session-turn Run).

### E3. Enforce the absolute Host task cap

**Files:**
- `packages/contracts/src/subagent-orchestration.ts`
- `packages/host-runtime/src/subagent-orchestrator.ts`

**Steps:**
- [ ] Add a hard cap of **eight** active tasks per Host (`MAX_HOST_TASK_CAP = 8`
      or equivalent constant in `host-runtime`).
- [ ] A persisted `maxTasksPerRun` may lower the effective cap, never raise it.
- [ ] Non-isolated runner executes at effective concurrency one (already
      implemented via SC-06 clamp - verify).

### E4. Dirty-base ask flow (only if A1)

**Files:**
- `packages/host-runtime/src/subagent-workspace-service.ts`
- `packages/git/src/worktree-integration.ts`
- persisted-config migration code
- Desktop/CLI Settings surfaces

**Steps:**
- [ ] When a parallel write would start on a dirty base, raise an ask through
      the existing permission ask machinery (`auto` / `ask` / `bypass`).
- [ ] The user chooses among *continue anyway* / *commit-or-stash first* /
      *cancel*; no silent rejection, no silent bypass.
- [ ] Migrate the persisted boolean to a `parallelWrites.dirtyBase` policy and
      delete the old toggle.

### E5. Enable runtime replacement

**Files:**
- `packages/host-runtime/src/commands/session-live-commands.ts`
- `packages/host-runtime/src/host-runtime.ts`

**Steps:**
- [ ] Replace `runtime-reload-not-ready` with the Unit D engine.
- [ ] Enable `now` and `after-current-run` modes.
- [ ] Add an integration test with an active Plan and subagent descendants;
      prove no untracked old-generation work survives backend disposal.

### Tests to write first

- [ ] Batch start returns before task completion.
- [ ] Plan, model tool, Desktop command, and CLI command all hit the same
      orchestrator fixture.
- [ ] `plan/execute` returns a `runId`; `plan/abort` cancels the Plan Run.
- [ ] Parent cannot terminalize before all tasks and integrations join.
- [ ] Absolute cap eight enforced; lower persisted cap respected.
- [ ] Runtime reload cancels and joins an active Plan/subagent Run tree before
      disposing the old backend.
- [ ] (A1) dirty-base parallel write raises an ask and honors the user choice.

### Verification

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/subagent-scheduler.test.ts \
  src/subagent-orchestrator.test.ts \
  src/subagent-run-tool.test.ts \
  src/commands/plan-commands.test.ts \
  src/commands/subagent-commands.test.ts \
  src/sessions/session-runtime-replacement.integration.test.ts
pnpm --filter @piwin/session test
pnpm --filter @piwin/cli test
pnpm --filter @piwin/desktop test
pnpm test:architecture
```

### Phase 2 deletion gate

```bash
rg "Legacy sequential path|spawnPlanSubagent|mergePlanSubagent" packages
rg "runRegistry\?:|integrationPort\?:|sessionBlueprint: undefined|runtimeGenerationId \?\? 'unknown'" packages
rg "Promise\.all\(dispatches\)" packages
rg "new SubagentOrchestrator" packages
rg "requireCleanBaseForParallelWrites" packages apps
```

Expected: exactly one production `new SubagentOrchestrator(...)` in
`host-runtime` (plus tests); if A1, no production toggle path.

Also extend `scripts/check-package-boundaries.mjs` with a hard production-source
assertion for exactly one `new SubagentOrchestrator(...)`.

---

## Unit F: Schema-guessing cleanup, final deletion, docs, guard (Task 9-10 remainder)

### F1. Remove schema guessing from the SDK tool adapter

**Files:**
- `packages/host-runtime/src/pi-tool-adapter.ts`
- `packages/host-runtime/src/pi-tool-adapter.test.ts`
- `packages/host-runtime/src/index.ts`

Verified baseline: `toPiCustomTool`/`parametersForHostTool` is exported from
`host-runtime` but has **no production callers** (only tests). The
`Type.Record(Type.String(), Type.Any())` fallback for unknown tool names is
schema guessing and violates the descriptor rule.

**Steps:**
- [ ] Delete `toPiCustomTool`/`toPiCustomTools`/`parametersForHostTool` and the
      test file (dead export + guessing).
- [ ] If any SDK path still needs typebox conversion, move it into `agent-host`
      where the descriptor-to-Pi translation belongs, and make unknown tool
      names throw instead of receiving `Type.Any()`.

### F2. Final source deletion

**Steps:**
- [ ] Confirm zero production matches for every gate below.
- [ ] Delete `packages/process/src/process-registry.ts` if it survived Unit B.
- [ ] Delete `packages/host-runtime/src/active-run.ts` if it survived Unit C.
- [ ] Remove `terminalRunIdsBySession` if it survived Unit C.

### F3. Docs truth pass

**Files:**
- `docs/architecture.md`
- `docs/dev-plan.md`
- `docs/adr/0003-dual-mode-host.md`
- `docs/adr/0006-desktop-host-transport.md`
- `docs/adr/0017-host-sidecar-bundling.md`
- `docs/specs/settings-capability-runtime-refactor.md`
- `docs/specs/runtime-refactor.md`
- `README.md` if it describes runtime topology
- root `package.json`

**Steps:**
- [ ] Update runtime topology: one main Node sidecar; `host-runtime`
      composition root; `agent-host` backend boundary; per-generation internal
      workers; `RunRegistry`/`JobController` authorities.
- [ ] Mark removed paths (`ActiveRunRegistry`, `ProcessRegistry`, RPC fallback,
      sequential Plan fallback) as historical/superseded in ADRs.

### F4. Extend the architecture guard

**Files:**
- `scripts/check-package-boundaries.mjs`

**Steps:**
- [ ] Add production-source rules rejecting `ActiveRunRegistry`,
      `createActiveRunRegistry`, `terminalRunIdsBySession`, `ProcessRegistry`,
      `createProcessRegistry`, `ManagedProcessRecord`, RPC fallback selectors,
      and any remaining worker-selector flags.
- [ ] Keep `test:architecture` in the normal verification path.

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

Expected: no production match. Historical ADR text may mention removed paths
only when clearly marked historical/superseded.

---

## 4. Final verification (run after Unit F)

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

## 5. Completion checklist

- [x] `settings/apply` is the only revisioned whole-document Settings write.
- [ ] `JobController` is the only non-interactive child-process authority; no
      `process/*` AgentEvent variants; `ProcessRegistry` deleted.
- [ ] `RunRegistry` is the only Run lifecycle/terminal authority; no
      `ActiveRunRegistry`; run lifecycle emitted as `RunHostPush`; Desktop and
      CLI consume `RunHostPush`.
- [ ] Runtime replacement engine implemented and disabled
      (`runtime-reload-not-ready`), enabled only after Unit E.
- [ ] `plan/execute` creates a `plan-execution` Run and returns `runId`;
      `plan/abort` cancels the Plan Run; one orchestrator serves Plan, model
      tool, Desktop, and CLI; absolute task cap eight enforced.
- [ ] No schema guessing (`Type.Any`) for unknown tools anywhere.
- [ ] Docs and `test:architecture` reflect the final topology; final source
      gates clean.
- [ ] Full typecheck, tests, JSONL smoke, bundle smoke, Rust checks, and Desktop
      E2E pass.

## 6. Stop conditions

Stop and update this plan if any of these are false during execution:

1. another production `HostRuntime` or process entry has been introduced;
2. `RunRegistry` semantics changed in a way that breaks SC-08/SC-09;
3. a new "temporary" compatibility path is needed to satisfy a gate;
4. the worktree contains unrelated uncommitted changes whose origin is unclear
   (the current large diff predates this plan - do not revert it, but flag
   interactions if a unit touches those files).
