/**
 * Pointer-driven horizontal resize for the right workspace panel.
 * Updates CSS --right-panel-width via onWidthChange; persists on pointer-up.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  clampRightPanelWidth,
  clampRightPanelWidthForViewport,
  loadRightPanelWidth,
  saveRightPanelWidth,
} from '../right-panel-width';

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
  layoutMode: 'desktop' | 'compact';
  /** Left navigator currently open (reserves chrome on desktop). */
  navDrawerOpen: boolean;
  /** Sidebar CSS width in px (read once; default 260). */
  sidebarWidthPx?: number;
  /** Called when width should also adjust the OS window (desktop open only). */
  onLiveWidthCommit?: (widthPx: number) => void;
};

export type UseRightPanelResizeResult = {
  widthPx: number;
  isResizing: boolean;
  onResizePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** Apply a clamped width (e.g. double-click reset). */
  setWidthPx: (widthPx: number) => void;
};

export function useRightPanelResize(
  options: UseRightPanelResizeOptions,
): UseRightPanelResizeResult {
  const sidebarWidthPx = options.sidebarWidthPx ?? 260;
  const [widthPx, setWidthState] = useState(() => loadRightPanelWidth());
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(widthPx);
  const shellRef = useRef<HTMLElement | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const liveWidthCommitRef = useRef(options.onLiveWidthCommit);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  // Drag updates CSS only; React width state commits on pointer-up.

  useEffect(() => {
    widthRef.current = widthPx;
  }, [widthPx]);

  useEffect(() => {
    liveWidthCommitRef.current = options.onLiveWidthCommit;
  }, [options.onLiveWidthCommit]);

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

  // After every React commit, re-assert the live width so an unrelated App
  // re-render cannot snap --right-panel-width back to a stale style prop
  // while the user is mid-drag (or between rAF state flushes).
  useLayoutEffect(() => {
    writeLiveWidth(widthRef.current);
  });

  const resolveClamp = useCallback(
    (candidate: number): number => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const reserved =
        options.layoutMode === 'desktop' && options.navDrawerOpen ? sidebarWidthPx : 0;
      return clampRightPanelWidthForViewport(candidate, viewport, {
        reservedChromePx: reserved,
        // Keep the chat/composer column usable — below this the empty-state
        // composer card deforms when the right panel is dragged wide.
        minStagePx: options.layoutMode === 'compact' ? 0 : 420,
      });
    },
    [options.layoutMode, options.navDrawerOpen, sidebarWidthPx],
  );

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
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
    };
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

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
      const next = resolveClamp(drag.startWidth + delta);
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
      setWidthState(commit);
      liveWidthCommitRef.current?.(commit);
      // Keep transitions / blur disabled briefly after drag ends so the panel
      // does not animate from the already-correct width.
      setTimeout(() => {
        setIsResizing(false);
      }, 60);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveRightPanelWidth(commit);
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
  }, [flushPendingWidth, isResizing, resolveClamp, scheduleLiveWidth, writeLiveWidth]);

  // Re-clamp when viewport shrinks so the panel cannot cover the stage permanently.
  useEffect(() => {
    function onWindowResize(): void {
      const clamped = resolveClamp(widthRef.current);
      if (clamped !== widthRef.current) {
        widthRef.current = clamped;
        writeRightPanelWidthCss(clamped);
        setWidthState(clamped);
        saveRightPanelWidth(clamped);
        liveWidthCommitRef.current?.(clamped);
      }
    }
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [resolveClamp]);

  return {
    widthPx: clampRightPanelWidth(widthPx),
    isResizing,
    onResizePointerDown,
    setWidthPx,
  };
}
