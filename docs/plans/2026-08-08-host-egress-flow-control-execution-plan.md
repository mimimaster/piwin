# Host egress flow-control and Desktop renderer recovery execution plan

| Field | Value |
|-------|-------|
| Status | **Stage 1 and automated Desktop renderer bounds implemented; native Gate A, authenticated loopback composition, and renderer reload recovery pending** |
| Date | 2026-08-08 |
| Goal | Eliminate the Desktop WebContent event/memory amplification, establish one bounded Host egress authority, and make local/remote clients recover through the same protocol |
| Decision | [ADR 0038](../adr/0038-host-egress-flow-control-and-recovery.md) |
| Detailed spec | [Host egress delivery and recovery](../specs/host-egress-delivery.md) |
| Incident evidence | [Desktop WebContent memory incident](../notes/2026-08-08-desktop-webcontent-memory-incident.md) |
| Renderer Phase 2 | [Desktop WebContent memory containment](./2026-08-09-desktop-webcontent-memory-phase2.md) |

## 0. Outcome and scope

This plan delivers two releaseable milestones:

1. **Stage 1 containment:** semantic Run updates, one Host Egress Hub, bounded
   cursor batches over the existing JSONL/Tauri path, no response broadcast,
   and native macOS evidence that the WebKit OOM slope is gone.
2. **Stage 2 convergence:** public HostClient over authenticated loopback
   WebSocket, replay/hydration after renderer restart, keyed Desktop
   projections, and a windowed transcript.

The intended final flow is:

```text
HostRuntime semantic revisions
  → HostEgressHub
      → bounded local JSONL batch (Stage 1)
      → loopback/private WebSocket (Stage 2)
  → HostClient batch transaction
  → keyed client projections + one visual stream commit/frame
  → windowed transcript
```

### In scope

- Stop redundant Run projection publication.
- Add Run revisions and client duplicate/no-op handling.
- Add additive batch/cursor/capability contracts.
- Implement exhaustive HostPush policy/key/barrier classification.
- Implement one egress Hub, bounded replay journal, per-client queues, pacing,
  metrics, and slow-consumer isolation.
- Migrate local JSONL/Tauri delivery to bounded batches.
- Finish the in-progress public Host transport/client/server packages instead
  of creating duplicates.
- Migrate Desktop to public HostClient over loopback after Stage 1 proves safe.
- Add local replay/hydration and renderer restart recovery.
- Isolate Desktop Run state, heavy content, tool-output accounting, syntax
  highlighting, and transcript mount count.
- Capture automated and native macOS regression evidence.

### Out of scope

- Public Gateway/relay, cloud accounts, E2EE, or multi-tenancy.
- Remote PTY.
- Provider/Pi protocol changes.
- Moving Pi imports outside `@piwin/agent-host`.
- Redesigning product UI unrelated to transcript resource bounds.
- Arbitrarily dropping append deltas or making the UI a terminal-state
  authority.

## 1. Working-tree safety and starting state

The 2026-08-08 worktree is heavily dirty and contains user-owned, uncommitted
mobile/markdown/speech work plus new untracked Host packages. The implementation
must not start by mass-reverting, cleaning, or overwriting it.

Before Task 1, the implementer must:

- [ ] record `git status --short` and the current revision in the implementation
      note;
- [ ] have the owner commit/shelve unrelated work or create an isolated
      worktree/branch explicitly for this program;
- [ ] preserve the current untracked `packages/host-transport`,
      `packages/host-client`, `packages/host-server`, and `apps/host` skeletons;
- [ ] avoid `git reset --hard`, `git checkout --`, recursive cleanup, or an
      automatic stash of user changes;
- [ ] re-read `AGENTS.md`, ADR 0038, and the delivery spec after isolation.

The current Host skeleton is intentionally treated as an implementation base,
not as completed functionality. Known reconciliation items are listed in the
delivery spec §19.

## 2. Definition of done

This program is complete only when all of the following are true:

- [ ] Same-phase Agent deltas produce no unchanged `run/updated` pushes.
- [ ] Every HostPush variant has an exhaustive delivery policy/key/barrier.
- [ ] Exactly one HostEgressHub attaches to HostRuntime for production client
      fan-out.
- [ ] Every client queue and replay journal is bounded by bytes and items.
- [ ] Append/control content is exact or the client receives an explicit
      disconnect/recovery path; no silent transport truncation exists.
- [ ] Local Desktop receives bounded cursor batches, not one Tauri event per
      semantic push.
- [ ] Rust responses are correlated only and never broadcast to WebContent.
- [ ] A slow secondary client cannot increase the fast client's queue or block
      Host completion/control.
- [ ] Desktop uses public HostClient by default over authenticated loopback
      WebSocket; Stage 1 JSONL batch remains a bounded fallback until its
      scheduled removal.
- [ ] Renderer reload during a live Run replays or hydrates without duplicate
      transcript content or lost terminal/permission state.
- [x] Identical Run projections preserve reducer/map identity and historical
      row render counts.
- [x] A 500+ message transcript mounts only a bounded virtual window.
- [x] Tool-output retention work is linear in received bytes and remains
      capped.
- [ ] Package boundary test, typecheck, touched tests, JSONL E2E, Host WebSocket
      E2E, Desktop E2E, Cargo tests, bundle smoke, and native evidence pass.
- [ ] ADR/spec/architecture/status documents reflect the landed behavior.

### Current execution ledger — 2026-08-09

Stage 1 code is now present and verified in the shared worktree. The remaining
unchecked items below are intentionally not implied complete by this ledger;
they require native macOS measurements or the separate Stage 2 rollout.

- [x] Run authority publishes semantic revisions only; same-phase observations
      are reducer/authority no-ops.
- [x] Desktop Run projection ignores stale/identical revisions and passes only
      the row-local Run record through memo boundaries.
- [x] Contracts and codec accept bounded `push/batch` frames with Host-instance
      cursors and capability negotiation.
- [x] Exhaustive HostPush/AgentEvent delivery policy is covered by tests.
- [x] HostEgressHub, bounded per-client channel, replay journal, scoped
      barriers, synchronous-burst draining, and payload-free egress metrics
      are implemented.
- [x] Hub ingress pending data and diagnostics are bounded by item/byte
      budgets; oversized append/control items take an explicit failure path.
