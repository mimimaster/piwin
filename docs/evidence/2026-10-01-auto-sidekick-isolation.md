# Auto sidekick isolation repair — 2026-10-01

## Root cause and scope

Auto's sidekick inherits the Fusion member (`implementer`, `worktree`). The Settings card treated an omitted isolation field as explicit `readonly`, rather than displaying its inherited value. Separately, both `cloneMember` and `patchMemberAt` dropped `inheritFrom`. After saving a pinned model, the contracts resolver declined to restore builtin inheritance because of that model override. The profile-less sidekick then fell back to Auto's default `explorer`; the existing profile isolation ceiling correctly narrowed its worktree request to readonly, which rejected candidate delivery.

The repair preserves `inheritFrom` through opening, field edits, and cleaning for save. Builtin recipe inheritance is restored even for old overlays with pinned models, while explicit model, profile and isolation overrides retain precedence. The form uses the existing public scheme resolver for display only: inherited fields are never copied into the persisted draft. The isolation dropdown distinguishes inherited Worktree from an explicit override and permits resetting to inheritance. Broken references produce an error notice without crashing the editor. No profile permission ceiling, generic spawn fallback, live config, dependencies, or installed application were changed.

## Verification

- Before production changes: Desktop regression tests reproduced missing `inheritFrom`, default Read-only display, and missing inheritance reset; contracts regression reproduced `profileId: explorer` for a pinned-model Auto sidekick.
- After repair: `pnpm --filter @piwin/desktop exec vitest run src/settings/orchestration-scheme-draft.test.ts src/settings/orchestration-scheme-editor.test.tsx src/settings/pages/subagents-page.test.tsx` — 22 passed.
- `pnpm --filter @piwin/contracts test` — 93 files / 691 tests passed.
- `pnpm --filter @piwin/desktop exec vitest run --reporter=dot` — 715 files / 5266 tests passed (background Job `fa03bffb-9340-4c85-8ead-d76062ccbb60`, exit 0). Focused tests were rerun after correcting the Select testId prop.
- `pnpm --filter @piwin/desktop typecheck` — passed, including the final Select prop correction.
- Independent reviewer approved the scoped main-session diff, with no high/critical findings.
- Shared browser inspected Settings against Vite on port 1439 with the in-browser mock Host. An isolated Playwright smoke run additionally verified: default inherited Worktree; explicit readonly survives save/reopen; resetting to inheritance survives save/reopen as Worktree. Real browser DOM assertions passed. Screenshot inspected at `/tmp/piwin-auto-sidekick-ui.png`.
- Whole-repo `pnpm typecheck` did **not** pass: concurrent, out-of-scope `packages/agent-grok` work had unresolved workspace dependencies / missing node_modules. No unrelated setup or source repair attempted.

## Deployment boundary

This is a source repair, not a Desktop release. The installed client and running Host still need to be rebuilt/updated before the changed resolver and editor apply there. Browser persistence smoke used only mock-host memory and did not modify `~/.piwin/config.json`. Existing explicit readonly/profile overrides remain explicit; repairing defaults does not override user-selected restrictions.
