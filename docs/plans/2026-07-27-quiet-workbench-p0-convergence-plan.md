# Quiet Workbench P0: Visual Baseline and Primitive Convergence Plan

| Field | Value |
|---|---|
| Status | **Planned** |
| Date | 2026-07-27 |
| Scope | Desktop visual regression, theme projection, and shared UI primitives |
| Supersedes | Nothing; this is a follow-up convergence slice after Quiet Workbench W1-W4 |
| Source of truth | `docs/design/quiet-workbench-proposal.html` v2.3 |
| Related | `docs/plans/2026-07-27-quiet-workbench-implementation.md`, `docs/design/desktop-foundations.md`, `AGENTS.md` |
| Constraints | No host, chat reducer, transport, persistence, contracts, CLI, or shell-layout authority changes |

---

## 0. Purpose

The Quiet Workbench implementation record marks its W1-W4 shell work as complete. This plan does **not** reopen that work or redesign the desktop shell. It closes the remaining P0 convergence gap:

1. screenshot assertions exist, but their checked-in baseline policy and deterministic fixture contract are not yet proven in this checkout;
2. document CSS tokens update when the user changes themes, while the mounted Mantine provider is initialized with the dark manifest in `main.tsx`; and
3. shared primitive behavior is in `@piwin/ui-kit`, while a material portion of their styling remains in desktop CSS without an explicit selector-ownership contract.

The result must be a reproducible visual baseline suite and one active `ThemeManifest` projected consistently to document CSS, Mantine, and artifact rendering.

### 0.1 Deliverables

- A reviewed, committed Playwright screenshot baseline policy for the canonical macOS Chromium environment.
- Deterministic dark and light visual fixtures for the shell and the shared primitive state matrix.
- One React-level active-theme owner that feeds both `PiwinUiProvider` and document token application.
- Shared primitive structural styles owned by `@piwin/ui-kit`; desktop owns token values, shell layout, and narrowly-scoped regional placement refinements.
- Targeted unit, integration, browser, build, and changed-path verification evidence.

### 0.2 Explicit non-goals

Do not change or refactor:

- `packages/agent-host/**`, Pi adapters, host sidecar, host transport, or IPC;
- `apps/desktop/src/chat-reducer.ts` or stream-event/reducer semantics;
- session persistence, trust, permissions, project opening behavior, or terminal lifecycle;
- `packages/contracts/**` or the `ThemeManifest` wire contract;
- `apps/cli/**`;
- `shell-layout.ts` breakpoints, overlay enums, or `data-layout` authority;
- right-panel IA/state memory, titlebar relocation, composer information architecture, transcript process presentation, or streaming behavior;
- a Mantine-to-Radix migration or any new UI dependency.

If an implementation appears to need one of these changes, stop and write a separate plan/ADR rather than expanding this slice.

---

## 1. Review findings and locked decisions

### 1.1 Baselines are pending, not already a gate

`apps/desktop/e2e/visual-regression.spec.ts` defines eight screenshot assertions, but the expected Playwright snapshot assets are not present in the current worktree. The prior Quiet Workbench record's statement that eight Darwin baselines were regenerated is therefore not sufficient evidence for a clean-checkout regression gate.

**Decision:** treat committed screenshot creation and clean-checkout verification as P0 work. Do not claim the visual suite is a regression gate until all expected image assets resolve from a clean checkout.

### 1.2 One active theme must drive all runtime projections

The current path is split:

```text
main.tsx
  applyAppearanceToDocument(PIWIN_APPEARANCE_DARK)  // correct pre-paint fallback
  PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK} // currently static

useHostBootstrap.ts
  activeTheme -> applyThemeToDocument(resolved theme)
  artifactThemeKey -> App artifact refresh

App.tsx
  titlebar/theme Settings callbacks repeat theme resolution, document writes,
  and artifact refresh
```

This can leave Mantine-backed controls on their initial dark palette after document CSS switches to another theme.

**Decision:** a root presentation component will own the resolved active `ThemeManifest`. It will render `PiwinUiProvider` with that manifest and apply its document tokens. `App` will receive the active manifest and a callback for applying a newly resolved manifest; it will no longer hold a duplicate theme-selection state.

The one allowed pre-paint exception remains:

```ts
applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);
```

It avoids an unthemed first frame before React mounts. Once React is mounted, the root owner is authoritative.

### 1.3 UI-kit owns primitive visual contracts

`docs/design/desktop-foundations.md` assigns shared visual contracts to `@piwin/ui-kit`. That contract must be implemented as more than class names with app-owned global styling.

**Decision:**

- `@piwin/ui-kit` owns primitive structural CSS, semantic class names, states, focus treatment, and Mantine projection for `Button`, `IconButton`, `Field`, `ListRow`, `Surface`, and `StatusBadge`.
- That CSS must consume semantic custom properties only; it must not embed desktop colors, dimensions, Tauri APIs, or host-derived state.
- `apps/desktop` owns `ThemeManifest` token projection, shell geometry, global typography fallback, region layout, and documented regional refinements only.
- Region CSS must not redefine generic primitive default/hover/focus/disabled behavior. A refinement is allowed only where a domain layout requires it, and it must use a more specific documented class.

This preserves the dependency direction: desktop consumes public ui-kit exports and styles, while ui-kit remains independent of desktop, Tauri, host, Node, and Pi.

### 1.4 P0 browser fixtures must be deterministic

