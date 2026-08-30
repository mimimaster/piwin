import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  isRangeAttached,
  snapshotCardTextSelection,
  type CardSelectionSnapshot,
} from './card-text-selection';

function isInsideSelectionChrome(node: Node | null): boolean {
  if (!(node instanceof Element) && node?.parentElement) {
    return isInsideSelectionChrome(node.parentElement);
  }
  if (!(node instanceof Element)) return false;
  return Boolean(
    node.closest('[data-testid="card-selection-popover"]') ||
      node.closest('[data-testid="ui-popover-virtual-anchor"]') ||
      node.closest('.fc-tutor-panel'),
  );
}

export function useCardTextSelection(options: {
  containerRef: RefObject<Element | null>;
  enabled?: boolean;
}): {
  snapshot: CardSelectionSnapshot | null;
  getAnchorRect: () => DOMRect;
  dismiss: () => void;
} {
  const { containerRef, enabled = true } = options;
  const [snapshot, setSnapshot] = useState<CardSelectionSnapshot | null>(null);
  const snapshotRef = useRef<CardSelectionSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const dismiss = useCallback((): void => {
    snapshotRef.current = null;
    setSnapshot(null);
  }, []);

  const capture = useCallback((): void => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    const live = typeof window === 'undefined' ? null : window.getSelection();
    const next = snapshotCardTextSelection(container, live);
    if (next) {
      snapshotRef.current = next;
      setSnapshot(next);
      return;
    }
    if (!snapshotRef.current) return;
    // Keep the snapshot while clicking the popover so invoke is not raced off.
    if (
      isInsideSelectionChrome(live?.anchorNode ?? null) ||
      isInsideSelectionChrome(document.activeElement)
    ) {
      return;
    }
    dismiss();
  }, [containerRef, dismiss, enabled]);

  useEffect(() => {
    if (!enabled) {
      dismiss();
      return;
    }
    const onSelectionChange = (): void => {
      capture();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target) || isInsideSelectionChrome(target)) {
        return;
      }
      dismiss();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [capture, containerRef, dismiss, enabled]);

  const getAnchorRect = useCallback((): DOMRect => {
    const range = snapshotRef.current?.range;
    if (!range || !isRangeAttached(range)) {
      return new DOMRect();
    }
    try {
      return range.getBoundingClientRect();
    } catch {
      return new DOMRect();
    }
  }, []);

  return useMemo(
    () => ({ snapshot, getAnchorRect, dismiss }),
    [snapshot, getAnchorRect, dismiss],
  );
}
