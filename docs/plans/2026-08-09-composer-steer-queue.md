# Composer Steer Queue

## Problem

Desktop currently treats Enter during a running turn as an immediate steer and
optimistically inserts a `[Steer] ...` message into the transcript. This makes
an execution control look like a detached system message and gives the user no
place to review several follow-up instructions.

The existing `SteerQueue` presentation is not connected to application state,
is visually detached from the composer, and includes an unrelated
"Start Multitasking" action.

## Product behavior

1. While a turn is running, Enter adds the text to a session-scoped queue.
2. The queue is attached directly to the top edge of the composer. New items
   are appended nearest the composer, so the surface grows upward.
3. Queue items can be edited or removed before execution.
4. When the current turn completes, the first queued item is submitted as the
   next normal user turn. Remaining items drain one turn at a time.
5. A queue item can be sent immediately as a steer into the active turn.
   `Command/Ctrl+Enter` provides the same immediate-steer shortcut for the
   current composer text.
6. Immediate steer messages render as ordinary user messages. Product-only
   `[Steer]` and `[Follow-up]` prefixes must never enter the visible transcript.
7. Queue state is Desktop-local and scoped by session. The Host remains the
   authority for accepted prompts and active-run steer validation.

Desktop-local means these entries have the same durability boundary as an
unsent composer draft: they are not accepted Runs, do not survive a Desktop
restart, and are not projected to another shell. This is intentional Desktop
UX degradation for this slice; CLI keeps its explicit `steer` / `follow-up`
commands. A future durable, multi-client queue must start with a Host contract
and HostPush projection rather than reusing this local state.

## Implementation boundary

- `apps/desktop`: queue model/state, composer interactions, attached queue UI,
  localized copy, optimistic steer presentation.
- `packages/contracts`: optional `clientMessageId` on `session/steer`, allowing
  the Host transcript row to match the optimistic Desktop row.
- `packages/host-runtime`: persist an accepted steer as a user transcript row.

No Pi packages are imported by Desktop, and the Host queue protocol is not
expanded: editable waiting items remain client-side until they are submitted.

## Verification

- Pure queue model tests cover append order, session isolation, edit, remove,
  and head consumption.
- Composer tests cover Enter-to-queue, Command/Ctrl+Enter-to-steer, attached
  queue rendering, and item actions.
- Host live-command tests verify accepted steer persistence and stale-steer
  rejection without persistence.
- Run Desktop/package typecheck and touched Vitest suites.
