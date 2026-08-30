import { Button } from '@piwin/ui-kit';
import type { ReactElement } from 'react';
import { IconChevronRight } from './shell-icons.js';
import type { TurnWorkDisclosureProjection } from './turn-work-disclosure-model.js';

export type TurnWorkDisclosureProps = {
  projection: TurnWorkDisclosureProjection;
  open: boolean;
  locale: 'zh-CN' | 'en';
  onToggle: () => void;
};

function formatDuration(elapsedMs: number, locale: 'zh-CN' | 'en'): string {
  let remainingSeconds = Math.max(1, Math.round(elapsedMs / 1_000));
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds -= hours * 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds - minutes * 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  if (locale === 'zh-CN') {
    return `已工作 ${parts.join(' ')}`;
  }
  return `Worked for ${parts.join(' ')}`;
}

function summaryLabel(projection: TurnWorkDisclosureProjection, locale: 'zh-CN' | 'en'): string {
  const duration =
    projection.elapsedMs === undefined
      ? locale === 'zh-CN'
        ? '已工作'
        : 'Work'
      : formatDuration(projection.elapsedMs, locale);
  if (projection.failureCount === 0) return duration;
  if (locale === 'zh-CN') return `${duration} · ${projection.failureCount} 次失败`;
  return `${duration} · ${projection.failureCount} failure${projection.failureCount === 1 ? '' : 's'}`;
}

/** Turn-level disclosure around unchanged causal rows after the query settles. */
export function TurnWorkDisclosure(props: TurnWorkDisclosureProps): ReactElement {
  return (
    <div
      className={`turn-work-disclosure${props.open ? ' is-open' : ' is-collapsed'}`}
      data-testid="turn-work-disclosure"
      data-open={props.open ? 'true' : 'false'}
    >
      <Button
        variant="ghost"
        className="turn-work-disclosure-trigger"
        aria-expanded={props.open}
        data-testid="turn-work-disclosure-trigger"
        onClick={props.onToggle}
      >
        <span className="turn-work-disclosure-trigger-content">
          <span className="turn-work-disclosure-label">
            {summaryLabel(props.projection, props.locale)}
          </span>
          <span
            className={`turn-work-disclosure-chevron${props.open ? ' is-open' : ''}`}
            aria-hidden="true"
          >
            <IconChevronRight />
          </span>
        </span>
      </Button>
    </div>
  );
}
