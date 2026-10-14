# ADR 0046: Inline subagent invocation projection

## Status

Accepted (2026-08-12)

**Presentation update (2026-08-30, `feat/subagent-delivery-review`):** Desktop
inline/inspector observation no longer shows a standing apply/retain/discard
bar. Ordinary delivery is Host-owned on the parent turn (ADR 0030 delivery
update). Child panels remain for status, process, and transcript.

## Context

Subagent execution was presented in a composer-adjacent working dock.
The parent transcript does not own a stable link from the model's
`piwin_subagent_run` tool call to the child task/session, while the child
inspector maintains a second simplified transcript renderer. This causes three
product problems:

- parallel calls cannot be durably restored at their causal positions in the
  parent response;
- a child session may remain visibly running when preparation fails before the
  worker starts;
- child tool/message streaming differs from the main session presentation.

The parent tool executor already receives a Run identity, and normalized Agent
events already carry generation-scoped tool-call identities. The missing seam
is to carry that tool-call identity into Host tool execution and persist its
association with the child.

## Decision

One model-facing subagent invocation is anchored by the normalized parent
`toolCallId`. The Host assigns an additional opaque `invocationId` and persists
the relationship among parent Run, parent tool call, task, batch Run, and child
session. Display names, task text, and list positions are never identities.

The UI uses two data paths:

- the parent transcript's `piwin_subagent_run` tool card is the stable visual
  anchor and appears immediately on `tool/start`;
- Host-owned child lifecycle projections and ordered `subagent/stream` Agent
  events update status/latest activity and hydrate the full child transcript.

The specialized subagent block replaces the generic delegation tool card at
the same causal position. Current-response subagents are not duplicated in the
composer dock. A background notification may exist only for work whose parent
transcript is not visible.

The Host is the lifecycle authority. After a child session is allocated, every
terminal task result carries its `childSessionId`, and durable terminal
persistence is independent of push delivery. General readonly children inherit
General scope; General worktree admission fails before child allocation.

The child-session window reuses the main normalized transcript and tool-card
rendering. Raw hidden chain-of-thought is never projected as latest activity;
only normalized reasoning summaries, public assistant text, tool presentation,
waiting state, and terminal facts are eligible.

Follow-up input is a separate Run admission path. It cannot reopen an already
terminal batch or silently leave a retained worktree.

## Consequences

- Host tool execution input gains an optional/proven parent tool-call identity,
  and SDK/RPC worker adapters must normalize it exactly as Agent events do.
- Child session/index projections carry invocation linkage for restart and
  `session/list-children` hydration. Child records persist but do not appear
  in the product main session list (`session/list`, `session/list-page`,
  `session/search`); they are reached from the parent transcript inline panel
  and `session/list-children`. Side chats already follow the same rule (SIDE-D9).
- Desktop can render an immediate shell before child allocation and bind it
  later without matching task text.
- Lifecycle persistence and transport push are separate effects; a dropped UI
  push cannot leave durable state running.
- The dock-first components are removed. Historical `subagentActivity` rows
  retain a compatibility renderer, while new invocations use the parent tool
  anchor and the shared child transcript renderer.
- A historical General session is never guessed into a project. The explicit
  **Continue in project…** operation copies the session into the chosen
  destination scope — a trusted project, or `No Repo` (General) to carry a
  repo-bound session back out — and retains the original audit trail.

## Acceptance criteria

- two parallel identical task texts bind to different parent tool calls and
  different child sessions;
- project and General scope inheritance is explicit and tested;
- no post-allocation failure can omit the child id from its terminal result;
- reconnect/restart restores the inline block and terminal state;
- the child modal renders the same normalized message/tool sequence as the main
  transcript;
- current-response child work is not duplicated above the composer.

## Client presentation status (2026-08-13)

Desktop implements the full inline projection. The CLI is an intentional
degradation for now: it ignores the `subagent/invocation-updated` and
`subagent/stream` pushes entirely, so subagent progress is visible only through
the parent's tool result text. Durable state (invocation records, child
sessions) is Host-owned and identical for both shells; reconnecting from
Desktop shows the complete record. Revisit when the CLI gains a transcript
renderer for pushes.

Desktop live projection (2026-08-13): completed assistant messages are retained
as bounded segments (cap 30). Empty `message/end` shells are kept so a
tool-only assistant is not wiped by the next `message/start`. Inspector history
refresh keys off a monotonic `completionRevision`, not segment array length,
so a long child still refreshes after the cap.

Desktop delivery presentation (2026-08-30): the standing worktree
apply/retain/discard action bar is removed from the inline child panel.
Host capability flags `subagentDeliveryV1`, `subagentResultReviewV1`, and
`turnChangeUndoV1` are advertised true so clients can gate new surfaces
honestly. Candidate adopt/mutex UI, parent `request-resolution` prompt wiring,
and Tauri smoke evidence for the full delivery-review acceptance matrix are
**not** claimed shipped here.

## Async delegation presentation (2026-09-13, `feat/async-subagents`)

Model-facing structured in-turn concurrency splits **invocation anchors** from
**control tools**:

- `piwin_subagent_start` creates exactly one `SubagentInvocation` card at the
  parent transcript tool position (same causal anchor as synchronous
  `piwin_subagent_run`).
