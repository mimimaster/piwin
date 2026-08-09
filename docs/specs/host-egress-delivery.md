# Host egress delivery and recovery specification

| Field | Value |
|-------|-------|
| Status | **Stage 1 implemented; hydration/security slice landed; Stage 2 loopback/renderer details pending** |
| Date | 2026-08-08 |
| Authority | [ADR 0038](../adr/0038-host-egress-flow-control-and-recovery.md) |
| Execution | [`../plans/2026-08-08-host-egress-flow-control-execution-plan.md`](../plans/2026-08-08-host-egress-flow-control-execution-plan.md) |
| Evidence | [`../notes/2026-08-08-desktop-webcontent-memory-incident.md`](../notes/2026-08-08-desktop-webcontent-memory-incident.md) |

## 1. Purpose

This specification defines the missing operational contract between semantic
`HostPush` production and client rendering. It applies equally to:

- the current Desktop Node JSONL sidecar;
- the canonical loopback WebSocket Desktop path;
- standalone/private Host Server connections;
- CLI, mobile, Web, and future Gateway/tunnel transports.

The design must stop the current WKWebView evaluation storm without moving
product authority into Rust or React, and it must remain correct with multiple
clients and parallel subagents.

## 2. Fixed invariants

The implementation is invalid if any of these are violated:

1. `HostRuntime` and owning application services remain the semantic state
   authorities. Egress never invents Run/session/tool terminal state.
2. `agent-host` only normalizes Pi events. It does not throttle product
   transport or inspect client capacity.
3. An unchanged replaceable projection is not published by its domain
   authority.
4. Append content is never silently dropped or truncated by transport.
5. Control/lifecycle delivery is never sacrificed to stream or diagnostic
   traffic.
6. A slow client cannot block Host execution or grow Host memory without a
   configured bound.
7. Every `HostPush` variant has one exhaustive delivery policy.
8. Ordering barriers are scoped to the entity/run they close, not global.
9. Sequence is assigned only to canonical egress records, after intentional
   ingress coalescing/replacement.
10. A cursor advances only after a client applies a batch transaction.
11. Replay is bounded; replay-too-old always causes explicit hydration.
12. A renderer crash/reload is treated as a reconnect to the same Host, not as
    a new execution authority.
13. Responses never enter the unsolicited push data lane.
14. Metrics are queried/sampled and cannot recreate a telemetry push storm.

## 3. Target components and dependency direction

```text
@piwin/host-runtime
    │ unsequenced semantic HostPush
    ▼
@piwin/host-server
    HostEgressHub
      ├─ uses policy/key helpers from @piwin/host-transport
      ├─ owns canonical journal and sequence
      ├─ owns one bounded channel per client
      └─ reads snapshot projections from HostRuntime public port
            │
            ├─ LocalJsonlConnection → apps/cli writer → Tauri Rust batch event
            └─ WebSocketConnection → loopback/private client
                                          │
                                          ▼
                                @piwin/host-client
                                  cursor/replay/hydration
                                          │
                                          ▼
                                Desktop / CLI / Mobile
```

Allowed package dependencies for this work:

```text
host-transport → contracts
host-client    → host-transport + contracts
host-server    → host-runtime + host-transport + contracts
apps/host      → host-server + host-runtime
apps/cli       → host-server + host-runtime + contracts
apps/desktop   → host-client + host-transport + contracts
```

`host-transport` contains transport-neutral codec/policy primitives only. It
must not import Node-only HostRuntime, React, Tauri, or Pi.

## 4. Terminology

### Semantic push

An unsequenced `HostPush` produced by `HostRuntime` or an owning service. It
describes normalized product meaning and is independent of a client/transport.

### Canonical egress record

A semantic push that remains after the Hub's short ingress aggregation window
and receives one Host-global sequence and event ID.

### Client cursor

The highest canonical Host sequence a specific client has atomically examined
and applied/ignored according to its subscription and delivery policy.

### Delivery key

A collision-safe tuple identifying an append stream or replaceable entity.
Keys are encoded by one helper; production code must not build colon-joined
strings ad hoc.

### Barrier scope

The append/projection keys that must be canonicalized before a closing control
record may be sequenced.

### Hydration

Replacement of client projections from Host-owned state when replay cannot
prove continuity.

## 5. Delivery policy model

The public implementation shape should be equivalent to:

