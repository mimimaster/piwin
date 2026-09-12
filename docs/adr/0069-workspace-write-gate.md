# ADR 0069: Host workspace write gate

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-09-08 |
| Related | ADR 0012, ADR 0030 |
| Spec | [`2026-09-08-workspace-write-gate.md`](../plans/2026-09-08-workspace-write-gate.md) |
| Execution | [`2026-09-08-workspace-write-gate-execution.md`](../plans/2026-09-08-workspace-write-gate-execution.md) |

## Context

Host-owned `write_file` / `delete_file` / `bash` / Git writes / subagent
integrate shared one in-process exclusive lock per workspace realpath.
Contention returned `workspace-busy` immediately. Parallel writes of different
files in one turn failed. Undo did not take the lock. Parent and child project
roots did not conflict.

Worker-local writes stay closed (ADR 0012). Subagent worktrees stay isolated;
only parent integrate takes the parent lock (ADR 0030).

## Decision

Process-local fair FIFO, two levels:

- Exact-path `write_file` / `delete_file`: workspace shared + canonical file exclusive.
- `bash` / `run_bash`, Git mutations, parent integrate: workspace exclusive, wait.
- undo / redo: workspace exclusive, fail-fast `workspace-busy`, no queue.

File identity is `resolveFileLockKey` in `@piwin/git` (existing ancestor
realpath + missing suffix). Workspace exclusive conflicts when roots are equal
or ancestor/descendant. Independent worktrees do not share that lock.

Waiting uses `AbortSignal`. Permission admission stays before the lock.
`workspace-busy` is for undo collision (and reserved restoring/foreign-host
reasons), not everyday parallel writes.

Reviewed-delivery apply (`piwin_subagent_result_apply`) does not add a second
writer. After an exact durable `approved` review, parent mutation still takes
the existing exclusive integrate lease and the existing integration
coordinator. Reviewer isolation stays readonly; worker writes stay on the
child worktree until that one gated apply.

## Consequences

Same-turn writes of different files succeed. Long shell still serializes with
other Host writes in that workspace. Integrate waits for the workspace exclusive
instead of failing immediately. Clients must not treat `workspace-busy` on
`write_file` as the normal parallel-write outcome.
