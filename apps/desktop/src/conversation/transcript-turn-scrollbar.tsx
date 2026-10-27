/**
 * Floating scrollbar in whole-session turn coordinates (see
 * transcript-turn-scale.ts). Inside the resident window it scrolls by
 * pixels; dragged or clicked past it, it seeks the turn there through the
 * same jump as a history tick (with a way back), on release for a drag.
 */
import type { ReactElement, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import type { SessionUserMessageIndexData } from '@piwin/contracts';
import { useTranscriptScrollPort } from './transcript-scroll-port';
import { jumpToHistoryMessage, type HistoryAnchorJumpHandler } from '../session/history-anchor-jump.js';
import {
  computeTurnScrollThumb,
  findTurnAnchor,
  isWholeSessionResident,
  resolveTurnScrollTarget,
  turnOrdinalAtFraction,
  type ResidentTurnSpan,
} from './transcript-turn-scale.js';

type DragPreview = {
  /** Track fraction under the pointer. */
  fraction: number;
  /** Turn a release would seek; null while the drag stays inside the window. */
  seekOrdinal: number | null;
};

export function TranscriptTurnScrollbar(props: {
  isOverflowing: boolean;
  scrollRatio: number;
  scrollProgress: number;
  span: ResidentTurnSpan | null;
  historyIndex: SessionUserMessageIndexData | null;
  onJumpToAnchor: HistoryAnchorJumpHandler | undefined;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const port = useTranscriptScrollPort();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const { span, historyIndex, onJumpToAnchor } = props;
  // Whole-session coordinates only matter when some turns are not resident.
  const turnSpan = isWholeSessionResident(span) ? null : span;
  const visible = props.isOverflowing || turnSpan !== null;

  const seekTurn = useCallback(
    (ordinal: number): void => {
      const anchor = historyIndex ? findTurnAnchor(historyIndex.anchors, ordinal) : null;
      if (!anchor) return;
      jumpToHistoryMessage({ port, messageId: anchor.messageId, anchor, onJumpToAnchor });
    },
    [historyIndex, onJumpToAnchor, port],
  );

  /** Apply a track position: scroll in place, or return the turn to seek. */
  const applyFraction = useCallback(
    (fraction: number): number | null => {
      const container = port?.scrollElementRef.current;
      if (!container) return null;
      const target = resolveTurnScrollTarget({
        span: turnSpan,
        fraction,
        maxScrollTop: container.scrollHeight - container.clientHeight,
      });
      if (target.kind === 'turn') return target.ordinal;
      container.scrollTop = target.scrollTop;
      return null;
    },
    [port, turnSpan],
  );

  const fractionAt = useCallback((clientY: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  }, []);

  const handleTrackMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (event.target !== trackRef.current) return;
      event.preventDefault();
      const ordinal = applyFraction(fractionAt(event.clientY));
      if (ordinal !== null) seekTurn(ordinal);
    },
    [applyFraction, fractionAt, seekTurn],
  );

  const handleThumbMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      let seekOrdinal: number | null = null;
      const handleMouseMove = (moveEvent: MouseEvent): void => {
        const fraction = fractionAt(moveEvent.clientY);
        seekOrdinal = applyFraction(fraction);
        setDrag({ fraction, seekOrdinal });
      };
      const handleMouseUp = (): void => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        setDrag(null);
        // One seek per drag: the Host window is fetched only where it ends.
        if (seekOrdinal !== null) seekTurn(seekOrdinal);
      };
      setDrag({ fraction: Number.NaN, seekOrdinal: null });
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [applyFraction, fractionAt, seekTurn],
  );

  const thumb = computeTurnScrollThumb({
    span: turnSpan,
    scrollRatio: props.scrollRatio,
    scrollProgress: props.scrollProgress,
  });
  // Past the window the transcript cannot follow the pointer; the thumb does.
  const thumbTopPct =
    drag?.seekOrdinal != null
      ? Math.min(Math.max(drag.fraction, 0), 1) * (100 - thumb.heightPct)
      : thumb.topPct;
  const label =
    drag && turnSpan && Number.isFinite(drag.fraction)
      ? formatTurnLabel(turnOrdinalAtFraction(turnSpan, drag.fraction) + 1, turnSpan.total, props.locale)
      : null;

  return (
    <div
      className={
        visible ? 'chat-stream-floating-scrollbar is-visible' : 'chat-stream-floating-scrollbar'
      }
      data-testid="chat-stream-floating-scrollbar"
      data-turn-scale={turnSpan ? 'session' : 'window'}
      aria-hidden="true"
      ref={trackRef}
      onMouseDown={handleTrackMouseDown}
    >
      <div
        className="chat-stream-floating-scrollbar-thumb"
        data-testid="chat-stream-floating-scrollbar-thumb"
        style={{ height: `${thumb.heightPct}%`, top: `${thumbTopPct}%` }}
        onMouseDown={handleThumbMouseDown}
      >
        {label ? (
          <span className="chat-stream-floating-scrollbar-label" data-testid="turn-scrollbar-label">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function formatTurnLabel(turn: number, total: number, locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN' ? `第 ${turn} / ${total} 轮` : `Turn ${turn} of ${total}`;
}
