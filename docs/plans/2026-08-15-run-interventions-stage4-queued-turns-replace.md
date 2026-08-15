# Run Interventions Stage 4: queued turns and Replace Run

| Field | Value |
|-------|-------|
| Date | 2026-08-15 |
| Status | Implemented; bounded evidence complete |
| Parent | [coding-agent long-run dogfood review](./2026-08-15-coding-agent-long-run-dogfood-review.md) |
| Spec | [run interventions](../specs/run-interventions.md) |
| ADR | [0051 Host-owned run interventions](../adr/0051-host-owned-run-interventions.md) |

## Goal

Move the normal next-turn queue out of Desktop memory and make the Host the
authority for both `Send` while a Run is active and `Replace Run`. A queued
turn is a normal prompt that has not started yet; it is never Pi steering and
never changes the current Run's model context.

This slice deliberately keeps the existing `session/prompt` command for
backward-compatible direct sends. New clients use the explicit queue and
replace commands. The Host drain calls the existing prompt admission path only
after the foreground Run is absent, so that path cannot silently supersede a
different Run during a normal queue drain.

## Frozen design decisions

### Record and lifecycle

Queued turns use their own `queued_turn` table and public record. They do not
reuse `run_intervention` rows or its terminal reasons.

```text
pending → starting → started
   ├──────────────→ cancelled
   └──────────────→ failed
```

`pending` is durable Host acceptance. `starting` is a short-lived claim while
the Host is admitting the normal prompt. `started` means the record is bound to
one ordinary `runId`; the Run owns all later execution state. `cancelled` and
`failed` are terminal and are never retried implicitly. A client may explicitly
retry by creating a new queued-turn id.

The record contains the complete, validated `PromptInput` accepted by the
Host, including media references, context references, model, thinking level,
mode, skill and orchestration selections. The accepted payload is immutable;
edit creates a new revision of the same record while it is `pending` only.
Media files remain Host-owned paths under the existing media root and are
revalidated at drain time.

```ts
type QueuedTurnRecord = {
  queuedTurnId: string;
  revision: number;
  sessionId: string;
  sequence: number;
  userMessageId: string;
  status: QueuedTurnStatus;
  input: PromptInput;
  submittedAt: string;
  updatedAt: string;
  startedRunId?: string;
  replaceRunId?: string;
  terminalReason?: QueuedTurnTerminalReason;
};
```

`replaceRunId` is set only for Replace Run records and is the exact Run that
must become terminal before the record can enter `starting`. A queued turn's
`userMessageId` is also the transcript row id and the idempotency identity for
the optimistic client bubble.

### Stable status and error vocabulary

```ts
type QueuedTurnStatus = 'pending' | 'starting' | 'started' | 'cancelled' | 'failed';

type QueuedTurnTerminalReason =
  | 'user-cancelled'
  | 'run-replaced'
  | 'session-closed'
  | 'prompt-rejected'
  | 'preparation-failed'
  | 'media-unavailable'
  | 'runtime-unavailable'
  | 'replacement-target-mismatch'
  | 'replacement-cancellation-timeout'
  | 'host-restarted';
```

Command failures use stable prefixes: `queued-turn-not-found`,
`queued-turn-idempotency-conflict`, `queued-turn-revision-conflict`,
`queued-turn-bounds-exceeded`, `queued-turn-no-active-run`,
`queued-turn-run-mismatch`, `queued-turn-replace-ineligible`, and
`queued-turn-admission-failed`. Human-readable detail may follow the prefix.

### Idempotency, ordering and compare-and-swap

The client supplies `queuedTurnId` and `userMessageId`. A repeated submit with
the same id is replayed only when session, mode (`next` or `replace`), target
Run, and a canonical JSON fingerprint of the full input match. A different
fingerprint returns `queued-turn-idempotency-conflict` and cannot mutate the
existing row.

The store assigns a monotonic `sequence` under `BEGIN IMMEDIATE`, scoped to a
session. This is the source of truth for display and drain order. Each
mutation increments `revision`. Edit, cancel and reorder require the current
revision; a stale client receives `queued-turn-revision-conflict` and must
rehydrate. Reorder accepts a complete ordered list of queued ids plus the
expected queue revision. The store validates that the list contains every
non-terminal id exactly once, then rewrites sequence values in one transaction.