```ts
export type HostDeliveryKey = readonly [
  namespace: string,
  ...parts: string[],
];

export type HostPushPolicy =
  | {
      kind: 'control';
      barrierKeys: HostDeliveryKey[];
      runBarrierId?: string;
    }
  | {
      kind: 'append';
      key: HostDeliveryKey;
      runId?: string;
    }
  | {
      kind: 'projection';
      key: HostDeliveryKey;
      runId?: string;
    }
  | {
      kind: 'diagnostic';
      key: HostDeliveryKey;
    };

export function classifyHostPush(push: HostPushVariant): HostPushPolicy;
```

The exact exported names may differ, but the discriminated semantics and
exhaustive handling may not.

The classifier must use `assertNever` (or an equivalent compile-time exhaustive
check) at both the outer `HostPush` and nested `AgentEvent` unions. A fixture
table snapshots every current variant's policy/key/barrier.

## 6. Required classification matrix

### 6.1 `event` and `subagent/stream`

`subagent/stream` uses the nested Agent policy with a key prefix containing
`parentSessionId` and `childSessionId`.

| Agent event | Policy | Stable key / barrier |
|-------------|--------|----------------------|
| `message/text_delta` | append | session + run + message + `text` |
| `message/thinking_delta` | append | session + run + message + `thinking` |
| `tool/update` | append | session + run + toolCall + `output` |
| `message/text_snapshot` | projection | session + run + message + `text-snapshot` |
| `usage/update` | projection | session + `usage` |
| `message/end` | control | barrier: that message's text/thinking/snapshot keys |
| `tool/end` | control | barrier: that tool's output key |
| `session/aborted` | control | barrier: every pending key indexed by its run |
| `session/started`, `session/ended` | control | session lifecycle |
| `message/start`, `tool/start` | control | entity lifecycle; no unrelated flush |
| `permission/request`, `permission/resolved` | control | immediate; no unrelated flush |
| `compaction/start`, `compaction/end` | control | run/session lifecycle |
| `error` | control | run barrier when `runId` is present |
| `memory/extraction_start`, `memory/extraction_end` | control | session lifecycle |

For missing legacy `runId`, the key remains session/entity scoped. New Host
events are expected to carry correlated Run identity where the domain has one.

### 6.2 Product pushes

| Host push | Policy | Key / barrier notes |
|-----------|--------|---------------------|
| `run/updated` | projection | runId; only non-terminal revisions belong here |
| `run/terminal` | control | flush every pending key indexed by runId |
| `job/started`, `job/ready` | control | Job lifecycle |
| `job/updated` | projection | jobId |
| `job/log` | append | jobId + stream |
| `job/exited` | control | flush Job log/projection keys |
| `session/name-updated` | projection | sessionId |
| `session/runtime-updated` | projection | sessionId |
| `plan/updated` | projection | sessionId |
| `plan/execution-updated` | projection | execution/run/plan identity |
| `todo/updated` | projection | sessionId |
| `subagent/updated` | projection | parent + child session |
| `subagent/batch-updated` | projection | runId |
| `subagent/task-updated` | projection | runId + task identity |
| `subagent/merged` | control | child/session merge lifecycle |
| `transcript/append` | append | sessionId + transcript; dedup by message id client-side |
| top-level `permission/request` | control | immediate |
| `extension/ui_request` | control | immediate |
| `automation/cron_finished` | control | Job/automation lifecycle |
| `host/status` | control | immediate readiness transition |
| `host/log` | diagnostic | host log lane |
| `pty/output` | append | ptyId |
| `pty/exit` | control | flush ptyId output |
| `pet/state` | projection | active pet/global pet state |
| `browser/frame` | projection | browser mirror frame; latest wins |
| `browser/state` | projection | browser state |
| `browser/picked` | control | user-requested result |
| `browser/console` | diagnostic | browser console |
| `browser/network` | diagnostic | browser network |
| `walkthrough/updated` | projection | sessionId + artifact message identity |
| legacy `host/replay-done` | control | transport compatibility only; new path uses wire `replay/done` |

If a variant's identity field is absent from its current contract, the
contracts slice must add an additive stable identity or document a deliberately
coarser key. Object serialization is never used as an entity key.

## 7. Domain revision contract

### 7.1 Run records

`ExecutionRunRecord` adds:

```ts
revision?: number;
```

