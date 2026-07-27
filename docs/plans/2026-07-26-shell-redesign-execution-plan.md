# Desktop Shell Redesign Execution Plan

| Field | Value |
|---|---|
| Status | **Implemented + verified 2026-07-26** — R1–R5 landed; unit 199/199, Playwright 45/45 (baselines regenerated); manual smoke + native Tauri evidence pending |
| Date | 2026-07-26 |
| Scope | Desktop shell chrome, settings surface, CSS/token architecture, ui-kit convergence. No Host/session/Tauri transport behavior changes. |
| Related | `docs/prd.md`, `docs/architecture.md`, `docs/plans/2026-07-25-coding-agent-chat-window-plan.md`, `docs/adr/0016-general-workspace-sessions.md`, canvas prototype `piwin-shell-redesign.canvas.tsx` (approved 2026-07-26) |
| Constraints | `AGENTS.md`; UI never imports Pi; ui-kit depends on contracts only; security boundaries (trust flow, permission cards, destructive-command confirmation, `~/.piwin` media paths) unchanged |

## 0. Purpose

The 2026-07-26 full shell review found structural debt that makes every UI
change more expensive than it should be:

| ID | Finding | Evidence |
|---|---|---|
| SR-01 | Four stacked horizontal bands above the transcript | `workspace-titlebar.tsx` + `session-task-tabs.tsx` + `workspace-context-header.tsx` + `run-status-strip.tsx` |
| SR-02 | 15-layer order-dependent CSS cascade, 10,773 lines total, with corrective layers | `styles/` — `visual-overhaul.css` alone has 79 `!important`; several files are commented "extracted from styles.css L####" |
| SR-03 | Three competing color-token systems | `tokens.css` (Copper static), `appearance-tokens.ts` (~70 runtime vars), Mantine theme tuples in `piwin-ui-provider.tsx` |
| SR-04 | ui-kit exists but is bypassed | 168 raw `className="btn"`/`icon-btn` occurrences across 40 files; two hand-rolled popovers (`ThinkingEffortControl.tsx`, `composer-plus-menu.tsx`) |
| SR-05 | Settings monolith | `SettingsPanel.tsx` 1,157 lines, 16 ternary section branches, 13 drilled `request*` props |
| SR-06 | Fragile inspector entry point | toggle button portaled to `document.body`, fixed position, `z-index: 2147483000 !important` |
| SR-07 | Oversized shell files | `App.tsx` 1,377 lines mixing host wiring, config persistence, DOM queries, window resize, and rendering |

The approved target design (canvas prototype):

- **Vertical chrome = exactly 4 fixed bands**: titleband (40px) → unified
  context bar (42px) → composer dock → status bar (26px). Everything else
  scrolls.
- **Three columns**: collapsible sidebar (~236px) · stage (content column
  max-width 640px) · resizable inspector (~290px, keeps outward window
  expansion).
- **Context bar** absorbs session title, scope pill, run status + stop, and
  the inspector toggle. `SessionTaskTabs`, `WorkspaceContextHeader`,
  `RunStatusStrip`, and the portal toggle are retired. Multi-session
  switching returns to the sidebar and ⌘K.
- **Settings is a sibling routed view**, not an overlay: fixed two-layer
  structure (category nav + single content page). No third column. Provider
  selection is in-page tabs on the Models page; the model directory is a
  full-width list with inline expansion (context window / max output as
  Runtime Limits). All sections use two page templates: `PageTitle +
  FieldRow` list, or directory list.
- **Composer controls converge to 4**: ＋ menu, merged `model · effort` chip,
  context ring, send/stop.

## 1. Scope and non-goals

### In scope

1. Shell layout restructure (bands, columns, context bar).
2. Token unification and CSS layer removal.
3. Settings routing, section registry, page templates, prop-drilling removal.
4. Convergence of raw buttons/popovers onto ui-kit primitives.
5. `App.tsx` decomposition **only** as far as required by the above (shell
   frame extraction; not a state-management rewrite).

### Explicit non-goals

1. No changes to host transport, chat reducer semantics, run/event ordering,
   or transcript persistence (covered by the chat-window plan).
