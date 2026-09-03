/**
 * GoalTimeline — popover from the strip's round pill.
 *
 * Each row is a real goal event (objective, wait, block, complete). Clicking
 * a row with an anchor scrolls the matching card or user message into view;
 * the synthesized `running` row has no anchor and is not a button.
 */
import type { ReactElement } from 'react';
import type { GoalTimelineEvent, GoalTimelineEventKind } from './goal-session-model';

export type GoalTimelineProps = {
  events: readonly GoalTimelineEvent[];
  locale: 'zh-CN' | 'en';
  onJump: (event: GoalTimelineEvent) => void;
};

function kindLabel(kind: GoalTimelineEventKind, isZh: boolean): string {
  switch (kind) {
    case 'objective':
      return isZh ? '目标' : 'Goal';
    case 'running':
      return isZh ? '执行中' : 'Working';
    case 'waiting':
      return isZh ? '等待中' : 'Waiting';
    case 'waited':
      return isZh ? '已等待' : 'Waited';
    case 'blocked':
      return isZh ? '受阻' : 'Blocked';
    case 'completed':
      return isZh ? '已达成' : 'Done';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function formatClock(at: string, locale: 'zh-CN' | 'en'): string | null {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

export function jumpToGoalTimelineEvent(event: GoalTimelineEvent): void {
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = reducedMotion ? 'auto' : 'smooth';
  if (event.toolCallId) {
    const node = document.querySelector<HTMLElement>(
      `[data-tool-call-id="${cssEscape(event.toolCallId)}"]`,
    );
    node?.scrollIntoView({ behavior, block: 'center' });
    return;
  }
  if (event.messageId) {
    document
      .getElementById(`msg-${event.messageId}`)
      ?.scrollIntoView({ behavior, block: 'center' });
  }
}

export function GoalTimeline({ events, locale, onJump }: GoalTimelineProps): ReactElement {
  const isZh = locale === 'zh-CN';
  return (
    <ol className="goal-timeline" data-testid="goal-timeline">
      {events.map((event) => {
        const clock = event.at ? formatClock(event.at, locale) : null;
        const canJump = event.toolCallId !== null || event.messageId !== null;
        const inner = (
          <>
            <span className={`goal-timeline-dot dot-${event.kind}`} aria-hidden />
            <span className="goal-timeline-copy">
              <span className="goal-timeline-kind">{kindLabel(event.kind, isZh)}</span>
              {event.detail ? (
                <span className="goal-timeline-detail" title={event.detail}>
                  {event.detail}
                </span>
              ) : null}
            </span>
            {clock ? <span className="goal-timeline-clock">{clock}</span> : null}
          </>
        );
        if (!canJump) {
          return (
            <li
              key={event.id}
              className="goal-timeline-row is-static"
              data-kind={event.kind}
            >
              {inner}
            </li>
          );
        }
        return (
          <li key={event.id} className="goal-timeline-row" data-kind={event.kind}>
            <button
              type="button"
              className="goal-timeline-jump"
              data-testid={`goal-timeline-jump-${event.kind}`}
              onClick={() => onJump(event)}
            >
              {inner}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
