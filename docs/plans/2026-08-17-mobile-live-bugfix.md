# Mobile live-test bugfix (2026-08-17)

Status: implementing  
Related: ADR 0037, [iOS mobile shell execution plan](./ios-mobile-shell-execution-plan.md)

## Goal

Fix the defects reproduced against a real Host (`~/.piwin`, `ws://127.0.0.1:8787`) without giving the mobile shell Host filesystem paths or provider secrets.

## Non-goals

- Real pairing / Keychain / Tailscale QR issuance (still P0 of the mobile plan, separate slice).
- `config/get` or `settings/get` on the remote allowlist.
- Inbox / Artifact / steer / follow-up product surfaces.

## Fixes

### 1. Model pill and picker follow Host config

- New Host command `models/configured`: enabled chat models + default ids.
- Payload is a typed projector: no `apiKey*`, `baseUrl`, headers, or `root`.
- Allow it on Host Server; project the response explicitly (do not pass config through).
- Mobile picker consumes that list. `session/prompt` sends `model` + `thinkingLevel`.

### 2. Overlay no longer eats top-bar New Chat

- Drawer overlay starts below the top bar (same stacking as the 44px chrome).
- Top-bar `+` stays clickable while the drawer is open.

### 3. Hash overlays have one source of truth

- Open/close settings, sidebar, model picker, inbox, and share via `location.hash`.
- Close always clears the hash so `#settings` cannot cover chat after reload.

### 4. Web QR does not call Tauri `invoke`

- Guard barcode scan behind a native-runtime check; browser shows a manual-entry message.
- Declare `NSCameraUsageDescription` in mobile `tauri.conf.json` for the future iOS target.

### 5. Sessions and projects

- Mobile `session/list` uses `allScopes: true` with a bounded `maxItems`.
- Remote session summaries include opaque `projectId` (never `projectPath`).
- `session/create` accepts remote `projectId`; Host Runtime resolves it to a registered project path.
- Host Server still rejects raw `projectPath` / `cwd` from remote clients.
- Sidebar project pills filter by `projectId`.

## Verify

- `packages/contracts`, `host-runtime`, `host-server`, `apps/mobile` typecheck + unit tests.
- Manual: connect mobile Vite to 8787, pill shows `deepseek-v4-flash`, new chat from open drawer, settings close survives reload, scan on web does not throw `invoke`.