It is optional for wire compatibility, but every new `RunRegistry` record sets
it and starts at `1`. The authority increments it exactly once for each
published mutation. Creation, start, phase/first-token change, cancelling, and
terminalization are mutations. A no-op observation does not increment it.

`RunRegistry.noteAgentEvent()` follows this algorithm:

```text
changed = false
if first relevant delta and firstTokenReceived is false:
  firstTokenReceived = true
  changed = true
if derived phase differs from public current phase/detail:
  update phase + phaseUpdatedAt
  changed = true
if changed:
  revision += 1
  publish copy
return copy (even when unchanged, if the caller needs it)
```

The Desktop stores the last source revision. An incoming lower/equal revision
is a no-op. Legacy records without a revision use semantic field equality.

### 7.2 Other projections

Egress `seq` is sufficient for transport freshness during this incident slice.
Domain revisions may be added later to other authoritative projections when
they have independent persistence/concurrency needs; clients must not invent
them.

## 8. Canonicalization algorithm

The Hub owns an ingress ordinal so it can preserve meaningful order before
wire sequence exists.

### 8.1 Ingress

For each semantic push:

1. Classify it.
2. Cache its encoded byte estimate once.
3. Assign an ingress ordinal.
4. Apply policy:
   - control: flush only its barrier scope, then canonicalize the control;
   - append: enqueue the original item under its key;
   - projection: replace the pending value for its key and move its ordinal to
     the newest observation;
   - diagnostic: append to the bounded diagnostic ring, evicting oldest when
     required.
5. Schedule the data flush if one is not already scheduled.

### 8.2 Append aggregation rule for v1

V1 aggregates append pushes into a wire batch but does **not** concatenate
their nested delta strings at the Hub. Original `AgentEventEnvelope` identity
and ordering are retained. This avoids pretending multiple source events are
one event and eliminates the sequence-range ambiguity that existed in the
removed CLI-local batcher.

A future payload-concatenation optimization requires an additive coverage
contract (source event IDs/sequence range) and an ADR/spec amendment. It must
not be introduced as a local helper.

### 8.3 Flush

When a data tick or scoped control flush occurs:

1. Select eligible append/projection/diagnostic records.
2. Sort by their final ingress ordinal.
3. Assign consecutive canonical Host `seq` values and one `eventId` each.
4. Append them to the bounded journal.
5. Offer the canonical records to every authenticated client channel after
   subscription filtering.

Intentional projection replacements and diagnostic evictions happen before
sequence assignment and therefore produce no sequence holes.

## 9. Wire contract

The contracts slice adds shapes equivalent to:

```ts
export type HostSequencedPush = {
  seq: number;
  eventId: string;
  push: HostPushVariant;
};

export type HostPushBatchFrame = {
  type: 'push/batch';
  hostInstanceId: string;
  /** Cursor the receiver must currently hold before applying this frame. */
  afterSeq: number;
  /** Highest canonical sequence examined for this client. */
  throughSeq: number;
  /** Ordered subset in (afterSeq, throughSeq]. May be empty. */
  items: HostSequencedPush[];
};
```

Required validation:

- `afterSeq` and `throughSeq` are non-negative safe integers;
- `throughSeq >= afterSeq`;
- item sequences are strictly increasing;
- every item sequence is `> afterSeq` and `<= throughSeq`;
- event IDs are non-empty strings;
- the encoded frame is below the hard transport frame cap;
- no inner `HostPush` sequence fields disagree with the envelope.

The remote protocol union and local `HostServerMessage` framing both recognize
the batch. The singular `HostPushFrame` remains accepted during migration.

Handshake capabilities add optional fields equivalent to:

```ts
pushBatching: boolean;
cursorBatches: boolean;
boundedReplay: boolean;
hydration: boolean;
```

A server sends `push/batch` only after the client advertises support (or on the
same-build local JSONL transport where batch framing is the negotiated
default).

## 10. Cursor and client transaction rules

`@piwin/host-client` stores `{ hostInstanceId, throughSeq }`, not a naked
number shared across Host instances.

For a batch:

1. Reject/resync if `hostInstanceId` differs from the active Host.
2. Ignore the whole batch if `throughSeq <= currentCursor`.
3. Request replay if `afterSeq !== currentCursor`.
4. Validate item ordering/range.
5. Apply all items through one batch subscriber transaction.
6. Only after the transaction returns successfully, persist `throughSeq`.
7. If validation/application throws, do not advance; close/replay/hydrate.

