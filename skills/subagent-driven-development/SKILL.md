---
name: subagent-driven-development
description: Execute an implementation plan by delegating independent steps to child subagent sessions, then merge and verify in the parent. Trigger via /subagent-driven-development.
---

# Subagent-Driven Development

Use this skill when the user invokes `/subagent-driven-development` or selects
the **subagent-driven** execution mode from a plan card.

This skill orchestrates plan execution across multiple isolated child sessions,
merging results back into the parent for verification.

## 1. Prerequisites

- A **plan** must exist (created via `/writing-plans` or `piwin_plan_create`).
- The plan should have `independentSteps` declared so the host can identify
  which steps are safe to run in isolated child sessions.
- If no independent steps exist, fall back to inline execution (see
  `executing-plans` skill).

## 2. Execution flow

1. **Read the plan** and confirm which steps are independent vs sequential.
2. **For each independent step**:
   - The host spawns a child subagent session with the step's task directive.
   - The child works in an isolated worktree (when available) or read-only mode.
   - Monitor child progress; do not proceed to dependent steps until the child
     completes.
3. **Merge each child** back into the parent session after it completes.
4. **Run final verification** in the parent session:
   - Verify that changes have the desired effects (run unit tests, typecheck,
     build, etc.).
   - Create or update the walkthrough.md artifact to summarize changes.
5. **Update plan step status** via `piwin_plan_set_step` as each step completes.

## 3. Step directives

Each step receives a directive containing:
- The step title and detail from the plan.
- The overall plan goal for context.
- Instructions to implement only that step — no drive-by refactors.

## 4. Error handling

- If a child session fails, mark the step as `failed` and surface the error.
- Do not silently retry — report the failure and ask the user how to proceed.
- If a merge fails, preserve the child session for manual inspection.

## 5. Walkthrough

When all steps complete, produce a bounded walkthrough summary:

- What changed (files/areas per step).
- Verification results (tests, typecheck, build).
- Merged child sessions and their outcomes.
- Unresolved items or follow-ups.

Keep it concise. Point the user to the walkthrough artifact for details.

## 6. Constraints

- Do not modify source files from the parent during step execution — delegate
  to child sessions.
- Do not skip verification — the parent must confirm the merged state.
- Respect architecture boundaries (see `AGENTS.md`).
- Abort paths must be implemented for long-running child sessions.

## 7. Subagent profiles (CE-SUB-PROF)

Use **configured profiles** from Settings → Sub-agent profiles instead of
inventing role semantics. Built-in profiles:

- `explorer` — read-only codebase exploration (readonly isolation)
- `reviewer` — read-only code review and analysis (readonly isolation)
- `implementer` — isolated implementation with write + execute (worktree)
- `tester` — isolated test execution and fixture writes (worktree)

Assign a `profileId` per plan step when the step's role differs from the
default. Assign different models at child creation time when useful (e.g.
a cheaper model for exploration, a stronger model for implementation).

## 8. Parallel groups (CE-SUB-ORCH)

Mark `parallelGroup` on plan steps **only** when tasks have no data, file,
or external-resource dependency. Use `dependsOn` to declare explicit
dependencies between steps.

Rules:

- Use **readonly** profiles for exploration/review tasks.
- Use **worktree** profiles for write tasks.
- **Never** request shared-cwd parallel writes — the host rejects them.
- Expect **serialized integration**: the host integrates successful
  worktree results one at a time and stops on conflicts.
- Let the **host decide** whether process isolation is available; the
  skill is guidance, not a security boundary.
- A failed or conflicted child worktree is **retained** for inspection;
  the host never silently discards unintegrated changes.
- Do not automatically retry failed write children — create a new task
  with a fresh child id instead.
