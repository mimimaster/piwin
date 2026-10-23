/**
 * xterm.js surface bound to Tauri PTY (ADR 0013).
 * Presentational + I/O only; trust gate stays in TerminalDock.
 *
 * The terminal is not opened until the container has a real layout size.
 * This prevents fitAddon from computing a 0/1-column grid while the right
 * panel is collapsed or the tab is hidden, which was the source of garbled
 * prompt output and diagonal wrapping.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { HostAttachTarget } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { TAURI_PTY_TRANSPORT, type XtermPty } from './xterm-pty-transport.js';
import { connectXtermPty } from './xterm-pty-connection.js';
import { listenForTuiSession } from './xterm-tui-session';
import { readDeckXtermFontFamily, readDeckXtermTheme } from './xterm-theme';
import { attachXtermWebglRenderer, type XtermRenderer } from './xterm-webgl-renderer';
import { attachXtermImageLinks } from './xterm-image-links.js';
import { attachXtermImageAddon, type XtermImages } from './xterm-image-addon';
import { fullBleedColumns } from './xterm-fit-gutter';
import {
  tauriPtyOpen,
  tauriPtyOpenTui,
} from '../host/tauri-pty';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from '../context-menu';

export type PtyStatus = 'idle' | 'starting' | 'open' | 'error' | 'exited';

export type XtermSurfaceProps = {
  /** Actual working directory for the terminal. */
  cwd: string;
  /** A retained conversation terminal only fits/focuses while visible. */
  visible?: boolean | undefined;
  /** Project root for authorization (empty = general-scope terminal). */
  projectPath?: string;
  /**
   * Run the terminal shell (`piwin tui`) instead of a login shell, on this
   * session or on a new conversation. `cwd` is unused then: the program is
   * Desktop's own CLI; `projectPath` scopes a new conversation.
   */
  tui?: { sessionId?: string; remoteTarget?: HostAttachTarget } | undefined;
  pty?: XtermPty | undefined;
  onStatus: (status: PtyStatus, ptyId: string | null, message?: string) => void;
  /** The terminal shell announced the session it shows (see `parseTuiSessionAnnouncement`). */
  onTuiSession?: (sessionId: string) => void;
  /** The program set the window title (OSC 0/2). */
  onTitle?: ((title: string) => void) | undefined;
  /** The program's `[Open Image]` button was clicked; Desktop shows the file itself. */
  onOpenImage?: ((fileName: string) => void) | undefined;
  /**
   * The program paints its own full-screen surface (Grok and other native CLIs).
   * FitAddon otherwise keeps a scrollbar gutter that shows up as a right-hand band.
   */
  fullBleed?: boolean | undefined;
};

const MIN_OPEN_WIDTH = 40;
const MIN_OPEN_HEIGHT = 40;
const RESIZE_DEBOUNCE_MS = 120;

function reclaimFullBleedColumns(terminal: Terminal, container: HTMLElement): void {
  const screen = container.querySelector('.xterm-screen');
  const element = terminal.element;
  if (!(screen instanceof HTMLElement) || element === undefined) return;
  const style = getComputedStyle(element);
  const paddingX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const columns = fullBleedColumns({
    screenWidth: screen.getBoundingClientRect().width,
    columns: terminal.cols,
    containerWidth: container.clientWidth,
    paddingX,
  });
  if (columns === undefined || columns === terminal.cols) return;
  terminal.resize(columns, terminal.rows);
}