Gaps between item sequences inside a valid cursor batch are not automatically
data loss: the batch envelope proves they were filtered or superseded by
policy. The current `HostClient` behavior that requests replay for every
`seq > lastSeq + 1` applies only to singular compatibility frames.

The public client API adds a batch subscription. Per-push subscriptions may be
retained as a compatibility adapter that unfolds a validated batch, but
Desktop uses the atomic batch API.

## 11. Per-client channel and pacing

### 11.1 Initial budgets

These are implementation defaults, not user settings:

| Budget | Local Desktop | Private/remote client |
|--------|---------------|-----------------------|
| data flush cadence | 24 ms | 24 ms |
| target batch bytes | 256 KiB | 128 KiB |
| maximum batch items | 128 | 128 |
| hard encoded frame cap | 1 MiB | 1 MiB |
| data queue bytes | 8 MiB | 2 MiB |
| data queue items | 4,096 | 2,048 |
| reserved control bytes | 512 KiB | 256 KiB |
| diagnostic bytes within data queue | 256 KiB | 128 KiB |

The implementation exposes these as constructor options for deterministic
tests. Production defaults live in one host-server module, not scattered
magic numbers.

Control is scheduled in the current microtask after its scoped dependencies;
it does not wait for the 24 ms data tick. At most one ordinary data batch is
sent per connection per tick. A control batch is allowed in addition.

### 11.2 Queue entries

The queue stores canonical record references plus cached encoded sizes. It does
not eagerly stringify one copy per client.

- queued projection with the same key: replace the older entry;
- queued diagnostic over budget: evict oldest diagnostic;
- queued append: preserve order/content;
- control: use reserved lane;
- append/control overflow after compaction: close the connection with
  `slow-consumer` and require recovery.

WebSocket `send()` returning normally and Tauri `emit()` returning normally are
not evidence that the consumer rendered the payload. They are drain operations
against this explicit queue, never the queue itself.

### 11.3 Oversized items

Transport does not truncate an oversized append/control record. The producing
domain should already chunk/bound payloads. If one canonical item cannot fit
the hard frame cap:

- record an `oversized-item` metric and boundary error;
- a replaceable/diagnostic item may be rejected according to its documented
  producer cap;
- an append/control connection is failed and recovers from Host state;
- secrets/payload bodies are never included in the error log.

## 12. Replay journal

The canonical journal is bounded by all of:

- 16 MiB encoded record bytes;
- 50,000 canonical records;
- 10 minutes of record age.

Eviction occurs when any limit is exceeded. These defaults are configurable in
tests/server construction, not through ordinary client commands.

Replay behavior:

1. Client requests from its last applied cursor.
2. If the cursor is at/after the low watermark, the server applies the current
   client subscription and emits cursor batches.
3. `replay/done` reports requested cursor, delivered `throughSeq`, current Host
   sequence, and `complete: true`.
4. If the cursor predates the low watermark, the server emits an explicit
   snapshot/hydration frame and `complete: false`; it does not replay a partial
   suffix as if continuity were proven.

Journal eviction never blocks Host execution. Durable transcript and current
Host projections are the fallback authority.

## 13. Hydration contract

The first recovery slice now carries an additive `hydration` wire frame. It
contains a Host-instance identity, a snapshot cursor, redacted Host status,
bounded session summaries, and transcript messages only for the client’s
explicitly advertised session subscriptions. Host paths, secrets, and media
payloads do not cross this frame. Subscription count, message count,
projection bytes, and the final encoded frame are capped; omitted sessions are
listed in `truncatedSessionIds`.

The public HostClient applies hydration as a replacement transaction: listeners
must finish successfully before `{ hostInstanceId, snapshotSeq }` is persisted.
The server fences the paused channel at `snapshotSeq`, replays records after
that cursor, and removes queued duplicates before resuming the live tail. The
full normalized projection below remains the Stage 2 expansion target for
active Runs, permissions, plan/todo, and renderer lifecycle composition.

The status-only snapshot draft is not enough. The Host must expose a normalized
client hydration projection containing, for the requested/subscribed sessions:

- safe Host status and `hostInstanceId`;
- snapshot cursor;
- current non-terminal and recent terminal Run records;
- pending permission requests;
- session runtime status;
- current plan/todo projection;
- persisted transcript messages and a transcript revision/cursor;
- active partial turn projection when a Run is in flight.

Suggested contract boundary:

