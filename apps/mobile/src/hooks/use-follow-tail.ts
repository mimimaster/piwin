import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const FOLLOW_TAIL_THRESHOLD_PX = 64;

export function isFollowTailNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx = FOLLOW_TAIL_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

export interface FollowTail {
  /** False once the reader scrolled up; the page offers a way back. */
  atTail: boolean;
  jumpToTail: () => void;
}

/**
 * Stick to the latest turn only while the user is already at the tail.
 * Streaming must not call scrollIntoView on every token — that fights
 * pan gestures on iOS WKWebView.
 */
export function useFollowTail(options: {
  axisRef: RefObject<HTMLElement | null>;
  revision: string;
}): FollowTail {
  const followRef = useRef(true);
  const programmaticRef = useRef(false);
  const [atTail, setAtTail] = useState(true);
  const { axisRef } = options;

  useEffect(() => {
    const node = options.axisRef.current;
    if (!node) {
      return;
    }
    const onScroll = () => {
      if (programmaticRef.current) {
        return;
      }
      const near = isFollowTailNearBottom(node.scrollTop, node.scrollHeight, node.clientHeight);
      followRef.current = near;
      setAtTail(near);
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', onScroll);
    };
  }, [options.axisRef]);

  useLayoutEffect(() => {
    const node = options.axisRef.current;
    if (!node || !followRef.current) {
      return;
    }
    programmaticRef.current = true;
    node.scrollTop = node.scrollHeight;
    const frame = window.requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      programmaticRef.current = false;
    };
  }, [options.revision]);

  const jumpToTail = useCallback(() => {
    const node = axisRef.current;
    if (!node) return;
    followRef.current = true;
    setAtTail(true);
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [axisRef]);

  return { atTail, jumpToTail };
}
