import { useEffect } from 'react';
import { measureScrollEdgeOverflow } from '../scroll-edge-overflow';

/**
 * Mirrors which edges of `element` hide content onto `data-overflow-above` /
 * `data-overflow-below`, for CSS edge fades. Written straight to the DOM, not
 * React state: scroll fires every frame and the owner (the sidebar tree) is a
 * large component that must not re-render on scroll.
 *
 * Content height changes without a scroll (rows added, groups folded), so the
 * subtree is watched too; every trigger collapses into one rAF read.
 */
export function useScrollEdgeFade(element: HTMLElement | null): void {
  useEffect(() => {
    if (element === null) {
      return undefined;
    }
    let frame = 0;
    const sync = (): void => {
      frame = 0;
      const overflow = measureScrollEdgeOverflow(element);
      element.toggleAttribute('data-overflow-above', overflow.above);
      element.toggleAttribute('data-overflow-below', overflow.below);
    };
    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(sync);
      }
    };

    sync();
    element.addEventListener('scroll', schedule, { passive: true });
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(element, { childList: true, subtree: true });

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      element.removeEventListener('scroll', schedule);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeAttribute('data-overflow-above');
      element.removeAttribute('data-overflow-below');
    };
  }, [element]);
}