2. No new state library, no router library (settings routing extends the
   existing `shell-navigation.ts` stack).
3. No visual rebrand beyond the already-chosen graphite theme; this plan
   removes the *competing* palettes, it does not introduce a new one.
4. No CLI work; CLI has no shell chrome. Document intentional degradation
   where a Desktop-only affordance appears (none expected).
5. No behavior change to trust/permission/security flows — container styling
   only.

## 2. Slice overview and dependencies

```text
R1 Token unification ──┐
                       ├─→ R3 CSS layer removal
R2 Context bar merge ──┤
                       ├─→ R4 Settings routing
                       └─→ R5 ui-kit convergence
```

R1 and R2 are independent and can proceed in parallel. R3 requires R1 (single
token source) and benefits from R2 (three components deleted before their CSS
is rewritten). R4 and R5 depend on R2 only for the shell frame being stable.

Each slice is a separate commit series, independently verifiable, and leaves
the app fully working (`pnpm typecheck` + touched-package tests + manual smoke
+ existing Playwright shell cases green).

## 3. Slices

### R1 — Token unification

**Goal**: one semantic token source; themes are value swaps only.

Tasks:

1. Make `appearance-tokens.ts` the single color/typography token authority.
   Every semantic variable it emits gets a documented name
   (`--surface-*`, `--content-*`, `--stroke-*`, `--accent-*`).
2. Reduce `styles/tokens.css` to geometry/z-layer variables only (band
   heights, column widths, radii, z-layer contract). Delete the Copper
   palette and the `[data-theme-mode='light']` static block.
3. Remove legacy aliases (`--blue`, `--panel-2`, etc.): grep each alias,
   rewrite usages to semantic names, delete alias emission.
4. Derive the Mantine theme in `piwin-ui-provider.tsx` from the same token
   values (read from the appearance manifest, not duplicated tuples).
5. Verify `ThemePanel` manifest switching still works: switching theme writes
   the same variable set with different values; artifact theme mapping
   (`artifact-theme-map.ts`) unchanged.

Tests / verification:

- Unit: appearance-token emission snapshot (dark + light manifests produce
  the full documented variable set, no legacy aliases).
- Grep gate: zero occurrences of removed alias names in `apps/desktop` and
  `packages/ui-kit`.
- Manual: theme toggle light/dark; settings appearance preview; artifact
  frame theme.

Exit criteria: one runtime token source; `tokens.css` contains no colors;
Mantine reads derived values; all themes render.

### R2 — Context bar merge

**Goal**: 4 fixed bands; one component owns everything between titleband and
transcript.

Tasks:

1. New `context-bar.tsx`: session title (truncating), scope pill, run status
   cluster (phase dot, elapsed, stop/retry from existing `run-status.ts` /
   `run-presentation.ts` logic), inspector toggle, overflow menu. Reuses run
   state selectors as-is — presentation move only.
2. Delete `session-task-tabs.tsx`, `workspace-context-header.tsx`,
   `run-status-strip.tsx` and their renders in `App.tsx`.
3. Delete the portaled inspector toggle in `right-panel.tsx`; the context-bar
   toggle calls the same `use-shell-layout.ts` overlay state. Keep outward
   window expansion (`window-outward-expand.ts`) and resize
   (`use-right-panel-resize.ts`) untouched.
4. Sidebar remains the only session-switching surface; verify ⌘K commands
   (`desktop-commands.ts`) cover "switch session" so tab-strip users lose no
   capability. Add a command if missing.
5. Extract the shell frame from `App.tsx` into `workspace-shell.tsx`
   (columns + bands as layout slots). `App.tsx` keeps state/wiring and passes
   slot content. This is the *minimal* App decomposition, not a rewrite.
6. Preserve `data-testid` used by Playwright shell tests; where a testid
   lived on a deleted component, move it to the context bar equivalent and
   update tests in the same commit.

Tests / verification:

- Unit: context-bar rendering for idle / running / error / archived-session
  states (reuse run-status fixtures).
