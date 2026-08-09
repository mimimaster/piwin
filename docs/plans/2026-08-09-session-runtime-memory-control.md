# Session runtime memory control — execution plan

| Field | Value |
|-------|-------|
| Status | Implemented; native SDK/RPC RSS gate passed, manual cross-feature rollout check remains |
| Date | 2026-08-09 |
| Decision | [ADR 0040](../adr/0040-host-session-runtime-residency.md) |
| Primary owner | `@piwin/host-runtime` |

## 1. Outcome

After this plan, durable chat count and live Agent runtime count are independent.
Opening history is bounded and cheap. Prompting a cold session transparently
reactivates it. Idle SDK sessions and RPC workers are retired by TTL/LRU before
count or memory budgets are exhausted.

The plan deliberately has two release gates:

1. **Runtime residency gate** stops memory growth caused by switching among
   sessions.
2. **Transcript-store gate** stops one long active session from retaining and
   rewriting its complete transcript document.

Gate 1 should ship first. Gate 2 is required before claiming Host session
memory is bounded end to end.

Stable runtime identity and generation-scoped Agent event identity are
correctness requirements of Gate 1. Gate 2 preserves those identities in
SQLite; it must not be used as a substitute for fixing them.

## 2. Current failure map

| Current path | Failure |
|--------------|---------|
| `HostRuntime.sessions` / `ProductAgentHost.sessions` | Entries leave only on explicit drop/dispose |
| `AgentWorkerSupervisor` | Hard worker cap, no idle victim selection |
| `session/resume` | Loads the complete transcript, creates/binds a Product Shell, and reports `live: true` |
| `ProductShellSession` | May retain complete `seedMessages`; lazy backend creation can use a new session id, so Host tool frames fail admission against the stable session Run |
| Pi event mapper / `TranscriptRecorder` | Synthesized `pi-message-*` ids restart in each backend generation; naked-id replay dedupe can merge a reconstructed answer and tool cards into an old row |
| `TranscriptRecorder` | Retains the complete document and rewrites it every flush |
| `RuntimeResourceCoordinator` | Correctly limits execution leases, but does not own runtime residency |

## 3. Work packages

### WP0 — Baseline and test fixtures

- [x] Add an injected clock and memory sampler fixture for residency tests.
- [x] Add fake SDK/RPC backends that count create, drop-generation, drop-session,
      subscribe, unsubscribe, and worker-memory-query calls.
- [x] Capture baseline behavior for cold resume, first prompt reconstruction,
      active Run correlation, pending permission, compaction, and runtime reload.
- [x] Add a cold-resume fixture in which two backend generations both emit
      `pi-message-2` and `call_00`; reproduce the current old-row merge and
      Host-tool `session-mismatch` denial before applying the fix.
- [x] Add a deterministic 100-session navigation fixture proving the current
      live-handle/recorder count can grow.

Exit gate: the regression is reproduced without real waiting or flaky RSS
assertions.

### WP1 — Contracts and normalized Settings

- [x] Add `SessionRuntimeRetentionConfig` under `SessionConfig` with the ADR
      defaults and strict normalization/clamps.
- [x] Add residency details to `SessionRuntimeStatus` without removing the
      existing compatibility state.
- [x] Add `waiting-resource` to `SessionRunPhase` and
      `runtime-memory-pressure` to stable terminal codes.
- [x] Add `host/runtime-resources` query/response contracts.
- [x] Add a bounded `session/outline-page` contract and capability marker.
- [x] Update every switch/exhaustive mapper in Host, Desktop, CLI, and tests.

Exit gate: `@piwin/contracts` typecheck is green and old clients can ignore the
additive status fields.

### WP2 — Pure residency controller

Create
`packages/host-runtime/src/sessions/session-runtime-residency-controller.ts`.

- [x] Track state, generation id, last-used time, idle deadline, transition
      promise, protection count, and last eviction reason per resident session.
- [x] Implement `touch`, `beginActivation`, `commitActivation`,
      `abortActivation`, `markBusy`, `markIdle`, `protect`, `releaseProtection`,
      and `suspend` transitions.
- [x] Implement deterministic victim selection: expired first, then idle LRU;
      never choose a protected runtime.
