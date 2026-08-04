import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastProps = {
  tone?: ToastTone;
  title?: string;
  children?: ReactNode;
  /** When provided, a dismiss control is rendered. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss control. */
  dismissLabel?: string;
  testId?: string;
};

/**
 * Floating, dismissible feedback bubble.
 * Presentation only — TTL / queue policy stays in the app host.
 * Prefer this over inline Notice when the message must sit above modals.
 */
export function Toast(props: ToastProps): ReactElement {
  const tone = props.tone ?? 'info';
  const role = tone === 'error' ? 'alert' : 'status';
  const dismissLabel = props.dismissLabel ?? 'Dismiss';

  return (
    <div
      className={`ui-toast tone-${tone}`}
      role={role}
      data-testid={props.testId ?? 'toast'}
      data-tone={tone}
    >
      <div className="ui-toast-body">
        {props.title ? <strong className="ui-toast-title">{props.title}</strong> : null}
        {props.children ? <div className="ui-toast-message">{props.children}</div> : null}
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

export type ToastHostPosition = 'top-center' | 'top-right';

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
