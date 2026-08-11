# Plan workflow reliability implementation plan

## Goal

Make the persisted-plan workflow reliable end to end:

1. an explicit writing-plans request must create or revise the session's durable `plan.json`;
2. the Plan card can atomically approve and start a draft plan;
3. Desktop plan state is scoped and restored by session;
4. plan completion generates a Walkthrough bound to the exact execution result;
5. regression tests cover the complete state transition rather than isolated components only.

The project workspace remains read-only while planning. The narrow write exception is Host-owned product state under `~/.piwin/sessions/<sessionId>/plan.json`.

## Constraints

- Preserve `SessionPlan` JSON as the structured source of truth.
- Keep authority in Host commands; Desktop must not emulate state transitions.
- Do not change Pi-native event shapes or import Pi outside `@piwin/agent-host`.
- Preserve current uncommitted work and avoid unrelated refactors.

## Implementation steps

1. Add an explicit persisted-plan intent/invariant around writing-plans turns. Capture the starting plan revision and reject successful completion when no new durable revision exists.
2. Add a Host-authoritative approve-and-execute transition guarded by plan id and revision, and have the Plan card use it for draft plans.
3. Store Desktop plans by session id and hydrate them through `plan/get` when a session becomes active or reconnects.
4. Return the exact final assistant message id and execution summary from the Plan Run seam, then pass those identifiers into Walkthrough generation with the plan id.
5. Add integration tests for create/push, draft process, session restoration, completion binding, and failure to persist.
6. Reconcile the user-facing Plan/Walkthrough specification with the implemented invariants.

## Acceptance criteria

- A writing-plans turn cannot report success without a newly persisted plan revision.
- Clicking Process on a draft plan starts execution without a separate approval race.
- Switching sessions never displays or executes another session's plan.
- Reopening a session restores its durable Plan card.
- A completed plan creates exactly one Walkthrough for its own final assistant message and records `planId`.
- Relevant package typechecks and tests pass; unrelated pre-existing failures are reported separately.

## Outcome

Implemented on 2026-08-11.

- Plan mode and `/writing-plans` now carry a Host-verifiable persisted-plan intent and fail with `plan-not-persisted` when no new durable revision exists.
- Host-owned planning artifact writes are allowed under the read-only permission floor while project mutations remain restricted.
- Draft Process is atomic and revision-guarded.
- Desktop Plan state is session-keyed and restored on activation/reconnect.
- Execution waits for the foreground Run, persists `PlanExecutionSummary`, and binds Walkthrough generation to the exact assistant message plus `planId`.
- Subagent execution handles parent-owned sequential residual steps explicitly.
- Desktop, CLI, Host, contracts, and session focused regression suites pass. Full-repository validation remains blocked by unrelated dirty-worktree failures recorded in the delivery summary.
