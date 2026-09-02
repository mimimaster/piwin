# ADR 0030: Safe Parallel Subagent Execution

**Status:** Accepted
**Date:** 2026-08-03 (renumbered 2026-08-04)
**Supersedes:** None
**Related:** ADR 0012 (RPC worker isolation), ADR 0024 (run modes and sandbox)
**Implementation:** [`runtime-refactor.md`](../specs/runtime-refactor.md), Phases 2 and 3

**Implementation status (2026-08-05):** Implemented. Plan, model-tool, Desktop,
and CLI batch entry points share the production `SubagentOrchestrator`; Run
identity, dirty-base consent, worktree integration, and worker isolation are
enforced by Host-owned services.

**Delivery / integrate update (2026-08-30, `feat/subagent-delivery-review`):**
Ordinary admitted write subtasks default to `deliveryIntent=integrate` with
`applyPolicy=auto` when `ACTIVATE_NEW_INTEGRATE_DEFAULT` is true. Readonly
tasks stay `report`. `retainWorktree` only keeps the execution copy after
integrate; it does **not** skip integrate. Child result freeze (S0→S1) is
against the worktree lease `baseCommit`, not parent `HEAD`. Parent apply uses
the bounded turn-change file writer (`applyTreeDiffToWorkspace`); Git
three-way calculation may still use a temporary index / `git apply --cached`,
but that is not the parent working-tree write path. Host advertises
`subagentDeliveryV1`, `subagentResultReviewV1`, and `turnChangeUndoV1` as
true. See also
[`2026-08-30-subagent-delivery-review-adjustment.md`](../specs/2026-08-30-subagent-delivery-review-adjustment.md).

## Context

piwin supports subagent-driven plan execution where independent steps run in
isolated child sessions. The initial implementation was sequential: one child
at a time, merged before the next step. Users with long plans (4+ independent
steps) want parallel execution to reduce wall-clock time.

Parallel subagent execution introduces safety risks:

1. **File conflicts**: multiple children writing to the same file.
2. **Process isolation**: stock Pi RPC cannot register piwin custom tools.
3. **Dirty base**: parallel writes on a dirty parent branch lose changes.
4. **Failure cascades**: a failed child's dependents must not run with
   missing input.
5. **Integration ordering**: concurrent `git checkout` or `git apply` can
   corrupt the parent branch.

## Decision

### One Host-owned orchestrator

All batch invocation surfaces (model tool, plan execution, Desktop controls)
call one `SubagentOrchestrator`. The orchestrator owns batch scheduling and
failure policy only; it does not own Pi process code, session transitions, or
Git operations.

### Separation of concerns

| Service | Owns |
|---------|------|
| `SubagentOrchestrator` | Multi-task scheduling, bounded concurrency, failure/cancel policy |
| `SubagentLifecycleService` | One-child spawn/seed/cancel/complete/summary transitions |
| `SubagentCapabilityResolver` | Profile → tool/skill resolution |
| `SubagentTaskRunner` | Pi session/process execution (worker backend) |
| `SubagentWorkspaceService` | Readonly/worktree lease allocation |
| `SubagentIntegrationPort` | Serialized three-way code integration |
| `@piwin/git` | Git primitives (worktree create/remove/diff/apply) |

`RunRegistry` is the only Run lifecycle and terminal authority. Scheduler
state, durable manifests, and UI snapshots are projections rather than
competing state machines.

### Bounded concurrency

Default max concurrency: **4** = subagent parallel ceiling (`subagents.maxConcurrency`).
The worker process pool is `N + 1` (one foreground reserve), clamped to
`ABSOLUTE_MAX_RESIDENT_RUNTIMES` (8). CPU core count no longer participates in
the cap. Hard task cap per batch remains **8**. Configurable in Settings →
Sub-agent profiles (`PiwinConfig.subagents`). `processIsolation` is unchanged:
parallelism above one still requires a real isolated worker backend.

### Process isolation

Parallel runs require the **piwin-owned SDK worker** (ADR 0012), not stock Pi
RPC. The worker runs as a child process with JSONL IPC, maps Pi-native events
to normalized `AgentEvent` before emission, and preserves piwin permission,
MCP, model, session, and event boundaries.

The structured scheduler lands before the isolated runner. Until the backend
reports `processIsolation=true`, the production orchestrator clamps effective
concurrency to one and reports that degradation honestly. It does not run an
unisolated batch in parallel merely because `maxConcurrency > 1` was requested.

