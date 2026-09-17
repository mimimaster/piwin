---
name: executing-plans
description: "Execute an approved SessionPlan in the current session slice by slice, recording step evidence with piwin_plan_set_step. Use when the user wants an approved plan implemented inline (执行一下 / 当前会话执行 / 按计划做) or asks to continue the next plan step. If they chose 子代理执行, use subagent-driven-development instead."
version: 4
---

# Executing Plans

## Goal
Implement only the current approved plan slice so its acceptance criteria pass, then stop at the next checkpoint.

## Done means
- Current step(s) match plan intent; no drive-by refactors or scope expansion.
- Step progress is recorded with `piwin_plan_set_step` (mark `done` only with a short evidence note).
- Required verification for the slice ran in this environment (tests, typecheck, or the plan’s stated check).
- If a step has `profileId`, the Host-resolved profile bounds model/capabilities/isolation — do not widen them.

## Before you execute
- If the user already named a mode, or plan context already shows a chosen execution mode, use that path. Do not ask them to repeat keywords.
- If they only say they want it executed (for example 「执行一下」) and no mode is known, ask **当前会话执行，还是子代理执行？** Then wait.
- If the plan is still draft, or `piwin_plan_set_step` says 尚未选择执行方式 / 请先确认执行方式, ask that same question. Do not retry the tool and do not keep implementing as if the plan were approved.
- Failed runs use the existing continue / retry controls. Do not invent a second recovery path.

## Stop when
- Plan is wrong, blocked, or acceptance criteria cannot be met — fix the plan briefly or ask; do not silently diverge.
- Checkpoint / user gate requires review before the next slice.

## Constraints
- Default profiles when unset: worktree + explicit apply. Built-ins: `explorer`, `reviewer` (readonly); `implementer`, `tester` (worktree).
- Host owns isolation and permission; skill text is guidance only.

## Verify
- Re-run the failing or required path for the slice; summarize actual results before claiming the step done.
