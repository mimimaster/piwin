# Screenshots with annotation (Desktop)

| Field | Value |
|-------|-------|
| Status | macOS implemented · Windows / Linux implemented, not yet tried on real machines · packaged-app gates pending |
| Related | [product spec](../specs/2026-10-25-desktop-screenshot-annotation.md) (local doc), [ADR 0062](../adr/0062-client-device-tools-and-apple-health.md) |

Desktop captures part of your screen QQ-style: pick a region, mark it up in
place, finish, and the image is on the clipboard. Capture runs on the computer
in front of you, so it works the same whether the Host is the local sidecar or
a remote machine.

## Taking a screenshot

Any of these starts a capture:

- **⇧⌘A** (Windows / Linux: **Ctrl+Shift+A**) — system-wide: works from any
  app while piwin is running, and while typing in the composer. While it is
  registered, other apps no longer receive this chord. If another app already
  holds it, piwin logs that and the chord only works inside piwin.
- Composer **+** menu → **Take screenshot**. Hidden when the current model
  cannot take images.
- Command palette (**⌘K**) → **Take Screenshot**.

## macOS and Windows: the capture overlay

piwin freezes the monitor under the pointer; its own windows stay where they
are and show in the shot as they are, like QQ. Everything
else happens on that frozen screen:

1. **Pick a region.** Drag a rectangle; the size in pixels shows at its corner.
   A plain click takes the whole screen.
2. **Adjust or mark it up.** A toolbar appears under the region (above it when
   there is no room). With no tool picked, drag inside the region to move it,
   drag the handles to resize, or use the arrow keys (Shift: 10 px). Pick a
   tool to draw inside the region; pick it again to go back to adjusting.
3. **Finish** with **✓**, **Enter**, a **double-click** inside the region, or a
   **click on the dimmed area** outside it. (While nothing is drawn yet, a
   *drag* outside still picks a new region.)

| Tool | Key | How |
|------|-----|-----|
| Box | R | Drag |
| Ellipse | E | Drag |
| Arrow | A | Drag from tail to tip |
| Pen | P | Draw freehand |
| Mosaic | M | Paint over what to hide (a click hides a short word) |
| Text | T | Click, type, Enter (Esc discards) |

**⌘Z** / **⇧⌘Z** (Ctrl on Windows) undo and redo marks. **Right-click** drops
the region and starts over; right-click again, **Esc** or **✕** leaves without
keeping anything. Marks are always red.

Where the image goes:

- Always: the **clipboard**, ready to paste into any app.
- Also the **composer**, when piwin was the app in front when you started
  (the **+** menu, the palette, or the shortcut inside piwin). It is attached
  like a pasted image: large captures are shrunk before upload.
- **Pin** (thumbtack on the toolbar): the crop stays as a floating always-on-top
  window you can drag around. It is copied to the clipboard too, but not attached
  to the composer. Hover the pin for **×**, or press **Esc**, to close it. Up to
  eight pins at once; a ninth closes the oldest.
- Started from another app, piwin stays in the background and focus goes back
  to the app you were in.

If the composer cannot take the image (no trusted project, or a model without
image input), piwin says so; the image is still on the clipboard.

## Linux: the desktop's picker, then the editor

Linux has no silent capture that works on every desktop, so the desktop draws
the region picker: xdg-desktop-portal (GNOME, KDE, most Wayland and X11
desktops), or without a portal the first of `grim`+`slurp`,
`gnome-screenshot`, `spectacle`, `maim`, `scrot` found on PATH. The portal
saves the shot in the desktop's screenshot folder, as a normal system
screenshot would.

The same editor then opens inside piwin with the whole shot as the region.
**✓** attaches it to the composer. **Pin** still opens a floating window.
It is not copied to the clipboard on Linux.

## Screen Recording permission (macOS)

macOS asks for **Screen Recording** permission the first time. If it is
missing, piwin shows a dialog instead of capturing:

1. **Open Settings** raises the system prompt (first time) and opens
   *Privacy & Security → Screen Recording*.
2. Turn piwin on.
3. **Restart piwin** — macOS only applies the grant after a relaunch.

Running from `pnpm dev:tauri` in a terminal, macOS attributes the permission to
the terminal app instead of piwin.

If piwin keeps asking although its switch is on, the grant probably belongs to
another copy with the same bundle id (`app.piwinwin.desktop`), for example a
locally built, ad-hoc signed `.app`. macOS checks the code signature, so the
installed app does not match. Quit piwin, reset the entry, and grant it again
from the installed app:

```bash
tccutil reset ScreenCapture app.piwinwin.desktop
```

Windows and Linux have no capture permission step.

## Other clients

| Client | What to do instead |
|--------|--------------------|
| CLI `piwin chat` | Save a screenshot, then pass `--image <path>`. |
| CLI TUI (`piwin tui`) | Copy a screenshot to the clipboard (macOS ⌃⇧⌘4, Windows Win+Shift+S), then run `/paste`. It reads your own clipboard, so this also works with a remote Host. |
| Desktop on Linux without a portal or region tool | The capture shows a "not available" notice. Install one of the tools above, or paste an image. |
| Mobile | Take an iOS screenshot and attach it from Photos. |