The existing completed-reply screenshot is named `streaming reply` even though it waits for the run to settle. Existing tests also set reduced motion after navigation and do not explicitly state the capture environment or mock-host assumptions.

**Decision:** P0 will only snapshot stable states. Rename that case to `completed reply`, or defer it entirely. Streaming is out of scope unless a frozen mock streaming fixture can pause at a known event boundary without touching the reducer.

---

## 2. Architecture and ownership model

### 2.1 Theme projection data flow

```text
ThemeManifest from config/theme UI
          |
          v
resolveDesktopAppearance(theme)
          |
          v
DesktopThemeRoot (one React owner)
  |                 |                         |
  v                 v                         v
document tokens   PiwinUiProvider           App artifact input
appearance-       manifest={active}         mapArtifactTheme(active)
tokens.ts              |                         |
  |                    v                         v
  v                 Mantine controls          sandbox iframe vars
desktop CSS
```

Rules:

1. `resolveDesktopAppearance()` runs before a theme becomes active.
2. `applyAppearanceToDocument()` and `PiwinUiProvider` always receive the **same resolved object** from the root owner.
3. Artifact mapping continues to consume the active manifest passed through `App`; it must not read document computed styles.
4. `styles/tokens.css` remains the authority for geometry, motion, z-layer, and layout dimensions. Theme packages can never reshape the shell.
5. `ThemeManifest` stays unchanged. This is presentation synchronization, not a cross-boundary protocol change.

### 2.2 Primitive style delivery

Add an explicit ui-kit stylesheet entry point, for example:

```text
packages/ui-kit/src/primitives.css
packages/ui-kit/package.json -> exports["./styles.css"]
apps/desktop/src/styles.css -> import "@piwin/ui-kit/styles.css"
```

The exact filename may differ, but the public package subpath must be explicit and imported through the package boundary. Desktop must not deep-import `packages/ui-kit/src/**`.

The ui-kit stylesheet may style only public primitive selectors such as:

```text
.piwin-button
.piwin-icon-button
.ui-field
.piwin-list-row
.piwin-surface
.ui-status-badge
.ui-notice
.ui-spinner
.ui-tabs
.ui-menu
.ui-dialog
.ui-popover
```

It must use semantic variables supplied by desktop, such as `--surface-inset`, `--content-primary`, `--content-secondary`, `--border-default`, `--focus-ring`, `--accent`, `--state-danger`, and `--wb-hover`. It must not use `--sidebar-width`, `--right-panel-width`, or app-region selectors.

### 2.3 Style selector ownership matrix

| Concern | Owner | Examples |
|---|---|---|
| Primitive markup, ARIA, state classes | ui-kit | `Button`, `IconButton`, `Field` |
| Primitive default/hover/pressed/focus/disabled styles | ui-kit | `.piwin-button`, `.piwin-icon-button` |
| Semantic CSS variable values | desktop | `appearance-tokens.ts` |
| Geometry, z-index, font fallback | desktop | `styles/tokens.css` |
| Shell region placement | desktop | titlebar/sidebar/composer/inspector CSS |
| Domain-specific placement refinement | desktop | `.workspace-titlebar .piwin-icon-button` sizing only, when documented |
| Menus/dialogs/popovers behavior | ui-kit | Radix/Mantine wrapper components |
| Overlay placement and shell stacking | desktop | `region-overlays.css` |

Before deleting any existing desktop selector, map it to a row in this table. Preserve selectors that are genuinely regional; migrate generic primitive state rules into ui-kit.

---

## 3. Work packages

Each package should be reviewable as a checkpoint, but screenshots are provisional until P0-E. Proceed in order; do not migrate primitive styling before P0-B has deterministic fixture coverage and P0-C has the single theme owner in place. Avoid committing final image baselines until P0-E unless P0-A is only committing existing current-state baselines.

### 3.0 Mandatory implementation runbook

Execute the following sequence in order. A later step must not compensate for a failing earlier gate. The named files and symbols are the current implementation locations; if they move before this work begins, update this plan with the replacement location before changing behavior.

#### Step 1: Prove and document the baseline state without modifying UI code

1. Run the existing visual spec without `--update-snapshots`.
2. Inspect `.cursorignore`, `.gitignore`, and `apps/desktop/e2e/visual-regression.spec.ts-snapshots/`.
3. Record one of the following factual outcomes in `apps/desktop/e2e/README.md`:
   - **Tracked baseline:** expected images exist, are visible to review tooling, and the current suite passes from a clean checkout; or
   - **Bootstrap pending:** images are absent or hidden; P0-E will create and commit them before the visual suite is called a regression gate.
4. In `apps/desktop/playwright.config.ts`, add pre-navigation defaults under `use`:

   ```ts
   colorScheme: 'dark',
   reducedMotion: 'reduce',
   deviceScaleFactor: 1,
   ```

   Keep the per-test viewport declarations in `visual-regression.spec.ts`.
5. Remove `page.emulateMedia({ reducedMotion: 'reduce' })` from `waitForHostReady()` in `visual-regression.spec.ts`, because it currently runs after navigation. Keep media emulation only in a test specifically exercising media changes.
6. Rename the test currently named `streaming reply @1280` and its image to `completed reply @1280`; it intentionally waits for the mock run to finish and must not claim streaming coverage.

**Gate:** a reviewer can reproduce the failure/pass state and can inspect the expected-image policy without depending on an untracked local directory.

#### Step 2: Create the theme root before moving primitive CSS

