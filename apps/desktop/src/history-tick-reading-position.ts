/**
 * Which history tick the reader is "in": the last user message whose anchor
 * has scrolled above the reading line. Lets the right-edge ruler show where
 * the viewport sits among all turns instead of being a uniform comb.
 */
import { useEffect, useMemo, useState } from 'react';
import { messageAnchorId } from './transcript-outline';

/** Reading line as a fraction of the viewport height from its top edge. */
const READING_LINE_FRACTION = 0.35;

export type MountedTickAnchor = {
  /** Index into the tick list. */
  tickIndex: number;
  /** Anchor top relative to the scroll viewport's top edge. */
  top: number;
};

/**
 * Pure resolution over the anchors the (virtualized) transcript has mounted.
 * When every mounted anchor sits below the reading line, the reader is in the
 * turn just before the first mounted one; `null` means "keep the last value".
 */
export function resolveReadingTickIndex(
  anchors: readonly MountedTickAnchor[],
  readingLine: number,
): number | null {
  let passed: MountedTickAnchor | null = null;
  let firstBelow: MountedTickAnchor | null = null;
  for (const anchor of anchors) {
    if (anchor.top <= readingLine) {
      if (!passed || anchor.tickIndex > passed.tickIndex) passed = anchor;
    } else if (!firstBelow || anchor.tickIndex < firstBelow.tickIndex) {
      firstBelow = anchor;
    }
  }
  if (passed) return passed.tickIndex;
  if (firstBelow) return Math.max(firstBelow.tickIndex - 1, 0);
  return null;
}

function measureReadingTickIndex(
  container: HTMLElement,
  tickIndexById: ReadonlyMap<string, number>,
): number | null {
  const bounds = container.getBoundingClientRect();
  const anchors: MountedTickAnchor[] = [];
  for (const [messageId, tickIndex] of tickIndexById) {
    const element = document.getElementById(messageAnchorId(messageId));
    if (!element || !container.contains(element)) continue;
    anchors.push({ tickIndex, top: element.getBoundingClientRect().top - bounds.top });
  }
  return resolveReadingTickIndex(anchors, bounds.height * READING_LINE_FRACTION);
}

/** Tracks the reading tick index for a transcript scroll container. */
export function useHistoryTickReadingPosition(
  container: HTMLElement | null,
  tickIds: readonly string[],
): number | null {
  const [readingIndex, setReadingIndex] = useState<number | null>(null);
  const tickIndexById = useMemo(
    () => new Map(tickIds.map((id, index) => [id, index] as const)),
    [tickIds],
  );

  useEffect(() => {
    if (!container || tickIndexById.size === 0) {
      setReadingIndex(null);
      return;
    }
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const next = measureReadingTickIndex(container, tickIndexById);
      if (next !== null) setReadingIndex(next);
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    container.addEventListener('scroll', schedule, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(container);
    return () => {
      container.removeEventListener('scroll', schedule);
      resizeObserver?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [container, tickIndexById]);

  return readingIndex;
}
