# ADR 0068: Durable compaction replay across runtime replacement

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-09-02 |
| Related | ADR 0055, ADR 0064, ADR 0067 |
| Specification | [`../specs/session-conversation-tree.md`](../specs/session-conversation-tree.md) |

## Context

Pi keeps a successful compaction in its native session manager while a runtime
is warm. piwin can nevertheless replace that runtime when the user changes
provider/model, reopens a session, or the worker restarts. The old path only
replayed bounded product history, so a replacement could lose the compaction
summary, inject the summarized transcript a second time, or leave the context
ring without a trustworthy boundary.

The compaction card is also an activity, not a user/assistant message. Its
summary must therefore be available to the next model prompt without becoming
visible transcript content or a second billing turn.

## Decision

1. **Persist a product-side compaction boundary.** Every successful,
   non-no-op compact with a non-empty summary is recorded in the session
   transcript store (`session_compaction`) with its active-path anchor,
   optional first-kept entry, token evidence, runtime generation, and time.
   Unknown, failed, aborted, and no-op compactions are not persisted as
   successful boundaries.
2. **Restore through Pi's native context model.** Cold activation and runtime
   replacement pass the latest active-path compaction summary as a native Pi
   compaction seed, then replay only transcript/native rows after its anchor.
   The summary is never emitted as a visible transcript message.
3. **Use the same seed contract in SDK and RPC modes.** `compactionSeed` is a
   `CreateSessionOptions` field and is forwarded through both backends. The
   seeded manager appends the native compaction entry before replay rows, so
   both modes reconstruct the same context shape.
4. **Keep recovery exactly once.** When a generation is natively seeded,
   `coldStartHistoryBySession` is cleared; product-history text injection is
   retained only for the legacy unseeded path. Store writes deduplicate an
   observation with the same session, anchor, summary, and token evidence.
5. **Write before a replacement can race.** The explicit compact command waits
   for the durable boundary write before returning its result. Recorder-based
   observations remain idempotent and provide coverage for native/automatic
   compaction events.
6. **Keep context telemetry honest.** A successful compact counts as response
   evidence for ring eligibility, but an unmeasured post-compact occupancy is
   still unknown. Across a model switch, Desktop may show the old number only
   as a stale, read-only “last confirmed” presentation; it is never used for
   prompt budgeting or compact decisions until a fresh compatible measurement
   arrives. Compaction, capability, seed, and active-path boundaries remain
   strict.
7. **Do not make model switching a compaction barrier.** A prompt that selects
   another model applies that selection (and replaces the runtime when the
   provider requires it) without first running source-context compaction or
   waiting for a target-budget proof. The selected Pi runtime owns its normal
   automatic compaction/overflow recovery. Explicit target-model compaction
   remains available through `session/compact`; its failure is not a reason to
   reject an otherwise valid model selection.

## Consequences

- Reopening or switching models preserves the model-visible compact summary
  and the follow-up tail without duplicating old history.
- The activity card can disclose a summary for inspection, but it is not a
  synthetic chat turn and does not affect transcript ordering or billing.
- A store that cannot read the durable seed falls back to the existing bounded
  product-history path and logs a warning; it does not fabricate a successful
  compaction.
- Changing models is responsive even when source-context compaction would be
  slow, unavailable, or ineligible. If the selected model cannot accept the
  resulting context, its bounded runtime recovery or an explicit compact/new
  session remains the recovery path.
- Native Pi runtime integration remains behind `agent-host`; contracts and
  host-runtime carry only product-shaped seed data.

## Verification

- Store round-trip and active-path anchor tests cover persistence, dedupe, and
  branch safety.
- Seed-builder tests cover summary + post-anchor replay and current-prompt
  exclusion.
- SDK/RPC seeded-manager tests cover native compaction entry reconstruction.
- Context merge/coordinator tests cover compaction evidence and durable-boundary
  preservation across activation revalidation.
