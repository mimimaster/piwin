/**
 * Pointer-driven horizontal resize for the right workspace panel.
 * Updates CSS --right-panel-width via onWidthChange; persists on pointer-up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampRightPanelWidth,
  clampRightPanelWidthForViewport,
  loadRightPanelWidth,
  saveRightPanelWidth,
  shouldEnterRightPanelFullWidth,
  shouldExitRightPanelFullWidth,
  shouldCollapseRightPanel,
  shouldExpandRightPanel,
  RIGHT_PANEL_STAGE_MIN_PX,
} from '../right-panel-width';
import { isOverlayShellLayout, type ShellLayoutMode } from '../shell-layout';
import { usePanelWidthCommit } from './use-panel-width-commit.js';
import { beginPanelResize } from '../panel-resize-activity.js';

/** Write the live width straight to the shell so drag does not wait on React. */
function writeRightPanelWidthCss(shell: HTMLElement | null, widthPx: number): void {
  shell?.style.setProperty('--right-panel-width', `${widthPx}px`);
}

function findAppShell(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return document.querySelector<HTMLElement>('.app-shell');
}

export type UseRightPanelResizeOptions = {
  /** Desktop in-flow column vs compact overlay drawer. */
  layoutMode: ShellLayoutMode;
  /** Left navigator currently open (reserves chrome on desktop). */
  navDrawerOpen: boolean;
  /** Sidebar CSS width in px (read once; default 260). */
  sidebarWidthPx?: number;
  /** Called when width should also adjust the OS window (desktop open only). */
  onLiveWidthCommit?: (widthPx: number) => void;
  /** Drag past min width: close the panel. Last valid width is kept. */
  onCollapseRequest?: () => void;
  /** Reverse-drag back to min width after collapse, without releasing. */
  onExpandRequest?: () => void;
  /**
   * Empty inspector (no open tool tabs) cannot cover the conversation.
   * Defaults to true so isolated resize tests keep the previous drag path.
   */
  canEnterFullWidth?: boolean;
};

export type UseRightPanelResizeResult = {
  widthPx: number;
  isResizing: boolean;
  /** Desktop only: right panel covers the conversation (sidebar remains). */
  isFullWidth: boolean;
  onResizePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** Apply a clamped width (e.g. double-click reset). */
  setWidthPx: (widthPx: number) => void;
  setFullWidth: (next: boolean) => void;
  toggleFullWidth: () => void;
};