```ts
export type HostHydrationSnapshot = {
  hostInstanceId: string;
  snapshotSeq: number;
  generatedAt: string;
  status: RemoteHostStatusData;
  sessions: HostSessionHydrationSnapshot[];
  activeRuns: ExecutionRunRecord[];
  pendingPermissions: HostPendingPermissionProjection[];
};
```

Remote projection removes absolute Host paths and unauthorized sessions before
the snapshot leaves Host Server.

Snapshot consistency rules:

1. The Hub places an ingress fence and temporarily buffers new semantic pushes.
2. `HostRuntime` copies the in-memory normalized client projection
   synchronously; it does not perform provider/network work under the fence.
3. The Hub records `snapshotSeq` and resumes canonicalization.
4. The client atomically replaces its state from the snapshot.
5. It applies only batches after `snapshotSeq`.
6. Transcript messages and entities deduplicate by Host-issued identity, so a
   retry is idempotent.

If snapshot construction or the post-snapshot client queue exceeds its bound,
the connection closes and retries; the Host Run continues.

## 14. Local JSONL/Tauri stage

### 14.1 Node side

`commandHostServe` stops constructing its app-local
`createHostServeStreamBatcher`. It creates one local egress connection from
`@piwin/host-server` whose writer uses the existing backpressure-aware JSONL
writer.

Short command responses continue as raw response JSONL frames during this
migration. Push data is emitted as `push/batch` frames. Shutdown order is:

```text
stop command admission
→ drain dispatcher responses
→ flush/close local egress channel
→ detach Hub sink
→ dispose HostRuntime
→ close writer/process
```

### 14.2 Rust side

The stdout router has explicit outcomes:

```text
response    → satisfy/remove pending Rust request only
push/batch  → emit_to("main", "host-message-batch", payload)
legacy push → emit_to("main", "host-message", payload) during migration
invalid     → bounded redacted host-log warning
```

It never broadcasts a response after satisfying the pending request. It never
emits Host pushes application-wide. No Rust timer reclassifies or reorders
product pushes; the Hub already owns that policy.

### 14.3 Desktop side

The local Tauri transport listens to the batch and compatibility events,
validates/unfolds through `@piwin/host-client`, and sends one batch action to
the client projection. `StreamEventBuffer` remains the final rAF scheduler for
visual stream changes.

## 15. Loopback WebSocket stage

Tauri starts the packaged Host with:

- bind address `127.0.0.1` (or `::1` under an explicit tested path);
- port `0` (OS-assigned);
- a cryptographically random per-launch credential;
- a startup pipe/line used only to return endpoint metadata to Rust.

Rust returns endpoint metadata once through `host_start`. The secret is held in
memory, never written to config/stdout logs, and never placed in a URL query.
The WebView sends it in `client/hello` over the loopback connection.

Host Server validates:

- loopback peer/address;
- protocol version;
- credential;
- accepted production Tauri origin and the explicit Vite development origin;
- frame size and handshake deadline.

Desktop CSP permits only the loopback WebSocket origins required by this
contract. The listener is never exposed on `0.0.0.0` by the Desktop launch
path.

After migration, Tauri emits only process lifecycle/fatal-restart status. All
commands and pushes travel through public HostClient. The JSONL batch path
remains the bounded fallback until the loopback native evidence gate passes.

## 16. Desktop projection and render contract

### 16.1 Run state

- `applyRunRecord` returns the previous state when revision/semantic fields are
  unchanged.
- `ChatMessageRow` receives `runRecord` for `message.runId`, not
  `runRecordsById`.
- `TurnWorkDetails`, `resolveAssistantRenderingPhase`, and Run activity helpers
  accept the one record they consume.
- Historical rows do not rerender for another Run's projection.

### 16.2 Heavy content

- A collapsed thinking block is unmounted, not rendered under `hidden`.
- Completed historical tool details remain unmounted until expanded.
- Changing/streaming code fences render safe plain code; Shiki runs once after
  stability/terminal state, not on each delta.
- Tool output retains a cached UTF-8 byte count and encodes only the new delta,
  making bounded append work linear in total input size.

### 16.3 Transcript window

The windowing unit is one user turn group (user message plus its following
assistant/subagent rows), not an arbitrary individual DOM row. This preserves
turn semantics and current sticky-user behavior.

Implementation uses `@tanstack/react-virtual@3.14.9` with:

