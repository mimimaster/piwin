# ADR 0051: Host-owned run interventions

| Field | Value |
|-------|-------|
| Status | Accepted; run-intervention stages 1–4 implemented; Stage 5 cleanup pending |
| Date | 2026-08-15 |
| Related | ADR 0003, ADR 0015, ADR 0036, ADR 0038, ADR 0040, ADR 0050 |
| Specification | [`../specs/run-interventions.md`](../specs/run-interventions.md) |

## Context

The current product exposes Pi `AgentSession.steer()` almost directly:

1. Desktop paints an optimistic user row and sends `session/steer`.
2. HostRuntime checks its foreground Run and calls the backend `steer()`.
3. The SDK session or RPC worker places the message in Pi's steering queue.
4. Only after that queue admission does HostRuntime persist the product user
   row and model-visibility assembly.

Pi does not interrupt the current provider stream or tool batch. It consumes a
steering message after the current assistant turn and its tool calls finish,
before a later model request. This native behavior is useful, but its queue is
not a sufficient product authority:

- queue admission is not the same as model application;
- the Host Run can remain active briefly after the Pi loop becomes idle;
- persistence or client acknowledgement may fail after Pi already accepted the
  message;
- `runId` is optional, so an unowned command can affect a newer Run;
- Pi may expand Skills or prompt templates after the Host recorded a different
  model-facing assembly;
- Desktop-local optimistic and waiting queues are not a multi-client source of
  truth;
- a late message can remain queued for a later prompt instead of the Run the
  user intended to change.

Reordering two existing calls cannot establish truthful acceptance and
application semantics. The product needs an explicit intervention lifecycle.

## Decision

### 1. Separate three user intentions

The product defines three different operations and never silently converts
between them:

- **Run intervention**: apply an instruction to the exact active Run at its
  next safe checkpoint.
- **Queued turn**: start a normal new Run after the current Run becomes
  terminal.
- **Replace Run**: request cancellation of the exact current Run, then start a
  normal new Run after cancellation settles.

Pi `steer` and `followUp` are backend mechanisms, not the product vocabulary.

One explicit, user-initiated conversion exists: a queued message row can offer
an `Adjust current run after this step` action that adopts the pending queued
turn into a Run intervention on the active Run (`adoptQueuedTurn` on
`run/intervention-submit`). The Host performs the cancel-plus-create-plus-
rebind in a single store transaction (terminal reason
`converted-to-intervention`), so the message is neither lost nor admitted
twice. This is a deliberate shell action with its own contract — it does not
weaken the no-silent-conversion rule above.

### 2. HostRuntime owns intervention authority

Every intervention has a stable `interventionId`, exact `sessionId` and
required `runId`, monotonic per-Run sequence, revision, lifecycle state, raw
user payload, prepared model payload, and user transcript identity.

The lifecycle is Host-owned:

```text
pending → applying → applied
   ├──────────────→ cancelled
   ├──────────────→ expired
   ├──────────────→ failed
   └──── applying → uncertain
```

`pending` means durably accepted by the Host. `applied` means the prepared
instruction was included at a safe checkpoint before a specific model request.
It does not claim that the model complied. `uncertain` is the truthful terminal
state when a process or transport fails after application began and the Host
cannot prove whether the provider saw the instruction. Uncertain interventions
are never replayed automatically.

### 3. Durable acceptance precedes backend arming

HostRuntime validates the exact active Run and atomically stores the pending
intervention plus its provisional user transcript projection before asking the
backend to arm it. A backend rejection or race produces an explicit terminal
intervention state; it never deletes evidence of an instruction the system may
have acted on.

The canonical intervention record and transcript delivery state live in the
session store. The model-visibility ledger is a derived observation and is
recorded when the intervention is applied, not used as the commit authority.

### 4. Agent-host applies only at a safe checkpoint

`@piwin/agent-host` owns a run-scoped staging queue keyed by the exact
`(sessionId, runtimeGenerationId, runId)`. It does not immediately place a
product intervention in Pi's native steering queue.

