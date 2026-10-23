/**
 * GPU renderer for the xterm surface.
 *
 * xterm's built-in DOM renderer lays rows out as text spans: rows holding bold
 * or CJK runs drift off the cell grid, seams show between rows, and a
 * full-screen program repainting on every wheel tick is slow. The WebGL
 * renderer draws every cell on the grid. It is an upgrade, never a
 * requirement: when WebGL2 is missing or the context is lost, the terminal
 * keeps working on the DOM renderer.
 *
 * The addon shares one texture atlas between every terminal with the same
 * font and theme (split panes). Clearing it from one terminal leaves the
 * others drawing cached cells from atlas slots that now hold other glyphs —
 * rows that never repaint (status bars, headers) turn into garbage. So the
 * atlas is only ever cleared for all live terminals in the same tick.
 */
import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';

export type XtermRendererKind = 'webgl' | 'dom';

export type XtermRenderer = { kind: XtermRendererKind; dispose: () => void };

const liveAddons = new Set<WebglAddon>();
let fontsReadyPending = false;

/** Clears the shared atlas and every live terminal's cached cells together. */
function clearSharedTextureAtlas(): void {
  for (const addon of liveAddons) addon.clearTextureAtlas();
}

/** Glyphs rasterized before the web font arrived would stay in the atlas otherwise. */
function clearAtlasOnceFontsLoad(): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  if (document.fonts.status === 'loaded' || fontsReadyPending) return;
  fontsReadyPending = true;
  void document.fonts.ready
    .then(clearSharedTextureAtlas)
    .catch(() => undefined)
    .finally(() => { fontsReadyPending = false; });
}

/** Call after `terminal.open()`; the addon needs the terminal's screen element. */
export function attachXtermWebglRenderer(terminal: Terminal): XtermRenderer {
  let addon: WebglAddon | null = null;
  const release = (): void => {
    const current = addon;
    addon = null;
    if (current !== null) liveAddons.delete(current);
    // Disposing the addon hands rendering back to the DOM renderer.
    current?.dispose();
  };
  try {
    addon = new WebglAddon();
    // The browser may drop the context (GPU reset, too many contexts).
    addon.onContextLoss(release);
    terminal.loadAddon(addon);
    liveAddons.add(addon);
  } catch {
    // No WebGL2 in this webview: the DOM renderer is already active.
    release();
    return { kind: 'dom', dispose: () => undefined };
  }
  clearAtlasOnceFontsLoad();
  return { kind: 'webgl', dispose: release };
}
