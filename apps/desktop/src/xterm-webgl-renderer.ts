/**
 * GPU renderer for the xterm surface.
 *
 * xterm's built-in DOM renderer lays rows out as text spans: rows holding bold
 * or CJK runs drift off the cell grid, seams show between rows, and a
 * full-screen program repainting on every wheel tick is slow. The WebGL
 * renderer draws every cell on the grid. It is an upgrade, never a
 * requirement: when WebGL2 is missing or the context is lost, the terminal
 * keeps working on the DOM renderer.
 */
import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';

export type XtermRendererKind = 'webgl' | 'dom';

export type XtermRenderer = { kind: XtermRendererKind; dispose: () => void };

/** Call after `terminal.open()`; the addon needs the terminal's screen element. */
export function attachXtermWebglRenderer(terminal: Terminal): XtermRenderer {
  let addon: WebglAddon | null = null;
  const release = (): void => {
    const current = addon;
    addon = null;
    // Disposing the addon hands rendering back to the DOM renderer.
    current?.dispose();
  };
  try {
    addon = new WebglAddon();
    // The browser may drop the context (GPU reset, too many contexts).
    addon.onContextLoss(release);
    terminal.loadAddon(addon);
  } catch {
    // No WebGL2 in this webview: the DOM renderer is already active.
    release();
    return { kind: 'dom', dispose: () => undefined };
  }
  // Glyphs rasterized before the web font arrived stay in the atlas otherwise.
  if (typeof document !== 'undefined' && 'fonts' in document) {
    void document.fonts.ready.then(() => addon?.clearTextureAtlas()).catch(() => undefined);
  }
  return { kind: 'webgl', dispose: release };
}