At Pi's next-turn preparation boundary, the backend selects at most one pending
intervention by default and claims its exact revision from HostRuntime. The Host
durably moves it to `applying` and returns a revision-bound authorization. In
the text-only first version that authorization is an `accepted` boolean backed
by the durable compare-and-swap; structured payloads may later add an opaque
token/reference. The backend then injects the literal prepared text before the
next provider request and reports an application result through a dedicated
backend intervention channel. SDK and RPC workers implement the same contract.

Host admission may finish a few milliseconds before Pi enters `prompt()`. The
backend may stage during that preparation window, but it cannot claim or inject
until the same exact Run is active at the checkpoint. If a different Run starts
instead, the stale backend slot is retired without injection.

If the Pi loop settles before a staged intervention reaches a checkpoint, the
backend reports it as unapplied and HostRuntime marks it `expired`. It is never
left in Pi for a later Run.

### 5. Exact ownership and idempotency are mandatory

- `runId` is required for submit, edit, cancel, and replace operations.
- Backend arming also carries `runtimeGenerationId` and `runId`; Host-only
  validation is insufficient.
- `interventionId` is the idempotency key. Replaying the same valid command
  returns the existing record and cannot apply twice.
- Concurrent multi-client submissions receive a Host-assigned sequence.
- Edits and cancellation use expected revisions and succeed only while the
  intervention is still pending.

### 6. Product queues are Host-owned projections

Waiting interventions and queued turns are durable Host state and reach all
clients through `HostPush`, replay, and hydration. Desktop may paint a short
optimistic placeholder, but it reconciles by id and never becomes the queue
authority.

Stage 4 gives queued turns their own lifecycle and persistence boundary. A
queued turn freezes the complete `PromptInput` at admission, uses a separate
per-record revision and session queue revision, and is drained by a single
Host-owned session lock only after the foreground Run is terminal. Replace Run
is a dedicated `mode: replace` record bound to one exact target `runId`; the
Host persists that intent before cancellation and never substitutes a newer
Run when the target is missing. Normal pending records survive restart, while
ambiguous starting/Replace records fail with `host-restarted`. Pending queue
rows remain visible but are excluded from model-history reconstruction until
they reach `started`.

### 7. No implicit command expansion in an intervention

An intervention is literal structured user input. Slash commands, prompt
templates, model changes, and thinking-level changes are not interpreted by
Pi during intervention delivery. Future Skill, context-reference, or image
support must enter through Host prompt preparation and be represented in the
stored prepared payload before backend arming.

## Consequences

### Positive

- UI acknowledgement describes durable Host state instead of an opaque Pi
  queue call.
- A user can see whether an intervention is waiting, applied, expired,
  cancelled, or failed.
- Late, duplicated, stale, and cross-device commands have deterministic
  outcomes.
- Model-visibility records correspond to the content actually injected.
- Crash windows are reported as uncertain instead of being retried or falsely
  described as unapplied.
- SDK and RPC parity is testable through one intervention conformance suite.
- Future backends can implement a different safe-checkpoint mechanism without
  changing product commands or UI semantics.

### Costs

- Contracts, session persistence, HostRuntime, SDK backend, worker protocol,
  Desktop, CLI, replay, and hydration all need additive work.
- Agent-host needs a dedicated intervention staging channel rather than a
  one-line delegation to `piSession.steer()`.
- Pending transcript rows must be excluded from reconstructed model history
  until they become applied.
- The application acknowledgement is eventually delivered; it cannot be
  inferred from the initial command response.

## Rejected alternatives

- **Only persist before calling `piSession.steer()`** — leaves idle-tail,
  stale-Run, expansion, application, and multi-client problems unsolved.
- **Treat steer as immediate abort** — changes semantics, can interrupt side
  effects ambiguously, and duplicates Replace Run.
- **Keep the editable queue in Desktop** — loses state on restart and diverges
  across clients.
- **Silently convert a late intervention into a follow-up or new prompt** — the
  model may act in a different Run than the one the user addressed.
- **Represent every intervention as a new Run** — breaks the meaning of
  changing an in-progress Run and complicates tool/result ownership.
- **Add fake intervention variants to `AgentEvent`** — operational lifecycle is
  a sibling product channel, not a Pi-native event.
