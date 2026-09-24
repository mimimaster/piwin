import type { ReactElement } from 'react';
import type { ProgressRingTone } from './progress-ring.js';

export type ProgressBarProps = {
  /** Percentage 0–100. Undefined means indeterminate (work with no known size). */
  value?: number | undefined;
  /** Semantic color tone shared with ProgressRing. Default is 'pine'. */
  tone?: ProgressRingTone | undefined;
  /** Accessible description for screen readers. */
  label?: string | undefined;
  className?: string | undefined;
  testId?: string | undefined;
};

/**
 * Inkstone linear progress bar. Indeterminate mode sweeps instead of faking a
 * percentage, for operations (git clone, package install) that report none.
 */
export function ProgressBar({
  value,
  tone = 'pine',
  label,
  className,
  testId = 'progress-bar',
}: ProgressBarProps): ReactElement {
  const isDeterminate = typeof value === 'number' && !Number.isNaN(value);
  const clampedValue = isDeterminate ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  const classNames = [
    'ui-progress-bar',
    `ui-progress-bar--${tone}`,
    isDeterminate ? 'is-determinate' : 'is-indeterminate',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classNames}
      role="progressbar"
      aria-label={label ?? (isDeterminate ? `Progress: ${clampedValue}%` : 'Loading…')}
      aria-valuenow={isDeterminate ? clampedValue : undefined}
      aria-valuemin={isDeterminate ? 0 : undefined}
      aria-valuemax={isDeterminate ? 100 : undefined}
      data-testid={testId}
    >
      <div
        className="ui-progress-bar-indicator"
        style={isDeterminate ? { width: `${clampedValue}%` } : undefined}
      />
    </div>
  );
}