- `piwin_subagent_wait` and `piwin_subagent_cancel` are control tools only —
  they are not invocation topology nodes. Desktop renders Host-normalized
  `ToolPresentation.subagentControl` for wait/cancel lifecycle rows and never
  parses raw tool text when that field exists.

The parent transcript owns invocation cards plus wait/cancel lifecycle rows. The
right panel **Tasks** tab shows the F1 orchestration overview for the active
batch; it does not auto-open on spawn.

The composer **activity pill** above the input is a compact reachability rail
(Cursor-style Working count) for in-flight async subagents and live
`process_start` jobs. Its popover jumps to invocation cards or Terminal job
logs; Stop uses only `subagent/batch-cancel` and `job/stop`. The Terminal tab
adds a zsh PTY plus a job-log switcher so nohup-style services stay reachable;
it is not a second scheduler.

This pill is **not** a return of the old composer-adjacent current-work dock
removed by this ADR. The transcript invocation card remains the causal anchor;
the pill is reachability for background work only.

## Reviewed-delivery loop presentation (2026-09-13, `codex/subagent-review-loop`)

Desktop joins Host-normalized invocation, result, review, and verification
facts into one connected loop (F1) and renders it on the transcript card and
Tasks panel (F2). It does not parse raw tool text for decisions or lineage.

- Candidate generations stay inspectable. v1 is stale once v2 is the lineage
  head; a v1 approval cannot look applied.
- `approved`, `applied`, and `verified`/`delivered` are separate phases.
  `Delivered` requires a durable passed verification fact, not a verification
  ref and not an approved review.
- Reviewer submit and result-read stay linking metadata, not extra child
  topology cards. Continuation is the same worker identity with a new Run /
  generation.
- CLI still ignores subagent push surfaces; rich nesting remains Desktop-only.

## Fan-out and dense preview (2026-10-14, `feat/subagent-fanout-preview`)

Owner direction: users never jump into a child session, and the preview
should be dense and plain rather than a second copy of the main transcript.
This supersedes the "child-session window reuses the main normalized
transcript and tool-card rendering" decision and its acceptance criterion
("the child modal renders the same normalized message/tool sequence as the
main transcript").

- **No navigation into child sessions.** The inline preview no longer offers
  "Open full session"; the `openFullSession` plumbing is removed. Child
  records still persist and remain reachable through
  `session/list-children` for hydration — only the Desktop entry is gone.
- **Dense preview, own renderer.** `SubagentPreview`
  (`subagent-preview-model.ts` + `subagent-preview.tsx`) lists one plain line
  per child step — `time · verb · target · result` from Host-normalized
  `ToolPresentation` — followed by the final report as plain text. No
  Markdown, tool cards, diffs, file-change bars or artifacts. The child's
  pending permission gate is the only control and is never folded. The
  retained tail grows from 20 messages to 200 lines because a line is cheap.
- **Fan-out for parallel delegations.** A group with two or more delegations
  draws a display-only main-agent node, one phase-coloured wire per child,
  and fixed-height rows (`SUBAGENT_FANOUT_ROW_HEIGHT`). Rows keep two lines in
  every phase (a finished row shows its conclusion's first line) so wire
  geometry is pure arithmetic and rows never change height. Narrow cards swap
  curves for a tree rail via a container query. A lone delegation keeps the
  single-row card.

Prototype: `apps/docs/public/inkstone/proto-14-subagent-fanout.html`.

New acceptance criteria:

- no Desktop affordance navigates the active session to a child session;
- the preview lists each child tool call as one line in causal order (persisted
  history, then the live tail), and shows the final report without Markdown
  rendering;
- a pending child permission prompt is actionable from the preview;
- ≥ 2 delegations in one group render as a fan-out whose wire endpoints depend
  only on the row index.

### TUI parity (2026-10-14)

The TUI follows the same three rules; the "CLI ignores the pushes" note
above is superseded (it already consumed `subagent/invocation-updated` and
`subagent/result-updated`).

- **Fan-out in the transcript.** Two or more consecutive delegation tools in
  one assistant message render as one block: header with counts, a
  display-only `主代理` label on the origin row, one box-drawing branch and
  one line per child, coloured by phase. Below 72 columns it falls back to a
  plain `├ └` tree. A lone delegation keeps its tool line plus one `└` row;
  synchronous `piwin_subagent_run` rows are now live too (matched through
  `SubagentInvocation.parentToolCallId`).
- **Dense preview, shared projection.** `/subagents` → Enter opens the
  preview. The line projection lives in `@piwin/host-client`
  (`subagent-preview-projection.ts`, `subagent-report-text.ts`) and is used by
  both Desktop and the TUI; each shell only paints it.
- **`subagent/stream` is consumed.** A small tail per child gives the running
  step on fan-out rows and live lines in an open preview; a finished message
  triggers a throttled `session/messages` refetch. Child
  `permission/request` events now queue the regular permission dialog
  (titled with the child) — previously a child waiting for approval was
  invisible in the TUI — and can also be answered from the preview.
- **Removed:** "open the child's conversation" and "send the child a
  follow-up" (`subagent/continue`) from the TUI. Delegation and follow-ups
  belong to the parent agent. The Host command itself is unchanged.
