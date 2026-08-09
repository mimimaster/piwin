# ADR 0040: Host-owned session runtime residency and memory budgets

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-09 |
| Related | ADR 0003, ADR 0009, ADR 0012, ADR 0015, ADR 0036, ADR 0038, ADR 0039 |
| Execution plan | [`2026-08-09-session-runtime-memory-control.md`](../plans/2026-08-09-session-runtime-memory-control.md) |
| Native evidence | [`2026-08-10-session-runtime-rss-soak.md`](../evidence/2026-08-10-session-runtime-rss-soak.md) |

## Context

piwin already bounds Desktop session-index pages, transcript pages, mounted
turns, and transport queues. It does not bound Host session-runtime residency.
Opening or prompting sessions can leave these objects resident until explicit
session disposal or Host shutdown:

- `HostRuntime.sessions` and `ProductAgentHost.sessions` handles;
- SDK Pi sessions or RPC worker processes;
- generation-scoped tool and MCP snapshots;
- subscriptions, event correlation, and transcript recorders;
- the full transcript document retained by an active `TranscriptRecorder`.

Cold reconstruction also currently exposes two identity failures that must not
be carried into the residency or transcript-store design:

- a recovered `ProductShellSession` can lazily create a randomly identified
  backend session while the foreground Run still belongs to the stable product
  session id; Host tools then fail Run admission because the frame and Run
  session identities differ;
- each reconstructed Pi backend owns a fresh event mapper, so generated ids
  such as `pi-message-2` can repeat across runtime generations. Treating a
  repeated naked message id as replay can append a new answer and tool cards to
  an old transcript row, leaving the newest user turn apparently unanswered.

The RPC worker supervisor has a count cap, but capacity exhaustion fails rather
than retiring an idle runtime. ADR 0012 and the Runtime Refactor explicitly
deferred automatic idle eviction. The result is a capacity guard, not a memory
lifecycle policy.

Public product evidence supports separating durable conversation state from
expensive execution state:

