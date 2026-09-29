/**
 * Pi extension surface next to the composer (ADR 0080): text widgets above
 * or below the card, and status chips plus the working message below it.
 * Everything is plain text; extensions never supply markup.
 */
import type { ReactElement } from 'react';
import type { ExtensionUiSurfaceSnapshot, ExtensionUiWidgetPlacement } from '@piwin/contracts';

export type ExtensionSurfaceStripProps = {
  surface: ExtensionUiSurfaceSnapshot | null | undefined;
  placement: ExtensionUiWidgetPlacement;
};

export function ExtensionSurfaceStrip({
  surface,
  placement,
}: ExtensionSurfaceStripProps): ReactElement | null {
  if (!surface) return null;
  const widgets = surface.widgets.filter((widget) => widget.placement === placement);
  // Pi renders statuses in its footer, so they belong under the card.
  const showStatusRow =
    placement === 'belowEditor' &&
    (surface.statuses.length > 0 || surface.workingMessage !== undefined);
  if (widgets.length === 0 && !showStatusRow) return null;

  return (
    <div
      className={`extension-surface-strip is-${placement === 'aboveEditor' ? 'above' : 'below'}`}
      data-testid={`extension-surface-${placement}`}
    >
      {widgets.map((widget) => (
        <pre key={widget.key} className="extension-surface-widget" data-widget-key={widget.key}>
          {widget.lines.join('\n')}
        </pre>
      ))}
      {showStatusRow ? (
        <div className="extension-surface-status-row" role="status">
          {surface.workingMessage !== undefined ? (
            <span className="extension-surface-chip is-working">{surface.workingMessage}</span>
          ) : null}
          {surface.statuses.map((status) => (
            <span
              key={status.key}
              className="extension-surface-chip"
              title={status.key}
              data-status-key={status.key}
            >
              {status.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
