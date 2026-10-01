/**
 * Fold rail: the open folds the reader is inside of, pinned to the top of the
 * viewport once their headers have scrolled away.
 *
 * Long call chains put the header that owns them far above what is on screen;
 * collapsing used to mean scrolling back to it. Each row here proxies its real
 * header (`collapseFoldWithAnchor`), so state stays owned by the fold and the
 * reader's place survives the collapse. Esc collapses the innermost one.
 *
 * Viewport chrome, not transcript content: it lives beside `.chat-stream`
 * like the history ticks and the jump-to-latest button, never inside the
 * virtualized list (whose slots clip and transform their contents).
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { IconChevronDown } from './shell-icons';
import { TRANSCRIPT_TURN_MEASURE_EVENT } from './transcript-turn-measure.js';
import {
  collapseFoldWithAnchor,
  FOLD_RAIL_MAX_ROWS,
  pinnedFoldChain,
  type OpenFold,
} from './work-fold-anchor.js';

export type TranscriptFoldRailProps = {
  scrollElementRef: RefObject<HTMLDivElement | null>;
  beginProgrammaticScroll: () => void;
  locale: 'zh-CN' | 'en';
};

type RailGeometry = { left: number; width: number };

function sameChain(left: readonly OpenFold[], right: readonly OpenFold[]): boolean {
  return left.length === right.length && left.every((fold, index) => fold.id === right[index]?.id);
}

export function TranscriptFoldRail(props: TranscriptFoldRailProps): ReactElement | null {
  const [chain, setChain] = useState<readonly OpenFold[]>([]);
  const [geometry, setGeometry] = useState<RailGeometry | null>(null);
  const chainRef = useRef<readonly OpenFold[]>([]);
  const frameRef = useRef<number | null>(null);
  const zh = props.locale === 'zh-CN';

  const update = useCallback((): void => {
    frameRef.current = null;
    const container = props.scrollElementRef.current;
    if (!container) return;
    const next = pinnedFoldChain(container);
    if (!sameChain(next, chainRef.current)) {
      chainRef.current = next;
      setChain(next);
    }
    // The chat column is centered (and resized by panes); align to it, not to the shell.
    const thread = container.querySelector<HTMLElement>('.chat-thread');
    const shell = container.parentElement;
    if (thread && shell) {
      const threadRect = thread.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const left = Math.round(threadRect.left - shellRect.left);
      const width = Math.round(threadRect.width);
      setGeometry((current) =>
        current !== null && current.left === left && current.width === width
          ? current
          : { left, width },
      );
    }
  }, [props.scrollElementRef]);

  const schedule = useCallback((): void => {
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(update);
  }, [update]);

  useEffect(() => {
    const container = props.scrollElementRef.current;
    if (!container) return;
    container.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener(TRANSCRIPT_TURN_MEASURE_EVENT, schedule);
    // A fold opening or closing flips `data-fold-open` on its header.
    const observer =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    observer?.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-fold-open'],
      childList: true,
    });
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(container);
    schedule();
    return () => {
      container.removeEventListener('scroll', schedule);
      document.removeEventListener(TRANSCRIPT_TURN_MEASURE_EVENT, schedule);
      observer?.disconnect();
      resize?.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [props.scrollElementRef, schedule]);

  const collapse = useCallback(
    (fold: OpenFold): void => {
      const container = props.scrollElementRef.current;
      if (!container) return;
      collapseFoldWithAnchor(container, fold.header, {
        beginProgrammaticScroll: props.beginProgrammaticScroll,
      });
    },
    [props.beginProgrammaticScroll, props.scrollElementRef],
  );

  // Esc closes the innermost fold the reader is inside — but never steals it
  // from a composer, dialog or menu: only from the transcript itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const innermost = chainRef.current[chainRef.current.length - 1];
      const container = props.scrollElementRef.current;
      if (!innermost || !container) return;
      const target = event.target;
      const inTranscript =
        target === document.body ||
        (target instanceof Node && container.parentElement?.contains(target) === true);
      if (!inTranscript) return;
      event.preventDefault();
      collapse(innermost);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [collapse, props.scrollElementRef]);

  if (chain.length === 0) return null;
  const shown = chain.slice(-FOLD_RAIL_MAX_ROWS);
  return (
    <div
      className="transcript-fold-rail"
      data-testid="transcript-fold-rail"
      role="navigation"
      aria-label={zh ? '当前所在的折叠' : 'Enclosing folds'}
      style={geometry ? { left: geometry.left, width: geometry.width } : undefined}
    >
      {shown.map((fold, index) => (
        <button
          key={fold.id}
          type="button"
          className="work-h transcript-fold-rail-row"
          data-testid="transcript-fold-rail-row"
          data-fold-level={fold.level}
          style={{ paddingLeft: `calc(var(--row-pad, 8px) + ${index * 12}px)` }}
          onClick={() => collapse(fold)}
          aria-label={`${zh ? '收起' : 'Collapse'} ${fold.title}`}
        >
          <IconChevronDown className="transcript-fold-rail-chev" width={12} height={12} />
          <b className="transcript-fold-rail-title">{fold.title}</b>
          <span className="transcript-fold-rail-meta">{fold.meta}</span>
          <span className="transcript-fold-rail-close">{zh ? '收起' : 'Collapse'}</span>
        </button>
      ))}
    </div>
  );
}
