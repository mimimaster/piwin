---
name: using-git-worktrees
description: Use git worktrees for isolated sub-agent or parallel feature work.
---

# Using Git Worktrees

1. Prefer a new worktree for long-lived parallel branches instead of dirty stashing.
2. Create under a dedicated sibling directory when the product supports it.
3. Keep main worktree clean for product default sessions.
4. Merge or discard deliberately; never force-push main/master.
5. For piwin sub-agents: `worktree` mode owns isolation; readonly mode must not mutate.

Document the worktree path in the session/UI when spawning agents.
