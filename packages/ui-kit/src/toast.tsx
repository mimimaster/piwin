import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { renderToneSealIcon } from './tone-icon.js';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastProps = {
  tone?: ToastTone;
  title?: string;
  children?: ReactNode;
  /** When provided, a dismiss control is rendered. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss control. */
  dismissLabel?: string;
  /**
   * Stacks the title above the message and lets the bubble grow. Leave false
   * for short confirmations, which read better as `title · message` on one line.
   */
  multiline?: boolean;
  /**
   * Adds a show-more control under a stacked message. Both labels are
   * required so the control never renders untranslated.
   */
  expandLabel?: string;
  collapseLabel?: string;
  testId?: string;
};

/**
 * Inkstone-styled floating, dismissible feedback bubble.
 * Features a crisp straight left indicator bar, seal badge, and serif title.
 */
export function Toast(props: ToastProps): ReactElement {
  const tone = props.tone ?? 'info';
  const role = tone === 'error' ? 'alert' : 'status';
  const dismissLabel = props.dismissLabel ?? 'Dismiss';
  const multiline = props.multiline === true;
  const expandable =
    multiline && props.expandLabel !== undefined && props.collapseLabel !== undefined;
  const [expanded, setExpanded] = useState(false);

  const className = ['ui-toast', `tone-${tone}`, multiline ? 'is-multiline' : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role={role}
      data-testid={props.testId ?? 'toast'}
      data-tone={tone}
    >
      <div className="ui-toast-seal-wrap" aria-hidden="true">
        <span className={`ui-toast-seal tone-${tone}`}>{renderToneSealIcon(tone)}</span>
      </div>
      <div className="ui-toast-body">
        {props.title ? <strong className="ui-toast-title">{props.title}</strong> : null}
        {props.title && props.children && !multiline ? (
          <span className="ui-toast-sep" aria-hidden="true">
            ·
          </span>
        ) : null}
        {props.children ? (
          <div className={`ui-toast-message${expanded ? ' is-expanded' : ''}`}>
            {props.children}
          </div>
        ) : null}
        {expandable ? (
          <button
            type="button"
            className="ui-toast-expand"
            data-testid="toast-expand"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? props.collapseLabel : props.expandLabel}
          </button>
        ) : null}
      </div>
      {props.onDismiss ? (
        <button
          type="button"
          className="ui-toast-dismiss"
          data-testid="toast-dismiss"
          aria-label={dismissLabel}
          onClick={props.onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export type ToastHostPosition = 'top-center' | 'top-right' | 'bottom-center';

export type ToastHostProps = {
  children: ReactNode;
  /**
   * When true (default), render into document.body so nested dialogs cannot
   * trap the toast inside a lower stacking context.
   */
  portal?: boolean;
  position?: ToastHostPosition;
  className?: string;
  testId?: string;
};

/**
 * Fixed-position host for one or more Toast bubbles.
 * Uses the product stacking token `--layer-toast` when available.
 */
export function ToastHost(props: ToastHostProps): ReactElement | null {
  const portal = props.portal !== false;
  const position = props.position ?? 'top-center';
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!portal) {
      setMountNode(null);
      return;
    }
    setMountNode(document.body);
  }, [portal]);

  const className = [
    'ui-toast-host',
    `ui-toast-host--${position}`,
    props.className,
  ]
    .filter(Boolean)
    .join(' ');

  const host = (
    <div className={className} data-testid={props.testId ?? 'toast-host'} aria-live="polite">
      {props.children}
    </div>
  );

  if (!portal) {
    return host;
  }

  if (!mountNode) {
    return null;
  }

  return createPortal(host, mountNode);
}
