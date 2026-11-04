import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import type { StatusTone } from './status-badge.js';

export type SessionRailItemVariant = 'summary' | 'tool' | 'activity';

export type SessionRailDiffStat = {
  additions: number;
  deletions: number;
};

export type SessionRailItemProps = {
  /** Stable identifier for test hooks and selection. */
  id: string;
  /** Accessible and visible label for the rail entry. */
  label: string;
  /** Leading 14-16px icon node. */
  icon: ReactNode;
  /** Visual role: summary (top overview), tool (standard entry), or activity (dynamic pill). */
  variant?: SessionRailItemVariant | undefined;
  /** Whether this entry is currently active/expanded in the right panel. */
  active?: boolean | undefined;
  /** Optional status dot/badge tone when active or running in background. */
  statusTone?: StatusTone | undefined;
  /** Optional short right-hand value (e.g. "35%", "2 运行中"). */
  badgeText?: string | undefined;
  /** Optional git diff stat (+add / -del) for the Changes row. */
  diffStat?: SessionRailDiffStat | null | undefined;
  /** Optional tooltip / title override. */
  title?: string | undefined;
  disabled?: boolean | undefined;
  onSelect?: ((id: string) => void) | undefined;
  testId?: string | undefined;
};

export type SessionRailDensity = 'auto' | 'expanded' | 'compact';

export type SessionRailProps = Omit<HTMLAttributes<HTMLElement>, 'onSelect'> & {
  /** Accessible landmark label for the session rail. */
  ariaLabel?: string | undefined;
  /** Display density: 'expanded' shows labels+stats, 'compact' shows icon+dot, 'auto' adapts via CSS container query. */
  density?: SessionRailDensity | undefined;
  /** Primary rail items (Summary + core tools + dynamic activity pills). */
  items?: readonly SessionRailItemProps[] | undefined;
  /** Optional slot rendered directly below the rail (e.g. docked BrowserMiniCard). */
  dockedSlot?: ReactNode | undefined;
  /** Optional custom children when composing `<SessionRailItem>` manually. */
  children?: ReactNode | undefined;
  testId?: string | undefined;
};

/**
 * Single row/pill inside the right-gutter Session Rail.
 * Supports Summary overview toggle, Git diff stats (+x -y), and live status dots.
 */
export function SessionRailItem(props: SessionRailItemProps): ReactElement {
  const {
    id,
    label,
    icon,
    variant = 'tool',
    active = false,
    statusTone,
    badgeText,
    diffStat,
    title,
    disabled = false,
    onSelect,
    testId,
  } = props;

  const hasDiff =
    diffStat != null && (diffStat.additions > 0 || diffStat.deletions > 0);
  const showDot =
    statusTone !== undefined ||
    hasDiff ||
    (badgeText !== undefined && badgeText.length > 0);
  const dotTone = statusTone ?? (hasDiff ? 'success' : 'neutral');

  const rowClassName = [
    'piwin-session-rail-item',
    `piwin-session-rail-item--${variant}`,
    active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={rowClassName}
      data-testid={testId ?? `session-rail-item-${id}`}
      data-rail-id={id}
      data-rail-variant={variant}
      data-active={active ? 'true' : 'false'}
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onSelect?.(id);
        }
      }}
    >
      <span className="piwin-session-rail-icon" aria-hidden="true">
        {icon}
        {showDot ? (
          <span
            className={`piwin-session-rail-dot tone-${dotTone}`}
            data-testid={`session-rail-dot-${id}`}
          />
        ) : null}
      </span>

      <span className="piwin-session-rail-label">{label}</span>

      {hasDiff && diffStat ? (
        <span
          className="piwin-session-rail-stat"
          data-testid={`session-rail-diff-${id}`}
          aria-label={`+${String(diffStat.additions)} -${String(diffStat.deletions)}`}
        >
          {diffStat.additions > 0 ? (
            <span className="piwin-session-rail-add">
              +{diffStat.additions}
            </span>
          ) : null}
          {diffStat.deletions > 0 ? (
            <span className="piwin-session-rail-del">
              -{diffStat.deletions}
            </span>
          ) : null}
        </span>
      ) : badgeText ? (
        <span
          className={`piwin-session-rail-badge${statusTone ? ` tone-${statusTone}` : ''}`}
          data-testid={`session-rail-badge-${id}`}
        >
          {badgeText}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Right-gutter Session Rail container.
 * Hosts the collapsible Summary toggle, core tool entries, and an optional
 * docked slot below the rail (for the docked BrowserMiniCard).
 */
export function SessionRail(props: SessionRailProps): ReactElement {
  const {
    ariaLabel = '会话工具导轨',
    density = 'auto',
    items,
    dockedSlot,
    children,
    className,
    testId = 'session-rail',
    ...elementProps
  } = props;

  const rootClassName = [
    'piwin-session-rail-stack',
    `piwin-session-rail-stack--${density}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav
      {...elementProps}
      aria-label={ariaLabel}
      className={rootClassName}
      data-testid={testId}
      data-density={density}
    >
      <div className="piwin-session-rail-card" data-testid={`${testId}-card`}>
        {items?.map((item) => <SessionRailItem key={item.id} {...item} />)}
        {children}
      </div>
      {dockedSlot ? (
        <div
          className="piwin-session-rail-docked-slot"
          data-testid={`${testId}-docked-slot`}
        >
          {dockedSlot}
        </div>
      ) : null}
    </nav>
  );
}