- [x] Implement admission against max resident/max idle counts and high/low RSS
      hysteresis.
- [x] Queue capacity waiters FIFO with AbortSignal cancellation.
- [x] Use one unref'ed 30-second sweep timer only while resident entries exist.
- [x] Keep metrics counters bounded and aggregate; never retain an eviction log
      per session indefinitely.

Required tests:

- TTL expiry;
- LRU tie-breaking by stable session id;
- max-idle and max-resident admission;
- high-water eviction to low water;
- all-protected behavior;
- cancelled waiter removal;
- duplicate activation/suspension deduplication;
- stale generation cannot evict a replacement generation;
- timer starts/stops and releases on Host dispose.

Exit gate: pure tests cover every transition and no backend/session package is
imported by the controller.

### WP3 — Cold resume, stable activation, and event identity

- [x] Change `session/resume` into a durable bounded read. Do not bind a shell
      or create a backend when the session is cold; return `live: false`.
- [x] Remove complete `seedMessages` retention from `ProductShellSession`, or
      retire the shell from the normal resume path.
- [x] Add a Host-owned `activateSessionRuntime(sessionId, signal)` path using
      `ProductAgentHost.prepareSession`/commit with the stable product session
      id and a fresh generation id.
- [x] Deduplicate concurrent activation by session id.
- [x] Make `session/prompt` validate the durable record instead of requiring an
      already-bound handle before acceptance.
- [x] Preserve the current prompt-persistence ordering, then activate in the
      detached Run before provider execution.
- [x] Add `RunRegistry.attachRuntimeGeneration(runId, generationId)` with
      exact-once validation before Host tool admission.
- [x] At the `@piwin/agent-host` adapter boundary, normalize Pi-native and
      synthesized message, tool-call, and permission ids with the stable
      product session id plus runtime generation id before emitting
      `AgentEvent`. Keep the resulting ids opaque to clients.
- [x] Make identity mapping deterministic within one generation so replayed
      events remain idempotent, while identical backend ids from different
      generations always produce different product ids.
- [x] Update the current JSON `TranscriptRecorder` immediately: only matching
      normalized id plus generation provenance counts as replay. A collision
      with different provenance emits a bounded `host/log` diagnostic and
      cannot update the older row.
- [x] Inject bounded product history once when the accepted Run started cold;
      do not infer this from a full in-memory seed array.
- [x] Set `SessionResumeData.live` from actual residency, not from product
      session existence.
- [x] Replace the complete resume outline with the bounded recent window.

Required tests:

- browsing 100 sessions creates zero Agent runtimes;
- first prompt creates one runtime using the original product session id;
- two simultaneous activation attempts create one generation;
- the first reconstructed turn receives bounded history once;
- the second turn does not receive duplicate history;
- RPC Host tool calls see the newly attached generation on the Run;
- SDK and RPC Host tool frames carry the original product session id and pass
  Run admission after cold activation;
- two generations that each emit `pi-message-2` create two ordered assistant
  rows, and the newest final answer remains after the newest user row;
- replaying `pi-message-2` within one generation is idempotent;
- repeated backend tool-call ids across generations do not merge tool cards or
  poison Run event correlation;
- activation failure leaves durable history and no leaked reservation.

Exit gate: session selection no longer changes worker/session-handle counts;
the first cold prompt can execute Host tools and appends one new assistant turn
without mutating prior-generation transcript rows.

### WP4 — Safe suspension transaction

- [x] Implement `suspendSessionRuntime` separately from session delete/dispose.
- [x] Build the eviction blocker from RunRegistry, pending permission/UI maps,
      compaction protection, replacement state, and transition state.
- [x] Add explicit protection leases around compaction and any backend
      operation not represented in RunRegistry.
- [x] Flush recorder before detaching. Treat flush failure as an eviction
      failure, keep the runtime resident, and surface a bounded diagnostic.
- [x] Mark generation non-admitting before backend abort/drop so late tool
      frames fail closed.
- [x] Unsubscribe, clear event correlation, release Host tool/MCP generation
      snapshots, and call ProductAgentHost/backend drop exactly once.
