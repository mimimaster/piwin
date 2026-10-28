# ADR 0084: The mobile shell's default interface is the responsive workbench

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-10-06 |
| Related | [0037-mobile-remote-shell.md](./0037-mobile-remote-shell.md), [0075-operator-host-pairing.md](./0075-operator-host-pairing.md), [0076-bundled-phone-access-lan.md](./0076-bundled-phone-access-lan.md), [execution plan](../plans/2026-10-06-ios-web-shell-default-mode.md) |

## Context

ADR 0037 §3 gave Mobile its own small interface and forbade reusing Desktop's.
That interface (Inkstone, ~30k lines) has to be kept in step with a ~200k-line
Desktop workbench by hand, and it is always behind. Meanwhile the workbench
gained a phone layout for browser access (2026-09-11), a shell-only build, a
connect wall and a native WebSocket bridge.

Owner direction (2026-10-06): the phone app should render the responsive
workbench by default; the existing interface stays reachable from settings.

## Decision

1. **One shell, two front ends.** `apps/mobile` keeps its Tauri shell (Rust,
   plugins, capabilities, signing). Its bundle carries the workbench at `/` and
   the original interface at `/classic/`. `apps/mobile/scripts/build-shell-dist.ts`
   assembles them from build output; neither app imports the other's source.
2. **Mode is a device-local preference.** `piwin.mobile.interface-mode`
   (`web` | `classic`, default `web`) in `localStorage`, defined in
   `@piwin/host-client` `shell-interface-mode`. An inline boot script on the
   web entry page hands off to classic before the workbench bundle is fetched.
   Switching is a navigation, not a live swap.
3. **The workbench is bundled, not loaded from the Host.** A page served from
   `http://host` would lose the Tauri plugins and blank when the Host is down.
4. **Shell runtime is explicit.** `apps/desktop/src/tool-cards/shell-runtime.ts` tells
   `browser`, `desktop-tauri` and `mobile-tauri` apart. `isTauriRuntime()` now
   means the Desktop app only; the mobile shell paints `web` window chrome and
   uses the Tauri bridge only for what it has (WebSocket, Keychain, camera).
5. **Device enrolment and device tools are shared.** Pairing-code parsing, the
   device credential vault, the client-tool runtime and the HealthKit bridge
   live in `@piwin/host-client`; native access is injected (`invoke`), so the
   package still does not import Tauri. The workbench connect wall
   scans a pairing QR in the mobile shell; the credential stays in the
   Keychain and is primed into memory before the first hello
   (`apps/desktop/src/devices/device-admission.ts`). The client still identifies as
   `clientType: 'desktop'` because it runs the Desktop capability set.
6. **Classic is frozen.** Crash fixes only. It is removed once the default
   interface has feature parity and has gone four weeks without a switch back.

This supersedes ADR 0037 §3 for the default interface. §1, §2, §4 and §5 of
ADR 0037 are unchanged: the phone is still a thin client and the Host is the
only execution authority.

## Consequences

- Features reach the phone when they reach the workbench; no display mapping.
- Device capabilities reach the default interface through shared modules, not
  through classic code: Apple Health (`@piwin/host-client` `device-tools/`,
  wired by `apps/desktop/src/devices/device-health.ts`; a turn opts in with the
  `connected-source` context chip), local notifications
  (`desktop-attention-os-mobile.ts`), and external links (the shell's own `mobile_open_external` command; the
  shell plugin's JS `open` cannot launch anything on iOS).
  Voice input and Live use the workbench's own browser capture (recording +
  Host `speech/transcribe`). Classic has no on-device recognition left to
  port: after the Inkstone rewrite its dictation sheet is a plain text field
  (corrected 2026-10-28).
- Classic-only conveniences were ported to the default interface on
  2026-10-28 ([plan](../plans/2026-10-28-default-interface-classic-parity.md)):
  the offline session-list snapshot (remote Hosts only; read-only rows, a
  sidebar notice, session actions blocked until the Host answers) and
  swipe-to-reveal session rows on coarse pointers. The swipe row moved to
  `@piwin/ui-kit` and classic now uses it from there. Per-session drafts
  already existed in the workbench. Nothing classic-only remains, so the
  removal condition in §6 is down to four weeks without a switch back.
- The conversation / CLI switch reaches the phone (2026-10-28,
  [ADR 0102](./0102-host-run-terminal-shell.md)): native agent CLIs stream from
  the Host as on Desktop, and Pi's TUI runs on a sidecar Host's machine. Touch
  screens get a key bar (Ctrl, Esc, Tab, arrows, `/`, paste); Grok opens in the
  conversation view on a phone.
- The bundle grows by the workbench (~50 MB unpacked, 3.9 MB main chunk).
- Phone-layout defects in the workbench are now phone-app defects; they are
  fixed once for the browser and the app.
- Composer parity with Desktop (2026-10-28): the remote session projection
  now carries each row's model and thinking level, and `session/resume`
  carries the conversation's orchestration scheme and delegation switch.
  Before that a phone showed its own draft scheme and the global default model
  on Desktop's conversations. In the phone layout the composer status row is
  gone: context usage is the toolbar ring, and the turn and session counters
  sit in its popover. The Conversations tab still hides run mode and
  orchestration on both shells, as before.
- Composer pickers on a phone (2026-10-28): model, run mode and orchestration
  open as full-width sheets above the toolbar (ui-kit Popover
  `presentation="sheet"`) instead of narrow anchored boxes. A touch screen no
  longer focuses model search on open, so the keyboard does not cover the
  list. Orchestration rows stack name over a two-line description, and
  "Delegation disabled" is a switch. The toolbar pill drops the effort suffix
  and the chevrons, and model names lose the vendor prefix OpenRouter repeats
  ("DeepSeek: DeepSeek V4.1 Flash" → "DeepSeek V4.1 Flash"). + submenus
  settle over the menu rather than flying off the right edge.
- Phone usability pass (2026-10-28, plan `2026-10-28-phone-usability-wishlist.md`):
  the composer names the model a send will use instead of "Default model";
  jump-to-latest stays hidden within half a screen of the end; the landing
  holds its recent-list space while loading; settings reuses its loaded
  chunk and shows its own frame on first load. Routine per-turn assembly
  capsules are hidden on a phone (untrusted sources still show). Error cards
  lead with a plain-words hint by failure code, raw text folded; remote
  transcripts now carry each row's structured `failure`. In project mode a
  phone merges run mode and orchestration into one pill and sheet.
- The phone document is a fixed frame. Conversations and other content scroll
  within their own regions; edge gestures do not move the outer page. The
  session drawer scrolls vertically only, with long titles and expanded touch
  targets constrained to its width (2026-10-07).
