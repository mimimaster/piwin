---
name: writing-plans
description: "Explore the codebase and save a reviewable, modular SessionPlan via piwin_plan_create, then ask how to execute it. Use when the user asks for a plan or proposal before implementation (写个计划 / 出方案 / plan this), or when a large change spans several packages and the scope should be approved first; also /writing-plans or /write-plan."
version: 8
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
2. **Draft Blueprint**: Invoke `piwin_plan_create` with the fields above. This only saves the plan.
3. **Optional card**: You may call `piwin_plan_present` to attach Desktop display data. Present does not change plan status or stop other tools.
4. **Ask and finish**: Write the user-visible summary, include the plan path (`plans/<session>.md`), and ask: **当前会话执行，还是子代理执行？** Then end the reply and wait.

If you skip present, the text question is enough. If the user follows up with questions, plan edits, or a new topic instead of choosing a mode, handle that normally.

## Execution choice
- The card is a shortcut, not a permission gate. Reading, verifying, or editing the plan is normal.
- If the user names one mode (`inline` / 当前会话执行, or `subagent` / 子代理执行), follow that path. Do not re-ask.
- If they only say they want it executed (for example 「执行一下」) and no mode is already known, ask **当前会话执行，还是子代理执行？** Do not implement and do not call `piwin_plan_set_step`.
- If this conversation already chose a mode, or plan context already shows a chosen execution mode, do not demand those keywords again.
- If a plan tool says the plan is still draft / 尚未选择执行方式, tell the user that and ask the same question. Do not retry `piwin_plan_set_step`.
- Failed later execution uses the existing continue / retry controls, not this card.

## Stop when
- Goal, constraints, or technical choices are ambiguous in a way that would change the plan — surface the real options and ask; do not invent scope.
- After the plan is saved and you have asked how to execute, stop. Do not implement or start execution in this turn.

## Constraints
- Prefer thin, correct plans over speculative multi-week epics.
- Host permissions and isolation are enforced by runtime; do not restate security policy.

## Verify
- Every step has checkable acceptance criteria and a concrete verification signal (command, test, or observable outcome).
- Independent steps truly do not contend on the same files or external resources.
- After approved execution (not during drafting), a bounded Walkthrough of changes + verification is appropriate when the host/plan flow produces one.
