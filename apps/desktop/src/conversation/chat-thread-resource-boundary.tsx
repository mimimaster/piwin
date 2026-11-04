import { useCallback, useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';
import { useSessionRenderRetention } from '../hooks/use-session-render-retention.js';

/** Reclaims rows/images/tool views without unmounting the composer or its scroll viewport. */
export function ChatThreadResourceBoundary(props: {
  sessionId: string | undefined;
  children: (elementRef: RefObject<HTMLDivElement | null>) => ReactElement;
}): ReactElement {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const lastHeight = useRef(0);
  const measure = useCallback((): void => {
    const height = elementRef.current?.getBoundingClientRect().height ?? 0;
    // display:none reports zero after tab changes; keep the last painted size.
    if (height > 0) lastHeight.current = height;
  }, []);
  const retained = useSessionRenderRetention({
    ...(props.sessionId !== undefined ? { sessionId: props.sessionId } : {}),
    beforeReclaim: measure,
  });
  useLayoutEffect(() => {
    if (!retained) return;
    measure();
    const element = elementRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [retained, measure]);
  return retained ? (
    props.children(elementRef)
  ) : (
    <div
      className="chat-thread"
      data-testid="chat-thread-reclaimed"
      aria-hidden="true"
      style={{ height: lastHeight.current }}
    />
  );
}
