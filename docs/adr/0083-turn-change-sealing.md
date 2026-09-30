# ADR 0083: Sealing turn changes for undo

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-09-29 |
| Related | ADR 0069 (workspace write gate), ADR 0030 |
| Spec | `docs/specs/2026-08-30-file-checkpoint-restore.md` |
| Plan | `docs/plans/2026-09-29-turn-change-undo-completion.md` (P1–P4) |

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
`incomplete` mark. Desktop shows the sealed record under each turn — only once sealed, with the
files listed directly — and one-click undo / redo
(`apps/desktop/src/turn-changes/`); a rejected undo
returns `reason` and `affectedPaths` so the client can name the files.

## Retention (2026-09-30)

The Host sweeps `~/.piwin/turn-changes` a minute after start and then daily
(`host-runtime/turn-changes/retention-schedule.ts` →
`git/turn-changes/retention.ts`). A turn whose runs all ended more than 30 days
ago is marked `expired`: its version, write-receipt and finished undo/redo backup
references are dropped, while its summary and line counts stay, so history still
shows what it changed and undo reports the data as gone. Undo/redo operations
still `applying` or `needs-repair` block expiry and keep their bytes. Object
files that nothing references are deleted after a 24-hour grace period (this
covers bytes stored just before their reference row is written). Reusing an
existing object refreshes its mtime, and the age is re-checked right before
each delete. Subagent results have no run segments and keep their own lifecycle.
On the owner's store, a dry run against a copy freed 82 MB of 98 MB (4455
orphaned objects from before sealing existed); no turn was old enough to expire.

## Operation record, cancel, failure and repair (2026-09-30)

Each undo/redo gets an `operation_note` row (workspace, created/updated time,
reason, cancel flag): a new additive table, so the schema version and the
`operation` table shared with subagent apply are unchanged.

- **Idempotency is per gesture.** Undo/redo use the caller's idempotency key
  (Desktop: one per click; CLI: one per invocation), falling back to the
  request id. The previous fallback, `turn-changes/undo:<changeSetId>`, made a
  second undo after a redo replay the first one and write nothing.
- **Mid-write failure rolls back** from the per-file backups and returns
  `rolled-back` (`write-failed`); if the rollback itself fails the operation
  stops at `needs-repair`. Either way the command answers instead of throwing.
  A `needs-repair` (or still `applying`) operation blocks both directions of
  its turn (`needs-repair` / `workspace-restoring`).
- **Cancel** (`turn-changes/cancel`) is honored only before the first write:
  the runner checks the flag after its pre-check. Once a file is written the
  answer is `write-started`; the operation completes or rolls back on its own.
- **Repair** is preview → run → verify. Preview classifies each path as
  `restored`, `operation-content` or `foreign` and returns a token bound to
  those states; run refuses a stale token and restores only
  `operation-content` paths; verify clears the block once every path is back to
  its pre-operation bytes. Foreign content is never overwritten.
- **Record** (`turn-changes/operations`, by workspace id or project path) lists
  undo/redo newest first with the turn's current summary; an operation older
  than the turn's latest successful one is `superseded` (read only).
- **Pushes**: `turn-changes/operation-updated` when an operation starts and
  when it ends, alongside `turn-changes/updated` for the turn.
- **Retention**: a turn undone or redone in the last 7 days is not expired, so
  恢复改动 survives an undo late in the 30-day window. `TurnChangeSummary.expiresAt`
  is now the last run end + 30 days.

Clients: Desktop's right-panel 本轮变更 shows the turn a card opened (查看变更),
using the same card component, and Git carries 更多 → 代码撤销记录 (list,
detail, restore, repair). The docked 变更 tool mounts the same review surface.
Mobile is read-only: it fetches summaries for visible history turns once and
shows 已撤销 / 记录不完整 / 需要在桌面端修复 / 已过期. CLI adds
`piwin turn operations|operation|cancel|repair`, and undo/redo exit non-zero
when nothing was applied.

P3's backup-export gap is closed by P4 below. Per-tool-call undo and mobile
write actions remain deferred.

## P4: Safety checks and exceptional exits (2026-09-30)

- **One precheck for check and execute** (`git/turn-changes/precheck.ts`):
  changed file → permission failure → affected staged/unmerged path → missing
  backup. Every refusal is before the first write. Git HEAD movement alone is
  not a refusal: only affected working-file bytes and index entries matter;
  unrelated staged files, HEAD and index are not modified. Non-Git directories
  skip the Git check; unauditable shell writes still make capture incomplete.
