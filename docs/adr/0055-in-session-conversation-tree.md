# ADR 0055: In-session conversation tree (product store)

| Field | Value |
|-------|-------|
| Status | Accepted; Stages 1–5 implemented (write-boundary warn-only) |
| Date | 2026-08-21 |
| Related | ADR 0009, ADR 0040, ADR 0038 |
| Specification | [`../specs/session-conversation-tree.md`](../specs/session-conversation-tree.md) |
| Plan | [`../plans/2026-08-18-conversation-tree-s2-execution.md`](../plans/2026-08-18-conversation-tree-s2-execution.md) |

## Context

The product transcript was a linear SQLite log. Edit/resend, revert, and
regenerate called `session/truncate-from` and physically deleted later rows.
Trying another wording required a new `session/fork` session.

Pi already has a native session tree, but wiring `piSessionFile` into
create/resume is the residual ADR 0009 spike (D-M2-01b / D-M2-02-full). That
path stays closed: a wrong Pi JSONL resume looks resumed and is silently
wrong.

## Decision

1. **The tree lives only in the product store.** Each `transcript_message`
   row has `parent_message_id`. `transcript_meta.active_leaf_message_id`
   names the visible path. Clients never persist parent ids on
   `SessionTranscriptMessage`.
2. **Reads are path-scoped.** Pages, outline, search, history injection, and
   fork/duplicate walk the active path. Sibling branches stay on disk until
   the user switches or deletes a subtree.
3. **Daily edit/regenerate branches.** `PromptInput.branchFromMessageId` is
   the **user message being replaced**. Host resolves that row's parent
   (including a null root parent) and appends a sibling. Clients do not send
   the parent id.
4. **`session/truncate-from` is explicit destruction.** It deletes the
   target subtree, not a linear `sequence >=` tail. Desktop exposes it only
   as “Delete this and after”. Revert opens the edit card with no Host call.
5. **Switching is a Host command.** `session/branch-list` / `session/branch-switch`
   plus `session/branch-updated`. A live foreground run returns `run-active`.
   Unconfirmed switches that abandon writes return `needs-confirmation`.

This design **replaces** the D-M2-01b / D-M2-02-full “true Pi JSONL multi-leaf
tree” residual. Those IDs remain only as “do not resume Pi JSONL”.

## Consequences

- ADR 0009's truncate-from rebuild still applies to the **explicit** subtree
  delete. Edit/resend no longer truncates; Host rebases the leaf, then the
  next prompt injects the new path.
- Desktop shows `‹ n/m ›` on the active sibling head. CLI prints an indented
  fork list (`piwin session branches` / `switch`).
- Workspace files do not follow a switch. Host warns when the abandoned
  path wrote files; v1 confirmation is continue/cancel only. The next
  prompt injects the abandoned file list plus a bounded git snapshot.

## Deviations from spec §5 (settled)

1. `branchFromMessageId` names the replaced **user** row, not its parent.
2. Write-boundary confirm is two options (continue / cancel); worktree waits
   on SF-06.
3. Abandoned-branch calibration injects file list + git truth, not an LLM
   `branch_summary`.
