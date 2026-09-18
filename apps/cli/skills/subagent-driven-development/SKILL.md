---
name: subagent-driven-development
description: Execute an approved plan by delegating isolatable steps to isolated child sessions (Host serializes writers), then review diffs and verify in the parent. Trigger via /subagent-driven-development or the plan execution gate.
version: 2
---

# Subagent-Driven Development

## Goal
Finish an approved plan by running isolatable steps in child sessions one writer at a time, then producing a correct parent state with verification evidence.

## Done means
- A plan exists (`/writing-plans` or `piwin_plan_create`) with honest `independentSteps` (or fall back to `executing-plans` / inline).
- Each isolatable step runs in a child with a self-contained brief: step title/detail, plan goal, acceptance criteria, verification, and “implement only this step”. The child does not see the parent transcript.
- Parent reviews child diffs and verification output, applies approved candidates, updates steps via `piwin_plan_set_step`, and records failures instead of hiding them.
- Final parent verification passes (or failures are explicit).
- Bounded walkthrough summary exists: what changed, verification, child outcomes, unresolved items.

## Stop when
- No safe independent steps — use inline execution.
- A child fails, merge conflicts, or verification fails — report and ask; do not silent-retry write children (new task + new child id if retrying).
- Parent would need to edit sources during delegated step execution — delegate instead.

## Constraints
- Profiles from Settings bound capabilities; optional per-step `profileId` / model overrides cannot widen isolation.
- `parallelGroup` does not authorize concurrent worktree writes. Host runs at most one writer; use `dependsOn` for true sequencing.
- Readonly for explore/review (may run in parallel); worktree for writes (serialized). Shared-cwd parallel writes are rejected by the host.
- Host serializes worktree integration and retains failed/conflicted worktrees for inspection.
- Depth: children do not spawn further subagents via this path.

## Verify
- Parent confirms merged tree against plan acceptance criteria (unit tests, typecheck, build as applicable).
- Walkthrough states only evidenced outcomes.