- **Durable repair guard**: `needs-repair` undo/redo operations block Host file
  tools on their recorded paths and repository-wide Git/integration operations
  on overlapping roots. Restart retains the block. Unrelated file writes and
  ordinary shells keep the optimistic ADR 0069 behavior; this is not an OS
  sandbox or a guarantee against editor/MCP/shell writes. Recovery verify lifts
  the block only after paths match the pre-operation content.
- **Model notice**: an additive `operation_notice` table tracks delivery per
  session. The next prompt/resume in a workspace tells the model which undo/redo
  happened since it began working there, with at most 20 paths per operation
  (10 operations per notice), and asks it to re-read. It does not rewrite the
  user's transcript or auto-run the model; delivery survives restart.
- **Conflicts and progress**: check/undo/redo report blocked paths and up to five
  later applied recorded turns per path, never guessing unrecorded sources.
  `diff against:current` compares sealed result to the current listed file;
  sealed diff remains immutable. `operation-updated` includes verified-file
  progress, throttled to 100 ms with the final count always sent. Desktop shows
  cancellation only before first write, unconfirmed reconnect state, conflict
  details and same-chat turn navigation (not automatic cascade undo).
- **Reconnect preserves the gesture**: Desktop waits for Host readiness then
  resends the exact command with the exact idempotency key (at most five times).
  This replays the durable Host result; it never creates a fresh operation on
  reconnect or presents transport timeout as success.
- **Backup export**: `turn-changes/export-backup` copies an operation's backups
  plus manifest to a new `piwin-undo-backup-<operationId>` directory outside the
  workspace, staged then renamed. Relative, missing, in-workspace or existing
  destinations and absent backup objects are refused. Desktop accepts an
  absolute Host directory (native picker only for local sidecar); CLI adds
  `piwin turn export <operationId> <destination>`.
- **Storage and deletion**: 5 GiB soft CAS budget; existing hashes are reused,
  new captures over budget become `storage-full` without stopping the task.
  A sweep measures usage and frees only eligible expired/unreferenced data;
  protected repair/redo data are never evicted just for space. Permanent session
  deletion warns that workspace-owned records/backups remain under retention;
  `SessionDeleteResult.turnChangeRecordsKept` reports remaining turns.

Verification and TU-A01…A24 coverage/gaps are recorded in the completion plan
§9. Browser e2e covers undo → restore → conflict → details → recheck and keyboard
activation, three repeats under CI. The isolated Host smoke uses production
HostRuntime, Git, filesystem tools and turn-change service with only model
execution mocked; it does not claim remote-provider or packaged Tauri proof.

Remaining limits: receipts/undo do not fully preserve executable/mode-only
changes; storage usage-management UI, per-tool-call undo and mobile write
controls remain separate work. These are not advertised as complete Spec
coverage (see canonical backlog D-WWG-08/09).

## Tool wording: file changes go through Host tools (2026-09-30)

Undo restores what Host recorded (before/after bytes in the object store).
Models prefer `bash` for file changes anyway, so the tool descriptions say so
positively instead of prohibiting: `edit`, `write_file`, `move_lines`,
`move_file` and `delete_file` state that every workspace file change MUST go
through them because Host records those exactly, and `bash` is described as the
tool for running programs. The former "Do not modify files with sed, perl or
python scripts" sentence is gone.

Research on other agents (Claude Code, Codex, Cline, Gemini CLI, opencode,
oh-my-pi) shows wording alone does not hold: bypass rates vary by model, and the
agents that can undo shell changes do it by snapshotting the workspace, not by
policing tools. So wording is the first of three layers; the other two shipped
with it.

## Move tools (2026-09-30)

`move_file` (move/rename; destination must not exist; keeps the file mode) and
`move_lines` (cut a 1-based inclusive line range out of a file, optionally
append it to another file that is created when missing, optionally leaving a
`replacement` behind) close the gaps that pushed models to `mv`/`sed`/scripts.
Moving a block through `edit` quotes it twice; a range does not. `move_lines`
requires the range's first and last line as a check (`startText`/`endText`,
indentation ignored): a mismatch changes nothing and the error names where the
quoted line actually is (`tools/line-range-cut.ts`).

Both write the destination first, so a failure in between leaves the content in
both files, never neither, and both record receipts like `write_file`, so undo
covers them (a rename is a delete plus an add). They lock both files in one gate
acquisition (`extraFilePaths`). Permission uses the `file-paths` subject
(existing for browser uploads): the strictest verdict over both paths wins, so a
secret path on either end denies. They are not rememberable. A multi-file
`apply_patch` is not added: `edit` calls can be issued in parallel and a patch
format is a large surface.

## Command changes are imaged (2026-09-30, product decision)