- [x] CLI JSONL uses the Hub as its sole push fan-out and no longer uses the
      lossy app-local stream batcher.
- [x] Rust routes responses only to pending requests, targets push events at
      the main WebView, and emits batches on `host-message-batch`.
- [x] Desktop local HostClient validates and applies one batch cursor
      transaction while retaining singular compatibility delivery.
- [x] Public HostClient/HostServer now have an additive bounded hydration
      frame, Host-instance cursor replacement, subscription-limited session
      summaries/transcripts, and post-hydration replay fencing.
- [x] HostServer now supports an explicit Origin allowlist and has rejection
      coverage for wrong credentials and disallowed browser origins.
- [x] Desktop heavy-content containment is implemented: collapsed thinking
      and historical completed-tool bodies unmount, tool output has one exact
      UTF-8 256 KiB projection, and streaming code does not start Shiki.
- [x] Desktop transcripts above 40 turns use one dynamic-height scroll owner,
      four-turn overscan, virtual History Tick jumps, focused-editor pinning,
      and bounded per-session offset/height caches.
- [x] The pet overlay now boots from a separate Vite/Tauri entry and no longer
      loads the main Desktop JS/CSS graph.
- [x] `pnpm typecheck`, `pnpm test:architecture`, targeted Host/Desktop/Cargo
      tests, the 49-assertion JSONL E2E, and the final 141-test renderer suite
      pass. The full Desktop run passes 145 files / 919 tests and is blocked
      only by three unrelated `resolve-document-content*` tests in the user's
      dirty Desktop worktree; the Host/renderer slices remain green.
- [ ] Native Gate A evidence (30-minute run, memory slope, Tauri evaluation
      count, queue/cursor statistics) is still required.
- [ ] Stage 2 authenticated loopback Desktop default and renderer
      lifecycle/reload wiring are still pending. The public hydration protocol
      and automated renderer-containment slices are implemented and await that
      composition plus native evidence.
- [x] Renderer Phase 2 implementation and clean-start spot evidence are
      complete: React development User Timing is bounded, optional surfaces
      have active-only lifecycles and deferred JS/CSS, and the full stage has
      one compositor owner. A clean 10-minute spot series held at 212–214 MB
      with no live User Timing entries. A later restart hardened the interval
      into a synchronous write-boundary guard and passed another 10-minute idle
      gate at 277.7–278.3 MiB; the formal 30-minute Gate A run remains pending.
- [x] Client collection Phase 3 Tasks 1–3 bound the sidebar to six-row project
      and twelve-row General Host cursor pages, replace complete Desktop index
      hydration with a three-page/128-KiB lazy sliding window, and resume
      transcripts through Host-owned byte/item-bounded tail pages plus a
      bounded Desktop cache. Native HMR evidence reduced live buttons from 530
      to 186 and SVG roots from 400 to 146. The browser panel now owns independently named
      Chromium leases and releases the process after its final surface closes;
      see the [Phase 3 plan](./2026-08-09-desktop-client-collection-windowing-phase3.md).

## 3. Release gates and dependency order

```text
Task 0: reconcile in-progress Host skeletons
  ↓
Task 1: Host semantic Run revisions ──→ Task 2: Desktop Run no-op/isolation
  ↓
Task 3: batch/cursor contracts
  ↓
Task 4: exhaustive delivery policy primitives
  ↓
Task 5: HostEgressHub + queues + journal
  ↓
Task 6: JSONL/Tauri bounded batch migration
  ↓
Gate A: Stage 1 native containment evidence (shippable incident fix)
  ↓
Task 7: replay + hydration + restart recovery
  ↓
Task 8: public HostClient + authenticated loopback Desktop path
  ↓
Task 9: renderer heavy-work bounds
  ↓
Task 10: dynamic transcript windowing
  ↓
Gate B: architecture-complete native/multi-client evidence
```

Tasks 2 and the test-fixture part of Task 3 may proceed after Task 1 contracts
settle. Tasks 9 and 10 may be developed after Task 2, but they do not replace
Gate A and must not obscure the transport before/after measurement.

### Gate A — incident containment release

Requires Tasks 0–6 plus:

- 30-minute native tool/thinking-heavy run;
- no WebKit renderer termination;
- no more than 2,600 Host batch evaluations/minute plus bounded controls;
- footprint no more than 1 GiB over post-hydration/warm-up baseline;
- Stop acknowledgement under 250 ms in the controlled fixture;
- exact queue/cursor stats retained in a dated evidence note.

The semantic hotfix from Tasks 1–2 may be merged early, but the incident is not
declared closed until Gate A passes.

### Gate B — architecture complete

Requires Tasks 7–10 plus:

- direct loopback HostClient is Desktop default;
- ordinary pushes cause no Tauri Host-message JavaScript evaluation;
- forced renderer termination during a live Run recovers correctly;
- fast + deliberately slow two-client test passes;
- 500+ turn dynamic-height/history-jump/follow-tail matrix passes;
- the 30-minute native matrix is repeated over loopback.

## 4. Planned files by ownership

This is the expected file map. New filenames may be adjusted within the same
focused responsibility, but ownership may not move across package boundaries.