- dynamic `measureElement` sizing;
- stable turn/message keys;
- overscan of at least four turns during the initial rollout;
- activation only above a configurable-in-code threshold (initially 40 turns);
- current live turn inclusion while follow-tail is active;
- measured scroll restoration per session;
- an imperative message-id → turn-index jump API for History Ticks;
- remeasurement when Markdown images/artifacts/details change height.

Tests must cover sticky headers, editing, permission visibility, History Tick
jumps to an initially unmounted row, follow-tail, scrolling while a live tail
grows, theme/font resize, and session restore.

## 17. Observability

The Hub retains a bounded snapshot equivalent to:

```ts
type HostEgressStats = {
  ingressByType: Record<string, number>;
  canonicalByPolicy: Record<string, number>;
  batches: number;
  bytes: number;
  projectionsReplaced: number;
  diagnosticsEvicted: number;
  oversizedItems: number;
  slowConsumerDisconnects: number;
  replayRecords: number;
  replayBytes: number;
  snapshotFallbacks: number;
  clients: Array<{
    clientId: string;
    queuedItems: number;
    queuedBytes: number;
    highWaterItems: number;
    highWaterBytes: number;
  }>;
};
```

The client ID is a product identifier, not a raw IP/token. Stats omit payloads,
prompts, tool output, URLs with credentials, and secrets.

## 18. Acceptance budgets

### Automated

- 100 same-phase deltas produce one first-token/phase Run revision, not 100.
- 100 deltas in production event→Run observation order never produce the
  observed 200 wire frames.
- Ordinary data batches are paced to at most one per configured 24 ms tick per
  client; control remains immediate.
- A slow second client reaches its bound/disconnects without increasing the
  first client's queue or changing Host completion.
- Append ordering/content is exact across batch, replay, disconnect, and
  hydration tests.
- Projection replacement creates no false cursor gap.
- Identical Run projections preserve reducer/map identity and historical row
  render counts.
- A 500+ message fixture mounts only the configured virtual window.
- A rapid 10 MiB tool-output fixture keeps every queue/state allocation within
  its declared cap and follows an explicit success-or-recover path.

### Native macOS Stage 1

- During a 30-minute tool/thinking-heavy run, Tauri Host batch delivery stays
  at or below 2,600 JavaScript evaluations/minute plus bounded control events
  (24 ms cadence ceiling), rather than 12,000–15,000/minute.
- No WebKit renderer termination or automatic reload.
- Main WebContent physical footprint at 30 minutes is no more than 1 GiB above
  its post-hydration/warm-up baseline; any tighter project baseline supersedes
  this provisional ceiling.
- After the run stops, footprint does not continue a monotonic growth trend.
- Composer and Stop remain usable; controlled Stop acknowledgement is under
  250 ms.

### Native macOS Stage 2

- Ordinary Host pushes cause no Tauri `host-message` JavaScript evaluations;
  only bounded lifecycle/supervisor events remain.
- The same 30-minute and renderer-restart recovery matrix passes over loopback
  HostClient.

## 19. Current skeleton reconciliation

At the date of this spec, the worktree contains in-progress, uncommitted
`host-transport`, `host-client`, `host-server`, and `apps/host` skeletons. They
are the base for this design, but they are not yet this design:

- Host Server broadcasts synchronously to every socket;
- the replay buffer is count-only and contains 256 singular frames;
- sequence is assigned before delivery classification/coalescing;
- outer and inner event IDs are generated independently;
- there is no per-client byte queue, pacing, filtering, or slow-consumer path;
- snapshot contains Host status only;
- HostClient interprets every numeric gap as loss;
- the HostTransport hello factory surface is inconsistent between draft
  interfaces/consumers;
- local Desktop still bypasses all of these packages through app-local JSONL
  and Tauri event code.

The first execution task reconciles and tests these skeletons. Implementers
must extend them in place, not create another transport/client/server package.

## 20. Deletion gates

After Stage 1:

```bash
rg "createHostServeStreamBatcher|host-serve-stream-batcher" apps/cli/src
```

Expected: no production match; old tests are replaced by Hub/local-connection
tests.

After Stage 2:

```bash
rg "app_reader\.emit\(\"host-message\"|listen<HostServerMessage>\('host-message'" \
  apps/desktop/src-tauri/src apps/desktop/src
```

Expected: only the intentionally retained legacy batch fallback, clearly named
and not selected by default. A follow-up release removes it after native
evidence is retained.
