# ADR 0070: SessionPlan document integrity and failed-run visibility

| Field | Value |
|-------|-------|
| Status | Implemented (single-Host T1–T6); T7 cross-process lock **not** claimed |
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
index) do not serialize `plan.json`. A process-local per-path queue plus atomic
rename is the single-Host document contract. Cross-process mutex is a later
hardening (T7) and must not be claimed from the racy index-lock recycler.

## Decision

1. **Document mutation.** Every create/update/clear/heal/isolate for one
   `plan.json` runs in a per-path Promise queue keyed by resolved absolute
   path. Writes use `writeTextFileAtomic`. The store assigns
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
- T7 (cross-process `plan.json.lock` without racy auto-steal) remains open.
  Independent-process tests are required before claiming that mutex.