- [x] Dispose the recorder and remove resident-only maps.
- [x] Revoke session-only permission grants and overrides on cold suspension.
- [x] Do not stop independent Jobs, archive/delete the session, or abort
      walkthrough generation.
- [x] Touch/mark idle on terminal Run and wake queued activation requests.

Required tests:

- active, cancelling, permission-waiting, UI-waiting, compacting, and replacing
  sessions are never evicted;
- idle SDK handle is dropped once;
- idle RPC worker exits and supervisor capacity is reclaimed;
- recorder flush precedes unsubscribe/drop;
- late events from the retired generation do not reach transcript or clients;
- Job and walkthrough authorities survive suspension;
- cold re-prompt reconstructs successfully.

Exit gate: SDK and RPC pass the same residency conformance suite.

### WP5 — Worker and Host memory pressure

- [x] Add an internal worker resource request/response carrying current
      `process.memoryUsage()` values with a strict frame size and timeout.
- [x] Aggregate Host RSS plus current worker RSS in AgentWorkerSupervisor/
      HostRuntime without exposing per-process secrets or PIDs remotely.
- [x] Cache worker samples briefly; mark aggregate completeness explicitly.
- [x] Run admission eviction before worker acquisition.
- [x] When idle victims exist, capacity exhaustion must evict/retry rather than
      return `worker capacity exhausted`.
- [x] When every runtime is busy, publish `waiting-resource` and queue
      cancellably.
- [x] When memory remains above high water after all idle victims are gone,
      terminalize the new activation with `runtime-memory-pressure` and an
      actionable message.
- [x] Add query-only aggregate metrics and doctor output:
      resident/idle/busy/activating counts, waiter count, Host RSS, worker RSS,
      budget, sample completeness, and eviction/failure counters by reason.

Exit gate: synthetic high-water tests evict before new worker creation, and a
fully busy Host rejects or waits safely without killing active Runs.

### WP6 — Bounded transcript store

Add a focused `SessionTranscriptStore` in `@piwin/session` and keep SQLite
imports inside its storage module.

Suggested per-session schema:

```sql
CREATE TABLE transcript_meta(
  session_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  project_path TEXT NOT NULL,
  scope_json TEXT,
  working_directory TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE transcript_message(
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  runtime_generation_id TEXT NOT NULL,
  backend_message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  thinking TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  run_id TEXT,
  model_json TEXT,
  attachments_json TEXT,
  tools_json TEXT,
  metadata_json TEXT,
  UNIQUE(runtime_generation_id, backend_message_id)
);
```

`id` is the opaque, product-global message id emitted after adapter
normalization. `(runtime_generation_id, backend_message_id)` is retained as
provenance and the replay-idempotency key; it is not exposed as a client-side
compound key. User-authored transcript rows use a reserved Host generation
and their client message id as provenance. Legacy imports use the reserved
`legacy-import-v1` generation namespace.

- [x] Define the store interface before changing callers.
- [x] Implement transactionally append/upsert/update/finalize operations for
      only the affected message row.
- [x] Require append/upsert callers to provide normalized id and generation
      provenance. Never update a row solely because its backend message id
      matches.
- [x] Replace recorder whole-document snapshots with current-row updates and a
      bounded write queue.
- [x] Implement tail/page cursors from transcript revision + sequence.
- [x] Implement bounded history-context and recent-model queries.
- [x] Implement outline pages without loading full message bodies.
- [x] Implement truncate/fork/duplicate/export as streamed or transactional
      store operations.
- [x] Import legacy `transcript.json` transactionally and verify message count,
      ids, and a content digest before selecting v2 as authority.
- [x] Keep the original JSON backup; provide doctor detection/repair for an
      interrupted migration.
- [x] Close SQLite handles when a session becomes cold and during Host dispose.

Required tests:

- v1 import is idempotent and lossless;
- interrupted import leaves v1 authoritative;
- append/update do not read or rewrite unrelated rows;
- two runtime generations with the same backend message id persist as two
  rows, while a replay in the same generation remains one row;
- cross-generation tool-call ids remain attached to their own assistant rows;
- legacy ids and the first post-migration generation cannot collide;
- cursor staleness after mutations;
- exact truncate/fork/duplicate/export parity;
- 10,000-message tail/history/outline operations return bounded rows/bytes;
- recorder memory is proportional to the active message/tool budget, not total
  transcript length.