1. Add `apps/desktop/src/desktop-theme-root.tsx`.
2. Give it exactly two presentation responsibilities:
   - own `activeTheme: ThemeManifest`, initialized with `PIWIN_APPEARANCE_DARK`;
   - expose `applyResolvedTheme(candidateTheme)` that calls `resolveDesktopAppearance(candidateTheme)`, calls `applyAppearanceToDocument(resolvedTheme)`, then stores that **same** `resolvedTheme` in state.
3. Use `useLayoutEffect` or an equivalent synchronous post-render effect to reapply the active manifest to the document whenever the root state changes. This protects a future caller that changes root state without using the callback. The callback still applies tokens before setting state to avoid an observable CSS/Mantine mismatch during the update.
4. Render exactly one provider boundary:

   ```tsx
   <PiwinUiProvider manifest={activeTheme}>
     <App activeTheme={activeTheme} onThemeApplied={applyResolvedTheme} />
   </PiwinUiProvider>
   ```

5. In `apps/desktop/src/main.tsx`, retain only the pre-paint call to `applyAppearanceToDocument(PIWIN_APPEARANCE_DARK)` and replace the current static provider/App tree with `<DesktopThemeRoot />`.
6. Do not create a global store, context for host data, or second provider. The root owns presentation theme state only.

**Gate:** changing the root theme prop rerenders Mantine using the same `ThemeManifest` whose token projection is applied to `document.documentElement`.

#### Step 3: Remove duplicate theme state and direct document writes

1. In `apps/desktop/src/hooks/use-host-bootstrap.ts`:
   - add `onThemeResolved: (theme: ThemeManifest) => void` to `UseHostBootstrapArgs`;
   - replace the inline built-in/custom merge with `resolveDesktopAppearance(themeData.theme)`;
   - call `args.onThemeResolved(resolvedTheme)` on successful `theme/get-active`;
   - call `args.onThemeResolved(PIWIN_APPEARANCE_DARK)` on failure;
   - remove imports of `applyThemeToDocument` and any local document-theme mutation;
   - remove `activeTheme`, `setActiveTheme`, `artifactThemeKey`, and `setArtifactThemeKey` from this hook's state and returned object.

2. In `apps/desktop/src/App.tsx`:
   - change the component signature to accept `activeTheme` and `onThemeApplied` props from `DesktopThemeRoot`;
   - remove the `activeTheme`, `setActiveTheme`, `artifactThemeKey`, and `setArtifactThemeKey` destructuring from `useHostBootstrap`;
   - pass `onThemeApplied` into `useHostBootstrap` as `onThemeResolved`;
   - retain an App-local `artifactThemeKey` only if it is required to remount the artifact iframe. If retained, increment it in an effect keyed by `activeTheme` rather than in each theme entry callback;
   - replace `handleToggleAppearance()`'s duplicated manifest merge, `setActiveTheme`, and `applyThemeToDocument` calls with: host `theme/set-active` -> `onThemeApplied(response theme)`;
   - replace the Settings `onThemeApplied` inline callback with `onThemeApplied` directly;
   - keep `activeTheme` flowing into `ChatThread`/artifact mapping as a prop.

3. In `apps/desktop/src/ThemePanel.tsx`:
   - remove the exported `applyThemeToDocument()` wrapper after its remaining call sites are removed;
   - keep `ThemePanel` limited to host request + `props.onApplied(theme)`; it must not resolve or apply document CSS itself.

4. Use one manual source audit before moving on:

   ```bash
   rg 'applyThemeToDocument|applyAppearanceToDocument' apps/desktop/src
   ```

   Expected production callers after the refactor:
   - `main.tsx`: pre-paint built-in dark only;
   - `desktop-theme-root.tsx`: active runtime projection;
   - tests only elsewhere.

**Gate:** bootstrap, titlebar toggle, and Settings Appearance all pass their manifest through the same root callback; no hook, panel, or feature component directly mutates document theme state.

#### Step 4: Make the provider contract explicit and repair every test mount

1. In `packages/ui-kit/src/piwin-ui-provider.tsx`, make `PiwinUiProviderProps.manifest` required and delete its implicit old dark/Outfit fallback.
2. Ensure `PiwinUiProvider` derives the Mantine theme using `useMemo(() => buildMantineTheme(manifest), [manifest])`; do not cache a theme outside the prop dependency.
3. Create a local ui-kit test manifest helper, for example `packages/ui-kit/src/test-theme-fixtures.ts`, for ui-kit-only tests. It may import `ThemeManifest` from contracts but must not import `apps/desktop/**`.
4. Update all current desktop test mounts to provide a manifest. The implementation checkpoint must at least audit and update:

   ```text
   apps/desktop/src/chat-thread.test.tsx
   apps/desktop/src/composer-plus-menu.test.tsx
   apps/desktop/src/context-bar.test.tsx
   apps/desktop/src/context-usage-ring.test.tsx
   apps/desktop/src/ThinkingEffortControl.test.tsx
   apps/desktop/src/right-panel.test.tsx
   apps/desktop/src/settings/settings-shell.test.tsx
   apps/desktop/src/main.tsx
   ```

   Desktop tests may import `PIWIN_APPEARANCE_DARK` from `appearance-tokens.ts`; ui-kit tests must use their local fixture.