| Owner | Files | Action |
|-------|-------|--------|
| contracts | `packages/contracts/src/run.ts` | Add optional Run `revision` |
| contracts | `packages/contracts/src/remote-protocol.ts` | Batch/cursor/capability/hydration frames |
| contracts | `packages/contracts/src/ipc.ts` | Local batch-compatible server framing/additive commands if required |
| contracts | `packages/contracts/src/ipc.test.ts`, new `remote-protocol.test.ts` | JSON shape/round-trip fixtures |
| host-runtime | `packages/host-runtime/src/run-registry.ts` + `.test.ts` | Publish only real Run revisions |
| host-runtime | `packages/host-runtime/src/host-runtime.ts` + tests | One broker sink; snapshot projection port |
| host-transport | `src/host-push-policy.ts` + test | Exhaustive policy/key/barrier classifier |
| host-transport | `src/protocol-codec.ts` + test | Strict singular/batch validation |
| host-transport | `src/host-transport.ts`, `src/websocket-host-transport.ts` + tests | Reconciled transport contract/state |
| host-server | `src/host-egress-hub.ts` + test | Canonical sequence/fan-out authority |
| host-server | `src/host-egress-channel.ts` + test | Per-client queues/pacing/slow consumer |
| host-server | `src/host-replay-journal.ts` + test | Byte/item/time-bounded replay |
| host-server | `src/local-jsonl-connection.ts` + test | Stage 1 local connection adapter |
| host-server | `src/client-hydration.ts` + test | Snapshot fence/projection |
| host-server | `src/host-server.ts` + tests | WebSocket admission delegates to Hub |
| host-client | `src/host-client.ts` + test | Atomic batch/cursor/replay/hydration state machine |
| host-client | new cursor store fixture/test | Host-instance-aware persistence |
| CLI | `apps/cli/src/index.ts`, serve transport/writer/dispatcher tests | Compose local egress; remove app policy |
| CLI | delete `host-serve-stream-batcher.ts` + old test after migration | Deletion gate |
| Tauri | `apps/desktop/src-tauri/src/host_bridge.rs` + tests | Route response vs batch; target main only |
| Desktop transport | `apps/desktop/src/host-client.ts` + tests or focused `tauri-host-transport.ts` | Stage 1 adapter, later public-client composition |
| Desktop state | `chat-reducer.ts`, `run-presentation.ts`, `chat-thread.tsx`, tests | Run no-op/keyed row projection |
| Desktop heavy work | `turn-work-details.tsx`, `syntax-highlight.tsx`, `chat-reducer.ts`, tests | Unmount/defer/incremental bytes |
| Desktop window | `transcript-viewport.tsx`, `chat-thread.tsx`, `use-transcript-scroll.ts`, `history-ticks-drawer.tsx`, tests | Dynamic turn virtualization + jump/anchor |
| packaging | `scripts/bundle-host.mjs`, `scripts/smoke-bundled-host.mjs`, Tauri config | Bundle/start loopback Host entry |
| evidence | new deterministic egress stress script and dated `docs/notes/` report | Retained automated/native measurements |

## 5. Task 0 — reconcile and lock the Host package skeletons

**Purpose:** make the current in-progress multi-client base internally coherent
before layering incident behavior onto it.

**Files:**

- `packages/contracts/src/remote-protocol.ts`
- `packages/host-transport/src/host-transport.ts`
- `packages/host-transport/src/websocket-host-transport.ts`
- `packages/host-transport/src/protocol-codec.ts`
- `packages/host-client/src/host-client.ts`
- `packages/host-server/src/host-server.ts`
- their `package.json`, `tsconfig.json`, `src/index.ts`, and new focused tests
- `apps/host/src/index.ts`
- `tsconfig.json`, workspace lock/reference files only as needed

### Steps

- [ ] Add at least one test file to each new package; remove
      `--passWithNoTests` only after tests exist.
- [ ] Choose one HostTransport hello contract. Recommended: HostClient supplies
      a factory through constructor options; transport exposes `setLastSeq`,
      `connect`, `send`, subscriptions, and `close` without a second mutable
      hello setter.
- [ ] Make `HostClient` and `WebSocketHostTransport` compile against that exact
      interface.
- [ ] Fix the HostServer start lifecycle so it does not call a second `listen`
      on a `WebSocketServer` already constructed with `host`/`port`.
- [ ] Generate exactly one event ID per canonical singular compatibility frame;
      do not copy a second UUID into the inner push.
- [ ] Add codec tests for malformed JSON, unknown types, missing fields,
      non-text WebSocket data, handshake timeout, auth failure, request
      correlation, and close cleanup.
- [ ] Add Host Server smoke with fake HostRuntime for connect → hello → status →
      one push → close.
- [ ] Run the package boundary checker with the new packages present and fix
      package classifications if it incorrectly treats infrastructure packages
      as application services.
- [ ] Record all pre-existing failures separately; do not hide them by weakening
      TypeScript or changing `--passWithNoTests` back.

### Verification

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/host-transport typecheck
pnpm --filter @piwin/host-transport test
pnpm --filter @piwin/host-client typecheck
pnpm --filter @piwin/host-client test
pnpm --filter @piwin/host-server typecheck
pnpm --filter @piwin/host-server test
pnpm --filter @piwin/host-app typecheck
pnpm test:architecture
```

### Exit criteria

- All five Host protocol packages/apps compile in isolation.
- The package dependency graph matches ADR 0038.
- One minimal WebSocket vertical slice passes without production Pi/provider.
- No local Desktop behavior changes in this task.

### Commit boundary

`refactor(host-protocol): reconcile host client transport server skeletons`

Rollback is a clean revert of this behavior-neutral reconciliation commit.

## 6. Task 1 — fix Run semantic publication at the authority

**Purpose:** eliminate the direct regression that publishes a full Run record
for every same-phase Agent delta.

**Files:**

- `packages/contracts/src/run.ts`
- `packages/host-runtime/src/run-registry.ts`
- `packages/host-runtime/src/run-registry.test.ts`
- `packages/host-runtime/src/host-runtime.test.ts`
- `packages/host-runtime/src/commands/session-live-commands.test.ts`

### Steps

- [ ] Add additive `revision?: number` to `ExecutionRunRecord`; document that
      new authorities always populate it.
- [ ] Centralize Run mutation publication in a focused private method such as
      `publishUpdated(node)` that increments revision once and emits a copy.
- [ ] Ensure create/start/phase/cancelling/terminal paths call it only after a
      real public mutation.
- [ ] Change `noteAgentEvent()` to track `firstTokenReceived` and phase/detail
      changes explicitly.
- [ ] Do not update `phaseUpdatedAt` or revision for a same-phase observation.
- [ ] Preserve `cancelling` and stale/mismatched Run behavior.
- [ ] Add a callback-count test: after test setup is cleared, 100 text deltas
      produce one first-token/streaming revision; another 100 thinking/tool
      deltas in the same phase produce zero Run revisions.
- [ ] Add transition tests for `tool/start`, `tool/end`, permission wait,
      cancelling, terminal immutability, and explicit mismatched `runId`.
- [ ] Add HostRuntime integration for production order: event push first, Run
      observation second; assert no unchanged Run push follows repeat deltas.

### Verification

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/host-runtime test -- run-registry
pnpm --filter @piwin/host-runtime test -- session-live-commands
pnpm --filter @piwin/host-runtime test -- host-runtime
```

### Exit criteria

