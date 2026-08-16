# Run Interventions

| Field | Value |
|-------|-------|
| Status | Active; run-intervention stages 1–4 implemented; Stage 5 cleanup pending |
| Date | 2026-08-15 |
| Decision | [ADR 0051](../adr/0051-host-owned-run-interventions.md) |
| Scope | Contracts, session persistence, HostRuntime, agent-host, Host transport, Desktop, CLI |

## 1. Product outcome

During a long Agent Run, users need three different things:

1. **Adjust direction** — let the current model response and active tool batch
   reach a safe boundary, then give the same Run a new instruction.
2. **Do this next** — leave the current Run unchanged and start a new normal
   turn afterward.
3. **Stop and replace** — cancel the exact current Run and start a new normal
   turn after cancellation settles.

The current product mixes these intents across `steer`, `follow_up`, a
Desktop-local queue, optimistic transcript rows, and normal prompts. The target
system makes each intent explicit, durable, observable, and consistent across
SDK/RPC backends and multiple clients.

The user-facing promise for Adjust direction is:

> Your instruction is saved now. It will be applied after the current response
> and current tool batch reach the next safe checkpoint. The UI will tell you
> whether it was applied to this Run or the Run ended first.

It is not an immediate provider interruption and it is not a guarantee that
the model will obey.

## 2. Terminology

### Run intervention

A durable instruction addressed to one exact active foreground Run. It may be
edited or cancelled while pending. It is applied at most once.

### Safe checkpoint

The boundary after the current assistant message and its current tool batch
have settled, but before the next provider request begins. A pending permission
or long-running tool is not a checkpoint. Deny, Stop, Pause, or Replace remains
the control for those situations.

### Queued turn

A durable normal prompt waiting to create a new Run. It is not inserted into
the current Run's model context.

### Replace Run

A Host-owned workflow that persists a new-turn intent, cancels an exact active
Run, waits for terminal confirmation, and then starts the new normal Run.
Completed side effects are not rolled back.

### Applied

The instruction was included in the model-facing context before a specific
provider request. Applied does not mean completed, successful, or obeyed.

## 3. Non-negotiable invariants

1. One intervention targets exactly one `runId`; the field is never optional.
2. One `interventionId` can be applied at most once.
3. Host durable acceptance happens before backend arming.
4. A command response reports Host admission; a push reports later application.
5. A terminal Run cannot accept, arm, or apply a new intervention.
6. A different runtime generation cannot consume an older intervention.
7. An intervention that missed its Run is `expired`; it is never silently
   converted into a queued turn.
8. Pending or expired intervention text is not injected during cold history
   reconstruction.
9. Applied model content is exactly the prepared content recorded for model
   visibility.
10. Desktop, CLI, mobile, and Web observe one Host-owned ordering and state.
11. Agent execution does not wait for a disconnected or slow client.
12. Intervention state is a product `HostPush` projection, never a fake Pi
   `AgentEvent`.

## 4. Product interaction model

### Target composer behavior during an active Run

Stages 1–4 are implemented. Desktop Enter now uses the Host-owned queued-turn
projection; `Cmd/Ctrl+Enter` uses Run intervention. Replace Run is available at
the Host/CLI boundary, while the Desktop “Stop and send this instead” action
remains a Stage 5 UI migration item.

| User action | Product meaning | Shortcut |
|-------------|-----------------|----------|
| Send | Add a durable queued turn | Enter |
| Adjust current direction | Submit a Run intervention | Cmd/Ctrl+Enter |
| Stop and send this instead | Replace Run workflow | Explicit menu action |
| New line | Edit the draft | Shift+Enter |

The primary Send action remains calm and non-destructive. The intervention
shortcut is available, but UI copy must say `Adjust after current step`, not
`Interrupt now` or `Send now`.

### Converting a queued message into an intervention

Each queued message row offers an explicit `Adjust current run after this
step` action. The action submits `run/intervention-submit` with an
`adoptQueuedTurn: { queuedTurnId, expectedRevision }` block: the Host cancels
the queued turn (terminal reason `converted-to-intervention`) and creates the
intervention bound to the active Run in one store transaction, re-binding the
already-painted user row instead of appending a second copy. The message then
follows the normal intervention lifecycle — applied at the next safe
checkpoint of the current Run, not after the Run ends.

Adoption is a deliberate shell action, never a fallback: the Host rejects it
when the queued turn is not `pending` (a drain may have won the race), when
the revision is stale, when the record carries attachments or context refs
(interventions are text-only today), or when the payload text differs from the
frozen queued text. An ACK-timeout retry replays the same durable outcome.

### Pending intervention presentation

