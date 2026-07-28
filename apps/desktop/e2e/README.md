# Desktop UI e2e (Playwright)

Local-first browser e2e for the Agent Window shell.

## What this covers

| Layer | Reality |
|-------|---------|
| UI | React Vite app (`pnpm dev:desktop`) |
| Host | In-browser `HostClient` **mock** transport |
| Not covered yet | Tauri native window + `host serve` sidecar (true live IPC) |

Scenarios (D-M2-05b local slice):

1. Shell loads, host ready, `tx:mock`
2. Settings open/close
3. Open project → trust → new session in list
4. Mock chat round-trip
5. Visual regression baselines (see below)

## Run (from monorepo root)

```bash
# one-time browser binary
pnpm --dir apps/desktop e2e:install

# all desktop e2e
pnpm e2e:desktop

# headed / UI mode
pnpm --dir apps/desktop e2e:headed
pnpm --dir apps/desktop e2e:ui
```

Playwright starts Vite on port `1420` unless already running (`reuseExistingServer` outside CI).

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `PIWIN_E2E_PORT` | `1420` | Vite port |
| `PIWIN_E2E_BASE_URL` | `http://127.0.0.1:1420` | baseURL |
| `VITE_PIWIN_E2E_FIXTURES` | set by Playwright `webServer` | enables the `#/e2e/primitives` fixture route |

## Visual regression baselines

### Baseline state (audited 2026-07-27)

**Tracked baseline.** All expected snapshot images under
`e2e/visual-regression.spec.ts-snapshots/` are committed to Git and the suite
passes from a clean checkout without `--update-snapshots`. `.cursorignore`
carries a narrow `!apps/desktop/e2e/visual-regression.spec.ts-snapshots/*.png`
exception so agents and review tooling can inspect expected images.

### Capture contract

- Canonical environment: macOS (`darwin`) with the Playwright Chromium
  revision locked by the repository lockfile (`Desktop Chrome` project).
- `colorScheme: 'dark'`, `reducedMotion: 'reduce'`, and `deviceScaleFactor: 1`
  are set in Playwright `use` (pre-navigation). Light-theme captures switch
  theme through the product/root theme path in-page, never through
  post-navigation `page.emulateMedia()`.
- Every test declares its exact viewport before interacting with the shell.
- The system font stack is part of the macOS capture contract; captures on
  other platforms are not comparable.
- Vite browser tests use the in-browser mock host, not Tauri/sidecar IPC.
  Synthetic `/tmp/piwin-e2e-*` project paths are browser-mock inputs only —
  they are not proof that native directory selection works.
- Masks are limited to volatile host/transport/usage text. Shell controls,
  primitive fixtures, and theme surfaces are never masked.
- `maxDiffPixelRatio: 0.02` is the accepted noise ceiling. Never loosen it to
  absorb intentional or unexplained drift; tighten only after measuring
  stable clean reruns.

### Baseline inventory

| Test name | Fixture state | Expected snapshot | Intentional visual reason | Approval reviewer |
|---|---|---|---|---|
| `empty shell @1280` | mock host ready, no project | `empty-shell-1280-darwin.png` | Quiet Workbench core chrome | repo owner |
| `trusted empty workspace @1280` | trusted mock project, empty chat | `trusted-workspace-1280-darwin.png` | project/chat composition | repo owner |
| `completed reply @1280` | mock run settled (not streaming) | `chat-complete-1280-darwin.png` | completed-reply transcript | repo owner |
| `settings general @1280` | settings panel open | `settings-general-1280-darwin.png` | real product ui-kit controls | repo owner |
| `narrow shell @800` | compact layout, sidebar open | `narrow-sessions-open-800-darwin.png` | compact/sidebar smoke | repo owner |
| `compact inspector @820` | right panel detail view | `compact-inspector-820-darwin.png` | compact inspector layout | repo owner |
| `compact settings @820` | compact settings panel | `compact-settings-820-darwin.png` | compact settings layout | repo owner |
| `session menu over inspector @1280` | session row menu portal open | `session-menu-over-inspector-1280-darwin.png` | overlay stacking contract | repo owner |
| `primitive gallery dark @1280` | E2E fixture route, dark | `primitive-gallery-dark-1280-darwin.png` | shared primitive state matrix | repo owner |
| `primitive gallery light @1280` | E2E fixture route, light applied via root callback | `primitive-gallery-light-1280-darwin.png` | theme/provider convergence | repo owner |
| `primitive portal light @1280` | gallery menu portal open, light | `primitive-portal-light-1280-darwin.png` | portal surface + focus contract | repo owner |
| `settings appearance light @1280` | Settings → Appearance after `piwin-light` apply | `settings-appearance-light-1280-darwin.png` | real product theme flow | repo owner |

### Updating baselines

Only after manually reviewing the diff on the canonical macOS environment:

```bash
pnpm --filter @piwin/desktop e2e -- visual-regression.spec.ts --update-snapshots
```

Commit the regenerated platform-specific (`*-darwin.png`) snapshot files with
the matching test and the README reason above. Then rerun without update
flags to confirm a clean pass.

## Later

- Tauri WebDriver / `tauri-driver` for live host path
- Optional CI job (keep host `pnpm e2e:smoke` as primary gate until UI e2e is stable)
