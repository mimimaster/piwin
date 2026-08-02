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

## Subagent profiles

When a plan step has a `profileId`, the Host resolves the corresponding
subagent profile (model, thinking level, capabilities, isolation, skills)
from Settings before spawning the child session. The profile's capability
set and isolation mode are upper bounds — a step cannot widen them.

Built-in profiles:
- `explorer` — read-only codebase exploration
- `reviewer` — read-only code review and analysis
- `implementer` — isolated implementation with write + execute (worktree)
- `tester` — isolated test execution and fixture writes (worktree)

Custom profiles can be defined in Settings → Sub-agent profiles. When a
step has no `profileId`, plan execution uses its default (worktree +
explicit apply policy).

If the plan is wrong, fix the plan briefly then continue — do not silently diverge.
