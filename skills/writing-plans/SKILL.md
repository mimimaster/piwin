---
name: writing-plans
description: Turn a goal into a scoped, reviewable SessionPlan with acceptance criteria, verification, and stop conditions. Trigger via /writing-plans or /write-plan.
---

# Writing Plans

## Goal
Produce one reviewable `SessionPlan` the user can approve before any implementation. The plan is the deliverable — not a Markdown checklist and not code changes.

## Done means
- Relevant code/docs/ADRs are grounded enough that steps are decision-complete (or open decisions are explicit questions).
- `piwin_plan_create` succeeds with: `title`, `goal`, ordered `steps` (stable ids, short titles), and each step `detail` covering affected area, **acceptance criteria**, and **verification**.
- `source: 'skill'`, `skillId: 'writing-plans'`.
- `independentSteps` lists only steps safe to run in isolated child sessions (no shared-file conflicts). Omit when work is sequential.
- Optional `profileId` per step only when a non-default subagent role is needed (`explorer` | `reviewer` | `implementer` | `tester`).
- Chat summary states plan size: **short** (<4 steps and <2 independent) or **long** (otherwise), so the UI can recommend execution mode.
- No shell commands, scripts, or hooks as step fields — plans are reviewable artifacts, not executables.

## Stop when
- Goal, constraints, or technical choices are ambiguous in a way that would change the plan — surface the real options and ask; do not invent scope.
- Plan is draft-created. Do **not** implement, mutate source, or start execution until the user approves and picks a mode (`inline` or `subagent-driven`).

## Constraints
- Prefer thin, correct plans over speculative multi-week epics.
- Host permissions and isolation are enforced by runtime; do not restate security policy.

## Verify
- Every step has checkable acceptance criteria and a concrete verification signal (command, test, or observable outcome).
- Independent steps truly do not contend on the same files or external resources.
