---
name: executing-plans
description: Execute an approved plan slice-by-slice with evidence at each checkpoint.
version: 2
---

# Executing Plans

## Goal
Implement only the current approved plan slice so its acceptance criteria pass, then stop at the next checkpoint.

## Done means
- Current step(s) match plan intent; no drive-by refactors or scope expansion.
- Step progress is recorded with `piwin_plan_set_step` (mark `done` only with a short evidence note).
- Required verification for the slice ran in this environment (tests, typecheck, or the plan’s stated check).
- If a step has `profileId`, the Host-resolved profile bounds model/capabilities/isolation — do not widen them.

## Stop when
- Plan is wrong, blocked, or acceptance criteria cannot be met — fix the plan briefly or ask; do not silently diverge.
- Checkpoint / user gate requires review before the next slice.

## Constraints
- Default profiles when unset: worktree + explicit apply. Built-ins: `explorer`, `reviewer` (readonly); `implementer`, `tester` (worktree).
- Host owns isolation and permission; skill text is guidance only.

## Verify
- Re-run the failing or required path for the slice; summarize actual results before claiming the step done.