- Run callback/revision counts match semantic transitions exactly.
- No event/transcript content or terminal behavior changes.
- The production ordering regression test fails against the pre-fix code.

### Commit boundary

`fix(host-runtime): publish run records only on semantic revision`

This commit is independently shippable and reversible.

## 7. Task 2 — make Desktop Run projection updates true no-ops

**Purpose:** prevent duplicate/irrelevant Run records from invalidating the
entire mounted transcript even if a legacy server sends them.

**Files:**

- `apps/desktop/src/chat-reducer.ts`
- `apps/desktop/src/chat-reducer.test.ts`
- `apps/desktop/src/run-presentation.ts` + test
- `apps/desktop/src/turn-work-details.tsx` + tests
- `apps/desktop/src/RunActivitySlot.tsx` + tests
- `apps/desktop/src/chat-thread.tsx`
- `apps/desktop/src/chat-thread.test.tsx`

### Steps

- [ ] Store the last Host Run revision in `RunRecordUi` when present.
- [ ] In `applyRunRecord`, immediately return the old state for a lower/equal
      revision.
- [ ] For legacy revisionless records, compare projected fields and preserve
      state/map identity when equal.
- [ ] Refactor `buildTurnPresentation` and rendering-phase helpers to accept
      the one `RunRecordUi | undefined` they need.
- [ ] Compute `messageRunRecord` in `ChatThread` and pass that to
      `ChatMessageRow`; remove the whole `runRecordsById` map from row memo
      identity.
- [ ] Keep the full map only at components that genuinely select an active Run,
      or pass the active record directly there as well.
- [ ] Extend the 500-history render-isolation harness: dispatch 100 identical
      Run projections and assert reducer identity, selected historical row
      render counts, and active row count do not change.
- [ ] Assert a real phase revision updates only the owning/current row and Run
      activity surface.

### Verification

```bash
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop test -- chat-reducer
pnpm --dir apps/desktop test -- run-presentation
pnpm --dir apps/desktop test -- chat-thread
```

### Exit criteria

- Duplicate Run projections return the exact old reducer object.
- Unrelated Run changes do not rerender historical transcript rows.
- Real phase/terminal changes remain visible.

### Commit boundary

`fix(desktop): isolate transcript rows from duplicate run projections`

## 8. Task 3 — add additive batch/cursor contracts

**Purpose:** make one bounded wire frame carry multiple semantic pushes with an
unambiguous client cursor.

**Files:**

- `packages/contracts/src/remote-protocol.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/ipc.test.ts`
- new `packages/contracts/src/remote-protocol.test.ts`
- `packages/host-transport/src/protocol-codec.ts` + test

### Steps

- [ ] Add `HostSequencedPush` and `HostPushBatchFrame` with
      `hostInstanceId`, `afterSeq`, `throughSeq`, and ordered `items` exactly as
      specified.
- [ ] Add handshake capability flags for batch/cursor/replay/hydration.
- [ ] Add stable `slow-consumer` and `oversized-frame` wire error/close reasons
      where clients must branch.
- [ ] Replace the naked last-sequence persistence shape with a Host-instance
      aware cursor type.
- [ ] Keep singular `HostPushFrame` as a decode/compatibility path; do not emit
      it to a batch-capable connection by default.
- [ ] Decide one local server-frame union without introducing a contracts
      import cycle. Prefer keeping shared wire envelopes in
      `remote-protocol.ts` and typing local writer output with that public
      union.
- [ ] Validate integer ranges, cursor order, item order, event IDs, nested push
      object shape, and encoded frame cap.
- [ ] Add JSON round-trip fixtures for zero-item checkpoint, one control item,
      mixed append/projection items, invalid order, duplicate seq, Host instance
      change, replay done, and snapshot required.
- [ ] Update codec's known-type set and its exported frame map intentionally.