Exit gate: no normal prompt, resume, page, naming, compaction-history, or
recorder path materializes the complete transcript array. Explicit export and
duplicate may iterate the full transcript but remain streaming/bounded.

### WP7 — Desktop and CLI visibility

- [x] Reuse the existing Session Runtime settings page and `@piwin/ui-kit`
      controls for idle TTL, idle count, optional resident cap, and optional
      memory high water.
- [x] Show `Cold`, `Starting`, `Ready`, `Busy`, and `Suspending` truthfully in
      diagnostics; ordinary chat UX only needs a subtle “restoring runtime”
      phase on cold prompt.
- [x] Keep history usable when `live: false`; do not label a cold session as
      disconnected or damaged.
- [x] Add aggregate resource status to CLI doctor/status.
- [x] Do not implement any Desktop-owned timer, LRU, or memory threshold.

Exit gate: Desktop and CLI observe the same Host policy and status.

### WP8 — Verification and rollout

- [x] Run touched-package typechecks and tests after every work package.
- [x] Add one SDK and one RPC integration scenario that prompts 50 distinct
      sessions, advances the injected clock, and verifies resident/worker/
      recorder counts return to policy bounds.
- [x] Add a multi-client scenario where two clients view different cold
      histories while one third session runs; viewing does not allocate a
      runtime and the running session is not evicted.
- [x] Add a cancellation scenario while waiting for runtime capacity.
- [x] Record Host and worker RSS during a native 30-minute switch/prompt soak;
      include resident counts and eviction counters with every sample.
- [ ] Verify session history, fork, duplicate, truncate, export, compact,
      permissions, MCP, and subagent flows after cold reactivation.
- [x] Update architecture, dev plan, product status, doctor docs, and remove
      the Runtime Refactor “automatic idle eviction” deferred item only after
      both release gates pass.

Release evidence must show:

- history-only switching allocates no runtimes;
- idle runtime and worker counts never exceed the configured policy;
- high-water pressure triggers Host eviction before backend capacity failure;
- active Runs and pending user decisions are never evicted;
- after warm-up and eviction, Host + worker RSS stays below the configured high
  water or reports a stable, actionable pressure failure;
- transcript data survives repeated cold/reactivate cycles exactly.
- every cold/reactivate cycle admits Host tools against the stable session Run
  and appends final output after the current user turn without modifying an
  older-generation message.

## 4. Rollout order

1. Ship WP0–WP4 behind the normalized default policy, with query-only metrics.
2. Enable count + TTL eviction by default after SDK/RPC conformance passes.
3. Enable RSS admission after worker sampling and native soak evidence pass.
4. Ship WP6 migration with legacy transcript fallback and backup retained.
5. Remove complete-array transcript internals only after migration parity tests
   and repair tooling are green.

No phase may silently fall back to unbounded residency. If a new policy path is
unavailable, the Host keeps deterministic count limits and reports capability
truthfully.

## 5. WP0–WP5 implementation review remediation (2026-08-09)

The first implementation review found cross-layer wiring and suspension-order
gaps that unit-level helpers did not expose. The implementation now enforces:

- SDK and RPC Worker adapter exits apply generation-scoped normalization before
  publishing message, tool-call, or permission identities.
- A residency victim remains `suspending` and continues consuming capacity
  until recorder flush, backend/worker drop, and Host resident-map cleanup have
  completed. A failed flush restores `resident-idle` and does not increment an
  eviction counter or wake a capacity waiter.
- A prompt arriving during suspension waits for the shared suspension
  transaction instead of receiving the retiring handle.
- Foreground Run cancellation uses the same `AbortSignal` for capacity waits;
  `runtime-memory-pressure` survives as the terminal Run code.
- Persisted `session.runtimeRetention` is normalized by the config store,
  loaded before the first Host command, updated after `settings/apply`, and
  reflected by `host/runtime-resources`.
- `runtimeResidency` and `sessionOutlinePage` capabilities are advertised only
  by the Host implementation that serves those commands.
