/**
 * Hover preview for the history rail: when, which turn(s), what kind of
 * turn, and the opening of the user message. Portaled to document.body so
 * position:fixed is viewport-relative (parents use backdrop-filter, which
 * creates a containing block).
 */
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { SessionUserMessageTurnMark } from '@piwin/contracts';
import type { CollapsedBubbleAnchor } from './history-tick-geometry.js';
import type { HistoryTickGroup } from './history-tick-groups.js';

export type HistoryTickLocale = 'zh-CN' | 'en';

const TURN_MARK_LABELS: Record<HistoryTickLocale, Record<SessionUserMessageTurnMark, string>> = {
  'zh-CN': { error: '出错', compaction: '上下文压缩', branch: '分支', artifact: 'Artifact' },
  en: { error: 'Error', compaction: 'Compacted', branch: 'Branch', artifact: 'Artifact' },
};

export function formatTurnMarks(
  marks: readonly SessionUserMessageTurnMark[],
  locale: HistoryTickLocale,
): string {
  return marks.map((mark) => TURN_MARK_LABELS[locale][mark]).join(' · ');
}

export function formatFullTimestamp(createdAt?: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month} ${day}, ${hours}:${minutes} ${ampm}`;
}

export function truncateMessageText(text: string, maxLength: number = 100): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

/** "12 / 200" for one turn, "12–18 / 200" for a sampled anchor or merged segment. */
export function formatHistoryTickPosition(group: HistoryTickGroup, totalTurns: number): string {
  const start = group.spanStartOrdinal + 1;
  const end = group.spanEndOrdinal + 1;
  return start === end ? `${start} / ${totalTurns}` : `${start}–${end} / ${totalTurns}`;
}

export function HistoryTickBubble(props: {
  group: HistoryTickGroup;
  anchor: CollapsedBubbleAnchor;
  totalTurns: number;
  locale: HistoryTickLocale;
}): ReactElement {
  const { group, anchor, locale } = props;
  const marks = formatTurnMarks(group.marks, locale);
  return createPortal(
    <div
      id="history-message-bubble"
      className="history-message-bubble history-message-bubble--collapsed"
      data-testid="history-message-bubble"
      role="tooltip"
      style={{
        // Anchor the right edge so the bubble opens leftward off the rail
        // without measuring its own width.
        right: `${(document.documentElement.clientWidth || window.innerWidth) - anchor.edgeX}px`,
        top: `${anchor.top}px`,
      }}
    >
      <div className="history-bubble-header">
        <span className="history-bubble-time">
          {formatFullTimestamp(group.first.createdAt) || 'User message'}
        </span>
        <span className="history-bubble-position">
          {formatHistoryTickPosition(group, props.totalTurns)}
        </span>
      </div>
      {marks ? (
        <div className="history-bubble-marks" data-testid="history-bubble-marks">
          {marks}
        </div>
      ) : null}
      <div className="history-bubble-text">{truncateMessageText(group.first.text, 240)}</div>
    </div>,
    document.body,
  );
}