export function useRightPanelResize(
  options: UseRightPanelResizeOptions,
): UseRightPanelResizeResult {
  const sidebarWidthPx = options.sidebarWidthPx ?? 260;
  const [widthPx, setWidthState] = useState(() => {
    const loaded = loadRightPanelWidth();
    if (typeof window === 'undefined' || isOverlayShellLayout(options.layoutMode)) {
      return loaded;
    }
    const reserved = options.navDrawerOpen ? sidebarWidthPx : 0;
    return clampRightPanelWidthForViewport(loaded, window.innerWidth, {
      reservedChromePx: reserved,
      minStagePx: RIGHT_PANEL_STAGE_MIN_PX,
    });
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isFullWidth, setFullWidthState] = useState(false);
  const widthRef = useRef(widthPx);
  const fullWidthRef = useRef(false);
  const shellRef = useRef<HTMLElement | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const liveWidthCommitRef = useRef(options.onLiveWidthCommit);
  /** Releases the shared drag signal; the drag effect re-runs mid-drag, so only pointer end or unmount releases it. */
  const releasePanelResizeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releasePanelResizeRef.current?.(), []);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    startedFullWidth: boolean;
    collapsed: boolean;
  } | null>(null);
  // Drag updates CSS only; React width state commits on pointer-up.

  useEffect(() => {
    widthRef.current = widthPx;
  }, [widthPx]);

  useEffect(() => {
    fullWidthRef.current = isFullWidth;
  }, [isFullWidth]);

  useEffect(() => {
    liveWidthCommitRef.current = options.onLiveWidthCommit;
  }, [options.onLiveWidthCommit]);

  const collapseRequestRef = useRef(options.onCollapseRequest);
  useEffect(() => {
    collapseRequestRef.current = options.onCollapseRequest;
  }, [options.onCollapseRequest]);

  const expandRequestRef = useRef(options.onExpandRequest);
  useEffect(() => {
    expandRequestRef.current = options.onExpandRequest;
  }, [options.onExpandRequest]);

  const canEnterFullWidth = options.canEnterFullWidth !== false;
  const canEnterFullWidthRef = useRef(canEnterFullWidth);
  useEffect(() => {
    canEnterFullWidthRef.current = canEnterFullWidth;
  }, [canEnterFullWidth]);

  const resolveShell = useCallback((): HTMLElement | null => {
    if (shellRef.current !== null) {
      return shellRef.current;
    }
    shellRef.current = findAppShell();
    return shellRef.current;
  }, []);

  const writeLiveWidth = useCallback(
    (nextWidth: number): void => {
      writeRightPanelWidthCss(resolveShell(), nextWidth);
    },
    [resolveShell],
  );

  const flushPendingWidth = useCallback((): void => {
    const pendingFrame = pendingFrameRef.current;
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
      pendingFrameRef.current = null;
    }
    const pendingWidth = pendingWidthRef.current;
    pendingWidthRef.current = null;
    if (pendingWidth !== null) {
      writeLiveWidth(pendingWidth);
    }
  }, [writeLiveWidth]);

  const scheduleLiveWidth = useCallback(
    (nextWidth: number): void => {
      pendingWidthRef.current = nextWidth;
      if (pendingFrameRef.current !== null) {
        return;
      }
      pendingFrameRef.current = requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        const pendingWidth = pendingWidthRef.current;
        pendingWidthRef.current = null;
        if (pendingWidth !== null) {
          writeLiveWidth(pendingWidth);
        }
      });
    },
    [writeLiveWidth],
  );

  usePanelWidthCommit(widthPx, isResizing, widthRef, writeLiveWidth);

  const resolveClamp = useCallback(
    (candidate: number): number => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const reserved =
        options.layoutMode === 'desktop' && options.navDrawerOpen ? sidebarWidthPx : 0;
      return clampRightPanelWidthForViewport(candidate, viewport, {
        reservedChromePx: reserved,
        // Keep the chat/composer column usable — below this the empty-state
        // composer card deforms when the right panel is dragged wide.
        minStagePx: isOverlayShellLayout(options.layoutMode) ? 0 : RIGHT_PANEL_STAGE_MIN_PX,
      });
    },
    [options.layoutMode, options.navDrawerOpen, sidebarWidthPx],
  );

  const resolveReservedChromePx = useCallback((): number => {
    return options.layoutMode === 'desktop' && options.navDrawerOpen ? sidebarWidthPx : 0;
  }, [options.layoutMode, options.navDrawerOpen, sidebarWidthPx]);

  const resolveViewportWidth = useCallback((): number => {
    return typeof window !== 'undefined' ? window.innerWidth : 1280;
  }, []);

  const commitFullWidth = useCallback((next: boolean): void => {
    if (options.layoutMode !== 'desktop') {
      if (fullWidthRef.current) {
        fullWidthRef.current = false;
        setFullWidthState(false);
      }
      return;
    }
    if (next && !canEnterFullWidthRef.current) {
      return;
    }
    if (fullWidthRef.current === next) {
      return;
    }
    fullWidthRef.current = next;
    setFullWidthState(next);
  }, [options.layoutMode]);

  const setWidthPx = useCallback(
    (next: number) => {
      flushPendingWidth();
      const clamped = resolveClamp(next);
      widthRef.current = clamped;
      writeLiveWidth(clamped);
      setWidthState(clamped);
      saveRightPanelWidth(clamped);
      liveWidthCommitRef.current?.(clamped);
    },
    [flushPendingWidth, resolveClamp, writeLiveWidth],
  );

  const setFullWidth = useCallback(
    (next: boolean): void => {
      commitFullWidth(next);
    },
    [commitFullWidth],
  );

  const toggleFullWidth = useCallback((): void => {
    commitFullWidth(!fullWidthRef.current);
  }, [commitFullWidth]);

  useEffect(() => {
    if (isOverlayShellLayout(options.layoutMode)) {
      commitFullWidth(false);
    }
  }, [commitFullWidth, options.layoutMode]);

  useEffect(() => {
    if (!canEnterFullWidth) {
      commitFullWidth(false);
    }
  }, [canEnterFullWidth, commitFullWidth]);

  const onResizePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    shellRef.current = target.closest<HTMLElement>('.app-shell') ?? findAppShell();
    pendingWidthRef.current = null;
    const reserved = resolveReservedChromePx();
    const viewport = resolveViewportWidth();
    const startedFullWidth = fullWidthRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: startedFullWidth
        ? Math.max(widthRef.current, viewport - reserved)
        : widthRef.current,
      startedFullWidth,
      collapsed: false,
    };
    releasePanelResizeRef.current?.();
    releasePanelResizeRef.current = beginPanelResize();
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [resolveReservedChromePx, resolveViewportWidth]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      // Dragging the left edge: move left → wider panel.
      const delta = drag.startX - event.clientX;
      const candidate = drag.startWidth + delta;
      const viewport = resolveViewportWidth();
      const reserved = resolveReservedChromePx();
      const desktop = options.layoutMode === 'desktop';
      const snapInput = {
        panelWidthPx: candidate,
        viewportWidth: viewport,
        reservedChromePx: reserved,
      };

      if (desktop && (drag.startedFullWidth || fullWidthRef.current)) {
        if (shouldExitRightPanelFullWidth(snapInput)) {
          drag.startedFullWidth = false;
          const clamped = resolveClamp(candidate);
          commitFullWidth(false);
          if (clamped === widthRef.current) {
            return;
          }
          widthRef.current = clamped;
          scheduleLiveWidth(clamped);
          liveWidthCommitRef.current?.(clamped);
        }
        return;
      }

      if (shouldCollapseRightPanel(candidate)) {
        if (!drag.collapsed) {
          drag.collapsed = true;
          commitFullWidth(false);
          const keep = widthRef.current;
          saveRightPanelWidth(keep);
          collapseRequestRef.current?.();
        }
        return;
      }

      if (drag.collapsed) {
        if (!shouldExpandRightPanel(candidate)) {
          return;
        }
        drag.collapsed = false;
        const restored = resolveClamp(candidate);
        widthRef.current = restored;
        scheduleLiveWidth(restored);
        liveWidthCommitRef.current?.(restored);
        expandRequestRef.current?.();
        return;
      }

      if (desktop && shouldEnterRightPanelFullWidth(snapInput)) {
        if (!canEnterFullWidthRef.current) {
          const next = resolveClamp(candidate);
          if (next !== widthRef.current) {
            widthRef.current = next;
            scheduleLiveWidth(next);
            liveWidthCommitRef.current?.(next);
          }
          return;
        }
        commitFullWidth(true);
        return;
      }

      const next = resolveClamp(candidate);
      if (next === widthRef.current) {
        return;
      }
      widthRef.current = next;
      // CSS-only during drag. Updating React width state every frame re-rendered
      // the entire App (file tree, transcript, glass blur) and caused visible flicker.
      // Coalesce grid writes to one per animation frame; aria / persistence catch
      // up on pointer-up.
      scheduleLiveWidth(next);
      liveWidthCommitRef.current?.(next);
    }

    function endDrag(event: PointerEvent): void {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      dragRef.current = null;
      flushPendingWidth();
      const commit = widthRef.current;
      writeLiveWidth(commit);
      releasePanelResizeRef.current?.();
      releasePanelResizeRef.current = null;
      setWidthState(commit);
      liveWidthCommitRef.current?.(commit);
      // Keep transitions / blur disabled briefly after drag ends so the panel
      // does not animate from the already-correct width.
      setTimeout(() => {
        setIsResizing(false);
      }, 60);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (!fullWidthRef.current && !drag.collapsed) {
        saveRightPanelWidth(commit);
      }
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      flushPendingWidth();
      dragRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [
    commitFullWidth,
    flushPendingWidth,
    isResizing,
    options.layoutMode,
    resolveClamp,
    resolveReservedChromePx,
    resolveViewportWidth,
    scheduleLiveWidth,
    writeLiveWidth,
  ]);

  // Re-clamp when viewport shrinks so the panel cannot cover the stage permanently.
  useEffect(() => {
    function applySplitClamp(): void {
      if (fullWidthRef.current) {
        return;
      }
      flushPendingWidth();
      const clamped = resolveClamp(widthRef.current);
      if (clamped !== widthRef.current) {
        widthRef.current = clamped;
        writeLiveWidth(clamped);
        setWidthState(clamped);
        saveRightPanelWidth(clamped);
        liveWidthCommitRef.current?.(clamped);
      }
    }
    applySplitClamp();
    function onWindowResize(): void {
      applySplitClamp();
    }
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [flushPendingWidth, resolveClamp, writeLiveWidth]);

  return {
    widthPx: isFullWidth ? clampRightPanelWidth(widthPx) : resolveClamp(widthPx),
    isResizing,
    onResizePointerDown,
    setWidthPx,
    isFullWidth,
    setFullWidth,
    toggleFullWidth,
  };
}