5. Add a ui-kit test that rerenders `PiwinUiProvider` from dark to light and asserts the derived Mantine theme values exposed to a test consumer change. Do not test private Mantine class hashes.
6. Extend `apps/desktop/src/hooks/use-host-bootstrap.test.ts` to prove `theme/get-active` invokes `onThemeResolved` with a resolved manifest and does not call `applyAppearanceToDocument`. If unit testing the full hook is too coupled to the HostClient stream, extract only the theme-response normalization into a named pure helper and test that helper.
7. Add `apps/desktop/src/desktop-theme-root.test.tsx` to prove the root writes `data-theme-id`, `data-theme-mode`, and the expected document token after its callback receives `PIWIN_APPEARANCE_LIGHT`.

**Gate:** typecheck passes after every provider mount supplies a manifest, and a rerender proves Mantine colors/font derive from the new prop.

#### Step 5: Add deterministic browser fixtures after real theme wiring exists

1. Add a desktop-owned gallery component at `apps/desktop/src/e2e/primitive-gallery.tsx`. It imports primitives only from `@piwin/ui-kit`.
2. Add a build-time route guard in the desktop entry/root that renders this gallery only when `import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true'` and the path is the explicit E2E fixture path. Do not add it to product navigation.
3. Set `VITE_PIWIN_E2E_FIXTURES=true` in the Playwright `webServer.command` in `apps/desktop/playwright.config.ts`; do not put it in a checked-in default environment file.
4. The gallery may include deterministic dark/light controls, but each control must call the same `DesktopThemeRoot` callback passed to product `App`. It must not mutate document style/dataset, call `applyAppearanceToDocument`, or mount another `PiwinUiProvider`.
5. Render the following exact minimum state matrix using public ui-kit primitives:
   - Button: primary, secondary, ghost, danger, disabled;
   - IconButton: default, `aria-pressed`, disabled, a programmatically focused control for the focus-visible screenshot;
   - Field: text input, invalid input, disabled input, select;
   - Field checkbox: unchecked, checked, disabled;
   - ListRow: default and selected;
   - Surface: base, inset, raised, selected;
   - StatusBadge: neutral, running, success, warning, danger;
   - one ui-kit menu/popover/dialog portal opened by a user-visible trigger.
6. Add Playwright tests in `visual-regression.spec.ts` for gallery dark, gallery light, and light portal. Add a separate real product test that opens Settings -> Appearance, applies `piwin-light`, asserts document theme identity, then screenshots the Appearance page.
7. For the dark-to-light assertion, compare a document CSS value (for example the root `--canvas`) and a computed style of a public Mantine-backed `Button`/`IconButton`; do not assert Mantine-generated class names.

**Gate:** gallery tests prove provider and document changes together, while Settings -> Appearance proves the gallery did not bypass product wiring.

#### Step 6: Transfer only generic primitive styles, then capture final images

1. Create `packages/ui-kit/src/primitives.css` and export it as `@piwin/ui-kit/styles.css` through `packages/ui-kit/package.json`.
2. Import it once from `apps/desktop/src/styles.css` after desktop token definitions and before desktop region styles. This order ensures desktop provides variables before primitive selectors consume them.
3. Move generic styles from `apps/desktop/src/styles/ui-foundations.css` into ui-kit CSS in this order:
   - Button and IconButton;
   - Field and FieldCheckbox;
   - ListRow and Surface;
   - StatusBadge, Notice, Spinner, Tabs;
   - generic Menu, Dialog, Popover surfaces.
4. Preserve a region selector only when it begins with a region parent and changes placement/dimensions rather than generic default/hover/focus/disabled state. Examples that may remain after review include `.workspace-titlebar .piwin-icon-button`, `.right-panel-section-row`, and `.thinking-effort-popover`.
5. For each moved primitive, first update or add its unit test, then run the gallery screenshot test in dark and light before moving the next group.
6. Do not migrate raw `.btn`/`.icon-btn` broadly. Convert only repeated P0-shell consumers after a generic ui-kit primitive is available; list every remaining specialized raw control in the PR/implementation note.
7. Generate final snapshots only after all CSS movement is complete. Ensure snapshot paths are visible to Git and review tooling, then rerun without update flags from a clean worktree.

**Gate:** desktop CSS has no generic ui-kit primitive state rules; remaining region selectors are layout refinements, and every baseline image is reviewed and clean-checkout-resolvable.

### P0-A: Baseline inventory and deterministic capture contract

**Goal:** establish what is actually committed and make screenshot execution reproducible before changing theme or CSS behavior.

**Files to inspect/change**

- `apps/desktop/e2e/visual-regression.spec.ts`
- `apps/desktop/e2e/README.md`
- `apps/desktop/playwright.config.ts`
- root and app `.gitignore` files, plus `.cursorignore`, if snapshot tracking or agent review visibility requires an intentional change
- expected Playwright `*-snapshots/` directory

**Implementation steps**

1. Run the current visual suite without `--update-snapshots`.
2. Determine whether expected images are missing, ignored, or intentionally supplied elsewhere. Record the outcome in the README.
3. Check whether `.cursorignore` excludes the expected snapshot directory. If the repository policy is to review and track visual baselines, add a narrow visibility exception for the desktop visual baseline path so future agents and reviewers can inspect expected images.
4. Establish the capture contract:
   - canonical environment: macOS (`darwin`) with the Playwright Chromium revision locked by the repository lockfile;
   - browser project: a named desktop Chromium project if one is added, otherwise the documented default Chromium project;
   - viewport: each test declares its exact viewport;
   - `colorScheme: 'dark'`, `reducedMotion: 'reduce'`, `deviceScaleFactor: 1`, and viewport defaults are set in Playwright `use` or per-test `test.use()` **before** `page.goto()`;
   - remove post-navigation `page.emulateMedia({ reducedMotion: 'reduce' })` from shared helpers except in tests that explicitly verify media changes;
   - if light screenshots override the color scheme, do so through `test.use({ colorScheme: 'light' })` or a separate `describe` block before navigation, not by post-navigation emulation;
   - system font stack is part of the macOS capture contract;
   - Vite browser tests use the in-browser mock host, not Tauri/sidecar IPC.
