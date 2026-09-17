# ADR 0064: Client-local attention notifications

| Field | Value |
|-------|-------|
| Status | **Accepted** (product-locked 2026-09-17; Desktop P0 implementation in flight) |
| Date | 2026-09-17 |
| Scope | Desktop macOS P0 · Mobile iOS M1 (local) · Remote Push APNs later. Apple shells only |
| Related | ADR 0023, ADR 0036, ADR 0037, ADR 0063, ADR 0071 |
| Specification | [Attention notifications product](../specs/2026-09-17-attention-notifications-product.md) (`AN-D01`–`AN-D12`, `AN-F04`/`AN-F07`/`AN-F15`/`AN-F19`, `AN-R03`–`AN-R06`) |
| Numbering | Filename required by spec work package AN-D1. Does **not** supersede [`0064-turn-repair-vs-branch-exploration.md`](./0064-turn-repair-vs-branch-exploration.md) |

## Context

Users send an Agent run to the background and need the shell to pull them
back on **turn complete**, **turn failed**, or **needs-input** (permission /
questionnaire). Host already fans the facts out; the missing piece is
device-local interruption policy (Dock badge, system banner, in-app notice,
click-to-session).

Three facts constrain the design:

- **AN-F04.** Push audience is already split: `run/*` for `session-turn` is
  global; `permission/*` and `extension/ui_request` are inbox; transcript
  events are session-scoped. A background client that has not subscribed a
  session still sees global/inbox facts. Host therefore cannot know which
  shell is looking at which session, and must not own OS notification calls
  (ADR 0036 multi-client; ADR 0037 thin mobile client).
- **AN-F07.** Desktop already tracks `completedAttentionSessionIds` /
  `failedAttentionSessionIds`, keyed off `activeSessionId !== run.sessionId`,
  plus a global `permissionQueue`. Sidebar unread marks consume that state.
  Docking (ADR 0071) and leftover conversation panes (ADR 0063) make
  “not the active session” the wrong “already looking” test: a session can
  be on screen in another stage group without being `activeSessionId`.
- **AN-F15.** `tauri-plugin-notification` 2.4.0 on desktop has no click
  callback (`onAction` is mobile-only), always reports authorization
  Granted, and on macOS goes through notify-rust. Under `tauri dev` it
  impersonates `com.apple.Terminal`. That is not a P0 click-to-session
  path and is not a reliable permission state.

Mobile (AN-F19) has no notification plugin and no `UIBackgroundModes`.
iOS WKWebView suspends in seconds; local notifications only work while the
process is still connected. Lock-screen / killed-process delivery is a
later APNs epic, not a keepalive trick.

## Decision

1. **Client-local interruption (AN-D01).** Host emits facts only
   (`run/terminal` / terminal `run/updated`, `permission/*`,
   `extension/ui_request`). No Host OS API, no Host-owned notification
   store, no Host “should we bother the user” bit. Each connected shell
   decides locally whether to badge, banner, toast, or stay silent.

2. **Reuse existing attention state (AN-D02).** Do not add an
   `AttentionStore`. Upgrade the “already seen” predicate on the existing
   completed/failed session id maps and permission / question slots.

3. **macOS banners via `UNUserNotificationCenter` (AN-D03).** Desktop P0
   ships a self-built native bridge (`attention_*` commands, AN-I08).
   Default is **not** `tauri-plugin-notification`. The bridge is supported
   only for a packaged `.app` with a real `NSBundle` identifier; a naked
   `tauri dev` binary reports `unsupported` (AN-G13).

4. **No-go fallback does not wait on signing (AN-D04).** If the native
   spike cannot obtain a real authorization dialog, banner, and click
   callback, P0 ships the plugin plus the AN-R21 in-app jump chip (record
   last `system` delivery; on presence becoming active within 60s, offer
   “jump to {session}”). Command names stay AN-I08.
   Capabilities become
   `{ nativeCenter: false, clickActivation: false, authorizationReliable: false }`;
   status commands report `granted`. Acceptance swaps G03/G11 for the
   60s chip; G13 is N/A on the plugin path.

5. **Presence is focus ∧ visible (AN-R03).**
   `presence = 'active'` if and only if the main window is focused **and**
   `document.visibilityState === 'visible'`; otherwise `'inactive'`.
   Occlusion, another Space, or a system dialog that steals focus counts
   as inactive. Sample at event time (AN-K06).