### Verification

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/host-transport typecheck
pnpm --filter @piwin/host-transport test -- protocol-codec
```

### Exit criteria

- All wire shapes round-trip as plain JSON.
- Invalid cursor/item ordering is rejected before client state mutation.
- Existing singular-frame fixtures still decode.
- No app or package deep-imports another package's `src`.

### Commit boundary

`feat(contracts): add cursor-bearing host push batches`

## 9. Task 4 — implement exhaustive delivery policy primitives

**Purpose:** establish one tested answer for how every HostPush may be paced,
replaced, replayed, or used as a barrier.

**Files:**

- new `packages/host-transport/src/host-push-policy.ts`
- new `packages/host-transport/src/host-push-policy.test.ts`
- new `packages/host-transport/src/delivery-key.ts`
- new `packages/host-transport/src/delivery-key.test.ts`
- `packages/host-transport/src/index.ts`

### Steps

- [ ] Implement collision-safe tuple keys and a single encoder. Add adversarial
      cases containing `:`, NUL, slashes, and Unicode.
- [ ] Implement exhaustive outer HostPush classification.
- [ ] Implement exhaustive nested AgentEvent classification for both `event`
      and `subagent/stream`.
- [ ] Return Run indexing metadata for scoped Run terminal barriers.
- [ ] Encode the complete matrix from delivery spec §6 as table-driven tests.
- [ ] Add a compile-time exhaustiveness fixture so a future union member breaks
      CI until classified.
- [ ] Keep the module pure; no timers, sockets, Node buffers, React, or
      HostRuntime imports.

### Verification

```bash
pnpm --filter @piwin/host-transport typecheck
pnpm --filter @piwin/host-transport test -- host-push-policy
pnpm --filter @piwin/host-transport test -- delivery-key
pnpm test:architecture
```

### Exit criteria

- Every current push/event has exactly one policy.
- Message/tool/Run/Job/PTY closing barriers reference only dependent keys.
- `subagent/stream` deltas are append-classified, fixing the current omission.

### Commit boundary

`feat(host-transport): define exhaustive host push delivery policy`

## 10. Task 5 — implement HostEgressHub, queues, journal, and metrics

**Purpose:** move sequencing/fan-out/backpressure from synchronous socket/app
callbacks into one bounded Host-owned delivery authority.

**Files:**

- new `packages/host-server/src/host-egress-hub.ts` + test
- new `packages/host-server/src/host-egress-channel.ts` + test
- new `packages/host-server/src/host-replay-journal.ts` + test
- new `packages/host-server/src/host-egress-metrics.ts` + test
- `packages/host-server/src/host-server.ts` + test
- `packages/host-server/src/index.ts`
- `packages/host-server/package.json` (add host-transport dependency)
- `packages/host-runtime/src/host-runtime.ts` + sink tests/comments

### Steps

- [ ] Add injected clock/timer/UUID/size-estimator seams; use fake timers in
      all cadence tests.
- [ ] Implement ingress ordinals and policy handling.
- [ ] Preserve original append items/envelopes; aggregate them into batches but
      do not concatenate delta strings.
- [ ] Replace pending projections by key and move their final order to the
      newest ingress ordinal.
- [ ] Bound diagnostics before canonical sequence assignment.
- [ ] Flush only scoped dependencies before a control record.
- [ ] Assign canonical Host sequence/event IDs after ingress canonicalization.
- [ ] Implement replay journal bounds: 16 MiB, 50,000 records, 10 minutes,
      each injectable for tests.
- [ ] Implement independent per-client channels with local/remote budgets from
      the spec.
- [ ] Pace ordinary data to one batch per 24 ms tick; allow immediate control
      batches.
- [ ] Replace queued projections and evict diagnostics before counting overflow.
- [ ] On remaining append/control overflow, close only that client with
      `slow-consumer`; leave HostRuntime and other channels running.
- [ ] Cache encoded sizes; do not stringify one full copy per client at ingress.
- [ ] Refactor `HostServer.handleRuntimePush/broadcast/send` to delegate to one
      Hub and one connection channel each.
- [ ] Ensure HostServer attaches one broker sink regardless of connection count.
- [ ] Expose a bounded stats snapshot through a local/admin query surface; do
      not add a metrics push.

### Required tests

- [ ] 100 append records within one interval → bounded number of batches with
      exact content/order.
- [ ] 100 replacements for one Run → one canonical projection and no false seq
      gaps.
- [ ] Delta → unchanged Run observation production order never yields 200
      frames.
- [ ] Message/tool end follows its own pending data.
- [ ] Permission for session B does not flush session A.
- [ ] Four concurrent subagent child streams stay isolated by keys.
- [ ] Slow client overflows/disconnects while fast client drains normally and
      Host terminal is recorded.
- [ ] Diagnostic storm evicts only diagnostics and reports the count.
- [ ] Journal byte/item/age boundaries each trigger explicit replay-too-old.
- [ ] Oversized items follow the explicit policy without logging payloads.
- [ ] Shutdown flushes control and detaches the sole runtime sink.

### Verification

```bash
pnpm --filter @piwin/host-server typecheck
pnpm --filter @piwin/host-server test -- host-egress
pnpm --filter @piwin/host-server test -- host-replay
pnpm --filter @piwin/host-server test -- host-server
pnpm --filter @piwin/host-runtime test -- host-runtime
pnpm test:architecture
```

### Exit criteria

- No direct synchronous WebSocket broadcast remains in production HostServer.
- All queues/journals have byte + item bounds.
- Slow-client test proves isolation and correct terminal persistence.
- Metrics expose every overflow/replacement/eviction path.

### Commit boundaries

1. `feat(host-server): add bounded host egress hub and replay journal`
2. `refactor(host-server): route websocket clients through egress channels`

The split permits reverting WebSocket integration without losing tested Hub
primitives.

## 11. Task 6 — migrate JSONL and Tauri to bounded batches (Stage 1)

**Purpose:** remove the high-rate `app.emit`/WKWebView evaluation path while
keeping the existing Desktop deployment topology.

**Files:**

- `apps/cli/src/index.ts`
- `apps/cli/src/host-serve-transport.ts` + tests
- `apps/cli/src/host-serve-jsonl-writer.ts` + tests
- `apps/cli/src/host-serve-dispatcher.ts` + tests
- delete `apps/cli/src/host-serve-stream-batcher.ts` and its test after parity
- new/use `packages/host-server/src/local-jsonl-connection.ts` + test
- `scripts/e2e-host-jsonl.mjs`
- `apps/desktop/src-tauri/src/host_bridge.rs` + Rust tests
- `apps/desktop/src/host-client.ts` and focused local transport tests
- `apps/desktop/src/hooks/use-host-bootstrap.ts`
- `apps/desktop/src/stream-event-buffer.ts` + test

### Steps — Node/CLI

- [ ] Construct HostRuntime without an app-local client fan-out callback.
- [ ] Start one HostEgressHub and attach one local JSONL client channel.
- [ ] Keep command responses on the writer's response path; send only push
      batches through the Hub channel.
- [ ] Preserve stdout as strict JSONL and writer backpressure.
- [ ] Implement shutdown order from spec §14.1.
- [ ] Port useful old batcher fixtures to Hub/local-connection tests, then
      delete the old batcher and export/import references.
- [ ] Extend the real spawned-host harness with batch validation, cursor order,
      100-delta production ordering, control priority, and bounded shutdown.

### Steps — Rust

- [ ] Extract a pure parsed-line router that returns response, push batch,
      legacy push, or invalid.
- [ ] Route a response to its pending request and `continue`; never emit it.
- [ ] Emit `host-message-batch` with `emit_to("main", ...)`.
- [ ] Keep legacy `host-message` targeted to main only for old-server
      compatibility.
- [ ] Keep invalid-line logs bounded/redacted.
- [ ] Add Rust tests proving response non-broadcast, batch forwarding,
      malformed input handling, and supervisor shutdown behavior.

### Steps — Desktop

- [ ] Add one local batch listener before starting Host.
- [ ] Validate the batch through the public codec/client path.
- [ ] Dispatch one batch transaction. Convert nested AgentEvents into one
      `event/batch` per session/rAF frame while lifecycle/control remains
      immediate.
- [ ] Retain legacy single-push listener for compatibility only.
- [ ] Make mock transport enter the same normalized batch-consumption path so
      tests do not cover a separate reducer protocol.
- [ ] Add render/dispatch count tests: 100 same-frame deltas produce one stream
      reducer commit and no historical Run-map invalidation.

### Verification

```bash
pnpm --filter @piwin/cli typecheck
pnpm --filter @piwin/cli test
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop test -- host-client
pnpm --dir apps/desktop test -- stream-event-buffer
pnpm --dir apps/desktop test -- chat-thread
pnpm e2e:host-jsonl
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### Automated exit criteria