5. Document the mock fixture contract for synthetic `/tmp/piwin-e2e-*` paths: they are browser-mock inputs, not proof that native directory selection works.
6. Keep only narrow masks for volatile host/transport/usage text. Do not mask shell controls, primitive fixtures, or theme surfaces.
7. Keep `maxDiffPixelRatio: 0.02` unchanged for the first stable run. Tighten it only after measuring stable clean reruns; never loosen it to accept intentional or unexplained visual drift.
8. Rename the current `streaming reply` test to `completed reply`, because it waits for completion. Do not add a streaming screenshot in this P0 slice.

**Baseline protocol to add to `apps/desktop/e2e/README.md`**

For every screenshot test, document:

```text
test name -> fixture state -> expected snapshot name -> intentional visual reason -> approval reviewer
```

Document the exact update command:

```bash
pnpm --filter @piwin/desktop e2e -- visual-regression.spec.ts --update-snapshots
```

Only run it after manual review. Commit the generated platform/browser-specific snapshot files when the repository policy is to track them.

**Exit gate**

- Existing screenshot assets either resolve in a clean checkout or the suite is explicitly documented as not yet a final regression gate until P0-E recaptures approved baselines.
- Visual test configuration fixes viewport/DPR/media preferences before the application navigates.
- No snapshot has been accepted merely by changing tolerance or mask scope.

---

### P0-B: Add focused theme and primitive regression fixtures

**Goal:** create test evidence that fails if CSS and Mantine projections diverge, without coupling a visual test to host, reducer, or product-only side effects.

**Files**

- `apps/desktop/e2e/visual-regression.spec.ts`
- `apps/desktop/playwright.config.ts`
- `apps/desktop/e2e/README.md`
- new desktop-owned test fixture component, for example `apps/desktop/src/e2e/primitive-gallery.tsx`
- new or existing test-only route gate in the desktop entrypoint
- existing settings/appearance components only when a stable public testid is missing

**Fixture design**

Create a desktop-owned primitive gallery rendered exclusively through public `@piwin/ui-kit` exports. It must not import ui-kit internals or desktop domain state. It must include the following deterministic matrix:

| Primitive | Required visible states |
|---|---|
| `Button` | primary, secondary, ghost, danger, disabled |
| `IconButton` | default, pressed, disabled, keyboard focus-visible |
| `Field` | default, disabled, invalid, select control |
| Checkbox/switch primitive | unchecked, checked, disabled, focus-visible |
| `ListRow` / `Surface` | default, selected, quiet surface vs overlay surface |
| `StatusBadge` | neutral, running, success, warning, danger |
| Menu/dialog/popover | one open portal state using the current theme |

The route must be gated behind a build-time E2E flag, such as `VITE_PIWIN_E2E_FIXTURES=true`, supplied only by the Playwright Vite server configuration. Production builds must not expose the route. It is a test harness, not a product navigation feature.

The fixture route may accept a query parameter or render a local control for `piwin-dark` / `piwin-light` only if it flows through `DesktopThemeRoot`'s public in-tree application callback. It must not call `applyAppearanceToDocument()` directly, mutate `document.documentElement`, or mount a second `PiwinUiProvider`.

**Tests to add**

1. **Dark primitive gallery screenshot** at a fixed desktop viewport.
2. **Light primitive gallery screenshot** after applying `piwin-light` through the same root theme application path used by the product.
3. **Dark-to-light integration assertion** that verifies:
   - `html[data-theme-id="piwin-light"]` and `html[data-theme-mode="light"]`;
   - one document-CSS primitive has a changed computed foreground/background value;
   - one Mantine-backed public primitive has changed theme-derived output;
   - an open menu/dialog/popover uses the light theme surface and text colors.
4. **Real shell light screenshot** that opens Settings -> Appearance, applies `piwin-light` through the visible product control, then captures either the Appearance page or returns to General after asserting `html[data-theme-id="piwin-light"]`. This prevents the gallery from becoming the only proof that product wiring works.

Prefer computed style values and public testids/roles. Do not assert private Mantine-generated class names.

**Exit gate**

- The test suite has an intentional dark and light coverage path.
- The integration assertion can distinguish document CSS updates from Mantine updates.
- No test-only document-token mutation or provider bypass exists. The E2E-only fixture route may expose deterministic controls for selecting built-in dark/light themes, but those controls must call the same `DesktopThemeRoot` theme application callback used by Settings and product chrome.

---

### P0-C: Move the active theme owner above the provider

**Goal:** make the React tree, document CSS, and artifacts consume one resolved active manifest.

**Files**