Isolation is a backend capability, not a caller preference. Batch requests do
not carry a `processPolicy` switch.

`PIWIN_RPC_STOCK=1` is not an acceptable product backend for isolated
subagents because stock Pi RPC cannot register piwin custom tools.

### Worktree-only parallel writes

Parallel write tasks use one worktree per child. Integration uses three-way
prepare on a temporary parent index, then a bounded working-tree write (not
`git checkout <branch> -- <paths>`, and not `git apply` as the parent write).

Subagent worktree checkouts live under the product config root
`<piwinRoot>/worktrees/<repository-key>/`, rather than inside the parent
checkout. Change capture and three-way calculation use temporary Git indexes;
integration must preserve both the child index and the user's parent index.
Applied changes appear as ordinary unstaged parent working-tree changes.

### Delivery intent and default integrate (2026-08-30)

Host resolves `SubagentDeliveryIntent` once per admission
(`report` | `integrate` | `candidate`) via `resolveSubagentDeliveryPolicy`.
Unspecified intent: readonly isolation → `report`; admitted worktree write →
`integrate`. With the integrate default activated, new non-legacy integrate
tasks receive `applyPolicy=auto`. Explicit legacy `none`/`explicit` stay
manual (`legacyManual`). Orchestrator integrate gate is
`applyPolicy === 'auto'` and intent is neither `candidate` nor `report`;
`retainWorktree` is not part of that gate.

The original hard-reject rule for dirty parent working trees is superseded by
[ADR 0031](./0031-dirty-base-parallel-write-consent.md). The current rule is
to ask the user before acquiring a worktree lease for a write-capable parallel
task. The safe persisted default is `ask`; an explicit one-run continue choice
is recorded in the Run diagnostic trail, while the Host never commits or
stashes automatically. Worktree isolation, serialized integration, and
conflict retention remain mandatory regardless of the dirty-base decision.

### Conflict retention

A failed or conflicted child worktree is **retained** for inspection. Cleanup
is never allowed to discard unintegrated changes. The batch status becomes
`needs-integration` when integration conflicts are detected.

The owning batch Run terminates as `failed` with stable terminal code
`integration-required`; `needs-integration` is the product projection, not a
second Run terminal state.

Settled worktree children freeze S0/S1 against `lease.baseCommit` into Host
turn-change storage when `turnChangeRuntime` is present. Automatic integrate
still serializes per repository and respects the workspace write gate when
that runtime exists.

### No automatic retry

Failed write children are never automatically resumed. Retry creates a new
task/child id from the same base.

### Three orthogonal state axes

Execution completion, parent-summary merge, and code integration are separate
state axes. `done` must never imply that a code change was integrated.

| Axis | States |
|------|--------|
| Execution | queued, running, completed, failed, cancelled |
| Summary | not-requested, pending, merged, failed |
| Integration | not-requested, pending, applied, conflict, failed, retained |

### Event correlation

Every batch event carries a stable `runId` and `taskId`. Child stream events
retain `parentSessionId` and `childSessionId`.

### Skills are guidance, not security boundaries

The `subagent-driven-development` skill teaches the model how to use profiles
and parallel groups. The host enforces capability gating, isolation, and
integration — not the skill.

### Settings-backed configuration

`PiwinConfig.subagents` is the only user configuration source. Profile model
fields reference existing provider/model entries; the parallel runner never
defines or copies provider/model catalogs.

## Design references

- Pi official extension (design reference, not runtime dependency)
- Pi native-subagent PR (design reference)
- Claude worktrees (design reference)
- Codex subagents (design reference)

## Consequences

- Parallel subagent execution is safe by default: readonly tasks share the
  parent cwd; write tasks get isolated worktrees with serialized integration.
- The piwin-owned SDK worker is the only product isolation path.
- Failed/conflicted worktrees are retained, requiring manual cleanup.
- The orchestrator is the single scheduling authority; plan code and the model
  tool never call `Promise.all` directly for subagent dispatch.
- Ordinary new write delegations integrate automatically into the parent
  workspace before the parent model continues; users review the parent turn,
  not each child apply bar.
- Parent undo/redo of recorded turn changes is Host-owned
  (`turn-changes/undo|redo` when `turnChangeRuntime` exists; CLI
  `piwin turn undo|redo <changeSetId> --expected-version <n>`).
- Result-review command surfaces such as `subagent/request-resolution`,
  candidate mutex adopt UI, and full result pagination/diff Host APIs are
  **not** claimed complete by this ADR update; they remain follow-ups under
  the delivery-review spec.
