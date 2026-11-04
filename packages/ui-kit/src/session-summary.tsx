import { useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { StatusBadge, type StatusTone } from './status-badge.js';

export type SessionSummarySectionProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  /** Section heading (e.g. "环境与上下文", "Connectors", "会话产物"). */
  title: ReactNode;
  /** Optional subtitle or scope hint shown beside or below the heading. */
  subtitle?: ReactNode | undefined;
  /** Optional count or short badge text shown beside the heading. */
  badgeText?: string | undefined;
  /** Optional right-side header action (e.g. scope selector, "+" button). */
  action?: ReactNode | undefined;
  /** Whether the section can be folded by clicking its header toggle. */
  collapsible?: boolean | undefined;
  /** Initial expanded state when uncontrolled (defaults to true). */
  defaultExpanded?: boolean | undefined;
  /** Controlled expanded state. */
  expanded?: boolean | undefined;
  onExpandedChange?: ((expanded: boolean) => void) | undefined;
  /** Optional empty state rendered when `isEmpty` is true. */
  emptyState?: ReactNode | undefined;
  isEmpty?: boolean | undefined;
  children?: ReactNode | undefined;
  testId?: string | undefined;
};

/**
 * Structured card section for the Right-Panel Session Summary view.
 */
export function SessionSummarySection(
  props: SessionSummarySectionProps,
): ReactElement {
  const {
    title,
    subtitle,
    badgeText,
    action,
    collapsible = false,
    defaultExpanded = true,
    expanded: controlledExpanded,
    onExpandedChange,
    emptyState,
    isEmpty = false,
    children,
    className,
    testId = 'session-summary-section',
    ...elementProps
  } = props;

  const [uncontrolledExpanded, setUncontrolledExpanded] =
    useState(defaultExpanded);
  const isExpanded = controlledExpanded ?? uncontrolledExpanded;

  const handleToggle = (): void => {
    if (!collapsible) return;
    const next = !isExpanded;
    if (controlledExpanded === undefined) {
      setUncontrolledExpanded(next);
    }
    onExpandedChange?.(next);
  };

  const rootClassName = [
    'piwin-session-summary-section',
    isExpanded ? 'is-expanded' : 'is-collapsed',
    isEmpty ? 'is-empty' : 'has-items',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const chevronIcon = (
    <span
      className={`piwin-session-summary-chevron${isExpanded ? ' is-open' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 12 12" width="11" height="11" fill="none">
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );

  return (
    <section
      {...elementProps}
      className={rootClassName}
      data-testid={testId}
      data-expanded={isExpanded ? 'true' : 'false'}
    >
      <header className="piwin-session-summary-section-header">
        {collapsible ? (
          <button
            type="button"
            className="piwin-session-summary-section-toggle"
            data-testid={`${testId}-toggle`}
            aria-expanded={isExpanded}
            onClick={handleToggle}
          >
            {chevronIcon}
            <span className="piwin-session-summary-section-title">{title}</span>
            {badgeText ? (
              <span
                className="piwin-session-summary-section-badge"
                data-testid={`${testId}-badge`}
              >
                {badgeText}
              </span>
            ) : null}
          </button>
        ) : (
          <div className="piwin-session-summary-section-heading">
            <span className="piwin-session-summary-section-title">{title}</span>
            {badgeText ? (
              <span
                className="piwin-session-summary-section-badge"
                data-testid={`${testId}-badge`}
              >
                {badgeText}
              </span>
            ) : null}
          </div>
        )}

        {action ? (
          <div
            className="piwin-session-summary-section-action"
            data-testid={`${testId}-action`}
          >
            {action}
          </div>
        ) : null}
      </header>

      {subtitle && isExpanded ? (
        <div className="piwin-session-summary-section-subtitle">{subtitle}</div>
      ) : null}

      {isExpanded ? (
        <div
          className="piwin-session-summary-section-body"
          data-testid={`${testId}-body`}
        >
          {isEmpty && emptyState !== undefined ? emptyState : children}
        </div>
      ) : null}
    </section>
  );
}

export type SessionSummaryStatCardProps = {
  /** Short metric label (e.g. "上下文占用", "工作树变更", "运行环境"). */
  label: ReactNode;
  /** Primary value node (e.g. "35%", "+48 -12", "Local Sidecar"). */
  value: ReactNode;
  /** Optional secondary caption or scope note (e.g. "18.2k / 128k tokens", "main · 3 files"). */
  caption?: ReactNode | undefined;
  /** Optional leading icon or visual indicator (e.g. ProgressRing). */
  visual?: ReactNode | undefined;
  /** Optional semantic status tone. */
  tone?: StatusTone | undefined;
  /** Optional click callback to drill into the owning tool panel. */
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  testId?: string | undefined;
  className?: string | undefined;
};

/**
 * Compact metric/telemetry tile for Context, Changes, Environment, or Activity.
 * Renders as a button when `onClick` is supplied, or a static card otherwise.
 */
export function SessionSummaryStatCard(
  props: SessionSummaryStatCardProps,
): ReactElement {
  const {
    label,
    value,
    caption,
    visual,
    tone,
    onClick,
    disabled = false,
    testId = 'session-summary-stat-card',
    className,
  } = props;

  const cardClassName = [
    'piwin-session-summary-stat-card',
    tone ? `tone-${tone}` : '',
    onClick ? 'is-interactive' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <div className="piwin-session-summary-stat-top">
        <span className="piwin-session-summary-stat-label">{label}</span>
        {visual ? (
          <span className="piwin-session-summary-stat-visual">{visual}</span>
        ) : null}
      </div>
      <div
        className="piwin-session-summary-stat-value"
        data-testid={`${testId}-value`}
      >
        {value}
      </div>
      {caption ? (
        <div
          className="piwin-session-summary-stat-caption"
          data-testid={`${testId}-caption`}
        >
          {caption}
        </div>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cardClassName}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={cardClassName} data-testid={testId}>
      {content}
    </div>
  );
}

export type SessionSummaryRowProps = {
  /** Primary item title (e.g. plan title, MCP server name, document path). */
  title: ReactNode;
  /** Optional provenance/scope subtitle (e.g. "本轮计划 · 3/5 步", "已连接 · 7 工具"). */
  subtitle?: ReactNode | undefined;
  /** Optional leading icon. */
  icon?: ReactNode | undefined;
  /** Optional operational status badge label and tone. */
  statusLabel?: string | undefined;
  statusTone?: StatusTone | undefined;
  /** Optional custom right-hand meta or action control (e.g. Switch, IconButton). */
  trailing?: ReactNode | undefined;
  /** Optional click callback to open/focus this item. */
  onClick?: (() => void) | undefined;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  testId?: string | undefined;
  className?: string | undefined;
};

/**
 * Single item row inside a Session Summary section (Connectors, Outputs, Sources, Activity).
 */
export function SessionSummaryRow(props: SessionSummaryRowProps): ReactElement {
  const {
    title,
    subtitle,
    icon,
    statusLabel,
    statusTone = 'neutral',
    trailing,
    onClick,
    active = false,
    disabled = false,
    testId = 'session-summary-row',
    className,
  } = props;

  const rowClassName = [
    'piwin-session-summary-row',
    onClick ? 'is-interactive' : '',
    active ? 'is-active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const mainContent = (
    <>
      {icon ? (
        <span className="piwin-session-summary-row-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="piwin-session-summary-row-text">
        <span className="piwin-session-summary-row-title">{title}</span>
        {subtitle ? (
          <span className="piwin-session-summary-row-subtitle">{subtitle}</span>
        ) : null}
      </span>
    </>
  );

  const rightContent = (
    <span className="piwin-session-summary-row-right">
      {statusLabel ? (
        <StatusBadge
          tone={statusTone}
          label={statusLabel}
          testId={`${testId}-status`}
        />
      ) : null}
      {trailing}
    </span>
  );

  if (onClick && trailing === undefined) {
    return (
      <button
        type="button"
        className={rowClassName}
        data-testid={testId}
        data-active={active ? 'true' : 'false'}
        disabled={disabled}
        onClick={onClick}
      >
        {mainContent}
        {rightContent}
      </button>
    );
  }

  return (
    <div
      className={rowClassName}
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
    >
      {onClick ? (
        <button
          type="button"
          className="piwin-session-summary-row-primary"
          data-testid={`${testId}-trigger`}
          disabled={disabled}
          onClick={onClick}
        >
          {mainContent}
        </button>
      ) : (
        <div className="piwin-session-summary-row-static">{mainContent}</div>
      )}
      {rightContent}
    </div>
  );
}

export type SessionSummaryGridProps = HTMLAttributes<HTMLDivElement> & {
  columns?: 1 | 2 | undefined;
  testId?: string | undefined;
};

/**
 * Responsive 1- or 2-column grid for `SessionSummaryStatCard` items.
 */
export function SessionSummaryGrid(
  props: SessionSummaryGridProps,
): ReactElement {
  const {
    columns = 2,
    className,
    testId = 'session-summary-grid',
    ...elementProps
  } = props;
  const gridClassName = [
    'piwin-session-summary-grid',
    `piwin-session-summary-grid--cols-${String(columns)}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <div {...elementProps} className={gridClassName} data-testid={testId} />;
}
