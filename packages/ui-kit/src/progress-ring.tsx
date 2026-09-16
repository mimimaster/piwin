import type { ReactElement } from 'react';

export type ProgressRingTone = 'pine' | 'zhu' | 'lamp' | 'azure' | 'neutral';

export type ProgressRingProps = {
  /** Progress percentage value between 0 and 100. Undefined means indeterminate. */
  value?: number | undefined;
  /** Diameter of the circular ring in pixels. Default is 20. */
  size?: number | undefined;
  /** Width of the ring stroke in pixels. Default is 2.5. */
  strokeWidth?: number | undefined;
  /** Semantic color tone aligned to Inkstone theme tokens. Default is 'pine'. */
  tone?: ProgressRingTone | undefined;
  /** Whether to render numeric percentage text inside or alongside. Default is false. */
  showValue?: boolean | undefined;
  /** Accessible description for screen readers. */
  label?: string | undefined;
  /** Additional CSS class name. */
  className?: string | undefined;
  /** Test identifier attribute. */
  testId?: string | undefined;
};

/**
 * Inkstone circular progress indicator.
 * Supports determinate 0-100% fill and smooth indeterminate spinning.
 */
export function ProgressRing({
  value,
  size = 20,
  strokeWidth = 2.5,
  tone = 'pine',
  showValue = false,
  label,
  className,
  testId = 'progress-ring',
}: ProgressRingProps): ReactElement {
  const isDeterminate = typeof value === 'number' && !Number.isNaN(value);
  const clampedValue = isDeterminate ? Math.max(0, Math.min(100, Math.round(value))) : 0;

  const center = size / 2;
  const radius = Math.max(1, center - strokeWidth / 2);
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = isDeterminate
    ? circumference - (clampedValue / 100) * circumference
    : circumference * 0.25;

  const classNames = [
    'ui-progress-ring',
    `ui-progress-ring--${tone}`,
    isDeterminate ? 'is-determinate' : 'is-indeterminate',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const accessibleLabel =
    label ?? (isDeterminate ? `Progress: ${clampedValue}%` : 'Loading…');

  return (
    <span
      className={classNames}
      role="progressbar"
      aria-label={accessibleLabel}
      aria-valuenow={isDeterminate ? clampedValue : undefined}
      aria-valuemin={isDeterminate ? 0 : undefined}
      aria-valuemax={isDeterminate ? 100 : undefined}
      data-testid={testId}
      data-value={isDeterminate ? clampedValue : undefined}
      data-tone={tone}
      style={{ width: size, height: size }}
    >
      <svg
        className="ui-progress-ring-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          className="ui-progress-ring-track"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          className="ui-progress-ring-indicator"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </svg>
      {showValue && isDeterminate && (
        <span className="ui-progress-ring-text" aria-hidden="true">
          {clampedValue}%
        </span>
      )}
    </span>
  );
}
