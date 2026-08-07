---
name: subagent-driven-development
description: Execute an approved plan by delegating independent steps to isolated child sessions, then merge and verify in the parent. Trigger via /subagent-driven-development or plan-card mode.
---

# Subagent-Driven Development

## Goal
Finish an approved plan by running independent steps in child sessions and producing a correct merged parent state with verification evidence.

## Done means
- A plan exists (`/writing-plans` or `piwin_plan_create`) with honest `independentSteps` (or fall back to `executing-plans` / inline).
- Each independent step runs in a child with a self-contained task: step title/detail, plan goal, acceptance criteria, and “implement only this step”.
- Parent merges children, updates steps via `piwin_plan_set_step`, and records failures instead of hiding them.
- Final parent verification passes (or failures are explicit).
- Bounded walkthrough summary exists: what changed, verification, child outcomes, unresolved items.

## Stop when
- No safe independent steps — use inline execution.
- A child fails, merge conflicts, or verification fails — report and ask; do not silent-retry write children (new task + new child id if retrying).
- Parent would need to edit sources during delegated step execution — delegate instead.

## Constraints
- Profiles from Settings bound capabilities; optional per-step `profileId` / model overrides cannot widen isolation.
- `parallelGroup` only with no data/file/resource dependency; use `dependsOn` otherwise.
- Readonly for explore/review; worktree for writes. Shared-cwd parallel writes are rejected by the host.
- Host serializes worktree integration and retains failed/conflicted worktrees for inspection.
- Depth: children do not spawn further subagents via this path.

## Verify
- Parent confirms merged tree against plan acceptance criteria (unit tests, typecheck, build as applicable).
- Walkthrough states only evidenced outcomes.
