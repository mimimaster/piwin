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
import { globalMemoryGovernor } from '../notes/memory-governor.js';
import { createXtermGraphicsLease } from './xterm-graphics-resources.js';

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
  let graphics: ReturnType<typeof createXtermGraphicsLease> | null = null;
  let disposed = false;
  let recoverable = true;
  const release = (repaint: boolean): void => {
    const current = addon;
    if (current === null) return;
    addon = null;
    liveAddons.delete(current);
    graphics?.capture();
    // Disposing the addon hands rendering back to the DOM renderer.
    current.dispose();
    graphics?.dispose();
    graphics = null;
    if (repaint) terminal.refresh(0, terminal.rows - 1);
  };
  const activate = (): void => {
    if (disposed || !recoverable || addon !== null || globalMemoryGovernor.getLevel() === 'critical') return;
    try {
      addon = new WebglAddon();
      graphics = createXtermGraphicsLease(terminal, addon);
      addon.onContextLoss(() => {
        recoverable = false;
        release(true);
      });
      terminal.loadAddon(addon);
      graphics.capture();
      liveAddons.add(addon);
      clearAtlasOnceFontsLoad();
    } catch (error) {
      recoverable = false;
      release(false);
      console.warn('[terminal] WebGL unavailable; using the text renderer:', error);
    }
  };
  const unsubscribe = globalMemoryGovernor.subscribe((level) => {
    // The visible terminal, PTY and scrollback stay live; only rebuildable graphics go.
    if (level === 'critical') release(true);
    else if (level === 'normal') activate();
  });
  activate();
  return {
    get kind() { return addon === null ? 'dom' : 'webgl'; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      release(false);
    },
  };
}
