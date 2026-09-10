# Right panel full-width overlay (Codex-aligned)

| Field | Value |
|---|---|
| Status | Accepted (product owner, 2026-09-08) |
| Surface | Desktop shell · right workspace panel |
| Codex sources | ChatGPT.app `app.asar`: `rightPanelFullWidth`, `toggleMaximizeSidePanel`, `UGi`, resize `allowPointerOverflow` |

## Product

Desktop split view keeps a usable chat column (`minStagePx` 420). The right
panel can **cover the conversation** so only the left sidebar and the right
panel remain.

Two triggers, one state:

1. Tabstrip expand control → Enter / Exit full screen (Codex labels).
2. Drag the panel's left edge past the split maximum (chat already at 420px)
   → enter full width. Drag back, or the same button, restores split.

Inverse overshoot (Codex `$j` close when size < min):

3. Drag the splitter right until the panel is at min width (200px), then keep
   dragging (~24px more) → collapse the right panel. Last valid split width
   is kept for the next open. Compact drawer uses the same close overshoot.

The left navigator uses the same overshoot in the other direction: drag its
right edge left past min width (~24px more) → collapse the sidebar
(`desktopSidebarCollapsed`). Last valid width is kept.

Reverse-drag without releasing: after either panel has collapsed, dragging
back to min width (200px) expands it again. Collapse still needs min−24;
expand uses the min (24px hysteresis) so the two thresholds do not flicker.

This is **not** Codex's three-state stepper (fullscreen content / split /
fullscreen chat). piwin ships two states: split | content-full.

## Non-goals

- Auto-entering full width when Canvas, files, or images open (Codex #42709).
- Persisting full-width across app launches (split width still persists).
- Migrating Host `WalkthroughArtifact` cards onto Canvas.
- Compact layout: the drawer already covers the stage.

## Layout

`.app-shell.right-panel-full-width.has-right-panel`:

- grid `nav | signal` (or `signal` alone if the sidebar is collapsed)
- `.workspace` stays mounted, `display: none` (transcript/composer state kept)
- right panel `max-width: none` so it fills the remaining column

Last split width is kept in the resize hook and restored on exit. Full-width
does not write that px value to `localStorage`.

Opening the inspector is always split. A persisted wide `--right-panel-width`
is viewport-clamped so the stage keeps `--stage-min` (420px). Full-width is
only the expand control or drag overshoot past that floor.

Empty inspector (tab strip has no tools) cannot cover the conversation.
The `+` picker is hidden until at least one tool tab is open.

## Artifact reports

Standalone reviews/reports MUST declare `surface="canvas"` (decision prompt
v8, Cursor-aligned: user intent, not length). Auto-reveal still opens the
Canvas tab and may bump width to 560px. It must not flip
`rightPanelFullWidth`.
