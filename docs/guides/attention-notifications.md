# Attention notifications (Desktop)

| Field | Value |
|-------|-------|
| Status | Implemented in code; packaged G-gate in progress |
| Related | [ADR 0064](../adr/0064-client-local-attention-notifications.md), [product spec](../specs/2026-09-17-attention-notifications-product.md) |

Desktop can remind you when a session finishes, fails, or needs approval —
without putting command paths, errors, or file contents into the banner.

## Where to configure

Settings → **Notifications** (`settings/notifications`).

- **Enable notifications** is the master switch for system banners, in-app
  toasts, and Dock bounce. The Dock **badge** has its own switch and still
  works when the master switch is off.
- **Needs approval** cannot be turned off without a confirm dialog.
- Authorization is macOS notification permission. If the OS denies it, open
  System Settings from the same row. Badge still works.

## Two apps, two permissions

All-in-one Desktop and the shell-only build are **different bundle ids**.
macOS treats them as separate apps:

| Build | Bundle id |
|-------|-----------|
| Sidecar / all-in-one (`package:desktop`) | `app.piwinwin.desktop` |
| Shell-only (`package:desktop-shell`) | `app.piwinwin.desktop.shell` |

Granting notifications for one does not grant the other. If banners work in
one build and not the other, check System Settings → Notifications for that
exact app name.

## `tauri dev` does not show system banners

The naked `tauri dev` binary is not a `.app`. Native
`UNUserNotificationCenter` is **unsupported** in that runtime (no crash, no
authorization dialog). Dock badge and in-app toasts still work. Packaged
`.app` builds are the path that can show Notification Center banners.

## What you will see

| You are… | Another session needs you |
|----------|---------------------------|
| Looking at that session | Silent (sidebar mark may still clear when you see it) |
| Looking at a different session, window focused | In-app toast with a jump action; no system banner |
| App in background / another Space | System banner (if authorized) + optional Dock bounce for approvals |
| Catching up after reconnect / hydration | At most one summary, not a burst of singles |

Clicking a system notification focuses the main window and opens that
session (or its parent, if it was a subagent child).