- Codex keeps a saved chat transcript and working-directory association for
  later resume. Codex Cloud creates a task container and separately caches
  container state for up to 12 hours. The published material does not specify
  a local foreground-session idle TTL, so 12 hours is not treated as one.
  Sources: [Projects and chats](https://learn.chatgpt.com/docs/projects),
  [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment).
- Cursor stores ordinary chat history in local SQLite, summarizes old model
  context, and dynamically retrieves details from history when needed.
  Background Agents are isolated remote machines with separately bounded
  retention. Sources: [History](https://docs.cursor.com/en/agent/chat/history),
  [Summarization](https://docs.cursor.com/en/agent/chat/summarization),
  [Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery),
  [Background Agents](https://docs.cursor.com/background-agent).

The applicable pattern is not a vendor TTL value. It is:

1. durable history is cheap and recoverable;
2. runtime state is explicitly admitted, bounded, and disposable;
3. model context is reconstructed from bounded durable history;
4. history browsing does not allocate an Agent runtime.

## Decision

### 1. Durable session and live runtime are separate authorities

A product session exists when its Host-owned index/transcript records exist.
It does not need an entry in `HostRuntime.sessions`, a `ProductAgentHost`
handle, or a Pi worker.

`session/resume` becomes a durable read operation. It returns a bounded newest
transcript page, bounded outline data, composer metadata, and runtime status.
It does not create or bind a Pi session merely because a client selected the
chat. A cold resume returns `live: false`; clients may continue to display and
page history. The next prompt transparently activates a runtime.

Organizational pinning, an open client view, and an archived/unarchived state
do not pin a runtime in memory.

### 2. Host Runtime owns one residency state machine

Add a focused `SessionRuntimeResidencyController` under
`@piwin/host-runtime`. It owns policy and transition serialization, but no Pi
imports. `@piwin/agent-host` remains the backend release authority through its
existing session/generation drop methods.

Residency is orthogonal to Settings staleness:

| Residency state | Meaning |
|-----------------|---------|
| `cold` | Durable session only; no Host session handle, Pi session, or worker |
| `activating` | Capacity reserved and a stable runtime generation is being created |
| `resident-idle` | Runtime exists and has no protected operation |
| `resident-busy` | Runtime exists and a protected operation is active |
| `suspending` | New work is blocked while recorder/subscription/backend cleanup runs |

The existing `SessionRuntimeStatus.state` continues to describe
`lazy-shell`/`live`/`stale`/`rebuilding` compatibility. Add an optional
`residency` projection to `SessionRuntimeStatus` so clients do not infer
residency from Settings staleness.

Every session transition is deduplicated by session id. Concurrent prompt,
resume, Settings replacement, and eviction paths share one in-flight
transition promise and compare the expected `runtimeGenerationId` before
publication or disposal.

### 3. Default retention policy is TTL plus hard budgets

Add this normalized Settings shape under `PiwinConfig.session`:

```ts
export type SessionRuntimeRetentionConfig = {
  /** Default 600. Zero means do not retain an idle runtime. */
  idleTtlSeconds: number;
  /** Default 2. Idle runtimes above this count are LRU candidates immediately. */
  maxIdleRuntimes: number;
  /** Omitted means derived from effective execution concurrency and backend capacity. */
  maxResidentRuntimes?: number;
  /** Omitted means an adaptive Host + worker RSS budget. */
  memoryHighWaterMiB?: number;
};
```

Defaults:

- idle TTL: 10 minutes;
- maximum idle runtimes: 2;
- maximum resident runtimes: effective Agent execution concurrency plus the
  idle allowance, clamped to the backend hard cap and an absolute ceiling of 8;
- automatic RSS high water: 25% of system memory, clamped to 512–2048 MiB;
- internal low-water target: 80% of high water;
- internal sweep interval: 30 seconds while at least one runtime is resident.

Omitting a value selects the adaptive default. Settings may tighten the
budgets. There is no persisted “unbounded” mode. Tests use injected clocks and
memory samplers rather than real timers or process RSS.

### 4. Admission evicts before capacity failure

Before creating a new SDK session or RPC worker, the residency controller:

1. samples resident counts and aggregate Host/worker RSS;
2. removes expired idle runtimes in least-recently-used order;
3. removes additional idle runtimes until count and memory are below their
   targets;
4. reserves capacity for the activation;
5. creates the stable runtime generation.

If the count limit is occupied only by busy runtimes, activation waits in a
cancellable `waiting-resource` Run phase. When RSS remains above high water
after every idle runtime is released, activation fails with the stable
`runtime-memory-pressure` terminal code. Existing busy runs continue; piwin
does not wait for an operating-system OOM and does not kill arbitrary active
work.

The RPC worker supervisor keeps its own hard process cap as a final invariant,
but normal foreground activation reaches that cap only after Host-level idle
eviction has run. An evictable idle worker must not produce
`worker capacity exhausted`.

### 5. Busy work is never evicted

A runtime is ineligible while any of these conditions is true:

- its Run or a generation-correlated descendant is queued, running, or
  cancelling;
- a permission or Extension UI request is pending;
- compaction or runtime replacement is in flight;
- activation/publication/suspension is already transitioning;
- a backend operation has acquired an explicit residency protection lease.

Host-owned Jobs, browser state, and walkthrough generation are not implicitly
destroyed by runtime suspension. They have independent authorities. A Job may
continue after its Agent runtime becomes cold if its declared lifetime allows
that. Session deletion and Host shutdown retain their existing stronger
cleanup behavior.

### 6. Suspension is not session disposal

Introduce `suspendSessionRuntime(sessionId, reason)` separately from
`disposeLiveSession(sessionId)`.

The suspension transaction:

1. rechecks all blockers and expected generation identity;
2. marks the generation non-admitting and the residency `suspending`;
3. flushes the transcript recorder; a flush failure aborts suspension and is
   surfaced rather than risking transcript loss;
4. detaches the Agent event subscription and clears correlation buffers;
5. drops the stable ProductAgentHost session/generation, releasing SDK state
   or the RPC worker;
6. releases generation-scoped Host tool and MCP snapshots;
7. disposes the recorder and removes resident handles/maps;
8. publishes `cold` status and records the eviction reason.

Suspension does not archive/delete the product session, remove durable
transcript/index data, stop independent session Jobs, or abort walkthroughs.
In-memory “Allow for session” permission grants are revoked on cold suspension;
the user may be prompted again after reactivation. This is the conservative
security behavior and prevents permission caches themselves from becoming an
unbounded per-session map.

### 7. Cold activation preserves stable runtime and event identity

The Product Shell must not create a second randomly identified backend
session. Cold activation uses the existing stable product `sessionId` and a
new `runtimeGenerationId` through the ProductAgentHost prepare/commit path.

The activation sequence is:

1. validate the durable session record;
2. reserve residency capacity;
3. create and commit a generation for the same product session id;
4. bind the event stream and recorder;
5. attach that generation id to the already accepted Run before tool
   execution is admitted;
6. inject bounded product history once for this reconstructed generation;
7. release the activation reservation on failure or terminal completion.

`RunRegistry` therefore gains a guarded operation that attaches a generation
to one non-terminal Run exactly once. A different second generation is a
correlation error.

Backend event identity is generation-scoped before an event reaches Run
correlation, transcript persistence, hooks, or clients. `@piwin/agent-host`
normalizes every Pi-native or synthesized message, tool-call, and permission
identity using the stable product `sessionId` and `runtimeGenerationId`. The
result is an opaque product identity; clients must not parse its string form.

The identity rules are:

- the same backend identity replayed in the same runtime generation maps to
  the same product identity and remains idempotent;
- the same backend identity emitted by a different runtime generation maps to
  a different product identity and creates a new transcript row;
- a reconstructed backend must never reuse a prior generation's product
  message or tool-call identity, including for synthesized `pi-message-*`
  values;
- a recorder/store may treat `message/start` as replay only when both the
  normalized product identity and its generation provenance match. A naked id
  collision with different provenance is a diagnostic error and must never
  mutate the older message.

This identity normalization lands with cold activation and applies to the
existing JSON transcript recorder. It is not deferred until the SQLite
migration.

Full transcripts are not stored inside a lazy Product Shell. Until the
transcript-store migration lands, a recovered shell may retain only the same
bounded tail sent to clients; model history is loaded transiently and remains
bounded by `buildProductHistoryContext`.

### 8. Memory accounting includes RPC children

Count limits are the deterministic safety layer. RSS pressure is the emergency
layer.

- SDK mode samples the Host process RSS.
- RPC workers answer an internal, bounded resource query with their current
  `process.memoryUsage()` snapshot. The supervisor caches the latest reply and
  exposes only aggregate bytes to Host Runtime.
- Missing/stale worker samples are marked incomplete; count/TTL enforcement
  still applies and no false low-memory claim is made.

Aggregate metrics are queried, not streamed at high frequency, in accordance
with ADR 0038. Add a safe `host/runtime-resources` query returning counts,
budget, sample completeness, queue depth, and cumulative eviction counters.
Per-session residency transitions continue through the existing
`session/runtime-updated` push.

### 9. Product transcripts move to a bounded-access store

Runtime eviction alone does not bound an active long session: the current
recorder loads the complete `transcript.json` into memory and atomically
rewrites the complete document on streaming flushes.

Add a `SessionTranscriptStore` in `@piwin/session` backed by one
`transcript.sqlite3` database per product session using the already available
`node:sqlite` runtime. It is product data, not a rebuildable cache.

SQLite is a bounded-access persistence mechanism, not an identity repair by
itself. The store persists the normalized product message id together with its
runtime-generation and backend-message provenance. Append/upsert operations
use that provenance for replay idempotency; they never upsert a backend event
by a naked `messageId`. Tool-call ids stored inside a message are normalized by
the same generation-scoped rule before persistence.

The store provides focused operations for:

- append/upsert one message;
- update the active assistant message and tool cards transactionally;
- read newest/older pages by sequence and revision;
- read bounded history context and recent model metadata;
- read a paged outline;
- truncate, fork, duplicate, export, and full iteration without materializing
  every message at once;
- close the database handle when the runtime becomes cold.

Legacy `transcript.json` is imported transactionally on first write/open of the
v2 store. The original JSON remains as a backup until import verification
succeeds; migration never silently deletes the only copy. Existing public
Host commands keep their semantics.

Legacy rows receive a reserved import-generation namespace so their existing
ids remain addressable without colliding with events from a later live runtime.

`session/resume` stops returning a complete outline. It returns a bounded
recent outline window; older outline data is available through an additive
`session/outline-page` command.

## Package ownership

| Package | Responsibility |
|---------|----------------|
| `@piwin/contracts` | Retention config, residency/resource status, Run phase/error, outline page contract |
| `@piwin/session` | Durable transcript store, provenance-aware replay idempotency, migration, page/history/outline queries |
| `@piwin/host-runtime` | Residency controller, admission, event-collision diagnostics, blockers, suspension transaction, metrics composition |
| `@piwin/agent-host` | Generation-scoped normalization of Pi event identities, SDK/RPC generation release, and internal worker memory snapshot |
| Desktop/CLI | Settings/status presentation only; no eviction timers or local authority |

## Consequences

- Browsing hundreds of chats remains bounded and does not create hundreds of
  Pi sessions or workers.
- Recently used sessions remain fast, but idle cache size and lifetime are
  explicit.
- Memory pressure is handled before backend capacity failure or OS OOM.
- A cold prompt pays runtime reconstruction latency and may ask again for a
  non-durable session permission.
- Runtime suspension and product-session deletion become distinct code paths,
  preventing eviction from killing independent Host-owned resources.
- A cold prompt keeps the stable product identity, so Host tools are admitted
  against the correct Run and a reconstructed backend appends new turns rather
  than merging them into older `pi-message-*` rows.
- Transcript migration is a larger change, but without it a single long active
  session still has whole-document memory and rewrite cost.

## Rejected alternatives

1. **TTL only** — does not react to a burst of sessions or a memory-heavy
   runtime before the deadline.
2. **RSS threshold only** — reacts late and cannot deterministically guarantee
   worker/session counts.
3. **Worker cap only** — converts memory pressure into capacity errors and
   leaves SDK/runtime maps unbounded.
4. **Evict when a client switches chats** — breaks multi-client/background
   work and throws away useful short-term locality.
5. **Treat a selected or pinned chat as permanently resident** — allows client
   count and navigation history to defeat the Host budget.
6. **Reuse `RuntimeResourceCoordinator` for residency** — execution leases and
   runtime cache lifetime have different ownership and release conditions.
7. **Rely on model compaction** — context-token compaction does not release Pi
   handles, workers, subscriptions, or Host transcript objects.
8. **Restart the Host at a threshold** — loses transient state and hides a
   missing lifecycle policy.
9. **Rely on SQLite `UNIQUE(message_id)` or upsert semantics** — changes the
   failure from an in-memory merge into an overwritten row or uniqueness
   error. Generation-scoped event identity must be correct before persistence.