6. **Visible sessions follow Docking, then panes (AN-R04).**
   - Docking on: each stage group’s foreground view, if it is a session.
   - Else old conversation-pane leaves: every leaf session id.
   - Else `[activeSessionId]` when non-null.
   - `conversationCovered === true` (settings sub-page or overlay over the
     session stage) → empty set.
   A session is **seen** (AN-R05) only when presence is active, the
   conversation stage is **not** covered, **and** (it is in the visible
   set, or the visible set is empty and it is `activeSessionId`). A
   covered stage (settings / overlay) must not fall back to
   `activeSessionId` as seen.

7. **Complete / fail notify only when not present (AN-D06).** Defaults:
   complete and fail reminders on. System banner only when `presence` is
   inactive. If the user is present but looking at another session →
   in-app notice, no system banner. Needs-input may bounce the Dock when
   that preference is on.

8. **Visible ≠ unread (AN-D12).** A Docking session that is the foreground
   view of a stage group is visible even when it is not `activeSessionId`.
   Completing there must **not** set the sidebar unread mark (and must not
   raise a system banner). This replaces the AN-F07 `activeSessionId !==`
   test.

9. **Two bundle identifiers, two grants (AN-K08).** Notification
   authorization is per Apple bundle id:
   - Desktop packaged app: `app.piwinwin.desktop`
   - Mobile: `app.piwin.mobile`
   Granting one does not grant the other. Settings / user copy must say
   so. Dev unsigned binaries are not a third notifiable identity; they
   are unsupported for system banners.

10. **APNs later; no `UIBackgroundModes` (AN-D08, AN-D09, AN-F19).**
    Mobile M1 reuses `@piwin/host-client` attention modules after Desktop
    P0. It may show foreground cross-session banners and a “while you were
    away” summary. It must **not** add `UIBackgroundModes`, must not claim
    WebSocket keepalive, and must not pretend iOS background delivery is
    reliable. Remote Push is a separate epic: **APNs only** (no ntfy, no
    FCM). Windows / Linux / Android remain deferred (AN-D10). Duplicate
    banners from two Desktops on one Host are accepted in P0 (AN-D11).

## Consequences

- Sidebar unread marks shrink: a second Docking group showing session B
  while A is focused no longer paints B as unread on B’s own completion.
  AN-R1 must switch the mark test to `shouldMarkTurnAttention` / AN-R05.
- Click-to-session (AN-R19) is a native delegate concern on the go path
  and an in-app chip on the no-go path. Host session identity is unchanged;
  the shell calls `openSessionFromShell`.
- Packaged Desktop and Mobile each need their own notification grant.
  Opening System Settings must pass the current bundle id
  (`x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=…`).
- `tauri dev` must stay crash-free with capabilities all false (AN-G13).
- Host, contracts push shapes, and permission `detail` / paths stay off
  the notification body (AN-R16). Copy is title + project + session +
  sanitized action token + counts only.
- No-go still ships P0 without waiting for Developer ID / notarization
  to make `UNUserNotificationCenter` authorize. Plugin authorization is
  not trustworthy; the settings page must say “managed in System Settings”
  when `authorizationReliable === false`.
- APNs work (AN-P1–P4) is out of this ADR’s implementation. Extending
  ADR 0037 for `device/push/register` happens in that epic.

## Rejected alternatives

- **Host pops OS notifications.** Violates AN-D01 and ADR 0036: the Host
  does not know which client is focused, and a remote Host cannot reach
  macOS UserNotifications. Multi-Desktop duplicates would be Host-owned
  instead of an accepted P0 client quirk (AN-D11).
- **Plugin-only, skip the native bridge.** Rejected as the default
  because AN-F15 has no desktop click callback and lies about
  authorization. Retained only as the AN-D04 no-go P0 bar.
- **New AttentionStore / Host-side seen ledger.** Rejected (AN-D02).
  Seen-ness is a shell presentation fact (presence + visible views). A
  second store would desync from sidebar marks and permission queue.
- **Presence = unfocused window only, or `onlyWhenUnfocused`.** Too
  coarse: a focused but `hidden` document, or a visible unfocused Docking
  pane, would mis-fire. Spec splits presence (AN-R03) from visible
  sessions (AN-R04).
- **Visible = `activeSessionId` only.** This is the AN-F07 bug AN-D12
  fixes under Docking.
- **ntfy / FCM as an MVP remote push.** Rejected (AN-D09). Direct APNs
  when that epic starts.
- **`UIBackgroundModes` to keep the iOS socket alive.** Rejected. It
  would not make WKWebView a durable push channel and would be a false
  product promise (AN-F19, AN-A02).
