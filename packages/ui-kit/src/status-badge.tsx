import type { ReactElement } from 'react';

export type StatusTone = 'running' | 'success' | 'warning' | 'danger' | 'neutral';

export type StatusBadgeProps = {
  tone?: StatusTone;
  /** Readable label is required — color alone is never enough. */
  label: string;
  showDot?: boolean;
  testId?: string;
};

/** Compact operational status with mandatory text label. */
export function StatusBadge(props: StatusBadgeProps): ReactElement {
  const tone = props.tone ?? 'neutral';
  const showDot = props.showDot !== false;
  return (
    <span
      className={`ui-status-badge tone-${tone}`}
      data-testid={props.testId ?? 'status-badge'}
      data-tone={tone}
    >
      {showDot ? <i className="ui-status-dot" aria-hidden /> : null}
      <span className="ui-status-label">{props.label}</span>
    </span>
  );
}
