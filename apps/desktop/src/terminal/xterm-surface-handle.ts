import type { XtermPtyTransport } from './xterm-pty-transport.js';

/** What a terminal pane can do to its running program besides typing into xterm. */
export type XtermSurfaceHandle = {
  /** Bytes from outside the keyboard (the touch key bar, a paste). */
  send: (data: string) => void;
  /**
   * Make the program paint its whole screen again. A full-screen program
   * redraws when its width changes, so the grid is narrowed by one column and
   * restored. Used after the Host connection drops: output sent meanwhile is
   * gone, and replaying it would only show stale frames.
   */
  redraw: () => void;
  focus: () => void;
};

const REDRAW_RESTORE_MS = 80;

export function createXtermSurfaceHandle(input: {
  transport: XtermPtyTransport;
  ptyId: () => string | null;
  size: () => { cols: number; rows: number } | null;
  focus: () => void;
}): XtermSurfaceHandle {
  return {
    send: (data) => {
      const ptyId = input.ptyId();
      if (ptyId === null || data.length === 0) return;
      void input.transport.write(ptyId, data).catch(() => {
        /* the program already exited */
      });
    },
    redraw: () => {
      const ptyId = input.ptyId();
      const size = input.size();
      if (ptyId === null || size === null || size.cols < 3) return;
      void input.transport.resize(ptyId, size.cols - 1, size.rows)
        .then(() => new Promise((resolve) => { setTimeout(resolve, REDRAW_RESTORE_MS); }))
        .then(() => {
          const current = input.size();
          if (input.ptyId() !== ptyId || current === null) return undefined;
          return input.transport.resize(ptyId, current.cols, current.rows);
        })
        .catch(() => {
          /* a redraw racing teardown is harmless */
        });
    },
    focus: input.focus,
  };
}