export function XtermSurface(props: XtermSurfaceProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const bootingRef = useRef(false);
  const visibleRef = useRef(props.visible !== false);
  visibleRef.current = props.visible !== false;
  const showRef = useRef<(() => void) | null>(null);
  const onStatusRef = useRef(props.onStatus);
  const onTuiSessionRef = useRef(props.onTuiSession);
  const onTitleRef = useRef(props.onTitle);
  const onOpenImageRef = useRef(props.onOpenImage);
  const contextMenu = useDesktopContextMenu();
  // CM-13: terminal-selection menu target, captured on right-click.
  // The menu stays mounted so a single right-click opens it; last non-null
  // selection keeps it populated when Radix clears the xterm selection.
  const [selectionTarget, setSelectionTarget] = useState<ContextMenuTarget | null>(null);
  const lastSelectionRef = useRef<ContextMenuTarget | null>(null);
  onStatusRef.current = props.onStatus;
  onTuiSessionRef.current = props.onTuiSession;
  onTitleRef.current = props.onTitle;
  onOpenImageRef.current = props.onOpenImage;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const transport = props.pty?.transport ?? TAURI_PTY_TRANSPORT;
    let disposed = false;
    const connection = new AbortController();
    let lastSize: { cols: number; rows: number } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
    let renderer: XtermRenderer | null = null;
    let images: XtermImages | null = null;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: readDeckXtermFontFamily(),
      theme: readDeckXtermTheme(),
      // `--xterm-canvas` may be transparent on the native window material.
      allowTransparency: true,
      allowProposedApi: false,
      // A full-screen program positions the cursor itself; rewriting its line
      // feeds would shift every frame.
      convertEol: props.tui === undefined && props.pty === undefined,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const titleSubscription = terminal.onTitleChange((title) => onTitleRef.current?.(title));
    const stopListeningForTuiSession = listenForTuiSession(terminal, (sessionId) =>
      onTuiSessionRef.current?.(sessionId),
    );
    // Only a surface with a consumer takes the click away from the program.
    const detachImageLinks = props.onOpenImage === undefined ? null : attachXtermImageLinks(
      terminal, containerRef.current, (fileName) => onOpenImageRef.current?.(fileName),
    );

    const hasUsableSize = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect();
      return rect.width >= MIN_OPEN_WIDTH && rect.height >= MIN_OPEN_HEIGHT;
    };

    const applyResize = (): void => {
      if (disposed || !containerRef.current || !terminalRef.current || !fitAddonRef.current) {
        return;
      }
      if (!visibleRef.current || !hasUsableSize(containerRef.current)) {
        return;
      }
      try {
        fitAddonRef.current.fit();
        const terminal = terminalRef.current;
        const container = containerRef.current;
        if (props.fullBleed === true && terminal !== null && container !== null) {
          reclaimFullBleedColumns(terminal, container);
        }
      } catch {
        // fit can throw if container is display:none or too small
        return;
      }
      const ptyId = ptyIdRef.current;
      if (!ptyId) return;
      const dims = { cols: terminalRef.current.cols, rows: terminalRef.current.rows };
      if (lastSize?.cols === dims.cols && lastSize.rows === dims.rows) return;
      lastSize = dims;
      void transport.resize(ptyId, dims.cols, dims.rows).catch(() => {
        /* ignore resize races during teardown */
      });
    };

    showRef.current = () => {
      if (disposed || !visibleRef.current) return;
      applyResize();
      if (terminalRef.current === null) return;
      terminal.refresh(0, terminal.rows - 1);
      if (ptyIdRef.current !== null && (props.tui !== undefined || props.pty !== undefined)) terminal.focus();
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
        renderer = attachXtermWebglRenderer(terminal);
        containerRef.current.dataset.renderer = renderer.kind;
        // After the renderer: the image layer sits above whichever renderer is active.
        images = attachXtermImageAddon(terminal);
        containerRef.current.dataset.images = images.enabled ? 'on' : 'off';
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
        if (props.fullBleed === true && containerRef.current) {
          reclaimFullBleedColumns(terminal, containerRef.current);
        }
      } catch {
        /* empty */
      }

      terminal.onData((data) => {
        const ptyId = ptyIdRef.current;
        if (!ptyId) return;
        void transport.write(ptyId, data).catch(() => {
          /* drop write if session already closed */
        });
      });

      try {
        const size = { cols: terminal.cols, rows: terminal.rows };
        lastSize = size;
        await connectXtermPty({
          signal: connection.signal,
          transport,
          open: () => props.pty !== undefined ? props.pty.open(size) : props.tui === undefined
            ? tauriPtyOpen({
                cwd: props.cwd,
                ...(props.projectPath ? { projectPath: props.projectPath } : {}),
                ...size,
              })
            : tauriPtyOpenTui({
                ...(props.tui.sessionId ? { sessionId: props.tui.sessionId } : {}),
                ...(props.tui.remoteTarget === undefined ? {} : { remoteTarget: props.tui.remoteTarget }),
                ...(props.projectPath ? { projectPath: props.projectPath } : {}),
                ...size,
              }),
          onOpen: (ptyId) => {
            ptyIdRef.current = ptyId;
            onStatusRef.current('open', ptyId);
            if (visibleRef.current && (props.tui !== undefined || props.pty !== undefined)) terminal.focus();
            applyResize();
          },
          onData: (data) => terminal.write(data),
          onExit: (event) => {
            terminal.writeln('\r\n[process exited]');
            ptyIdRef.current = null;
            onStatusRef.current('exited', event.pty_id);
          },
        });
      } catch (error) {
        if (disposed) return;
        const message = formatError(error);
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

    const themeObserver = new MutationObserver(() => {
      if (disposed) {
        return;
      }
      terminal.options.theme = readDeckXtermTheme();
      terminal.options.fontFamily = readDeckXtermFontFamily();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-id', 'data-theme-mode', 'style'],
    });

    return () => {
      disposed = true;
      showRef.current = null;
      bootingRef.current = false;
      themeObserver.disconnect();
      if (resizeDebounce) {
        clearTimeout(resizeDebounce);
      }
      resizeObserver?.disconnect();
      connection.abort();
      ptyIdRef.current = null;
      stopListeningForTuiSession();
      titleSubscription.dispose();
      detachImageLinks?.();
      images?.dispose();
      renderer?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [props.cwd, props.projectPath, props.tui?.sessionId, props.tui?.remoteTarget, props.pty, props.fullBleed]);

  useEffect(() => {
    if (props.visible === false) { terminalRef.current?.blur(); return; }
    const frame = requestAnimationFrame(() => showRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [props.visible]);

  // CM-13: read the xterm selection on right-click; only then show the menu.
  function handleContextMenu(): void {
    const selected = terminalRef.current?.getSelection().trim();
    if (!contextMenu || !selected) {
      setSelectionTarget(null);
      return;
    }
    const next: ContextMenuTarget = {
      surface: 'terminal-selection',
      selectedText: selected.slice(0, 8000),
      label: 'Terminal selection',
    };
    lastSelectionRef.current = next;
    setSelectionTarget(next);
  }

  const surface = (
    <div
      className="xterm-surface"
      data-testid="xterm-surface"
      ref={containerRef}
      onContextMenu={handleContextMenu}
      style={{ width: '100%', height: '100%', minHeight: 160 }}
    />
  );

  if (!contextMenu) {
    return surface;
  }
  return (
    <ContextMenuFromCatalog
      testId="terminal-selection-context-menu"
      target={selectionTarget ?? lastSelectionRef.current}
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      {surface}
    </ContextMenuFromCatalog>
  );
}