An accepted intervention appears as an ordinary user message in conversational
order with a compact delivery status:

- `Waiting for the current step to finish` (`pending`)
- `Applying to the next response` (`applying`)
- `Applied to this Run` (`applied`)
- `This Run ended before it could be applied` (`expired`)
- `Cancelled` or `Could not be applied`

While pending, the user can edit or cancel it. After application, it is
immutable because it may already be visible to a provider.

An expired row offers explicit actions:

- `Send as next turn`
- `Copy back to composer`
- `Dismiss`

No action is automatic.

### Multiple interventions

The Host assigns a monotonic per-Run `sequence`. The default policy applies one
intervention at each safe checkpoint. The UI shows the order and allows pending
items to be reordered only through an explicit Host command with revision
checks. A future `combine at next checkpoint` option can be added as a delivery
policy; it is never inferred.

Default bounds:

- 10 pending interventions per Run;
- 64 KiB UTF-8 text per intervention;
- 256 KiB pending text per Run;
- attachments use existing media limits and Host-owned paths.

The exact ceilings belong in contracts/constants and Host Server validation.

## 5. Domain model

Proposed additive contracts:

```ts
export type UserInstructionPayload = {
  text: string;
  attachments?: PromptAttachment[];
  contextRefs?: PromptContextRef[];
};

export type PreparedInterventionPayload = {
  text: string;
  images?: PreparedImageContent[];
  assembly: ModelPromptAssemblySummary;
};

export type RunInterventionStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'uncertain';

export type RunInterventionRecord = {
  interventionId: string;
  revision: number;
  sessionId: string;
  runId: string;
  runtimeGenerationId: string;
  sequence: number;
  userMessageId: string;
  status: RunInterventionStatus;
  input: UserInstructionPayload;
  submittedAt: string;
  updatedAt: string;
  appliedAt?: string;
  appliedRequestOrdinal?: number;
  terminalReason?:
    | 'run-ended'
    | 'run-pausing'
    | 'run-cancelling'
    | 'generation-replaced'
    | 'worker-crash'
    | 'backend-rejected'
    | 'preparation-failed'
    | 'application-outcome-unknown';
};
```

The public record does not expose prepared base64 image data or resolved
context bodies. Those remain Host/backend internal.

`SessionTranscriptMessage` gains an optional user-row projection:

```ts
instructionDelivery?: {
  kind: 'run-intervention' | 'queued-turn';
  instructionId: string;
  status: RunInterventionStatus | QueuedTurnStatus;
  targetRunId?: string;
  revision: number;
};
```

The model-history builder includes an intervention row only after `applied`.
The visible transcript may still show pending, expired, or cancelled rows.

## 6. Commands, responses, and pushes

New commands start in `@piwin/contracts`:

```ts
type RunInterventionSubmitCommand = {
  type: 'run/intervention-submit';
  sessionId: string;
  runId: string;
  interventionId: string;
  userMessageId: string;
  input: UserInstructionPayload;
};

type RunInterventionEditCommand = {
  type: 'run/intervention-edit';
  sessionId: string;
  runId: string;
  interventionId: string;
  expectedRevision: number;
  input: UserInstructionPayload;
};

type RunInterventionCancelCommand = {
  type: 'run/intervention-cancel';
  sessionId: string;
  runId: string;
  interventionId: string;
  expectedRevision: number;
};
```

The submit response returns the durable record. Repeating the same
`interventionId` with the same fingerprint returns the existing record;
reusing it with different content fails with `idempotency-conflict`.

New Host pushes:

```ts
type RunInterventionHostPush = {
  type: 'run/intervention-updated';
  intervention: RunInterventionRecord;
};
```

This push is a run-bound Host egress projection keyed by `interventionId`.
Revisions allow replacement of stale intermediate states; the target Run's
terminal control barrier flushes its latest state before `run/terminal`, and
hydration recovers the same state from the durable transcript projection.

Queued turns use separate `session/queued-turn-*` commands and
`session/queued-turn-updated` pushes. Replace Run composes exact cancellation
and queued-turn start under a dedicated workflow command; it does not reuse the
intervention state machine.

### Stage 4 queued-turn contract

The normal next-turn queue is a Host-owned `queued_turn` table, not an
intervention subtype and not Desktop state. A record has its own id, immutable
`userMessageId`, per-record `revision`, session `sequence`, frozen complete
`PromptInput`, and `mode: next | replace`. Its lifecycle is:

```text
pending → starting → started
       ↘ cancelled
       ↘ failed
```

