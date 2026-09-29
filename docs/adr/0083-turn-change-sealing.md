# ADR 0083: Sealing turn changes for undo

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-09-29 |
| Related | ADR 0069 (workspace write gate), ADR 0030 |
| Spec | `docs/specs/2026-08-30-file-checkpoint-restore.md` |
| Plan | `docs/plans/2026-09-29-turn-change-undo-completion.md` (P1) |

## Context

Host already recorded every Host file write (before/after object hashes),
bound runs to a per-prompt change set, and could undo/redo a published version
with per-file hash checks, backups and rollback. In practice undo never worked:

1. **Ordinary turns were never versioned.** Only subagent result freezes
   called `publishChangeVersion`; a turn ended with its change set left in
   `collecting`. `~/.piwin-test`: 0 of 249 change sets had a version.
2. **Any shell made the whole turn incomplete.** `fileEffect: uncontained`
   marked the attempt incomplete, and undo refuses incomplete turns. Of real
   turns that wrote files, 184 of 187 were incomplete — nearly every turn runs
   a `cat`, `rg` or test.
3. **Turns were registered under the wrong root.** A resumed session starts
   its turn before its project path is bound, so the change set fell back to
   the General workspace while tools wrote relative to the project. Undo then
   looked for the files in the wrong directory. 90 of those 187 turns.
4. Most read commands (`list-by-runs`, `files`, `diff`, `check`,
   `operation`) returned `unsupported-capability`; no `turn-changes/updated`
   push was sent; interrupted undo operations were not recovered at startup.

## Decision

- **Seal at segment end.** When a run segment ends, Host waits until every
  capture that run began has finished (tool timeouts finish later; bounded
  wait, then `capture-timeout`), nets all segments' writes per path, measures
  line totals, publishes the next revision, activates it, and pushes
  `turn-changes/updated`. A resumed turn is sealed again into the next
  revision; while it records, undo answers `capture-pending`.
- **Audit commands per path.** When a turn is recorded, every shell command is
  fingerprinted before and after (`git status -z` + size/mtime of dirty
  paths) and stores an audit row: `clean`, `changed` (paths), `unknown`, or
  `capture-failed` for an unpersistable receipt. Other sessions' Host writes in
  the command's window are subtracted; this session's own are not, so a
  command and a Host write on one file make that file unsafe rather than
  silently half-undone.
- **Coverage rule** (product decision): a command changing nothing tracked
  does not matter; files commands changed that the turn did not also write
  through Host tools are listed as `excludedPaths` and left alone by undo;
  overlap, an unaudited command, a broken write chain, a failed capture or a
  settle timeout make the version incomplete (`incompleteReason`).
- **Resume after undo starts a new change set** (product decision); the undone
  one stays redoable.
- **Align the root to the writes.** Receipts carry the tool's workspace root;
  the first persisted write re-points the turn at it. A turn that already
  recorded writes under another root refuses to mix (`capture-failed`).
- **Startup recovery.** Open run segments are closed (no run survives a Host
  restart; their turns seal on first read), and undo/redo operations left
  `applying` are finished or rolled back from backups. Subagent apply keeps its
  own recovery.
- **Reads answer from sealed versions**, never Git HEAD: `list-by-runs`
  (seals lazily), `files`, `diff` (cached per immutable version), `check`
  (the same hash rule undo enforces), `operation`.
- **Undo / redo lock only their files**: workspace shared plus exclusive on
  the version's paths, waiting up to 5 s. Other sessions' commands keep
  running; Host writes to the same files and repo-wide operations exclude it.
- The CLI sends an idempotency key with undo/redo (attached Hosts require it)
  and gains `piwin turn show <sessionId> <runId...>`.

## Consequences

Turns that only read or test, or that generate untracked artifacts, are
undoable; undo never touches files a command changed. Every recorded shell pays
two `git status` calls (~20ms each here; a slow repository is skipped for a
cool-down and its commands audit as `unknown`). Changes by MCP tools, extensions
or external editors are not recorded; undo still refuses any file whose bytes
moved since the turn. Turns recorded before this change keep their old
`incomplete` mark. Desktop shows the sealed record under each turn with
one-click undo / redo (`apps/desktop/src/turn-changes/`); a rejected undo
returns `reason` and `affectedPaths` so the client can name the files.