- Playwright: existing shell/inspector cases updated; add one case asserting
  exactly one status region exists during a run (regression against SR-01
  duplication).
- Manual smoke: run a prompt, stop it, toggle inspector, resize panel,
  compact layout mode.

Exit criteria: three components + portal button deleted; band count above
transcript is 2 (titleband + context bar); no `!important` z-index for the
toggle; all run controls reachable.

### R3 — CSS layer removal

**Goal**: component-scoped styles; delete the corrective cascade.

Approach: **rewrite-and-delete per region**, never "clean up in place".
Order regions by blast radius (smallest first): status bar → sidebar →
context bar (fresh from R2) → composer → transcript → inspector → overlays →
settings (deferred to R4 for section bodies; shell part only here).

Tasks per region:

1. Write the region's styles fresh against the R1 semantic tokens in a single
   region file (e.g. `styles/region-sidebar.css`), with no `!important` and
   no selectors reaching into other regions.
2. Delete that region's rules from **all** legacy files
   (`shell.css`, `ui-modernization.css`, `cursor-workspace.css`,
   `visual-overhaul.css`, `overlays-feedback.css`, `session-chrome.css`,
   `inspector-dock.css`, `settings-resources.css`, `shell-extensions.css`,
   `responsive-early.css`).
3. When a legacy file reaches zero meaningful rules, delete the file and its
   import from `styles.css`.

Tests / verification:

- Per region: manual smoke in both themes + both layout modes; Playwright
  visual assertions where they exist.
- Global gates at slice end: total `!important` count in `apps/desktop`
  styles < 10 (each remaining one commented with a reason); no selector for
  `.sidebar`/`.right-panel`/`.composer-dock` defined in more than one file.

Exit criteria: `ui-modernization.css`, `cursor-workspace.css`,
`visual-overhaul.css`, `responsive-early.css` deleted; remaining files are
region-scoped; `styles.css` import order no longer semantically significant.

### R4 — Settings routing and section registry

**Goal**: settings as a sibling routed view; each section a small page file.

Tasks:

1. Extend `shell-navigation.ts` routes so `settings/<section>` is a
   first-class shell view (back/forward already stack-based; settings stops
   being an overlay in `use-shell-layout.ts`).
2. New `settings/` directory under `apps/desktop/src`:
   - `settings-shell.tsx` — two-layer frame: category nav + content area.
   - `section-registry.ts` — typed registry `{ id, group, labelKey,
     component }` for the 16 sections; nav and routing both read it.
   - `settings-context.tsx` — provides the current `request*` adapters
     (from `host-request-adapters.ts`) via context; kills the 13 drilled
     props.
   - Page templates: `page-title.tsx`, `field-row.tsx`, `directory-list.tsx`
     (candidates for promotion to ui-kit if UI-pure; decide per component —
     anything without host access goes to `packages/ui-kit`).
3. Migrate sections in three waves, each wave a commit:
   - Wave 1 (inline-in-monolith today): general, appearance (wraps
     `ThemePanel`), session, rules, web.
   - Wave 2 (already separate components, re-homed + templated): skills, mcp,
     extensions, prompts, memory, automation, agents, pets.
   - Wave 3 (models): `ProviderSettings.tsx` restructured to the approved
     design — provider in-page tabs, connection grid, full-width model
     directory with inline expansion exposing `contextWindow` /
     `maxOutputTokens` from existing `ModelConfigEntry` (contracts already
     support both; **no contracts change expected** — if one becomes
     necessary, stop and update contracts first per AGENTS.md).
4. Delete `SettingsPanel.tsx` when the registry covers all sections.
5. i18n: while migrating each section, move inline `locale === 'zh-CN'`
   ternaries into the section's label table (pattern consistent with
   `desktop-locale.ts`). No new i18n framework.

Tests / verification:

- Unit: section registry completeness (every section id renders; nav groups
  match); shell-navigation route tests extended for settings routes.
- Per wave: manual smoke of migrated sections; models page gets targeted
  tests for limit editing round-trip through existing config save path.
- Playwright: open settings → navigate 3 sections → back to workspace
  restores prior session view.