- 100-delta fixture cannot reproduce 200 JSONL/Tauri frames.
- Ordinary batch cadence is bounded independently of provider chunk rate.
- Response lines never reach WebContent.
- Control/lifecycle ordering and Stop remain correct.
- Old CLI batcher has no production reference.

### Native Gate A procedure

- [ ] Build/run the same local Tauri topology users run.
- [ ] Use the controlled tool/thinking fixture for 30 minutes with the incident
      transcript or a larger sanitized fixture.
- [ ] Sample once per minute: Hub ingress/canonical/batch counts, Rust batch
      emits, WebKit `runJavaScriptInFrameInScriptWorld`, WebContent footprint,
      JS heap, queue high water, and UI responsiveness.
- [ ] Stop the Run; continue sampling for 10 minutes.
- [ ] Repeat once with a short permission/control burst.
- [ ] Save a dated evidence note with revision, hardware/macOS, exact command,
      start/peak/end figures, and pass/fail against Gate A.

### Commit boundaries

1. `refactor(cli): route local host pushes through egress hub`
2. `fix(tauri): forward host batches without response broadcast`
3. `feat(desktop): consume host push batches atomically`
4. `test(responsiveness): add native egress containment evidence`

### Rollback

The singular compatibility decoder remains, so a release can revert the three
integration commits independently. Rollback must return to a bounded Hub path;
it may not restore the known 200/s unbounded production default.

## 12. Task 7 — implement replay, hydration, and renderer restart recovery

**Purpose:** make loss/reload of WebContent a supported client reconnect while
the Host process and Run continue.

**Files:**

- `packages/contracts/src/remote-protocol.ts` + test
- contracts file for hydration projection if split by concept
- `packages/host-runtime/src/client-hydration-snapshot.ts` + test
- `packages/host-runtime/src/host-runtime.ts` + test/public export
- `packages/host-server/src/client-hydration.ts` + test
- `packages/host-server/src/host-egress-hub.ts` + fence tests
- `packages/host-client/src/host-client.ts` + recovery tests
- Desktop HostClient composition/bootstrap/reducer tests
- `scripts/e2e-host-jsonl.mjs` and new WebSocket recovery harness

### Steps

- [ ] Define a remote-safe hydration snapshot containing Host instance/cursor,
      active/recent Runs, pending permissions, session runtime, plan/todo,
      persisted transcript revision/messages for requested sessions, and active
      partial turn projection.
- [ ] Add a synchronous HostRuntime projection-copy port. It may read in-memory
      normalized state only under the Hub fence; no provider/network work.
- [ ] Add transcript/entity IDs and revisions required for idempotent snapshot
      replacement.
- [ ] Implement Hub snapshot fence: buffer new pushes, copy snapshot, record
      cursor, resume sequence, then send post-snapshot batches.
- [ ] Change replay-too-old from status-only “success” to explicit hydration.
- [ ] Key the client cursor store by `hostInstanceId` and subscription set.
- [ ] Persist a cursor only after successful batch transaction.
- [ ] On same Host: replay; on new Host or too-old cursor: hydrate; on failure:
      stay non-ready and retry with bounded backoff.
- [ ] Desktop atomically replaces transcript/Run/permission/plan projections,
      then applies batches after `snapshotSeq`.
- [ ] Deduplicate transcript messages and Agent events by Host identities.
- [ ] Add intentional renderer-listener disconnect/reconnect during: text
      stream, tool output, pending permission, and just-before Run terminal.

### Verification

```bash
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/host-runtime test -- hydration
pnpm --filter @piwin/host-server test -- hydration
pnpm --filter @piwin/host-client test -- recovery
pnpm --dir apps/desktop test -- host-bootstrap
pnpm e2e:host-jsonl
```

### Exit criteria

- Same-Host short disconnect replays exact content once.
- Replay-too-old replaces state explicitly and resumes after snapshot cursor.
- Host instance change never applies an old cursor.
- Permission/terminal state cannot disappear during renderer reload.
- Snapshot construction and post-snapshot buffering are bounded.

### Commit boundary

`feat(host-client): recover through bounded replay and hydration snapshot`

## 13. Task 8 — make authenticated loopback HostClient the Desktop default

**Purpose:** remove Tauri/WKWebView JavaScript evaluation from the ordinary
Host push data plane and converge Desktop with CLI/mobile Host deployment.

**Files:**

- `packages/host-transport/src/websocket-host-transport.ts` + test
- `packages/host-client/src/host-client.ts` + test
- `packages/host-server/src/host-server.ts` + admission/origin tests
- `apps/host/src/index.ts` or the canonical bundled Host entry
- `apps/desktop/src/host-client.ts` / new focused Desktop composition adapter
- `apps/desktop/src-tauri/src/host_bridge.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `scripts/bundle-host.mjs`
- `scripts/smoke-bundled-host.mjs`
- relevant package manifests/lockfile

### Steps

- [ ] Have Tauri launch Host Server on `127.0.0.1:0` with a cryptographically
      random per-launch credential.
- [ ] Return endpoint + credential once through `host_start`; never log/store
      the credential or place it in a URL.
- [ ] Update production/dev command resolution and packaged bundle entry so the
      same Host Server starts in both tiers.
- [ ] Validate loopback peer, hello deadline, credential, protocol version,
      accepted Tauri production origin, and explicit Vite dev origin.
- [ ] Add only required loopback WebSocket origins to Desktop CSP.
- [ ] Instantiate public `@piwin/host-client` in Desktop; remove duplicate
      request/cursor/replay logic from app-local HostClient.
- [ ] Route all ordinary commands/responses/pushes through WebSocket.
- [ ] Keep Tauri responsible for start/stop/PID/restart/fatal lifecycle only.
- [ ] On Host process restart, receive a new instance ID and hydrate; do not
      pretend replay continuity.
- [ ] Preserve Stage 1 JSONL batch as a bounded fallback transport until Gate B
      evidence, selected explicitly by transport capability/failure rather than
      by a second business path.
- [ ] Update packaged-host smoke to connect, hello, status, receive a batch,
      reconnect, and shut down cleanly.

### Security tests

- [ ] non-loopback Desktop bind rejected;
- [ ] missing/wrong token rejected;
- [ ] token absent from logs/errors/process args where observable;
- [ ] unaccepted Origin rejected;
- [ ] oversized frame rejected;
- [ ] expired handshake closed;
- [ ] Host remains local-only by default.

### Verification

```bash
pnpm --filter @piwin/host-transport test
pnpm --filter @piwin/host-client test
pnpm --filter @piwin/host-server test
pnpm --filter @piwin/host-app typecheck
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop test -- host-client
pnpm bundle:host
pnpm test:bundle
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### Exit criteria