- new `apps/desktop/src/desktop-theme-root.tsx` (name may vary)
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/hooks/use-host-bootstrap.ts`
- relevant App/theme tests
- `packages/ui-kit/src/piwin-ui-provider.tsx`
- `packages/ui-kit/src/piwin-ui-provider.test.ts`

**Implementation steps**

1. Create `DesktopThemeRoot` as a presentation-only component.
   - Initial state is `PIWIN_APPEARANCE_DARK`.
   - It renders:

     ```tsx
     <PiwinUiProvider manifest={activeTheme}>
       <App activeTheme={activeTheme} onThemeApplied={applyResolvedTheme} />
     </PiwinUiProvider>
     ```

   - `applyResolvedTheme(theme)` must:
     1. call `resolveDesktopAppearance(theme)`;
     2. call `applyAppearanceToDocument(resolvedTheme)`;
     3. store the same `resolvedTheme` in React state.

2. Preserve `main.tsx` pre-paint application of the built-in dark manifest, then render `DesktopThemeRoot` instead of mounting a static provider around `App`.
3. Refactor `useHostBootstrap` so it no longer owns or applies theme presentation state.
   - Add an argument such as `onThemeResolved: (theme: ThemeManifest) => void`.
   - On `theme/get-active` success, resolve the manifest exactly as today, then call `onThemeResolved(nextTheme)`.
   - On `theme/get-active` failure, call `onThemeResolved(PIWIN_APPEARANCE_DARK)`.
   - Remove `activeTheme`, `setActiveTheme`, `artifactThemeKey`, and `setArtifactThemeKey` from this hook unless a separate non-presentation reason remains.
   - Do not call `applyThemeToDocument()` or `applyAppearanceToDocument()` from `useHostBootstrap`.
4. Refactor `App` to receive `activeTheme` and `onThemeApplied` props.
   - Replace direct document appearance calls and duplicate `activeTheme` state with this callback/prop pair.
   - Pass `onThemeApplied` into `useHostBootstrap` as the bootstrap theme callback.
   - Replace Settings, titlebar dark/light toggle, and any other product theme entry with the same `onThemeApplied` path.
   - Continue using `activeTheme` as the input to artifact theme mapping.
   - Keep artifact refresh state either in `DesktopThemeRoot` or derive it from `activeTheme.id` plus an explicit refresh counter owned beside the theme owner.
   - Do not move host bootstrap, config requests, or session state into the root component.
5. Make `PiwinUiProviderProps.manifest` required.
   - There must be no stale hidden dark fallback in the provider.
   - Add a ui-kit-local test fixture, for example `packages/ui-kit/src/test-theme-fixtures.ts` or colocated test-only constants, containing minimal `ThemeManifest` values.
   - Desktop tests may import desktop `PIWIN_APPEARANCE_DARK` / `PIWIN_APPEARANCE_LIGHT`; ui-kit tests must not import `apps/desktop/src/appearance-tokens.ts`.
   - Search for every `<PiwinUiProvider` mount and update it in the same package checkpoint.
6. Update ui-kit local test fixtures to reflect Quiet Workbench values when their test purpose is product palette behavior. For generic derivation tests, use clearly named local manifest fixtures and test only contract invariants.
7. Retain fixed Mantine interpolation steps only where they are deliberate product rendering choices. Document them in `piwin-ui-provider.tsx`; do not expand `ThemeManifest` merely to eliminate derived scale values.
8. Remove `ThemePanel.applyThemeToDocument` if no production caller remains after the root refactor. If retained temporarily for compatibility, mark it deprecated in a comment and add an audit that no Settings/product component calls it directly; only `DesktopThemeRoot` may call `applyAppearanceToDocument` at runtime.

**Required tests**

- `PiwinUiProvider` rerenders its Mantine theme when its required `manifest` prop changes.
- `DesktopThemeRoot` applies the resolved manifest to the document and passes the same manifest to the rendered provider/App boundary.
- Bootstrap theme recovery calls the root theme application callback and does not directly mutate document CSS from `useHostBootstrap`.
- The titlebar dark/light toggle and Settings Appearance flow both use the same root `onThemeApplied` path.
- Existing `appearance-tokens.test.ts` remains the document-token inventory test; only update it if a semantic token actually changes.
- Existing artifact theme map tests continue to prove artifact overrides are mapped from the active manifest, not document CSS.

**Exit gate**

- No production `PiwinUiProvider` mount uses an implicit or stale fallback manifest.
- A dark-to-light change updates both CSS marker/token output and Mantine visual output.
- Manual audit confirms every `<PiwinUiProvider>` mount supplies `manifest`.
- No contract, host, reducer, session, or CLI file is touched.

---

### P0-D: Transfer shared primitive styles into ui-kit

**Goal:** give shared primitives one portable visual contract and remove generic state styling from desktop foundations.

**Files**

- new `packages/ui-kit/src/primitives.css`
- `packages/ui-kit/package.json`
- `packages/ui-kit/src/index.ts` should not export CSS from TypeScript; document the CSS public subpath in package exports/README or package comments instead
- `packages/ui-kit/src/button.tsx`
- `packages/ui-kit/src/icon-button.tsx`
- `packages/ui-kit/src/field.tsx`
- `packages/ui-kit/src/list-row.tsx`
- `packages/ui-kit/src/surface.tsx`
- `packages/ui-kit/src/status-badge.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/styles/ui-foundations.css`
- `apps/desktop/src/styles/region-overlays.css`
- relevant desktop region CSS only for documented regional refinements

**Implementation steps**

1. Inventory all generic selectors currently in desktop `ui-foundations.css` that target a ui-kit class. Categorize each as:
   - primitive structural/default-state styling -> move to `primitives.css`;
   - token value / alias -> remains desktop appearance projection;
   - desktop shell layout -> remains desktop;
   - legacy raw native class -> migrate or explicitly defer.
2. Export `./styles.css` from `@piwin/ui-kit` and import that public subpath exactly once from desktop's style entrypoint.
3. Move the primitive contract into ui-kit CSS using semantic variables only:
   - `Button`: primary, secondary, ghost, danger, hover, disabled, focus-visible;
   - `IconButton`: ghost default, pressed, disabled, focus-visible, `--icon-size-*` geometry;
   - `Field`: label, description, invalid, control focus, disabled;
   - `ListRow` and `Surface`: quiet default and selected/overlay distinctions;
   - `StatusBadge`: semantic dot/text tones;
   - `Notice`, `Spinner`, `Tabs`, `Menu`, `Dialog`, and `Popover`: generic surface, focus, state, and portal appearance.
4. Keep Mantine's behavior wrappers, but override only through ui-kit-owned primitive classes. Do not depend on private Mantine selector names or generated hashes.
5. Remove duplicate generic primitive rules from desktop `ui-foundations.css` after the ui-kit style entry is imported. Leave desktop-only aliases temporarily only when a known raw consumer still needs them.
6. Migrate repeated raw `.btn` and `.icon-btn` use in P0 paths only:
   - titlebar;
   - sidebar;
   - composer;
   - context/status controls;
   - right-panel directory;
   - Appearance/settings primary actions.

   Preserve testids, button types, keyboard behavior, labels, and domain callbacks. Record low-frequency specialized panel controls as post-P0 debt rather than forcing a broad rewrite.
7. Restrict `region-overlays.css` to shell layering and placement. Generic dialog/menu/popover appearance belongs to ui-kit; desktop may set overlay z-layer variables and region-specific dimensions only.
8. Do not add `!important`. If a Mantine default cannot be overridden with an owned public class and normal cascade, improve the ui-kit wrapper contract instead of escalating specificity indefinitely.

**Required checks for every migrated primitive**

- default, hover, pressed/selected, disabled, and focus-visible states;
- dark and light themes;
- Enter/Space activation and Tab reachability;
- menu/dialog/popover escape and return-focus behavior where relevant;
- no regression in existing component testids.

**Exit gate**

- The primitive gallery's dark/light screenshots use ui-kit structural CSS, not desktop generic overrides.
- Desktop CSS contains no generic ui-kit default-state rules for `.piwin-*` or `.ui-*` primitives, including buttons, icon buttons, fields, list rows, surfaces, status badges, notice/spinner/tabs, and menu/dialog/popover surfaces. Remaining desktop selectors using these classes must be documented region refinements with a more specific regional parent selector.
- Any remaining legacy `.btn` / `.icon-btn` consumer is documented as a specialized non-P0 control.
- No `@mantine/*` import exists under `apps/desktop/src/**`; Mantine remains encapsulated by `@piwin/ui-kit`.

---

### P0-E: Capture, review, and verify final baselines

**Goal:** turn the new fixtures into an approved regression gate and prove the architectural boundaries remain intact.

**Baseline set**

Capture only stable P0 evidence:

| Screenshot | Theme | Purpose |
|---|---|---|
| Empty shell | dark | Quiet Workbench core chrome |
| Trusted workspace / completed reply | dark | project/chat composition; not streaming |
| Settings general | dark | real product ui-kit controls |
| Settings Appearance after light apply | light | real Settings Appearance flow and provider/document convergence |
| Primitive gallery | dark | shared primitive state matrix |
| Primitive gallery | light | theme/provider convergence |
| Open primitive portal | light | portal surface and focus contract |
| Narrow shell | dark | compact/sidebar regression smoke |
| Existing stable right-panel/menu state | dark | retain only if already deterministic |

The previous eight assertions may remain where they are deterministic. Remove or defer only cases that cannot be given a fixed mock state; do not retain misleading state names.

**Capture procedure**

1. Run all targeted tests without snapshot update.
2. Resolve test/data/environment instability before accepting any image.
3. Run the documented update command only on the canonical macOS Chromium environment.
4. Inspect every diff against the v2.3 prototype and the expected P0 change.
5. Commit intended snapshot images with the matching test and README reason.
6. Run the visual suite again from a clean worktree without update flags.

**Per-checkpoint minimum**

```bash
pnpm --filter @piwin/ui-kit typecheck
pnpm --filter @piwin/ui-kit test
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/desktop e2e -- visual-regression.spec.ts
```

**Final full sweep**

```bash
pnpm --filter @piwin/desktop build
pnpm e2e:desktop
pnpm typecheck
pnpm test
```

`@piwin/ui-kit test` currently uses `--passWithNoTests`; if no meaningful tests exist for the changed primitive/provider behavior, add focused tests rather than treating a no-test pass as evidence.

Run the existing native Tauri smoke separately when available. Browser screenshots do **not** prove titlebar dragging, native traffic lights, file picker behavior, sidecar transport, or native platform rendering.

**Changed-path and import audit**

Before completion, inspect the final diff and verify that it does not touch:

```text
packages/agent-host/**
packages/contracts/**
apps/desktop/src/chat-reducer.ts
apps/desktop/src/host-client.ts
apps/desktop/src/host-request-adapters.ts
apps/desktop/src/stream-event-buffer.ts
apps/desktop/src/shell-layout.ts
apps/cli/**
```

Do not change `shell-layout.ts` breakpoints, overlay enums, or `data-layout` authority. Any `apps/desktop/src/hooks/use-shell-layout.ts` diff must be reviewed as layout behavior, not styling.

Any required exception needs explicit user approval and a separate design decision.

Also run a targeted import audit:

```bash
rg '@earendil-works/pi-' apps/desktop packages/ui-kit
rg '@mantine/' apps/desktop/src
rg 'applyThemeToDocument|applyAppearanceToDocument' apps/desktop/src
```

Expected results:

- no Pi package matches under desktop or ui-kit;
- no Mantine imports under desktop source;
- `main.tsx` may call `applyAppearanceToDocument(PIWIN_APPEARANCE_DARK)` for pre-paint only;
- `DesktopThemeRoot` may call `applyAppearanceToDocument` for active runtime projection;
- other production callers should not directly apply document theme state.

Also verify generated snapshot files are visible to repository review tooling, not only present on disk.

**Exit gate**

- Expected images are committed and resolve in a clean checkout.
- Dark/light theme convergence is covered by unit, integration, and browser tests.
- `pnpm typecheck`, targeted tests, desktop build, and desktop E2E all pass.
- Native Tauri smoke status is recorded separately rather than inferred from browser screenshots.
- The changed-path/import audit proves host and chat reducer boundaries were preserved.

---

## 4. Acceptance criteria

### 4.1 Visual

- [ ] Dark and light shells keep a unified, quiet graphite/light field rather than reverting to boxed component-library chrome.
- [ ] Composer remains the only normal raised shell surface.
- [ ] Button, IconButton, Field, ListRow, Surface, StatusBadge, and one portal share the active theme.
- [ ] Default icon buttons are ghost; hover, pressed, disabled, and keyboard focus-visible states are distinguishable.
- [ ] No generic shell border produces a visible "box inside a box" effect.
- [ ] No new `!important` is introduced.

### 4.2 Theme

- [ ] `html[data-theme-id]` and `html[data-theme-mode]` reflect the selected resolved theme.
- [ ] Document variables and `PiwinUiProvider` use the same resolved `ThemeManifest` after every theme change.
- [ ] Mantine-backed controls change with dark/light themes.
- [ ] Artifact iframe mapping remains manifest-based and honors artifact overrides.
- [ ] Theme packages cannot alter geometry, motion, or layout tokens.

### 4.3 Accessibility and behavior

- [ ] Changed primitives remain reachable by keyboard and expose visible focus.
- [ ] Disabled controls do not receive active hover styling or become interactive.
- [ ] Dialog/menu/popover keyboard close and focus-return behavior remains intact.
- [ ] `prefers-reduced-motion: reduce` still disables transition/shimmer/pulse movement.
- [ ] No right-panel, composer, transcript, session, host, or reducer behavior has changed.

### 4.4 Engineering boundary

- [ ] ui-kit imports no desktop, host, Tauri, Node, filesystem, or Pi modules.
- [ ] desktop imports ui-kit styles through a declared public package subpath only.
- [ ] no `@earendil-works/pi-*` import exists under `apps/desktop` or `packages/ui-kit`.
- [ ] no host/reducer/contracts/CLI paths are in the final diff.

---

## 5. Risks and response rules

| Risk | Response |
|---|---|
| Snapshot assets are intentionally untracked | Make that policy explicit and do not call the suite a clean-checkout regression gate; prefer committing assets for this product UI suite. |
| System-font antialiasing creates image noise | Capture only on canonical macOS Chromium; first eliminate nondeterminism, then evaluate whether the existing 2% threshold can be narrowed. |
| Theme root refactor makes `App` larger or moves host logic upward | `DesktopThemeRoot` owns only manifest state and document projection. Do not move host/session bootstrap. |
| ui-kit stylesheet delivery fails through workspace exports | Add an explicit exported stylesheet subpath and test the desktop build before removing desktop rules. Do not deep-import source CSS. |
| Mantine defaults resist normal CSS overrides | Add a stable ui-kit class/prop contract or adjust wrapper markup. Do not use private generated selectors or `!important`. |
| Primitive migration expands into a broad panel rewrite | Stop after documented P0 paths and log specialized low-frequency controls as later debt. |
| A deterministic streaming fixture needs reducer changes | Exclude streaming from this plan; retain completed-reply coverage only. |
| Required work touches forbidden paths | Stop, isolate the requirement, and prepare a separate plan/ADR for approval. |

---

## 6. Definition of done

This P0 convergence slice is done only when all of the following are true:

1. The screenshot suite has a documented canonical environment and committed, clean-checkout-resolvable baselines.
2. The suite covers real shell dark/light application, a deterministic shared primitive matrix, and at least one portal.
3. `DesktopThemeRoot` is the sole React owner of the resolved active manifest; document CSS, Mantine, and artifacts are projections of it.
4. ui-kit owns shared primitive structural state styling through its public package stylesheet; desktop owns token values and region layout only.
5. The targeted typecheck, tests, build, E2E suite, changed-path audit, and Pi-import audit pass.
6. The final diff leaves host, contracts, chat reducer, transport, persistence, shell-layout authority, and CLI untouched.

No ADR is required for this plan because it preserves the existing architecture: `ThemeManifest` remains the contract, ui-kit remains renderer-only, and desktop remains the presentation owner. An ADR becomes required only if the team decides to change the theme contract, layout authority, or desktop/ui-kit dependency direction.
