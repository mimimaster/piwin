# Quiet Workbench P0 Debt Cleanup: Legacy `.btn` / `.icon-btn` Retirement

| Field | Value |
|-------|-------|
| Status | Ready to execute |
| Date | 2026-07-27 |
| Parent plan | [`2026-07-27-quiet-workbench-p0-convergence-plan.md`](./2026-07-27-quiet-workbench-p0-convergence-plan.md) |
| Backlog IDs | QW-BTN-01 / QW-BTN-02 / QW-BTN-03 (`docs/todo-deferred.md` §2.13) |

---

## 1. Goal and non-goals

**Goal:** retire the last raw `.btn` button markup in desktop (NotesPanel + FlashcardsPanel, 21 usages) by migrating to the ui-kit `Button` component, then delete the now-orphaned legacy `.btn*` and dead `.icon-btn` CSS from `ui-foundations.css`. After this plan, every button in desktop renders through `@piwin/ui-kit` and its `primitives.css` contract.

**Non-goals:**

- No visual redesign of NotesPanel/FlashcardsPanel beyond the button swap.
- No changes to `@piwin/ui-kit` — `Button` already exposes every variant needed.
- No changes to notes/flashcards domain logic, host IPC, or data flow.
- No new screenshot baselines for these panels (they are not P0 surfaces; defer).

## 2. Verified inventory (audited 2026-07-27)

**Raw `.btn` consumers — exactly 21, nowhere else in desktop:**

| File | Count | Classes used |
|------|-------|--------------|
| `apps/desktop/src/FlashcardsPanel.tsx` | 9 (L221, 224, 227, 230, 238, 263, 275, 280, 308) | `btn`, `btn primary` |
| `apps/desktop/src/NotesPanel.tsx` | 12 (L205, 210, 224, 234, 237, 240, 302, 307, 313, 335, 389, 396) | `btn`, `btn primary`, `btn ghost` |

**Legacy CSS — all in `apps/desktop/src/styles/ui-foundations.css`, no other file references it:**

- `.btn*` family: L23–121 (`.btn`, hover/active/disabled, `.btn.primary`/`.btn-primary`, `.btn-secondary`, `.btn-ghost`/`.btn.ghost`, `.btn-compact`, `.btn-danger`).
- `.icon-btn` family: L123–148 (`.icon-btn`, `:hover`, `.active`) — **zero TSX consumers anywhere** (only region-prefixed classes like `composer-v2-icon-btn` exist, which are unrelated selectors). Confirmed dead.
- Note: `.btn-secondary`, `.btn-compact`, `.btn-danger` already have zero TSX consumers today; they die together with the family in Slice 3.

**Component mapping (ui-kit `Button`: `variant` = primary | secondary | ghost | danger; `size` = default | compact; `type` defaults to `"button"`):**

| Raw markup | Replacement |
|---|---|
| `<button type="button" className="btn">` | `<Button>` (default `secondary`) |
| `<button type="button" className="btn primary">` | `<Button variant="primary">` |
| `<button type="button" className="btn ghost">` | `<Button variant="ghost">` |

Import idiom (match existing consumers, e.g. `PlanPanel.tsx`):
`import { Button } from '@piwin/ui-kit';`

## 3. Constraints

- Forbidden paths from the parent plan stay forbidden: `packages/agent-host/**`, `packages/contracts/**`, chat-reducer/host-client/host-request-adapters/stream-event-buffer/shell-layout, `apps/cli/**`.
- Preserve on every migrated button: `disabled` state, `onClick` handler, label text, and any `title`/`aria-*` attributes. `type="button"` is the ui-kit default — do not re-add it.
- No `!important`, no Mantine private selectors, no new dependencies.
- **Accepted visual change:** raw `.btn` (fixed 34px, gradient fill) converges to the `piwin-button` look (Mantine-backed, `--control-height-default`). This is the intended outcome, limited to the two panels. It must NOT move any of the 12 committed e2e baselines — none of them capture these panels; a full e2e run proves it.

## 4. Slices (execute in order)

### Slice 1 — FlashcardsPanel migration (QW-BTN-01a)

