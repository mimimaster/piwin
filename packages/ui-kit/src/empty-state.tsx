import type { ReactElement, ReactNode } from 'react';

export type EmptyStateSuggestion = {
  label: string;
  onClick?: (() => void) | undefined;
};

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode | undefined;
  /** Optional illustration or icon node. */
  visual?: ReactNode | undefined;
  /**
   * Optional traditional seal character (e.g. '寻', '空', '墨', '牍', '砚').
   * If provided and no visual is given, renders an authentic Inkstone cinnabar seal stamp.
   * If provided alongside a visual icon, renders as a delicate accent stamp on the visual container.
   */
  seal?: string | undefined;
  /** Optional micro-badge / query pill above the title (e.g. search term or result count). */
  badge?: ReactNode | undefined;
  /** Primary call-to-action (button, link). */
  action?: ReactNode | undefined;
  /** Secondary call-to-action (button, link). */
  secondaryAction?: ReactNode | undefined;
  /** Optional suggestion chips (e.g. "Try another keyword", "Clear filters"). */
  suggestions?: readonly (string | EmptyStateSuggestion)[] | undefined;
  /** Sizing variant: 'compact' (sidebar/inspector), 'default' (panel/card), 'spacious' (full page). */
  size?: 'compact' | 'default' | 'spacious' | undefined;
  /** Whether to frame the empty state within a bordered/shaded card surface. */
  card?: boolean | undefined;
  className?: string | undefined;
  testId?: string | undefined;
  children?: ReactNode | undefined;
};

/**
 * Shared empty-surface layout. Product CSS supplies visual tokens via class names.
 */
export function EmptyState(props: EmptyStateProps): ReactElement {
  const sizeClass = props.size && props.size !== 'default' ? `empty-state--${props.size}` : '';
  const cardClass = props.card ? 'empty-state--card' : '';
  const rootClass = ['empty-state', sizeClass, cardClass, props.className].filter(Boolean).join(' ');

  const renderVisual = () => {
    if (props.visual && props.seal) {
      return (
        <div className="empty-state-visual has-accent" aria-hidden="true">
          <div className="empty-state-visual-inner">{props.visual}</div>
          <span className="empty-state-seal empty-state-seal--accent" title={props.seal}>
            {props.seal}
          </span>
        </div>
      );
    }
    if (props.visual) {
      return (
        <div className="empty-state-visual" aria-hidden="true">
          <div className="empty-state-visual-inner">{props.visual}</div>
        </div>
      );
    }
    if (props.seal) {
      return (
        <div className="empty-state-visual is-seal-only" aria-hidden="true">
          <span className="empty-state-seal" title={props.seal}>
            {props.seal}
          </span>
        </div>
      );
    }
    return null;
  };

  const hasActions = Boolean(props.action || props.secondaryAction);

  return (
    <div className={rootClass} data-testid={props.testId ?? 'empty-state'}>
      {renderVisual()}
      {props.badge ? (
        <div className="empty-state-badge" data-testid={`${props.testId ?? 'empty-state'}-badge`}>
          {props.badge}
        </div>
      ) : null}
      <h2 className="empty-state-title">{props.title}</h2>
      {props.description ? (
        <p className="empty-state-copy muted">{props.description}</p>
      ) : null}
      {props.suggestions && props.suggestions.length > 0 ? (
        <div className="empty-state-suggestions" role="group" aria-label="Suggestions">
          {props.suggestions.map((item, index) => {
            const isObject = typeof item === 'object' && item !== null;
            const label = isObject ? item.label : String(item);
            const onClick = isObject ? item.onClick : undefined;
            if (onClick) {
              return (
                <button
                  key={index}
                  type="button"
                  className="empty-state-suggestion-chip is-clickable"
                  onClick={onClick}
                >
                  {label}
                </button>
              );
            }
            return (
              <span key={index} className="empty-state-suggestion-chip">
                {label}
              </span>
            );
          })}
        </div>
      ) : null}
      {hasActions ? (
        <div className="empty-state-actions">
          {props.action ? <div className="empty-state-action">{props.action}</div> : null}
          {props.secondaryAction ? (
            <div className="empty-state-secondary-action">{props.secondaryAction}</div>
          ) : null}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}
