# ADR 0026: Safe Parallel Subagent Execution

**Status:** Accepted
**Date:** 2026-08-03
**Supersedes:** None
**Related:** ADR 0012 (RPC worker isolation), ADR 0024 (run modes and sandbox)

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

### Bounded concurrency

Default max concurrency: **4**. Hard task cap per batch: **8**. Both are
configurable in Settings → Sub-agent profiles (`PiwinConfig.subagents`).

### Process isolation

Parallel runs require the **piwin-owned SDK worker** (ADR 0012), not stock Pi
RPC. The worker runs as a child process with JSONL IPC, maps Pi-native events
to normalized `AgentEvent` before emission, and preserves piwin permission,
MCP, model, session, and event boundaries.

`PIWIN_RPC_STOCK=1` is not an acceptable product backend for isolated
subagents because stock Pi RPC cannot register piwin custom tools.

### Worktree-only parallel writes

Parallel write tasks require a clean base (or explicit product snapshot) and
one worktree per child. Integration uses three-way diff+apply (not
`git checkout <branch> -- <paths>`) to preserve parent branch history.

A dirty parent is rejected when `requireCleanBaseForParallelWrites` is true.

### Conflict retention

A failed or conflicted child worktree is **retained** for inspection. Cleanup
is never allowed to discard unintegrated changes. The batch status becomes
`needs-integration` when integration conflicts are detected.

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