Bounds are enforced before persistence: at most 20 pending turns per session,
64 KiB UTF-8 text per turn, and 512 KiB aggregate pending text per session.
Attachments are checked against existing media limits and ownership rules.

### Normal queue drain

The Host owns one drain promise per session. Submit of a `next` turn and every
foreground Run terminal callback request a drain. The drain loop:

1. serializes with the per-session promise;
2. returns while a foreground Run exists;
3. claims the earliest `pending` record with a revision CAS to `starting`;
4. emits `session/queued-turn-updated(starting)`;
5. revalidates media and the durable session;
6. invokes the existing prompt admission path with the frozen input and the
   queued `userMessageId`;
7. on accepted Run, transitions the record to `started` with that `runId` and
   emits the latest projection;
8. on rejection, transitions to `failed` with a stable reason and continues to
   the next pending record only when no foreground Run was admitted.

The prompt path must not supersede an active Run when called by this drain.
This is expressed by an internal `admission: 'queued-turn'` option rather than
by a client-visible flag. The queue record is the only user transcript row;
the prompt path reuses `userMessageId` and does not insert a duplicate row.

The drain starts only after the old `run/terminal` push has been emitted. The
terminal callback schedules the drain in a microtask/next turn, which gives
the transport egress hub a strict observable order:

```text
old run/terminal
  → queued-turn starting/started (or failed)
  → new run/updated / agent events
```

### Replace Run

Replace is a dedicated command. It requires an exact non-terminal foreground
`runId` and an input that passes the same synchronous validation as a prompt.
The Host first creates a durable queued-turn record with `replaceRunId` in a
transaction, then marks the exact Run `cancelling` and requests cancellation.
The command response reports the queued record; it does not claim that the
replacement Run has started.

The replacement drain waits for the target Run's terminal notification. It
does not trust a generic `no active run` observation: a target mismatch or a
newer Run is a failure for the replacement record. Once the target terminal is
observed, the drain emits the terminal barrier and admits the frozen prompt.
If bounded cancellation cleanup fails, the replacement becomes `failed` with
`replacement-cancellation-timeout`; no new Run is admitted behind a quarantined
generation. Completed tool side effects are not rolled back.

At Host restart, pending `next` records remain pending and may drain after the
session is ready. A `replace` record whose target Run was not restored is
marked `failed(host-restarted)` during reconciliation; it is never replayed as
an unconditional new prompt. A `starting` record is also failed during
reconciliation because its admission outcome is ambiguous.

### Transcript and history

The queue record is projected into one provisional user transcript row with
`instructionDelivery.kind = 'queued-turn'`. Pending, starting, cancelled and
failed rows remain visible but are excluded from cold model history. When the
normal prompt is admitted, the same row becomes `started` and is included in
history only through the ordinary user-message path. No second user row is
written.

### Transport and hydration

`session/queued-turn-updated` is a sibling HostPush projection classified as a
control/projection keyed by `(sessionId, queuedTurnId)`. The latest revision is
replayable and the terminal push is a barrier. `session/queued-turn-list`
returns all non-terminal plus recent terminal records for one session.

Hydration includes the bounded queue list for subscribed sessions in addition
to transcript messages. Legacy clients that do not advertise the capability
continue using the old local queue path; a capable client never treats local
state as authoritative.

## Implementation sequence

1. Add contracts, status guards, bounds, commands, push and capability fields.
2. Add store schema, row conversion, fingerprint/CAS/reorder, restart
   reconciliation, transcript projection and history filtering.
3. Add Host command handlers and a focused per-session queue coordinator.
4. Add terminal-barrier scheduling and queued prompt admission.
5. Add host-server allowlist/projection/hydration and transport policy.
6. Add Desktop reducer/bootstrap projection and replace/send queue actions;
   retain optimistic paint only until Host ACK.
7. Add CLI inspect/edit/cancel/reorder/replace operations.
8. Run the Stage 4 fault matrix and update dogfood evidence.

## Explicit non-goals

- No automatic retry of failed or uncertain queue admissions.
- No intervention/queued-turn merging or batch prompt semantics.
- No rollback of filesystem, process or other completed tool side effects.
- No removal of legacy `session/prompt` or `session/steer` until Stage 5.
