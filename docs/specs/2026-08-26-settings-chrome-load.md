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
| `lazy_load.ts` | `settings/pages/lazy-load.ts` — permissions, models, agent, extensions, web, knowledge, session, cold-storage, usage, archive |
| `ensureLazyLoaded()` | `ensureSettingsLazyLoaded()` |
| idle-load Advanced after Basic | `requestIdleCallback` inside SettingsShell after mount |
| warm likely next document | workbench idle + settings-button `pointerenter`/`focus` prefetch `SettingsPanel` |

Companion (Pet) stays a General tab but is a subpage-class surface: dynamic `import('../../PetPanel')` only when that tab is selected.

## Non-goals

- Separate Tauri settings window
- Putting the settings shell into the desktop cold-start main entry
- Keeping the settings React tree mounted while closed