Text is bounded to 64 KiB UTF-8, at most 20 pending/starting records may exist
for one session, and their aggregate text is bounded to 512 KiB. Submit is
idempotent by `(sessionId, queuedTurnId, userMessageId, mode, replaceRunId,
fingerprint)`. Edits, cancellation, and reorder use revision compare-and-swap;
a stale client must list the queue again rather than overwriting newer state.
An explicit user action may also convert a `pending` `next` record into a Run
intervention (`adoptQueuedTurn` on `run/intervention-submit`); the conversion
is one atomic store transaction — cancel with
`terminalReason: converted-to-intervention`, create the intervention, re-bind
the existing user row — so a crash can neither lose the message nor admit it
twice.

The Host owns one drain lock per session. A `next` record is admitted through
the ordinary `session/prompt` path with an internal `admission: 'queued-turn'`
guard, and only when no foreground Run exists. The internal path never writes a
second user row: the already-persisted queued row remains the transcript
authority. `started` is the only queued-turn state included in reconstructed
model history; pending/starting/cancelled/failed rows remain visible evidence
but are not replayed into a later model context.

Replace first persists a `replace` record with the exact target `runId`, then
requests cancellation of only that Run and settles its pending permission/UI
gates. The record cannot enter `starting` until the target's `run/terminal`
barrier has been observed. A target mismatch or bounded cancellation timeout
fails the record; no newer Run is guessed or substituted. On Host restart,
normal pending records remain eligible, while `starting` and pending Replace
records become `failed(host-restarted)` because their admission/cancellation
boundary is ambiguous.

Terminal egress is ordered as old `run/terminal`, then the queued-turn state
push, then the next Run's `run/updated`/agent events. The push is replayable and
hydration returns the queue revision plus records for each subscribed session.
CLI exposes explicit `session queue list|edit|cancel|reorder` and
`session replace` commands; these commands use the same Host records and CAS
rules as Desktop.

## 7. Authoritative submit flow

### Phase A: Host admission

1. Client creates stable `interventionId` and `userMessageId` and may paint a
   `submitting` placeholder.
2. Host validates command size, media ownership, session access, and queue
   capacity.
3. RunRegistry requires the exact foreground `runId`, non-terminal status, and
   a phase other than `pausing` or `cancelling`.
4. Host resolves structured context and prepares the exact model payload. Slash
   commands, template execution, model changes, and thinking changes are
   rejected for interventions.
5. After every awaited preparation step, Host revalidates the exact Run,
   generation, phase, and cancellation state. A Run that settled during
   preparation is rejected without persistence.
6. In one session-store transaction, Host writes:
   - the `pending` intervention record;
   - its provisional user transcript row;
   - the prepared assembly metadata/fingerprint needed for recovery and audit.
7. Host publishes `run/intervention-updated(pending)` and arms the exact
   backend generation.
8. If backend arming loses a race with Run settlement, Host changes the record
   to `expired` before returning. No content reached Pi.
9. The response returns the latest durable record. Client state reconciles by
   id and revision.

Host admission must be bounded and independent of model completion. It may
finish as `pending` even if the next checkpoint is minutes away.

### Phase B: Backend safe-checkpoint application

1. ProductAgentHost arms the backend with exact session, generation, Run,
   sequence, intervention, revision, and the already-prepared literal text.
   Phase 1 rejects attachments and context references; a later structured-input
   revision may replace the text field with a Host-issued payload reference so
   prepared secrets, resolved bodies, and image bytes never live in the queue.
2. SDK backend or worker stores that reference in a bounded run-scoped staging
   queue. This is not Pi's native steering queue. Staging is allowed while the
   exact Host Run is still preparing; claim and injection still require that
   same Run to become the active backend Run. A different Run retires the stale
   slot without consuming it.
3. After the current assistant message and tool batch settle, agent-host's
   next-turn hook selects the earliest pending reference.
4. The backend asks HostRuntime to claim that exact intervention revision.
   HostRuntime revalidates Run/generation ownership and atomically changes
   `pending → applying` before returning a revision-bound application
   authorization. The current text-only protocol represents that authorization
   as `accepted: true`; its compare-and-swap transition makes it one-shot. A
   stale edited revision is not applied.
5. After authorization, the backend constructs the literal Pi user message and
   synchronously inserts it where Pi's immediately following steering poll will
   consume it.
6. The backend binds the user message object to `interventionId`, so consumption
   acknowledgement never relies on matching text.
7. When Pi emits `message_start` for that exact marked user-message object, the
   backend reports `applied` with the post-claim revision. Text matching is
   never used.
8. Host verifies the exact applying revision, allocates the next model
   `requestOrdinal`, records the model-visibility assembly before the following
   provider response begins, updates the transcript projection, and pushes the
   new revision.