Exit criteria: `SettingsPanel.tsx` deleted; no `request*` prop drilling;
every section ≤ ~300 lines; models page matches approved prototype.

### R5 — ui-kit convergence

**Goal**: zero raw `btn`/`icon-btn` classNames; one popover implementation.

Tasks:

1. Sweep the 168 raw button usages file-by-file to ui-kit
   `Button`/`IconButton`. Mechanical; batch by region, commit per batch.
   Where a raw button carries region-specific styling, express it as a
   ui-kit variant prop or a region-scoped class *on top of* the ui-kit
   component — never a parallel button implementation.
2. Rewrite `ThinkingEffortControl.tsx` popover shell onto ui-kit (Radix)
   `Popover`, deleting manual outside-click/Escape/portal code. Keep the
   merged model+effort content and `composerProfile` persistence exactly.
3. Rewrite `composer-plus-menu.tsx` flyouts onto Radix menu primitives via
   ui-kit; keep slash-menu (`slash/`) untouched.
4. Composer dock control row converges to the approved 4 controls; the ＋
   menu absorbs anything displaced (no capability loss).
5. Delete dead shell code encountered in the sweep where certainty is
   possible: `rail-nav.ts` (describes removed UI), unwired
   `PetCompanion.tsx` render path check (delete only if truly unreferenced),
   `_`-prefixed unused destructures in `App.tsx`.

Tests / verification:

- Grep gate: zero `className="btn"` / `icon-btn` in `apps/desktop`.
- Unit: ThinkingEffortControl keyboard interaction (open, arrow, select,
  Escape) reusing existing test patterns; composer plus-menu selection.
- Manual: composer full loop — attach image, pick model/effort, slash
  command, send, steer, stop.

Exit criteria: one button system, one popover system; composer matches
prototype; no hand-rolled portals in the shell.

## 4. Verification matrix (every slice)

| Gate | Command / method |
|---|---|
| Types | `pnpm typecheck` |
| Unit/integration | `pnpm --filter @piwin/desktop test` (+ `@piwin/ui-kit` when touched) |
| Build | `pnpm --filter @piwin/desktop exec vite build` (known-good even while `tsc -b` tooling issue persists) |
| E2E | existing Playwright shell/inspector cases + cases added per slice |
| Manual smoke | scripted list per slice, run in both themes and both layout modes |
| Diff hygiene | whitespace-clean; no unrelated-package changes; testid moves paired with test updates in same commit |

## 5. Risks

| Risk | Mitigation |
|---|---|
| CSS deletion regresses an untested corner (banners, archived state, trust notice) | Region-by-region rewrite order; per-region manual checklist includes banner/notice states; keep legacy file until its region checklist passes |
| Removing SessionTaskTabs loses a workflow for tab-oriented users | ⌘K session-switch command verified/added in R2 before deletion; sidebar recency groups already cover the same set |
| Settings-as-route interacts with unsaved section drafts (web config form) | Wave 1 migrates the web draft form early; navigation away prompts via existing confirm-dialog pattern |
| Mantine theme derivation drifts from CSS tokens | Single derivation function with a snapshot test comparing both outputs from the same manifest |
| `App.tsx` extraction destabilizes hydration/single-flight guards | R2 extraction moves **JSX only**; all effects/refs/guards stay in `App.tsx` verbatim; chat-window plan owns any logic moves |
| Long-running parallel work conflicts (R1 ∥ R2) | R1 touches tokens/styles; R2 touches components; overlapping file is only `styles.css` imports — coordinate merges there |

## 6. Forbidden in this plan

1. Changing chat reducer, host client, event ordering, or persistence.
2. New runtime dependencies (router, CSS-in-JS, state library).
3. `!important` in any newly written CSS.
4. Copying legacy CSS rules into region files without re-derivation from
   tokens.
5. Partial section migration that leaves `SettingsPanel.tsx` rendering some
   sections indefinitely — each wave fully removes its sections from the
   monolith.
6. Weakening any security-related UI (permission cards, trust dialogs,
   destructive-command confirmation) — container styling only.
