/**
 * Inline pictures in the xterm surface.
 *
 * `@xterm/addon-image` decodes the iTerm2 inline-image protocol (OSC 1337
 * File=) and SIXEL; it has no kitty support. The embedded CLI is started with
 * `PIWIN_IMAGES=iterm2` (pty_tui.rs) so it draws pictures this addon can show.
 * The addon also answers CSI 14/16 t size reports, which the CLI uses to size
 * pictures to the real cell grid. It draws on its own canvas layer above the
 * text, so it works with the WebGL renderer and with the DOM fallback.
 * Like WebGL it is an upgrade: if loading fails the terminal keeps working and
 * pictures stay one-line placeholders.
 */
import type { Terminal } from '@xterm/xterm';
import { ImageAddon, type IImageAddonOptions } from '@xterm/addon-image';

/**
 * Bounded so a hostile or runaway program cannot exhaust the webview: one
 * picture at most 4096×4096 pixels (64 MB decoded), 64 MB of pictures kept per
 * terminal (oldest dropped first), and 16 MB per encoded sequence. The CLI
 * itself reads at most 8 MB per picture.
 */
export const XTERM_IMAGE_OPTIONS: IImageAddonOptions = {
  enableSizeReports: true,
  pixelLimit: 4096 * 4096,
  storageLimit: 64,
  showPlaceholder: true,
  iipSupport: true,
  iipSizeLimit: 16 * 1024 * 1024,
  sixelSupport: true,
  sixelSizeLimit: 16 * 1024 * 1024,
};

export type XtermImages = { enabled: boolean; dispose: () => void };

/** Call after `terminal.open()` (the addon attaches its canvas to the screen element). */
export function attachXtermImageAddon(terminal: Terminal): XtermImages {
  let addon: ImageAddon | null = null;
  try {
    addon = new ImageAddon(XTERM_IMAGE_OPTIONS);
    terminal.loadAddon(addon);
  } catch {
    addon?.dispose();
    return { enabled: false, dispose: () => undefined };
  }
  return {
    enabled: true,
    dispose: () => {
      const current = addon;
      addon = null;
      current?.dispose();
    },
  };
}
