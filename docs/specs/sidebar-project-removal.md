# Sidebar project removal

- `project/remove` hides a sidebar path without deleting files, Git worktrees,
  branches, or sessions.
- Host stores optional `hiddenProjectPaths` in `projects.json`. Legacy stores
  remain valid. Canonical directory identity matches symlink aliases; removing
  a subdirectory does not hide its parent checkout.
- `project/list` excludes hidden discovered worktrees, preserving siblings.
- Explicit `project/open` clears only the opened directory's tombstones.
- Discovered worktrees have the same remove context menu. Host validates them
  against live Git inventory; arbitrary unknown paths still fail.
- Desktop suppresses cached rows immediately. Pending removals and the existing
  commit epoch guard prevent stale lists from restoring rows before or after
  the remove completes. A fresh registered list can restore explicitly reopened
  projects. Failed removes restore rejected entries.

## Old removals

There is no historical removal record to backfill. After updating the app,
remove a previously reappearing unregistered worktree once more.
