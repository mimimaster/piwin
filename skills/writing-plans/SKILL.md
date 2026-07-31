---
name: writing-plans
description: Turn a goal into a scoped, ordered, executable implementation plan with exit criteria. Trigger via /writing-plans or /write-plan.
---

# Writing Plans

Use this skill when the user invokes `/writing-plans` or `/write-plan` (alias).
Produce a **structured, reviewable plan artifact** — not just a Markdown checklist.

## 1. Research before planning

1. Read the relevant code, docs, and ADRs first.
2. Restate the goal and non-goals in one short block.
3. List constraints (architecture boundaries, locks, packages, naming).

## 2. Create a structured SessionPlan

Do not start modifying source files before the plan is approved.

Call the piwin plan-create capability with:

- `title` and `goal`;
- ordered `steps`, each with:
  - a **stable id** (e.g. `1`, `2`, `3` — never reuse ids);
  - a short title;
  - `detail` covering affected area, acceptance criteria, and the verification command;
  - **no shell commands, scripts, or hooks as step fields** — plans are reviewable artifacts, not executables;
- `source: 'skill'` and `skillId: 'writing-plans'`;
- `independentSteps`: list step ids **only** when the work can safely run in an isolated child session without touching the same files as another step. Omit it when steps must run sequentially in one session.

## 3. Classify the plan

- **short**: fewer than 4 steps and fewer than 2 independent steps.
- **long**: 4+ steps, or 2+ valid independent steps.

State the classification in your chat summary so the UI can recommend an execution mode.

## 4. Execution modes (do not start execution yourself)

The user picks one after reviewing the plan card:

- `inline` — execute in the current session, updating steps via `piwin_plan_set_step`.
- `subagent-driven` — delegate each independent step to a child session, then merge and verify in the parent.

For **long** plans, `subagent-driven` is the recommended path; `inline` remains available as an explicit fallback. For **short** plans, `inline` is the default.

Do not begin implementation until the user approves the plan and selects a mode.

## 5. Walkthrough

When execution completes, produce a bounded walkthrough summary containing:

- what changed (files/areas);
- verification results;
- merged child sessions (if subagent-driven);
- unresolved items or follow-ups.

Keep it concise. Prefer thin, correct plans over speculative multi-week epics.
