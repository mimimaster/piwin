# ADR 0046: Inline subagent invocation projection

## Status

Accepted (2026-08-12)

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
  `session/list-children` hydration.
- Desktop can render an immediate shell before child allocation and bind it
  later without matching task text.
- Lifecycle persistence and transport push are separate effects; a dropped UI
  push cannot leave durable state running.
- The dock-first components are removed. Historical `subagentActivity` rows
  retain a compatibility renderer, while new invocations use the parent tool
  anchor and the shared child transcript renderer.
- A historical General session is never guessed into a project. The explicit
  **Continue in project…** operation creates a project-scoped copy and retains
  the original audit trail.

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
