---
name: using-git-worktrees
description: Use git worktrees for isolated parallel or sub-agent work without dirtying the main tree.
---

# Using Git Worktrees

## Goal
Isolated checkout(s) for parallel or sub-agent work, with a clean default product worktree and deliberate integrate/discard.

## Done means
- Long-lived parallel work uses a worktree (prefer product sibling directory when available) instead of dirty stashing on main.
- Worktree path is visible in session/UI when spawning agents.
- Merge or discard is explicit.
- For piwin sub-agents: `worktree` mode owns writable isolation; `readonly` does not mutate.

## Stop when
- Isolation is unavailable — say so; do not pretend writes are isolated.

## Constraints
- Do not force-push `main`/`master`.
- Host isolation policy is authoritative for sub-agents.

## Verify
- Default session worktree stays clean; agent work lands only where intended.
