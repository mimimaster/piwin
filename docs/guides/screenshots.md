# Screenshots with annotation (Desktop)

| Field | Value |
|-------|-------|
| Status | macOS implemented · Windows / Linux implemented, not yet tried on real machines · packaged-app gates pending |
| Related | [product spec](../specs/2026-10-25-desktop-screenshot-annotation.md) (local doc), [ADR 0062](../adr/0062-client-device-tools-and-apple-health.md) |

Desktop can capture part of your screen, let you mark it up, and attach it to
the current message. Capture runs on the computer in front of you, so it works
the same whether the Host is the local sidecar or a remote machine.

## Taking a screenshot

Any of these starts a capture:

- **⇧⌘A** (Windows / Linux: **Ctrl+Shift+A**) — system-wide: works from any
  app while piwin is running, and while typing in the composer. While it is
  registered, other apps no longer receive this chord. If another app already
  holds it, piwin logs that and the chord only works inside piwin.
- Composer **+** menu → **Take screenshot**. Hidden when the current model
  cannot take images.
- Command palette (**⌘K**) → **Take Screenshot**.

piwin hides its windows, then the system picker appears:

| Platform | Picker |
|----------|--------|
| macOS | The system crosshair. Drag a region, or press Space to pick a window. |
| Linux | The desktop's own screenshot UI through xdg-desktop-portal (GNOME, KDE, most Wayland and X11 desktops). Without a portal, the first of `grim`+`slurp`, `gnome-screenshot`, `spectacle`, `maim`, `scrot` found on PATH. The portal saves the shot in the desktop's screenshot folder, as a normal system screenshot would. |
| Windows | No picker: piwin copies the whole monitor under the pointer and opens the editor with **Crop** selected. Drag the area to keep. |

**Esc** cancels and nothing is kept. After a cancel piwin only comes back to
the front if it was in front before.

## Marking it up

| Tool | Key | How |
|------|-----|-----|
| Box | R | Drag |
| Arrow | A | Drag from tail to tip |
| Text | T | Click, type, Enter (Esc discards) |
| Crop | C | Drag the area to keep |

The editor fills the window; tools are icons in a small strip under the image
(hover for the name and key). **⌘Z** / **⇧⌘Z** (Ctrl on Windows / Linux) undo
and redo. **Enter** or **✓** attaches the image; **Esc** or **✕** throws it
away. Marks are always red.

The image is attached like a pasted image: large captures are shrunk before
upload, and nothing reaches the Host until you confirm.

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
