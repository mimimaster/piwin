import type { ReactElement } from 'react';

export type SkeletonProps = {
  /** What is loading; read by assistive tech in place of the bars. */
  label: string;
  /**
   * `lines` — paragraph rows; `list` — rows led by an icon dot (lists, trees);
   * `block` — one tall area (previews, editors).
   */
  variant?: 'lines' | 'list' | 'block';
  /** Bar widths in percent, one bar per entry. Ignored by `block`. */
  rows?: readonly number[];
  className?: string;
  testId?: string;
};

const DEFAULT_ROWS: readonly number[] = [72, 94, 58];

/**
 * Placeholder in the shape of the content that is coming, so nothing jumps
 * when it lands. It fades in after a short delay (ui-skeleton.css): a load
 * that finishes quickly never flashes it.
 */
export function Skeleton(props: SkeletonProps): ReactElement {
  const variant = props.variant ?? 'lines';
  const rows = variant === 'block' ? [100] : (props.rows ?? DEFAULT_ROWS);
  const className = ['ui-skeleton', `ui-skeleton--${variant}`, props.className]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
  return (
    <div
      className={className}
      role="status"
      aria-busy="true"
      aria-label={props.label}
      data-testid={props.testId ?? 'skeleton'}
    >
      {rows.map((width, index) => (
        <span key={index} className="ui-skeleton-row" aria-hidden="true">
          {variant === 'list' ? <span className="ui-skeleton-dot" /> : null}
          <span className="ui-skeleton-bar" style={{ width: `${width}%` }} />
        </span>
      ))}
    </div>
  );
}