- File: `apps/desktop/src/FlashcardsPanel.tsx`
- Add the `Button` import; replace all 9 raw buttons per the mapping table. The four rate buttons (`again/hard/good/easy`) and list/deck actions become default `Button`; the two `btn primary` submit/reveal actions become `variant="primary"`.
- Exit criteria: `rg '"btn' apps/desktop/src/FlashcardsPanel.tsx` returns nothing; `pnpm --filter @piwin/desktop typecheck` green.
- Test: manual smoke — open Flashcards panel, rate a card, add a deck; confirm hover/disabled states render.

### Slice 2 — NotesPanel migration (QW-BTN-01b)

- File: `apps/desktop/src/NotesPanel.tsx`
- Same treatment for all 12 buttons: search/index/eval actions and editor cancel become default `Button`; save (L389) becomes `variant="primary"`; the L335 `btn ghost` action becomes `variant="ghost"`.
- Exit criteria: `rg '"btn' apps/desktop/src/NotesPanel.tsx` returns nothing; typecheck green.
- Test: manual smoke — search, open a note, edit/save/cancel, reindex.

### Slice 3 — Delete legacy `.btn*` CSS (QW-BTN-02)

- File: `apps/desktop/src/styles/ui-foundations.css`
- Precondition gate: `rg -n '[\"\x60 ]btn[ \"\x60]|\bbtn-' apps/desktop/src --glob '*.tsx'` must return zero raw consumers (Slices 1–2 done).
- Delete the entire `.btn*` block (L23–121 region) including `.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-compact`/`.btn-danger` aliases. Keep `.run-status-actions` and its `.piwin-button` refinement — that block is live and unrelated.
- Leave a one-line comment: legacy raw button family retired; all buttons go through ui-kit `Button`.
- Exit criteria: `rg '\.btn' apps/desktop/src --glob '*.css'` returns nothing.

### Slice 4 — Delete dead `.icon-btn` CSS (QW-BTN-03)

- Same file. Re-verify zero consumers (`rg '\bicon-btn\b' apps/desktop/src --glob '*.ts*'` excluding region-prefixed names), then delete `.icon-btn` / `:hover` / `.active` (L123–148 region). The pointer comment at L150 about ui-kit IconButton stays.
- Exit criteria: `rg '\.icon-btn' apps/desktop/src --glob '*.css'` returns nothing.

### Slice 5 — Verification sweep + backlog closeout

1. `pnpm --filter @piwin/desktop typecheck && pnpm --filter @piwin/desktop test` — all green (216+ tests).
2. `pnpm --filter @piwin/desktop build` — green.
3. Full e2e from `apps/desktop`: `pnpm exec playwright test` — **all 50 pass with zero baseline updates**. Any baseline diff means the deletion touched a shared rule — stop and bisect; do not update baselines.
4. Manual smoke of both panels in dark and light themes (Notes + Flashcards are not baseline-covered, so eyes are the gate here).
5. Update `docs/todo-deferred.md` §2.13: mark QW-BTN-01/02/03 done with date.

## 5. Risks / do-not-do

| Risk | Response |
|---|---|
| A `.btn` string hides in a template literal or conditional class | Slice 3 precondition grep covers `` ` `` and `-` forms; run it before deleting CSS. |
| ui-kit `Button` inside these panels needs `PiwinUiProvider` | Panels render inside the app shell which already mounts the provider; no wiring needed. If a future isolated test mounts them, wrap with `TEST_THEME_DARK` provider like other suites. |
| Button height change breaks a tight panel layout row | Fix with a region refinement (`.notes-panel .piwin-button { … }`) in desktop CSS — never by re-adding `.btn` or touching `primitives.css` defaults. |
| Temptation to "also clean up" other panel styles | Out of scope. Button swap + dead CSS only. |

## 6. Definition of done

1. Zero `.btn`/`.icon-btn` class usage in desktop TSX; zero `.btn*`/`.icon-btn` rules in desktop CSS.
2. All buttons in NotesPanel/FlashcardsPanel are ui-kit `Button` with correct variant, preserved handlers/disabled/labels.
3. Typecheck, unit tests, build, and full e2e (50, unchanged baselines) all pass.
4. Backlog §2.13 rows closed.

**Start order:** Slice 1 → 2 → 3 → 4 → 5. Estimated size: one short session; no ADR needed (no architecture change).
