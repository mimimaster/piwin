/**
 * xterm.js surface bound to Tauri PTY (ADR 0013).
 * Presentational + I/O only; trust gate stays in TerminalDock.
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

export type XtermSurfaceProps = {
  projectPath: string;
  active: boolean;
  onStatus: (status: 'starting' | 'open' | 'error' | 'exited', message?: string) => void;
};

export function XtermSurface(props: XtermSurfaceProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const onStatusRef = useRef(props.onStatus);
  onStatusRef.current = props.onStatus;

  useEffect(() => {
    if (!props.active || !containerRef.current) {
      return;
    }

    let disposed = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

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
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const applyResize = (): void => {
      try {
        fitAddon.fit();
      } catch {
        // fit can throw if container is display:none
        return;
      }
      const ptyId = ptyIdRef.current;
      if (!ptyId) return;
      const dims = { cols: terminal.cols, rows: terminal.rows };
      void tauriPtyResize(ptyId, dims.cols, dims.rows).catch(() => {
        /* ignore resize races during teardown */
      });
    };

    const boot = async (): Promise<void> => {
      onStatusRef.current('starting');
      try {
        fitAddon.fit();
      } catch {
        /* empty */
      }

      unlistenData = await listenTauriPtyData((event) => {
        if (disposed || event.pty_id !== ptyIdRef.current) return;
        terminal.write(event.data);
      });
      unlistenExit = await listenTauriPtyExit((event) => {
        if (disposed || event.pty_id !== ptyIdRef.current) return;
        terminal.writeln('\r\n[process exited]');
        ptyIdRef.current = null;
        onStatusRef.current('exited');
      });

      try {
        const opened = await tauriPtyOpen({
          cwd: props.projectPath,
          projectPath: props.projectPath,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (disposed) {
          await tauriPtyClose(opened.pty_id);
          return;
        }
        ptyIdRef.current = opened.pty_id;
        onStatusRef.current('open');
        applyResize();
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        onStatusRef.current('error', message);
        terminal.writeln(`\r\n[failed to open PTY: ${message}]`);
      }
    };

    terminal.onData((data) => {
      const ptyId = ptyIdRef.current;
      if (!ptyId) return;
      void tauriPtyWrite(ptyId, data).catch(() => {
        /* drop write if session already closed */
      });
    });

    resizeObserver = new ResizeObserver(() => {
      applyResize();
    });
    resizeObserver.observe(containerRef.current);

    void boot();

    return () => {
      disposed = true;
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
  }, [props.active, props.projectPath]);

  return (
    <div
      className="xterm-surface"
      data-testid="xterm-surface"
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 160 }}
    />
  );
}
