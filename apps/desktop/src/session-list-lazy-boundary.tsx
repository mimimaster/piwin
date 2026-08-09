import { Spinner } from '@piwin/ui-kit';
import { useEffect, useRef, useState, type ReactElement } from 'react';

export type SessionListLazyBoundaryProps = {
  scopeKey: string;
  direction: 'previous' | 'next';
  cursor: string;
  loadingLabel: string;
  onLoad: () => boolean | Promise<boolean>;
};

type ScrollAnchor = {
  sessionId: string;
  top: number;
};

function captureScrollAnchor(root: HTMLElement): ScrollAnchor | null {
  const rootBounds = root.getBoundingClientRect();
  const rows = root.querySelectorAll<HTMLElement>('[data-session-id]');
  for (const row of rows) {
    const bounds = row.getBoundingClientRect();
    if (bounds.bottom >= rootBounds.top && bounds.top <= rootBounds.bottom) {
      const sessionId = row.dataset.sessionId;
      if (sessionId !== undefined) {
        return { sessionId, top: bounds.top };
      }
    }
  }
  return null;
}

function restoreScrollAnchor(root: HTMLElement, anchor: ScrollAnchor | null): void {
  if (anchor === null) {
    return;
  }
  const rows = root.querySelectorAll<HTMLElement>('[data-session-id]');
  for (const row of rows) {
    if (row.dataset.sessionId !== anchor.sessionId) {
      continue;
    }
    root.scrollTop += row.getBoundingClientRect().top - anchor.top;
    return;
  }
}

function waitForTwoAnimationFrames(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

/** Invisible cursor boundary that preserves the visible row across window shifts. */
export function SessionListLazyBoundary(props: SessionListLazyBoundaryProps): ReactElement {
  const boundaryRef = useRef<HTMLLIElement>(null);
  const cursorRef = useRef(props.cursor);
  const onLoadRef = useRef(props.onLoad);
  const lastRequestedCursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  cursorRef.current = props.cursor;
  onLoadRef.current = props.onLoad;

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (boundary === null || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const scrollRoot = boundary.closest<HTMLElement>('.sidebar-folder-tree');
    if (scrollRoot === null) {
      return;
    }
    let disposed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const intersects = entries.some((entry) => entry.isIntersecting);
        const cursor = cursorRef.current;
        if (!intersects || loadingRef.current || lastRequestedCursorRef.current === cursor) {
          return;
        }
        lastRequestedCursorRef.current = cursor;
        loadingRef.current = true;
        setLoading(true);
        const anchor = captureScrollAnchor(scrollRoot);
        void Promise.resolve(onLoadRef.current())
          .catch((error: unknown) => {
            console.warn(
              `[session-list] ${props.direction} lazy load failed for ${props.scopeKey}`,
              error,
            );
            return false;
          })
          .then(async () => {
            await waitForTwoAnimationFrames();
            if (disposed) {
              return;
            }
            restoreScrollAnchor(scrollRoot, anchor);
            // A successful load changes/removes the cursor. If it did not,
            // allow a later leave/re-enter intersection to retry the same page.
            if (cursorRef.current === cursor) {
              lastRequestedCursorRef.current = null;
            }
          })
          .finally(() => {
            loadingRef.current = false;
            if (!disposed) {
              setLoading(false);
            }
          });
      },
      {
        root: scrollRoot,
        rootMargin: '120px 0px',
        threshold: 0,
      },
    );
    observer.observe(boundary);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [props.direction, props.scopeKey]);

  return (
    <li
      ref={boundaryRef}
      className="session-list-lazy-boundary"
      data-testid={`session-lazy-${props.direction}`}
      data-session-scope={props.scopeKey}
      aria-live="polite"
    >
      {loading ? <Spinner label={props.loadingLabel} /> : null}
    </li>
  );
}
