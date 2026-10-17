/**
 * Transient browser status (element pick, mirror/frame errors, clear highlight)
 * floats over the top of the page viewport instead of taking a layout row, so
 * the page never shifts when a message appears or clears.
 */
import type { ReactElement } from 'react';
import { IconClose } from './shell-icons';

export type BrowserStatusOverlayProps = {
  pending: string | null;
  /** One entry per error source; the testId keeps each source addressable. */
  errors: ReadonlyArray<{ testId: string; message: string }>;
  clearHighlightLabel: string | null;
  onClearHighlight: () => void;
};

export function BrowserStatusOverlay(props: BrowserStatusOverlayProps): ReactElement | null {
  const { pending, errors, clearHighlightLabel } = props;
  if (!pending && errors.length === 0 && !clearHighlightLabel) return null;

  return (
    <div className="browser-status-overlay" role="status" aria-live="polite">
      {pending ? (
        <span
          className="browser-status-pill"
          data-tone="pending"
          data-testid="browser-session-pick-pending"
        >
          <span className="browser-status-dot" aria-hidden="true" />
          <span className="browser-status-text">{pending}</span>
        </span>
      ) : null}
      {errors.map((error) => (
        <span
          key={error.testId}
          className="browser-status-pill"
          data-tone="error"
          data-testid={error.testId}
        >
          <span className="browser-status-dot" aria-hidden="true" />
          <span className="browser-status-text">{error.message}</span>
        </span>
      ))}
      {clearHighlightLabel ? (
        <button
          type="button"
          className="browser-status-pill browser-status-clear"
          data-tone="action"
          onClick={props.onClearHighlight}
        >
          <span className="browser-status-text">{clearHighlightLabel}</span>
          <IconClose width={11} height={11} />
        </button>
      ) : null}
    </div>
  );
}
