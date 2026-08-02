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
} from '../sidebar-width';

export type UseSidebarResizeOptions = {
  layoutMode: 'desktop' | 'compact';
  /** Right panel currently open (reserves chrome on desktop). */
  rightPanelOpen: boolean;
  /** Right panel CSS width in px. */
  rightPanelWidthPx?: number;
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
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const pendingFrameRef = useRef<number | null>(null);

  useEffect(() => {
    widthRef.current = widthPx;
  }, [widthPx]);

  const resolveClamp = useCallback(
    (candidate: number): number => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const reserved =
        options.layoutMode === 'desktop' && options.rightPanelOpen ? rightPanelWidthPx : 0;
      return clampSidebarWidthForViewport(candidate, viewport, {
        reservedChromePx: reserved,
        minStagePx: options.layoutMode === 'compact' ? 0 : 280,
      });
    },
    [options.layoutMode, options.rightPanelOpen, rightPanelWidthPx],
  );

  const setWidthPx = useCallback(
    (next: number) => {
      const clamped = resolveClamp(next);
      widthRef.current = clamped;
      setWidthState(clamped);
      saveSidebarWidth(clamped);
    },
    [resolveClamp],
  );

  const onResizePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
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
      // Dragging the right edge: move right → wider sidebar.
      const delta = event.clientX - drag.startX;
      const next = resolveClamp(drag.startWidth + delta);
      if (next === widthRef.current) {
        return;
      }
      widthRef.current = next;
      if (pendingFrameRef.current != null) {
        return;
      }
      pendingFrameRef.current = requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        setWidthState(widthRef.current);
      });
    }

    function endDrag(event: PointerEvent): void {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      dragRef.current = null;
      if (pendingFrameRef.current != null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
        setWidthState(widthRef.current);
      }
      setTimeout(() => {
        setIsResizing(false);
      }, 60);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveSidebarWidth(widthRef.current);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      if (pendingFrameRef.current != null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, resolveClamp]);

  useEffect(() => {
    function onWindowResize(): void {
      const clamped = resolveClamp(widthRef.current);
      if (clamped !== widthRef.current) {
        widthRef.current = clamped;
        setWidthState(clamped);
        saveSidebarWidth(clamped);
      }
    }
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [resolveClamp]);

  return {
    widthPx: clampSidebarWidth(widthPx),
    isResizing,
    onResizePointerDown,
    setWidthPx,
  };
}
