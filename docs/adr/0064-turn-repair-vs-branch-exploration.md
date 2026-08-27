# ADR 0064: Turn repair is not branch exploration

| Field | Value |
|-------|-------|
| Status | Accepted (2026-08-27) |
| Related | ADR 0055, ADR 0009, ADR 0040 |
| Revises | ADR 0055 decision 3 + spec §9.1 ("daily edit/regenerate branches") |
| Specification | [`../specs/2026-08-27-turn-repair-and-conversation-tree.md`](../specs/2026-08-27-turn-repair-and-conversation-tree.md) |

## Context

ADR 0055 routed every daily gesture — edit/resend, regenerate, failed-turn
retry — through `PromptInput.branchFromMessageId`. That field rebases the
active leaf to the target user row's **parent**, so each gesture appends a new
**user** row as a sibling.

The observed result: a user who never opened the tree, and only pressed retry
after two aborted runs, ended up with three identical prompt branches under one
fork point (`session-mt9w1adm-cktxc1ux`, 2026-08-27 15:37 / 16:08 / 16:15; two
of the three assistant rows are `Request was aborted`). The same session holds
four identical root prompts from the same cause.

This contradicts the product judgment already recorded for Session Fork
(`session-fork-product-adaptation.md` §1): *the default transcript stays
linear; a tree appears only after the user explicitly creates one.* It also
diverges from Pi, whose native tree is append-only storage plus **explicit**
`/tree` navigation — auto-retry never forks, and selecting a user entry only
pre-fills the editor so the user decides whether to branch.

## Decision

1. **Two distinct intents, two distinct writes.**
   - *Repair* — "run this same turn again". Never creates a prompt sibling.
   - *Exploration* — "keep the old answer, try something else". Creates a
     sibling, and only from an explicit gesture.
2. **Retry rebases to the user row itself, not its parent.**
   New field `PromptInput.retryUserMessageId`. Host moves the active leaf to
   that user row and re-prompts, so alternatives accumulate as **response**
   siblings under one prompt — never as duplicate prompts. Host must not
   append a second user row for a retry.
3. **Failed attempts are replaced, successful attempts are kept.**
   `PromptInput.keepPreviousAttempt` defaults to `false`. A failed / aborted /
   empty attempt is deleted (`truncateFrom` on its subtree) before the retry;
   a deliberate "try another answer" on a completed turn passes `true` and
   keeps the previous response as a sibling.
4. **`branchFromMessageId` narrows to genuine prompt edits.** Clients send it
   only when the turn's text, attachments, or context refs actually changed.
   Unchanged content is a retry, not a branch. Host rejects a prompt that
   carries both fields.
5. **Revert names one thing only: `session/truncate-from`.** The user-bubble
   revert icon is removed; that affordance becomes "edit". Destructive
   truncation is the only action allowed to be called Revert.
6. **Fork Chat is untouched.** Cross-session lineage (ADR 0009 extension,
   ST-D1..D8) keeps its current semantics and stays out of the in-session tree.

## Consequences

- ADR 0055 decisions 1, 2, 4, 5 stand unchanged: the tree still lives in the
  product store, reads stay path-scoped, `truncate-from` is still the explicit
  subtree delete, switching is still a Host command.
- ADR 0055 decision 3 is replaced by decisions 2–4 above. `session-conversation-tree.md`
  §5.2 and §9.1 are updated in the same change.
- `listBranchPoints` needs no schema change: a retry variant is simply a fork
  point whose anchor is a user row and whose siblings are assistant rows.
  Clients render that shape as response variants (`‹n/m›` on the answer), and
  a user-row-sibling shape as prompt variants.
- Sessions created before this change keep their duplicate-prompt siblings.
  They remain switchable; no migration runs.
- Sending a retry no longer paints an optimistic user bubble, so the client
  reconciliation path for retries differs from a normal send. Desktop clips
  the previous answer only after Host accepts the retry — a write-discard
  confirm must not flash the transcript first.
- “Try another answer” (`keepPreviousAttempt: true`) is Conversation-only.
  Project / Agent sessions keep error-card retry and do not expose regenerate.
