# Merge backup inventory (2026-08-12)

Safe session-lifecycle rewrite was developed in an isolated worktree and
fast-forwarded into `main` as:

- commit: `6f998ff` — `feat: add safe session lifecycle archiving`

This note records how the pre-merge working tree was preserved. **Do not drop
these stashes until you confirm nothing still needed is missing from the
working tree.**

## Git stashes (newest first)

| Ref | Message | Purpose |
| --- | --- | --- |
| `stash@{0}` | `backup part 4 live agent files 2026-08-12` | Concurrent agent edits still live during restore (`App.tsx`, media hooks, live-commands, etc.) |
| `stash@{1}` | `backup part 3 before safe session lifecycle merge 2026-08-12` | Residual tracked + untracked changes after part 2 |
| `stash@{2}` | `backup part 2 before safe session lifecycle merge 2026-08-12` | Residual after first stash (pet assets, docs, concurrent writes) |
| `stash@{3}` | `backup before safe session lifecycle merge 2026-08-12` | Primary pre-merge snapshot of the large WIP (desktop/host/session/docs) |

Older stashes (`stash@{4}` and below) predate this merge and were **not** created
by the lifecycle rewrite.

## On-disk patch directory

`/Users/yorickjue/Developer/piwin-merge-backup-2026-08-12/`

| File | Contents |
| --- | --- |
| `main-unstaged.patch` | Working tree diff captured before clean merge |
| `main-staged.patch` | Index diff (empty if nothing staged) |
| `main-live-postmerge.patch` | Live residual snapshot during restore |
| `apply1.log` / `apply1-ordered.log` | Stash apply logs for the primary backup |
| `apply2-ordered.log` | Stash apply log for part 2 |
| `apply3-ordered.log` | Stash apply log for part 3 |

## How to inspect or re-apply

```bash
# List
git stash list

# Inspect primary WIP without applying
git stash show --stat stash@{3}
git stash show -p stash@{3} | less

# Re-apply without dropping (preferred)
git stash apply stash@{3}

# Only after confirming the tree already contains everything needed
# git stash drop stash@{0}   # do this carefully, newest first or by hash
```

Patches:

```bash
git apply --check /Users/yorickjue/Developer/piwin-merge-backup-2026-08-12/main-unstaged.patch
git apply /Users/yorickjue/Developer/piwin-merge-backup-2026-08-12/main-unstaged.patch
```

## Lifecycle product entry points after merge

- Host commands: `session/lifecycle-plan`, `session/lifecycle-apply`
- CLI: `piwin session lifecycle plan|apply --plan <id>`
- Config: `PiwinConfig.session.lifecycle.archive.{maxInactiveDays,maxActiveMainSessions}`
- Design: `docs/plans/2026-08-12-safe-session-lifecycle-archive.md`

Desktop Settings → Session exposes the same plan/apply flow (policy save is
separate from apply).