The 2026-09-29 coverage rule left files a command changed out of undo and made a
command/Host overlap on one file un-undoable. Both are now handled by giving
command changes the same before/after bytes a Host write has
(`host-runtime/turn-changes/command-capture.ts`):

- **Before the command**, every path the workspace fingerprint lists as dirty is
  read into the object store, cached by size+mtime (verified against the disk at
  hit time; entries older than 6 h are re-read so the retention sweep's
  unreferenced-object deletion never leaves a dangling hit). Cold cost is ~3 ms
  per file (the object store fsyncs), paid once per file version; capped at
  1000 paths / 128 MB per pass.
- **After the command**, each path that moved gets its after bytes from disk. The
  before image is the snapshot, or — the file was clean — its `HEAD` blob (a file
  `HEAD` lacks did not exist). `HEAD` is not trusted where the working file can
  differ from the blob while reading as clean: `core.autocrlf`/`core.eol`, or an
  `eol`/`filter`/`ident` attribute on the path.
- A path whose bytes ended up unchanged yields nothing. This also removes the
  false "changed" a `git commit` of the turn's own edits used to produce.
- Receipts are persisted like Host writes (`file_action`, settlement `applied`
  whatever the exit status) and net with Host writes through `composeFileActions`,
  so a command and an `edit` on one file chain instead of blocking undo.
- **Not imaged** — the path stays in the audit as before: commands that move HEAD
  or the index (`git checkout/reset/stash/merge…`, the exclusive-lock class),
  symlinks and other non-regular files, files over 20 MB, paths dirty before the
  command but not snapshotted (over the cap), files the filter check refuses,
  and anything past 500 paths / 128 MB in one command. Those keep the old rules:
  excluded from undo when the turn did not write them, `command-overlap` when it
  did. `unknown` (non-git workspace, slow repository, more than 5000 dirty paths)
  still makes the turn incomplete.
- Known limits: a file's mode is not part of the image (undo recreates a deleted
  file as 0644); ignored files are invisible to the fingerprint; a file changed
  and reverted inside one command is missed.

## Summary and card (2026-09-30)

The version note gains `overlapping_paths_json` (guarded `ALTER TABLE` for
existing stores; schema version stays 1) and the summary `overlappingPaths`: the
files a command changed that the turn also wrote and that could not be chained —
the ones that actually block undo. `excludedPaths` now means only what could not
be imaged. The card: an incomplete turn names `overlappingPaths` (five, then a
"另有 N 个" toggle) and states the excluded ones as a count ("另有 N 个文件由命令
修改" — the "not in the undo scope" wording is gone there because nothing is
undoable); a turn that can be undone folds its excluded list to three chips with
a "另有 N 个由命令修改" toggle. The right-panel 本轮变更 (`placement="panel"`)
lists everything. The CLI prints the blocking files and folds long lists.

## Command-created files that changed later are left alone (2026-09-30, product decision)

Imaging command changes (above) puts generated files in the undo set, and they
are the files most likely to keep changing after the turn (a dev server or
watcher, a test appending to a log, a lockfile a background process rewrites).
With the all-or-nothing pre-check, one such file would make the whole undo
refuse — stricter than the agents that snapshot the workspace (Cline, Gemini
CLI, opencode, Codex), which restore by overwriting.

The one exception: a file **only commands touched** (`file_action.origin =
'command'` on every action; `change_file.command_only`) **that the turn created**
(before image: absent) is `skippable`. In an undo, if it changed since the turn
it is reported and left out of the operation (nothing written, backed up or
verified for it); if it is already gone it is dropped silently. Everything else
still has to match its recorded bytes, and staged-path and backup checks run over
the remaining files only. If every file that would be undone is skipped, the undo
is refused as `files-changed` as before.

- The skipped paths are stored on the operation (`operation_note.skipped_paths_json`)
  and returned as `skippedPaths`; the summary carries them as `leftInPlacePaths`
  while the turn is `undone`. The card says "有 N 个命令新建的文件在这一轮之后又被改动，
  撤销没有动它们", folded like the other command lists; the CLI prints a
  `left in place` line.
- **Redo leaves the same files alone**: the undo never reverted them, so re-applying
  them would overwrite the later changes (`planTurnChangeFiles`, shared by the run
  and `turn-changes/check`).
- A file a Host tool wrote, and a file a command modified rather than created,
  stay strict. The model notice after an undo lists only files actually rewritten,
  since skipped files are not in the operation's file rows.
- Additive schema: `file_action.origin`, `change_file.command_only`,
  `operation_note.skipped_paths_json`, each added to existing stores by a guarded
  `ALTER TABLE`; the schema version stays 1.

