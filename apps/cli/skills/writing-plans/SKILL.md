---
name: writing-plans
description: Explore codebase context and formulate a modular SessionPlan via piwin_plan_create for user review. Trigger via /writing-plans or /write-plan.
version: 3
---

# Writing Plans

## Goal
Formulate a structured `SessionPlan` via `piwin_plan_create` with modular, decoupled steps that maximize potential parallel subagent dispatch.

## Decoupling Principles
- **Modular Slicing**: Partition tasks by distinct files, packages, or domains to prevent concurrent editing conflicts on shared resources.
- **Honest Dependency Modeling**: Add `dependsOn` ONLY when Step B strictly requires the output or type artifact of Step A. Leave naturally independent tasks (e.g. independent components, tests, distinct endpoints) unblocked.

## Workflow
1. **Explore & Scope**: Inspect relevant codebase files and interfaces to establish concrete boundaries.
2. **Draft Blueprint**: Invoke `piwin_plan_create` with:
   - `title`: Short descriptive plan title.
   - `goal`: Concise single-sentence objective.
   - `steps`: Ordered list of modular steps with affected components, explicit acceptance criteria, and a concrete verification command.
   - `dependsOn`: Preceding step IDs required before execution (omit when tasks are independent).
   - `parallelGroup`: Grouping key for steps that can execute concurrently across subagents.
   - `independentSteps`: Step IDs safe for isolated child session worktrees.
3. **Acknowledge & Await**: Summarize the plan in chat and await user review on the workbench plan card.

## Constraints
- Keep plans thin, correct, and tightly scoped to the immediate objective.
- Every step MUST include an executable verification command.
