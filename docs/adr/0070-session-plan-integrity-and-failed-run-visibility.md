# ADR 0070: SessionPlan document integrity and failed-run visibility

| Field | Value |
|-------|-------|
| Status | Implemented (single-Host T1–T6); defensive same-machine plan lock added, not a distributed lock |
| Date | 2026-09-08 |
| Related | ADR 0002, ADR 0025, ADR 0040, [turn-error run-outcome gate](../specs/2026-08-30-turn-error-run-outcome-gate.md) |
| Specification | [SessionPlan integrity](../specs/2026-09-08-session-plan-integrity.md) |
| Execution plan | [2026-09-08-session-plan-integrity-execution.md](../plans/2026-09-08-session-plan-integrity-execution.md) |

## Context

A live session tore `plan.json` when `piwin_plan_set_step` and plan-execution
`markFailed` overlapped on `fs.writeFile` (truncate-on-open). The next user
prompt persisted, then `JSON.parse` failed. Host stamped that failure onto the
previous **completed** assistant. `TurnErrorCard` hid it because that run's
outcome was still `completed`. The user saw a silent dead turn with Host still
connected.

Existing Host locks (`owner.lock`, runtime leases, session-operations, session
index) did not serialize `plan.json`. The plan store now uses a per-path
in-process queue plus a same-machine OS file lock and atomic rename. Root
ownership remains the product-level single-Host authority; the file lock is only
a cooperative defense for callers using the same storage protocol.

## Decision

1. **Document mutation.** Every create/update/clear/heal/isolate for one
   `plan.json` runs in a per-path in-process queue and same-machine OS file
   lock keyed by resolved absolute path. Writes use `writeTextFileAtomic`. The store assigns
   `current.revision + 1` (or `0` on create). Mutators derive from lock-held
   current. `saveSessionPlan` is create-only. Whole-document replace compares
   expected revision against **current**, not against a pre-bumped snapshot.
2. **Corrupt reads.** Leading-object scan (no V8 `at position` English). Valid
   prefix + trailing garbage: copy original bytes, heal. Empty / invalid /
   oversized: isolate as `plan.json.corrupt-*`. I/O errors throw a stable
   `PlanMutationError`; they are not treated as missing. Ordinary prompt
   skips plan context and still calls `liveSession.prompt`.
3. **Execution identity.** `plan/execute` re-checks planId, revision, status,
   and idle execution under the document lock. Callbacks require
   `current.id === admittedPlanId` and `current.execution.runId === planRunId`.
   Field updates merge from lock-held `current.execution`. Admission write
   failure finishes the reserved Run. Step-complete vs fail is decided in the
   same mutator.
4. **Failed-run visibility.** Every terminal `failed` session-turn must have
   an assistant row with that `runId` and `failure`.
   `finalizeRunTranscriptArtifacts` / `ensureFailedRunAssistant` is the durable
   close-out. Recorders must not fall back to another run's `lastAssistantId`.
   `hasRunAgentErrorEvidence` only dedupes events. Desktop stamps only the
   failed run's assistants/tools and retries the **turn's** user message, not
   the thread-tail user. `TurnErrorCard` still requires `runOutcome === 'failed'`.

## Consequences

- Single Host no longer tears `plan.json` or silently paints prepare failures
  onto a previous completed turn.
- Packaged Desktop/Host must be rebuilt from this source; `processStartedAt`
  does not prove the new bundle is running.
- The defensive `plan.json.lock` is cooperative and bounded to the same
  machine; it is not a distributed lock or protection from writers that bypass
  the storage protocol. The independent-process smoke verifies hold/release
  ordering and read-modify-write preservation; broader crash/maintenance
  recovery remains a separate hardening task.
