# Settings first-open: Chrome-style two-bundle load

Status: implementing
Date: 2026-08-26

## Goal

First click on 【设置】 should paint the settings chrome (nav + General) without compiling MCP / models / knowledge / artifact playground. Match Chromium Settings: a **basic** bundle for the first paint, a **lazy_load** bundle for everything else, warmed on idle and pointer intent.

## Model (from Chromium)

Chromium Settings uses:

- Main entry: shell + Basic pages
- `lazy_load.ts`: Advanced pages and all subpages
- Historical `settings-idle-load`: `requestIdleCallback` after Basic paints so Advanced is already in memory when expanded (bug 681238)
- `ensureLazyLoaded()` when navigating to a subpage that lives in the lazy bundle

It does **not** keep `chrome://settings` mounted after the tab closes. The browser module cache makes the next open cheap. Piwin matches that: `React.lazy` already caches `SettingsPanel`; closing settings still unmounts the overlay (e2e asserts `settings-panel` count 0).

## Mapping

| Chromium | Piwin |
|----------|--------|
| Settings shell + Basic | `SettingsPanel` + `SettingsShell` + `GeneralPage` (appearance / language / shortcuts) |
| `lazy_load.ts` | `settings/pages/lazy-load.ts` — permissions, models, agent, extensions, web, code-search, knowledge, session, cold-storage, usage, archive |
| `ensureLazyLoaded()` | `ensureSettingsLazyLoaded()` |
| idle-load Advanced after Basic | `requestIdleCallback` inside SettingsShell after mount |
| warm likely next document | workbench idle + settings-button `pointerenter`/`focus` prefetch `SettingsPanel` |

Companion (Pet) stays a General tab but is a subpage-class surface: dynamic `import('../../PetPanel')` only when that tab is selected.

## Load failure

The lazy bundle is one dynamic import; any page inside it can fail the whole
import. Two behaviors make that survivable and visible:

- A rejected import is **not** cached. `ensureSettingsLazyLoaded()` clears the
  slot before rethrowing, so a later attempt re-imports instead of replaying the
  same failure (the section would otherwise never register).
- The shell renders an error notice with the section name, the underlying
  message, and a **retry** action (`settings-section-load-error`) rather than an
  endless *"loading this settings page"* spinner. A stuck spinner is
  indistinguishable from a nav entry that was never wired to a page.

Covered by `settings-lazy-load.test.ts` (retry after failure) and
`settings-shell-lazy-load-error.test.tsx` (visible failure + retry).

## Non-goals

- Separate Tauri settings window
- Putting the settings shell into the desktop cold-start main entry
- Keeping the settings React tree mounted while closed