- Public HostClient is the only Desktop command/push client authority.
- Ordinary pushes produce zero Tauri Host-message evaluations.
- Packaged and dev Host topologies behave the same.
- Stage 1 fallback still routes through the Hub and passes its tests.

### Commit boundaries

1. `feat(host-server): add authenticated ephemeral loopback launch`
2. `refactor(desktop): use public host client over loopback websocket`
3. `build(host): package standalone host server entry`

Rollback returns Desktop to Stage 1 bounded JSONL batches without reverting the
Hub, contracts, or recovery behavior.

## 14. Task 9 — bound heavy Desktop projection/render work

**Purpose:** ensure a transport regression or large transcript cannot recover
the original all-row/quadratic allocation multiplier.

**Files:**

- `apps/desktop/src/turn-work-details.tsx` + test
- `apps/desktop/src/turn-tool-group.tsx` / `tool-call-card.tsx` + tests as needed
- `apps/desktop/src/chat-reducer.ts` + test
- new focused pure `bounded-text-accumulator.ts` + test (preferred over another
  generic utils file)
- `apps/desktop/src/syntax-highlight.tsx` + test
- `apps/desktop/src/MarkdownView.tsx` + test

### Steps

- [x] Render thinking body only while open; a collapsed historical `<pre>` is
      absent from DOM.
- [x] Verify completed historical tool/detail children are absent until the
      user expands them; preserve running/error visibility.
- [x] Extract a domain-named bounded UTF-8 accumulator returning text,
      retained byte count, and truncation state.
- [x] Encode only each incoming tool delta; never re-encode the full retained
      output per append.
- [x] Preserve redaction before byte accounting and the 256 KiB visible cap.
- [x] Add a many-small-delta golden test and a 10 MiB single/burst fixture.
- [x] During `renderingPhase='streaming'`, render safe plain code and do not
      start Shiki for each changing source identity.
- [x] Trigger highlighting once after terminal or a tested stability delay;
      ignore stale async results.
- [x] Keep Artifact/Mermaid execution rules unchanged.

### Verification

```bash
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop test -- chat-reducer
pnpm --dir apps/desktop test -- turn-work-details
pnpm --dir apps/desktop test -- tool-call-card
pnpm --dir apps/desktop test -- MarkdownView
pnpm --dir apps/desktop test -- syntax-highlight
```

### Exit criteria

- Collapsed thinking/tool heavy bodies are unmounted.
- Tool append cost is linear in received bytes and cap is exact for Unicode.
- Streaming code does not launch one Shiki tokenization per delta.
- Terminal/static Markdown presentation is unchanged.

### Commit boundaries

1. `perf(desktop): unmount collapsed transcript detail`
2. `perf(desktop): make tool output retention incremental`
3. `perf(desktop): defer syntax highlighting until stream stability`

## 15. Task 10 — window dynamic-height transcript turns

**Purpose:** cap DOM/Markdown/component mount count independently of session
history length while retaining current scroll, sticky-user, editing, and
History Ticks behavior.

**Dependency decision:** add `@tanstack/react-virtual@3.14.9` to Desktop. The
package is MIT-licensed, declares React/ReactDOM 19 peer support, supports
dynamic `measureElement`, and keeps piwin's existing components/styles. This is
preferred to custom scroll math and to the commercial Virtuoso Message List.

**Files:**

- `apps/desktop/package.json`, `pnpm-lock.yaml`
- new `apps/desktop/src/transcript-turns.ts` + test
- new `apps/desktop/src/transcript-scroll-port.tsx`
- new `apps/desktop/src/transcript-scroll-memory.ts` + test
- new `apps/desktop/src/transcript-turn-list.tsx` + test
- `apps/desktop/src/transcript-viewport.tsx` + test
- `apps/desktop/src/chat-thread.tsx` + test
- `apps/desktop/src/use-transcript-scroll.ts` + test
- `apps/desktop/src/history-ticks-drawer.tsx` + test
- `apps/desktop/src/transcript-outline.ts` + test
- `apps/desktop/src/styles/region-transcript.css`

### Steps

- [x] Add the dependency only in Desktop and document the justification in the
      manifest/plan; do not add a second virtual-list package.
- [x] Keep turn grouping pure and derive stable `turn.id` plus message-id →
      turn-index mapping.
- [x] Introduce one scroll-element context/port so TranscriptViewport,
      virtualizer, follow-tail, History Ticks, and floating scrollbar share one
      owner.
- [x] Virtualize turn groups only above 40 turns initially; keep the existing
      simple path below that threshold.
- [x] Use dynamic measurement and at least four-turn overscan.
- [x] Preserve measured height/scroll offset per active session; clear bounded
      caches on session deletion.
- [x] Keep follow-tail pinned while the active row grows; when the user scrolls
      away, do not snap them back.
- [x] Replace DOM-only History Tick jumps with virtualizer `scrollToIndex`, then
      highlight after the target mounts.
- [x] Re-measure after thinking/tool expand, image load, font/theme change,
      artifact height signal, and edit-card mount.
- [x] Preserve the current non-sticky user-row behavior inside each turn; do
      not introduce a frozen history header through the item wrapper.
- [x] Preserve accessibility: scrollport remains `role=log`, mounted items keep
      stable IDs, and keyboard focus is not unmounted while editing.
- [x] Add mount-count instrumentation in tests only.

### Required tests

- [x] 500 historical messages/turns mount only visible + overscan rows.
- [x] live tail grows without scroll jump while following;
- [x] user scroll-away remains stable during 100 deltas;
- [x] History Tick jumps to an initially unmounted first/middle/last turn;
- [x] editing a historical user turn remains mounted/focused;
- [ ] permission/control surface remains reachable;
- [ ] expanded thinking/tool height change preserves the native scroll anchor;
- [x] generic late content height change remeasures the virtual window;
- [ ] theme/font size change preserves the native scroll anchor;
- [x] session switch restores the correct session offset;
- [ ] user-row behavior matches the non-windowed path in native/Playwright.

