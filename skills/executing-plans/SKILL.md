---
name: executing-plans
description: Execute an existing plan slice-by-slice with verification checkpoints.
---

# Executing Plans

1. Read the plan; confirm current slice and exit criteria.
2. Implement only that slice; avoid drive-by refactors.
3. Run the package tests / typecheck required by the plan.
4. Update plan/backlog status when a slice is done.
5. Stop at checkpoints if something blocks; do not invent scope.

If the plan is wrong, fix the plan briefly then continue — do not silently diverge.
