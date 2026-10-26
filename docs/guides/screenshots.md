# Screenshots with annotation (Desktop)

| Field | Value |
|-------|-------|
| Status | macOS implemented; packaged-app gates pending · Windows / Linux not yet |
| Related | [product spec](../specs/2026-10-25-desktop-screenshot-annotation.md) (local doc), [ADR 0062](../adr/0062-client-device-tools-and-apple-health.md) |

Desktop can capture part of your screen, let you mark it up, and attach it to
the current message. Capture runs on the computer in front of you, so it works
the same whether the Host is the local sidecar or a remote machine.

## Taking a screenshot

Any of these starts a capture:

- **⇧⌘A** — works while typing in the composer.
- Composer **+** menu → **Take screenshot**. Hidden when the current model
  cannot take images.
- Command palette (**⌘K**) → **Take Screenshot**.

piwin hides its windows, then the macOS crosshair appears. Drag a region, or
press Space to pick a window. **Esc** cancels and nothing is kept.

## Marking it up

| Tool | Key | How |
|------|-----|-----|
| Box | R | Drag |
| Arrow | A | Drag from tail to tip |
| Text | T | Click, type, Enter (Esc discards) |
| Crop | C | Drag the area to keep |

**⌘Z** / **⇧⌘Z** undo and redo. **Enter** or **Add to chat** attaches the
image; **Esc** or **Cancel** throws it away. Marks are always red.

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

## Other clients

| Client | What to do instead |
|--------|--------------------|
| CLI `piwin chat` | Save a screenshot, then pass `--image <path>`. |
| CLI TUI (`piwin tui`) | Copy a screenshot to the clipboard (macOS ⌃⇧⌘4, Windows Win+Shift+S), then run `/paste`. It reads your own clipboard, so this also works with a remote Host. |
| Desktop on Windows / Linux | Not available yet: the **+** menu hides the entry and the shortcut shows a notice. Paste or attach an image instead. |
| Mobile | Take an iOS screenshot and attach it from Photos. |
