# ADR 0089: Native window material on macOS (Inkstone)

- **Status**: Accepted
- **Date**: 2026-10-14
- **Scope**: `apps/desktop` (Tauri config, theme, styles, Settings → Appearance)
- **Consults**: ADR 0061 (deck design system)

## Context

The product owner asked for a more translucent, better-looking window.
Earlier CSS `backdrop-filter` glass on the stage was removed: every blur
surface costs WebKit IOSurface memory (memory-degradation.css strips it under
pressure) and the glass mix flashed white during streaming reflow.

## Decision

1. **System material, not CSS glass, for the window.** The main window is
   `transparent` with a macOS `sidebar` NSVisualEffectView
   (`tauri.conf.json` `windowEffects`, `followsWindowActiveState`). The
   window server composites the blur; WebContent pays nothing. The native
   appearance follows the app theme mode (`native-window-appearance.ts`).
2. **One document flag.** `theme/apply-appearance.ts` sets
   `html[data-window-material]` only for macOS overlay chrome + Inkstone
   paper/ink. All material CSS hangs off it; other themes and platforms stay
   opaque. Phone layout stays opaque.
3. **Per-region opacity, user-tunable.** Settings → Appearance → 窗口通透
   exposes backdrop / sidebar / stage / right panel (defaults 60 / 30 / 90 /
   45, tuned on native captures). Values live in local preferences and are
   written on the document root so full-window pages reuse them.
4. **Full-window pages follow the shell.** Settings, library, flashcards,
   knowledge and marketplace map to the same regions (field / nav / content);
   the shell steps aside while they are open so fields do not stack.
5. **Overlays get small CSS glass.** Menus, popovers, toasts, dialogs and
   floating drawers share `--overlay-glass-fill(-dense)` + a 24px blur. They
   are small and short-lived; the selectors are added to
   `PRODUCT_GLASS_WHITELIST` and the fill turns solid when memory pressure or
   parking strips the blur.
6. **Transcript edge fades** on a translucent stage mask the scroller instead
   of painting the stage colour (which reads as a band) — a deliberate
   exception to region-transcript.css.

## Consequences

- Reading surfaces (stage 90%, cards, code, terminal) stay effectively
  solid; translucency lives in chrome and overlays.
- The terminal tab keeps its solid `--term-bg`; xterm transparency is not
  enabled (repaint cost).
- `transparent: true` is in the shared window config, so Windows also gets
  a transparent window with opaque content; not yet verified on Windows.
- Paper (light) theme has not been verified against the native window.
