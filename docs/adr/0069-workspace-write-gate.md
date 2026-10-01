# ADR 0069: Host workspace write gate

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-09-08 (revised 2026-09-29: optimistic shell) |
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
- `bash` / `run_bash` (default): workspace shared with no file keys ("shell
  lease"). Shells run beside file writes and each other; they only wait for
  exclusive holders. See the 2026-09-29 revision below.
- `bash` / `run_bash` naming a repo-wide mutation — Git subcommands that move
  HEAD, the index or many files (`checkout`, `switch`, `reset`, `restore`,
  `stash`, `rebase`, `merge`, `pull`, …; not the index-only `add` / `commit`,
  which Git's own `index.lock` serializes), package installs,
  repo formatters with `--write` / `--fix` — plus Host Git mutations and parent
  integrate: workspace exclusive, wait. The list lives in
  `host-runtime/src/tools/shell-write-policy.ts` with golden cases.
- undo / redo: workspace shared + exclusive on the turn's own files, waiting up
  to 5 s (then `workspace-busy`). Revised 2026-09-29: workspace exclusive with
  fail-fast made undo fail whenever any other session's command was running;
  undo's safety is its per-file hash check before and after writing (ADR 0083).

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

## Revision 2026-09-29: optimistic shell

The product owner chose optimism over serialization. Holding workspace X for
every shell made parallel sessions on one checkout queue every `rg`, `sed` and
`git status` behind another session's multi-minute test run; a 40ms command
read as a seven-minute one. No other coding agent we surveyed (Claude Code,
Codex, Cursor, OpenCode) puts a workspace lock on shell; they isolate with
worktrees or detect staleness per file.

Correctness moves from prevention to detection:

- **Activity log.** Every granted lease is recorded on a logical clock with its
  owner (session id) and file keys (`workspace-activity-log.ts`).
- **Shell result note.** When an optimistic shell ends, Host asks whether other
  sessions were active in the workspace during it. If another session wrote
  files through Host, or ran commands and the dirty set (a `git status -z` +
  size/mtime fingerprint) changed, the tool result carries a short note and
  `details.workspaceWrite.concurrentChanges`: the result — typically a test or
  build — may reflect a mix of versions. Other sessions only reading produce
  no note. Fingerprints are taken only while sessions overlap: a shell that
  starts while another session is live snapshots first and publishes it; a
  shell that started alone uses the first snapshot published after its start
  (`shell-baselines.ts`). When the turn is recorded for undo (production),
  every command is fingerprinted before and after anyway for its audit
  (ADR 0083), and the note reuses those fingerprints.
- **Write-after-write check.** `write_file` / `delete_file` remember the hash
  each session last wrote. If the bytes moved since and another session was
  active on that file or workspace meanwhile, the write is refused once
  (`reason: file-changed-by-other-session`) so the model re-reads. Drift with no
  foreign activity (the session's own formatter, an external editor) is
  allowed; so is drift when only shells ran and this session ran shells too
  (Host cannot tell whose shell touched the file). Read-before-write is not
  covered: `read` runs in the worker.
- **Host `edit`.** Targeted exact-text replacement registered under Pi's tool
  name and schema (`edits: [{ oldText, newText }]`), overriding Pi-native `edit`
  like Host `bash` does. The match runs against the bytes on disk inside the
  file lock: another session's change elsewhere in the file survives, a change
  to the same region fails the match and the model re-reads. No fuzzy fallback,
  since a loose match could land on text another session just rewrote. It is
  exempt from the write-after-write refusal but never vouches for a version
  the session has not seen, so a later whole-file overwrite is still caught.
  Pi's operation-seam factory was not used: it reads and writes through two
  separate calls from the worker, leaving the match outside the lock.
  `write_file` and `bash` descriptions steer partial edits here, away from
  `sed` / `python` scripts that Host cannot attribute or undo.
- **Undo** is unchanged and already safe: it verifies every file against the
  recorded hash and rejects with `files-changed`, then verifies after writing.
- **Queue time** is measured at the gate and reported as
  `details.workspaceWrite.queuedMs`; the Desktop tool card shows it apart from
  the run time.

- **Bounded reader preference.** Shared requests may pass a queued exclusive
  request for its first 20 s. Strict FIFO let one `git checkout` queued behind a
  long test stall every other session's shell until the test ended; after the
  window new shared requests queue behind it, so the exclusive is not starved.

Accepted costs: two sessions' shells writing the same file race, and the loser
is only reported afterwards; a test may run against a mix of versions and is
annotated, not blocked; undo refuses more often with `files-changed`; an
exclusive command waits up to the bypass window plus the shells admitted in it.

Parallel sessions that need real isolation should still use worktrees; roots
that do not overlap never share a lease.

## Consequences

Same-turn writes of different files succeed. Ordinary shell no longer
serializes with other Host writes or other shells in that workspace; only the
listed repo-wide commands, Git mutations and integrate take the workspace
exclusive, and they wait for running shells. Integrate waits for the workspace
exclusive instead of failing immediately. Clients must not treat
`workspace-busy` on `write_file` as the normal parallel-write outcome.
