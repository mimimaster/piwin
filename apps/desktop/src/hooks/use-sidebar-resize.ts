/**
 * Pointer-driven horizontal resize for the left navigator.
 * Updates CSS --sidebar-width via onWidthChange; persists on pointer-up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampSidebarWidth,
  clampSidebarWidthForViewport,
  loadSidebarWidth,
  saveSidebarWidth,
  shouldCollapseSidebar,
  shouldExpandSidebar,
} from '../sidebar-width';
import { isOverlayShellLayout, type ShellLayoutMode } from '../shell-layout';
import { usePanelWidthCommit } from './use-panel-width-commit.js';

/** Write the live width straight to the shell so drag does not wait on React. */
function writeSidebarWidthCss(shell: HTMLElement | null, widthPx: number): void {
  shell?.style.setProperty('--sidebar-width', `${widthPx}px`);
}

function findAppShell(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return document.querySelector<HTMLElement>('.app-shell');
}

export type UseSidebarResizeOptions = {
  layoutMode: ShellLayoutMode;
  /** Right panel currently open (reserves chrome on desktop). */
  rightPanelOpen: boolean;
  /** Right panel CSS width in px. */
  rightPanelWidthPx?: number;
  /** Drag past min width: collapse the navigator. Last valid width is kept. */
  onCollapseRequest?: () => void;
  /** Reverse-drag back to min width after collapse, without releasing. */
  onExpandRequest?: () => void;
};

export type UseSidebarResizeResult = {
  widthPx: number;
  isResizing: boolean;
  onResizePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  setWidthPx: (widthPx: number) => void;
};

export function useSidebarResize(options: UseSidebarResizeOptions): UseSidebarResizeResult {
  const rightPanelWidthPx = options.rightPanelWidthPx ?? 0;
  const [widthPx, setWidthState] = useState(() => loadSidebarWidth());
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(widthPx);
  const shellRef = useRef<HTMLElement | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    collapsed: boolean;
  } | null>(null);
  // Drag updates CSS only; React width state commits on pointer-up.

  useEffect(() => {
    widthRef.current = widthPx;
  }, [widthPx]);

  const collapseRequestRef = useRef(options.onCollapseRequest);
  useEffect(() => {
    collapseRequestRef.current = options.onCollapseRequest;
  }, [options.onCollapseRequest]);

  const expandRequestRef = useRef(options.onExpandRequest);
  useEffect(() => {
    expandRequestRef.current = options.onExpandRequest;
  }, [options.onExpandRequest]);

  const resolveShell = useCallback((): HTMLElement | null => {
    if (shellRef.current !== null) {
      return shellRef.current;
    }
    shellRef.current = findAppShell();
    return shellRef.current;
  }, []);

  const writeLiveWidth = useCallback(
    (nextWidth: number): void => {
      writeSidebarWidthCss(resolveShell(), nextWidth);
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
        options.layoutMode === 'desktop' && options.rightPanelOpen ? rightPanelWidthPx : 0;
      return clampSidebarWidthForViewport(candidate, viewport, {
        reservedChromePx: reserved,
        minStagePx: isOverlayShellLayout(options.layoutMode) ? 0 : 280,
      });
    },
    [options.layoutMode, options.rightPanelOpen, rightPanelWidthPx],
  );

  const setWidthPx = useCallback(
    (next: number) => {
      flushPendingWidth();
      const clamped = resolveClamp(next);
      widthRef.current = clamped;
      writeLiveWidth(clamped);
      setWidthState(clamped);
      saveSidebarWidth(clamped);
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
      collapsed: false,
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
      // Dragging the right edge: move right → wider sidebar.
      const delta = event.clientX - drag.startX;
      const candidate = drag.startWidth + delta;
      if (shouldCollapseSidebar(candidate)) {
        if (!drag.collapsed) {
          drag.collapsed = true;
          saveSidebarWidth(widthRef.current);
          collapseRequestRef.current?.();
        }
        return;
      }
      if (drag.collapsed) {
        if (!shouldExpandSidebar(candidate)) {
          return;
        }
        drag.collapsed = false;
        const restored = resolveClamp(candidate);
        widthRef.current = restored;
        scheduleLiveWidth(restored);
        expandRequestRef.current?.();
        return;
      }
      const next = resolveClamp(candidate);
      if (next === widthRef.current) {
        return;
      }
      widthRef.current = next;
      // Coalesce grid writes to one per animation frame to avoid synchronous
      // layout thrashing on every pointer event.
      scheduleLiveWidth(next);
    }

    function endDrag(event: PointerEvent): void {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      flushPendingWidth();
      dragRef.current = null;
      const commit = widthRef.current;
      writeLiveWidth(commit);
      setWidthState(commit);
      setTimeout(() => {
        setIsResizing(false);
      }, 60);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (!drag.collapsed) {
        saveSidebarWidth(commit);
      }
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      flushPendingWidth();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [flushPendingWidth, isResizing, resolveClamp, scheduleLiveWidth, writeLiveWidth]);

  useEffect(() => {
    function onWindowResize(): void {
      const clamped = resolveClamp(widthRef.current);
      if (clamped !== widthRef.current) {
        widthRef.current = clamped;
        writeLiveWidth(clamped);
        setWidthState(clamped);
        saveSidebarWidth(clamped);
      }
    }
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [resolveClamp, writeLiveWidth]);

  return {
    widthPx: clampSidebarWidth(widthPx),
    isResizing,
    onResizePointerDown,
    setWidthPx,
  };
}