### Verification

```bash
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop test -- transcript-window
pnpm --dir apps/desktop test -- transcript-viewport
pnpm --dir apps/desktop test -- use-transcript-scroll
pnpm --dir apps/desktop test -- history-ticks-drawer
pnpm --dir apps/desktop test -- chat-thread
PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test \
  e2e/shell.spec.ts --grep "renderer stress" --reporter=list
```

### Exit criteria

- DOM mount count is independent of total history beyond the configured
  viewport/overscan.
- No jump-to-latest, History Tick, sticky-user, editing, or focus regression.
- Existing small transcripts use the same visual component output.

### Commit boundaries

1. `feat(desktop): add measured turn transcript window`
2. `fix(desktop): route history jumps and follow-tail through window owner`
3. `test(desktop): cover dynamic transcript anchor and mount bounds`

Rollback can disable the thresholded virtual path and retain Tasks 1–9; no Host
protocol rollback is required.

## 16. Task 11 — final conformance, evidence, and documentation

**Purpose:** prove the complete design and update architecture truthfully.

**Files:**

- new `scripts/e2e-host-websocket.mjs`
- extend `scripts/e2e-host-jsonl.mjs`
- root `package.json` scripts
- Desktop E2E fixtures/tests
- new dated evidence note under `docs/notes/`
- `docs/architecture.md`
- `docs/specs/host-server-multi-client.md`
- `docs/ipc-transport-discipline.md`
- `docs/dev-plan.md`, `docs/product-status.md`
- ADR 0006/0015/0027 addendum links if needed; do not rewrite history
- this plan status/checklist

### Steps

- [ ] Add a real spawned Host WebSocket harness: hello, status, prompt fixture,
      push batch, control, disconnect, replay, slow client, snapshot, Host
      restart, shutdown.
- [ ] Add an architecture test that prevents production HostServer from
      attaching one Runtime sink per socket and prevents reintroduction of the
      CLI app-local batcher.
- [ ] Run the full two-client and subagent multiplier fixtures.
- [ ] Intentionally terminate/reload WebContent during an active native run and
      verify recovery.
- [ ] Repeat the 30-minute native matrix over loopback; record Tauri event count
      (ordinary Host pushes must be zero), WebContent footprint, queue high
      water, Stop latency, and post-run behavior.
- [ ] Run an A/B only if a full-scrollport fade/mask is proposed again; current
      code must not re-add it without native evidence.
- [x] Update docs to distinguish implemented Stage 1/Stage 2 from future remote
      auth/pairing work.
- [ ] Mark ADR/spec/plan implemented only after evidence is retained.

### Full verification

```bash
pnpm typecheck
pnpm test
pnpm test:architecture
pnpm e2e:host-jsonl
pnpm e2e:host-websocket
pnpm bundle:host
pnpm test:bundle
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --dir apps/desktop e2e
```

### Final deletion searches

```bash
rg "createHostServeStreamBatcher|host-serve-stream-batcher" apps/cli/src
rg "runRecordsById=\{props\.runRecordsById\}|previous\.runRecordsById === next\.runRecordsById" \
  apps/desktop/src/chat-thread.tsx
rg "app_reader\.emit\(\"host-message\"" apps/desktop/src-tauri/src/host_bridge.rs
rg "broadcast\(frame\)|socket\.send\(encodeHostWireMessage\(frame\)\)" \
  packages/host-server/src
```

Expected results:

- no production CLI-local stream batcher;
- no whole Run map in row memo identity;
- no default per-push Tauri broadcast;
- no direct unqueued HostServer fan-out.

### Exit criteria

- All verification commands pass or any environmental exclusion is explicitly
  documented with owner and rerun command.
- Gate A and Gate B native evidence both pass.
- Architecture/status docs claim only observed capabilities.
- No temporary compatibility path lacks an owner/removal milestone.

### Commit boundaries

1. `test(host): add websocket flow-control and recovery conformance`
2. `docs(architecture): record implemented host egress and recovery path`
3. `test(native): retain desktop egress memory evidence`

## 17. Risk register and mitigation

| Risk | Consequence | Mitigation / blocking test |
|------|-------------|----------------------------|
| Projection replacement reorders relative to lifecycle | stale UI or terminal overtakes data | final ingress ordinal + scoped barrier tests |
| Sequence assigned before intentional replacement | false replay gaps | sequence only in Hub flush after canonicalization |
| Client treats filtered gap as loss | replay loop | `afterSeq`/`throughSeq` batch semantics |
| WebSocket `send` hides large bufferedAmount | Host memory returns through socket | explicit channel queue + buffered amount/high-water close |
| Control reserve is consumed by large stream | Stop/permission delayed | separate reserved control lane and overflow test |
| Snapshot races live deltas | duplicate/lost partial message | Hub fence + synchronous projection copy + ID/revision dedup |
| Browser JPEG exceeds target batch | frame failure/queue burst | latest-wins projection, hard cap, oversized metric/test |
| Virtualization breaks sticky user/header | UX regression | turn-group unit + native/Playwright behavior test |
| Virtualization unmounts edit focus | lost draft/focus | pin focused turn in range; keyboard test |
| History Ticks target is not mounted | navigation stops working | message→turn index API + post-mount highlight test |
| Shiki still tokenizes stale stream versions | CPU/allocation churn | no highlight in streaming phase + stale result test |
| Dirty worktree merges unrelated changes | lost user work / unreviewable diff | Task 0 isolation gate; commits by concern |
| Stage 2 packaging differs from dev | release-only breakage | bundled Host connect/replay smoke before Gate B |

## 18. Commit/review discipline

- One concern per commit as listed above; do not mix mobile/speech/Markdown
  redesign changes into this program.
- Contracts changes update every implementer and fixture in the same vertical
  slice.
- No new production dependency except the justified Desktop virtualizer.
- New files remain focused; do not create `utils.ts`, `manager.ts`, or a second
  Host state authority.
- No compatibility fallback may bypass HostEgressHub.
- Do not delete the singular protocol decoder until released-client migration
  is complete; do stop emitting it to capable clients.
- Update public exports intentionally after each package slice.
- After each task, attach command output/evidence to the implementation note
  before moving the checklist forward.
