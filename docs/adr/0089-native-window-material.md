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
   parking strips the blur. Short pickers that open over the right panel's
   own list (tool picker, changes scope) take the thin fill so the list
   reads through instead of a slab.
6. **Right-panel cards are tinted glass.** Changes file cards, history
   commit cards and the inline git form on the docked panel use
   `--window-material-panel-card-fill` (paper `--s2` 60%, ink `--s3` 55%);
   diff bodies stay solid, and an expanded card's sticky head takes the
   dense 94% fill so its own diff does not read through. No blur: these are
   long-lived, so they stay off the backdrop-filter whitelist.
7. **Transcript edge fades** on a translucent stage mask the scroller instead
   of painting the stage colour (which reads as a band) — a deliberate
   exception to region-transcript.css.

## Consequences

- The stage defaults to 75% (ink scales it by 0.8, so 60%): denser than the
  side panels but still translucent. Cards and code inside it stay solid so
  reading contrast does not depend on the desktop behind the window.
- Under ink the terminal tab's xterm canvas clears to `#00000000` and the
  dock body paints the glass. It must be a hex alpha: xterm's colour parser
  rejects `transparent` and falls back to opaque #000, which shows as a black
  slab framed by the glass padding. Paper keeps a solid `--term-bg` canvas.
- `transparent: true` is in the shared window config, so Windows also gets
  a transparent window with opaque content; not yet verified on Windows.
- Paper (light) theme has not been verified against the native window.