- A generation-attachment conflict rolls back the newly allocated backend
  rather than continuing with a Run that cannot admit Host tool frames.
- Transcript collision quarantine covers the complete message/tool lifecycle,
  so a diagnostic collision cannot mutate an older-generation row.

Verification after remediation:

- repository-wide TypeScript project typecheck: passed (29 workspace projects);
- `@piwin/contracts`: 202 tests passed;
- `@piwin/agent-host`: 164 tests passed;
- `@piwin/session`: 189 tests passed;
- `@piwin/host-runtime`: 1010 tests passed;
- package-boundary architecture check and `git diff --check`: passed.

This evidence closes the review defects, but does not by itself complete the
WP8 native RPC/SDK soak, 50-session integration, or long-running RSS evidence.
WP0–WP5 must not be marked release-complete until those remaining gates pass.

## 5.1 Native SDK/RPC soak closure (2026-08-10)

The native residency gate now passes in both backend modes. Each mode ran for
30 minutes with six rotating sessions, one real prompt per minute, five-second
Host/worker RSS samples, a 45-second idle TTL, one idle slot, and two resident
slots. Both runs completed 30 cycles with complete samples and no admission,
prompt, or memory-pressure failure.

SDK recorded 359 samples with aggregate RSS p95 224 MiB. RPC recorded 359
samples with aggregate RSS p95 382 MiB, replaced its worker process on cold
reactivation, and left zero of 31 observed worker PIDs alive after Host
disposal. Both full-run RSS slopes were negative; the per-cycle peak plateau
also remained stable over the final ten cycles.

Full data, commands, interpretation, and the final regression matrix are in
[`2026-08-10-session-runtime-rss-soak.md`](../evidence/2026-08-10-session-runtime-rss-soak.md).
The only remaining WP8 rollout item is the manual provider-driven cross-feature
matrix for permissions, MCP, and subagent behavior after cold reactivation.

## 6. WP6 implementation closure (2026-08-09)

WP6 now uses a per-session `transcript.sqlite3` as the Host transcript
authority. The production recorder writes only the current row through a
bounded queue; ordinary resume, page, naming, history injection, compaction,
search, and walkthrough validation use bounded Store queries. Truncate is
transactional, while fork, duplicate, and export iterate in bounded batches.

The first open migrates a legacy `transcript.json` transactionally, verifies
count, ids, and a canonical content digest against independently streamed
database rows, and retains `transcript.json.v1.bak`. `piwin doctor` reports an
interrupted migration; `piwin doctor --repair-transcripts` rebuilds and
verifies a side database before swapping it in, while retaining the prior
database for recovery.

Cold-session command reads use reference-counted Store leases. Concurrent
clients may safely share one handle, and the last reader closes it unless the
session became resident meanwhile. Suspension, disposal, and Host shutdown
also close their handles explicitly.

Verification evidence:

- repository-wide `pnpm typecheck`: passed (29 workspace projects);
- `@piwin/contracts`: 202 tests passed;
- `@piwin/agent-host`: 164 tests passed;
- `@piwin/session`: 189 tests passed, including the 10,000-row bounded-query
  case;
- `@piwin/host-runtime`: 1010 tests passed, including SDK/RPC 50-session
  residency, migration/repair, concurrent leases, row recorder, and derived
  transcript operations;
- `pnpm test:architecture` and `git diff --check`: passed.

The repository-wide `pnpm test` aggregate remains red in four Desktop
`resolve-document-content.test.ts` cases from an unrelated concurrent document
content change. All packages and tests directly touched by WP6 are green; the
unrelated Desktop failures were not modified as part of this work.

## 7. Estimated effort

| Slice | Estimate |
|-------|----------|
| WP0–WP2 contracts/controller | 1.5–2 days |
| WP3–WP4 cold activation/suspension | 2–3 days |
| WP5 memory sampling/admission | 1–2 days |
| WP6 transcript store/migration | 3–5 days |
| WP7–WP8 UI, doctor, soak, docs | 1.5–2 days |

Expected total: 9–14 focused engineering days. The first useful safety release
(count + TTL + cold resume) is achievable after roughly 4–6 days; the remaining
work closes long-session and measured-memory gaps.
