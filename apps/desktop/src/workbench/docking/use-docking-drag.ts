import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAG_ACTIVATION_THRESHOLD_PX } from './constants.js';
import type { DropHighlight } from './drag-preview.js';
import type { Point } from './drag-hit-test.js';
import type { DropSource } from './types.js';

export type DragPreview = {
  ok: boolean;
  label: string | null;
  message: string | null;
  highlight: DropHighlight[];
};

export type DockDragState = {
  source: DropSource;
  point: Point;
  preview: DragPreview | null;
};

export type DockDragResolution = { preview: DragPreview; commit: () => void };

export type DockDragController = {
  drag: DockDragState | null;
  startDrag: (origin: Point, source: DropSource) => void;
  cancelDrag: () => void;
};

type Pending = { source: DropSource; origin: Point };

/**
 * Pointer-driven docking drag.
 *
 * Deliberately not built on HTML5 drag-and-drop: WKWebView (Tauri) reports
 * unreliable payloads and no useful `dragover` coordinates, which is exactly
 * what split previews need. Pointer events keep the same code path on macOS,
 * Windows, and the browser build.
 */
export function useDockingDrag(args: {
  enabled: boolean;
  resolve: (point: Point, source: DropSource) => DockDragResolution | null;
  onCommit: (commit: () => void) => void;
}): DockDragController {
  const [drag, setDrag] = useState<DockDragState | null>(null);
  const pending = useRef<Pending | null>(null);
  const active = useRef<DockDragState | null>(null);
  const latest = useRef(args);
  latest.current = args;

  const clear = useCallback(() => {
    pending.current = null;
    active.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      clear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clear, drag]);

  const startDrag = useCallback((origin: Point, source: DropSource) => {
    if (!latest.current.enabled) return;
    pending.current = { source, origin };
  }, []);

  useEffect(() => {
    if (!args.enabled) return;

    const resolveAt = (point: Point, source: DropSource): DockDragState => {
      const resolution = latest.current.resolve(point, source);
      const preview: DragPreview | null = resolution
        ? resolution.preview
        : { ok: false, label: null, message: null, highlight: [] };
      const next: DockDragState = { source, point, preview };
      active.current = next;
      return next;
    };

    const onPointerMove = (event: PointerEvent): void => {
      const point: Point = { x: event.clientX, y: event.clientY };
      const current = active.current;
      if (current) {
        setDrag(resolveAt(point, current.source));
        return;
      }
      const started = pending.current;
      if (!started) return;
      const travelled =
        Math.abs(point.x - started.origin.x) + Math.abs(point.y - started.origin.y);
      if (travelled < DRAG_ACTIVATION_THRESHOLD_PX) return;
      setDrag(resolveAt(point, started.source));
    };

    const onPointerUp = (): void => {
      const current = active.current;
      pending.current = null;
      if (!current) {
        active.current = null;
        return;
      }
      const resolution = latest.current.resolve(current.point, current.source);
      active.current = null;
      setDrag(null);
      if (!resolution?.preview.ok) return;
      latest.current.onCommit(resolution.commit);
    };

    const onPointerCancel = (): void => clear();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [args.enabled, clear]);

  return { drag, startDrag, cancelDrag: clear };
}