If the backend fails before injection and can prove the authorization was unused, Host
marks the record `failed`. If either side loses contact after the durable
`applying` transition and cannot prove whether injection occurred, Host marks
it `uncertain`. An uncertain intervention is visible to the user and is never
automatically retried in another request or Run.

The existing normalized Pi user `message/start` and `message/end` events can
continue for native session persistence, but they do not create a second
product user row.

### Phase C: Run settlement

When a Run becomes terminal, HostRuntime and agent-host close intervention
admission first. Pending items for that Run become `expired` with a stable
reason. An item already in `applying` becomes `uncertain` unless the backend can
prove that its one-shot authorization was unused. Backend staging queues are cleared
by exact Run and generation.

Run terminality waits for the intervention queue close operation, but it does
not wait for clients to receive the resulting pushes.

## 8. Agent-host contract and SDK/RPC parity

`SessionHandle.steer(message)` is insufficient because it has no Run identity
or application result. The implementation therefore uses the separate
`BackendRunIntervention` / `BackendRunInterventionEvent` contracts exported by
`@piwin/contracts`, surfaced through optional intervention methods on the
internal session handle. Conceptually the port is:

```ts
type BackendRunIntervention = {
  interventionId: string;
  sessionId: string;
  runtimeGenerationId: string;
  runId: string;
  sequence: number;
  revision: number;
  text: string;
};

interface RunInterventionBackendPort {
  arm(input: BackendRunIntervention): Promise<void>;
  cancel(interventionId: string, expectedRevision: number): Promise<boolean>;
  subscribe(
    listener: (event: BackendRunInterventionEvent) => Promise<{ accepted: boolean }>,
  ): () => void;
}
```

At a safe checkpoint the backend uses an injected authority callback (SDK) or
parent RPC claim/permit frame (worker) to authorize the exact armed revision.
The permit frame currently carries only `accepted`; the durable
`pending → applying` compare-and-swap is the one-shot token. The claim is the
post-await authority check; an armed item alone never authorizes model
injection. A future structured payload protocol may add an opaque token and
payload reference without changing Host commands or transcript state.

This channel is distinct from normalized `AgentEvent`. ProductAgentHost adapts
backend events into HostRuntime callbacks; HostRuntime alone mutates durable
intervention state and emits HostPush.

SDK keeps the staging queue in process. RPC adds worker protocol frames for
arm/cancel, claim authorization, and intervention lifecycle events. The worker
validates the frame's exact generation and rejects a different active Run. A
pre-active item remains inert until its exact Run enters the backend. The
shared stager owns ordering/revision invariants, with RPC bridge tests covering
the cross-process handshake.

Pi remains replaceable: a future backend with native run-scoped interventions
can implement the same port without changing Host commands, transcript state,
or UI.

## 9. Failure and recovery behavior

| Failure | Required outcome |
|---------|------------------|
| Missing/stale Run ID | Reject before persistence; no backend call |
| Duplicate command | Return existing record; no second application |
| Host persistence failure | Reject; no backend arming |
| Backend already idle | Persisted record becomes `expired`; never enters Pi |
| Client ACK timeout | Client hydrates by `interventionId`; Host state remains authoritative |
| Client disconnect | Run and intervention continue; replay/hydration restores state |
| Edit/cancel races application | Expected revision loses with `already-applying` or `already-applied` |
| Worker crash with pending items | Run fails with `worker-crash`; pending items expire |
| Crash after application claim | Applying item becomes `uncertain`; it is never auto-replayed |
| Runtime generation replacement | Remaining items expire with `generation-replaced` |
| Host restart | Active Runs become interrupted; pending items expire and applying items become uncertain |
| Model request fails after application | Intervention remains `applied`; Run records the model failure |
| Slow client | Egress policy protects control state or disconnects that client |

No recovery path automatically replays an intervention into a different Run.

## 10. Multi-client rules

- Host sequence, not client arrival time, determines order.
- All connected clients receive the same intervention revisions subject to
  session subscription policy.
- Only one edit/cancel revision wins. A losing client refreshes the current
  record instead of overwriting it.
- Device identity is audit metadata, not execution authority. Host admission
  policy still decides whether that client may mutate the Run.
- A client opening a session hydrates recent intervention projections together
  with transcript and active Run state.
- The text of an intervention is never written to operational logs or metrics.

## 11. Observability

Host diagnostics expose bounded, content-free counters:

- submitted, applied, expired, cancelled, failed;
- applying items reconciled as uncertain;
- stale-Run and idempotency-conflict rejects;
- submit-to-apply latency histogram;
- pending depth and oldest pending age;
- backend arm/apply/close latency;
- SDK/RPC parity failures;
- interventions expired during restart or worker crash.

