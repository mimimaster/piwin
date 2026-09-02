---
name: writing-plans
description: Explore codebase context and formulate a modular SessionPlan via piwin_plan_create for user review. Trigger via /writing-plans or /write-plan.
version: 3
---

# Writing Plans

## Goal
Produce one reviewable `SessionPlan` the user can approve before any implementation. The plan is the deliverable — not a Markdown checklist and not code changes. Prefer modular, decoupled steps that maximize potential parallel subagent dispatch.

## Decoupling Principles
- **Modular Slicing**: Partition tasks by distinct files, packages, or domains to prevent concurrent editing conflicts on shared resources.
- **Honest Dependency Modeling**: Add `dependsOn` ONLY when Step B strictly requires the output or type artifact of Step A. Leave naturally independent tasks (e.g. independent components, tests, distinct endpoints) unblocked.

## Done means
- Relevant code/docs/ADRs are grounded enough that steps are decision-complete (or open decisions are explicit questions).
- `piwin_plan_create` succeeds with: `title`, `goal`, ordered `steps` (stable ids, short titles), and each step `detail` covering affected area, **acceptance criteria**, and **verification** (prefer an executable verification command).
- `source: 'skill'`, `skillId: 'writing-plans'`.
- `dependsOn` / `parallelGroup` set only when needed for honest sequencing or concurrent groups.
- `independentSteps` lists only steps safe to run in isolated child sessions (no shared-file conflicts). Omit when work is sequential.
- Optional `profileId` per step only when a non-default subagent role is needed (`explorer` | `reviewer` | `implementer` | `tester`).
- Chat summary states plan size: **short** (<4 steps and <2 independent) or **long** (otherwise). The Host uses this to recommend `inline` vs `subagent-driven`.
- No shell commands, scripts, or hooks as step fields — plans are reviewable artifacts, not executables.

## Workflow
1. **Explore & Scope**: Inspect relevant codebase files and interfaces to establish concrete boundaries.
2. **Draft Blueprint**: Invoke `piwin_plan_create` with the fields above.
3. **Acknowledge & Await**: Summarize the plan in chat and await user review on the workbench plan card.

## Stop when
- Goal, constraints, or technical choices are ambiguous in a way that would change the plan — surface the real options and ask; do not invent scope.
- Plan is draft-created. Do **not** implement, mutate source, or start execution.
- Do **not** ask the user in chat to pick `inline` or `subagent-driven`. The Host shows a mode picker. Summarize the plan and wait.

## Constraints
- Prefer thin, correct plans over speculative multi-week epics.
- Host permissions and isolation are enforced by runtime; do not restate security policy.

## Verify
- Every step has checkable acceptance criteria and a concrete verification signal (command, test, or observable outcome).
- Independent steps truly do not contend on the same files or external resources.
- After approved execution (not during drafting), a bounded Walkthrough of changes + verification is appropriate when the host/plan flow produces one.
