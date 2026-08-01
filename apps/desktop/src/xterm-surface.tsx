/**
 * xterm.js surface bound to Tauri PTY (ADR 0013).
 * Presentational + I/O only; trust gate stays in TerminalDock.
 *
 * The terminal is not opened until the container has a real layout size.
 * This prevents fitAddon from computing a 0/1-column grid while the right
 * panel is collapsed or the tab is hidden, which was the source of garbled
 * prompt output and diagonal wrapping.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  listenTauriPtyData,
  listenTauriPtyExit,
  tauriPtyClose,
  tauriPtyOpen,
  tauriPtyResize,
  tauriPtyWrite,
} from './tauri-pty';

export type PtyStatus = 'idle' | 'starting' | 'open' | 'error' | 'exited';

export type XtermSurfaceProps = {
  /** Actual working directory for the terminal. */
  cwd: string;
  /** Project root for authorization (empty = general-scope terminal). */
  projectPath?: string;
  onStatus: (status: PtyStatus, ptyId: string | null, message?: string) => void;
};

const MIN_OPEN_WIDTH = 40;
const MIN_OPEN_HEIGHT = 40;
const RESIZE_DEBOUNCE_MS = 120;

export function XtermSurface(props: XtermSurfaceProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const bootingRef = useRef(false);
  const onStatusRef = useRef(props.onStatus);
  onStatusRef.current = props.onStatus;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let disposed = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#0f1115',
        foreground: '#d7dbe3',
        cursor: '#9bb8ff',
        selectionBackground: '#3a4a6b',
      },
      allowProposedApi: false,
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const hasUsableSize = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect();
      return rect.width >= MIN_OPEN_WIDTH && rect.height >= MIN_OPEN_HEIGHT;
    };

    const applyResize = (): void => {
      if (disposed || !containerRef.current || !terminalRef.current || !fitAddonRef.current) {
        return;
      }
      if (!hasUsableSize(containerRef.current)) {
        return;
      }
      try {
        fitAddonRef.current.fit();
      } catch {
        // fit can throw if container is display:none or too small
        return;
      }
      const ptyId = ptyIdRef.current;
      if (!ptyId) return;
      const dims = { cols: terminalRef.current.cols, rows: terminalRef.current.rows };
      void tauriPtyResize(ptyId, dims.cols, dims.rows).catch(() => {
        /* ignore resize races during teardown */
      });
    };

    const debouncedResize = (): void => {
      if (resizeDebounce) {
        clearTimeout(resizeDebounce);
      }
      resizeDebounce = setTimeout(() => {
        resizeDebounce = null;
        applyResize();
      }, RESIZE_DEBOUNCE_MS);
    };

    const boot = async (): Promise<void> => {
      if (disposed || !containerRef.current || bootingRef.current) {
        return;
      }
      if (!hasUsableSize(containerRef.current)) {
        return;
      }

      bootingRef.current = true;
      onStatusRef.current('starting', null);

      try {
        terminal.open(containerRef.current);
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        bootingRef.current = false;
      } catch {
        bootingRef.current = false;
        onStatusRef.current('error', null, 'Terminal DOM attach failed');
        return;
      }

      try {
        fitAddon.fit();
      } catch {
        /* empty */
      }

      terminal.onData((data) => {
        const ptyId = ptyIdRef.current;
        if (!ptyId) return;
        void tauriPtyWrite(ptyId, data).catch(() => {
          /* drop write if session already closed */
        });
      });

      unlistenData = await listenTauriPtyData((event) => {
        if (disposed || event.pty_id !== ptyIdRef.current) return;
        terminal.write(event.data);
      });
      unlistenExit = await listenTauriPtyExit((event) => {
        if (disposed || event.pty_id !== ptyIdRef.current) return;
        terminal.writeln('\r\n[process exited]');
        const closedId = ptyIdRef.current;
        ptyIdRef.current = null;
        onStatusRef.current('exited', closedId);
      });

      try {
        const opened = await tauriPtyOpen({
          cwd: props.cwd,
          ...(props.projectPath ? { projectPath: props.projectPath } : {}),
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (disposed) {
          await tauriPtyClose(opened.pty_id);
          return;
        }
        ptyIdRef.current = opened.pty_id;
        onStatusRef.current('open', opened.pty_id);
        applyResize();
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        onStatusRef.current('error', null, message);
        terminal.writeln(`\r\n[failed to open PTY: ${message}]`);
      }
    };

    resizeObserver = new ResizeObserver((entries) => {
      if (disposed || !containerRef.current) {
        return;
      }
      const last = entries[entries.length - 1];
      const hasSize =
        last &&
        last.contentRect.width >= MIN_OPEN_WIDTH &&
        last.contentRect.height >= MIN_OPEN_HEIGHT;

      if (!terminalRef.current) {
        // First positive layout: open the terminal surface.
        if (hasSize) {
          void boot();
        }
        return;
      }

      if (hasSize) {
        debouncedResize();
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      bootingRef.current = false;
      if (resizeDebounce) {
        clearTimeout(resizeDebounce);
      }
      resizeObserver?.disconnect();
      unlistenData?.();
      unlistenExit?.();
      const ptyId = ptyIdRef.current;
      ptyIdRef.current = null;
      if (ptyId) {
        void tauriPtyClose(ptyId);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [props.cwd, props.projectPath]);

  return (
    <div
      className="xterm-surface"
      data-testid="xterm-surface"
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 160 }}
    />
  );
}