Correlation uses session, Run, generation, and intervention IDs. Model text,
resolved context, media data, and secrets are excluded.

## 12. Package ownership

| Concern | Owner |
|---------|-------|
| Public records, commands, pushes, stable errors | `@piwin/contracts` |
| Durable intervention and queued-turn records | `@piwin/session` |
| Admission, preparation, sequencing, lifecycle, Run settlement | `@piwin/host-runtime` |
| Pi checkpoint staging and SDK/worker parity | `@piwin/agent-host` |
| Remote validation, replay, hydration, egress classification | `@piwin/host-server` / host transport |
| Composer, statuses, editing, reconciliation | `apps/desktop` + `@piwin/ui-kit` |
| Explicit inspect/submit/cancel commands | `apps/cli` |

No new top-level package is required. Agent-host does not import session or
other application packages; HostRuntime injects ports and owns persistence.

## 13. Migration plan

### Stage 1: Close correctness holes

- Require `runId` for legacy `session/steer` in new clients and Host Server.
- Track the exact active backend Run in SDK and worker sessions.
- Reject backend steer after Pi settlement instead of allowing a stranded
  queue entry.
- Add telemetry for stale, idle-tail, timeout, and persistence failures.

This is containment, not the final intervention architecture.

### Stage 2: Durable intervention authority

- Add contracts, session-store transaction, lifecycle controller, Host pushes,
  hydration, idempotency, and transcript delivery projection.
- Add Desktop reconciliation and status UI behind a Host capability flag.
- Keep old `session/steer` as a compatibility path for legacy clients.

### Stage 3: Safe-checkpoint backend port

- Implement run-scoped staging and application events in SDK.
- Add worker protocol and the shared SDK/RPC conformance suite.
- Cut new Desktop intervention submissions to the new command.
- Stop calling `piSession.steer()` directly from the product command path.

### Stage 4: Durable next-turn queue and Replace Run — implemented

- Move the current Desktop-local waiting queue into Host authority.
- Add edit, cancel, reorder, replay, and hydration.
- Implement Replace Run as exact cancellation followed by queued normal prompt
  admission.
- Add explicit CLI operations.

### Stage 5: Delete transitional surfaces

- Remove direct product `session/steer`, `session/follow_up`, and
  `PromptInput.streamingBehavior` after all clients use capability-negotiated
  interventions and queued turns.
- Remove Desktop-local queue authority and `[Steer]`/`[Follow-up]` legacy code.
- Update ADR 0015 and architecture docs to name the new control surfaces.

## 14. Verification matrix

### Pure lifecycle tests

- every legal and illegal state transition;
- exact revision and idempotency behavior;
- deterministic multi-client ordering;
- pending-history exclusion and applied-history inclusion;
- bounds and stable error codes.

### Concurrency tests

- submit immediately before, during, and immediately after a safe checkpoint;
- Run terminal races submit/edit/cancel;
- crash before and after the application claim/permit boundary;
- duplicate delivery frames and delayed worker responses;
- client timeout after durable acceptance;
- worker crash and generation replacement with pending items;
- Host restart reconciliation;
- multiple interventions under one-at-a-time policy.

### Backend conformance

The same fixtures run against SDK and RPC worker backends and prove:

- exact Run/generation admission;
- no native Pi queue entry after Run settlement;
- at-most-once application;
- one-shot revision-bound application authorization and no replay of uncertain outcomes;
- one applied event before the correlated provider request;
- closeRun returns every unapplied item;
- images and literal text produce equivalent model content.

### UI and transport

- optimistic placeholder reconciles after ACK timeout/reconnect;
- pending/edit/cancel/applied/expired states render correctly;
- other clients receive user row and status without reload;
- replay and hydration do not duplicate a row;
- expired action requires explicit user choice;
- control pushes survive batching and slow-client recovery.

## 15. Definition of done

The redesign is complete only when:

1. A successful submit always has a durable inspectable record.
2. The UI distinguishes accepted from applied.
3. A stale or late instruction cannot affect another Run.
4. A Run cannot terminalize with a hidden intervention left in Pi.
5. Applied model content and visibility assembly are identical.
6. Pending/expired content is excluded from model-history reconstruction.
7. SDK and RPC pass the same race-heavy conformance suite.
8. Desktop restart and a second client reproduce the same queue and statuses.
9. Queued turn and Replace Run are explicit rather than implicit fallbacks.
10. Legacy direct steer paths are deleted or capability-gated for old clients.
