/**
 * Pi extension text widgets next to the composer (ADR 0080), above or below
 * the card. Status items and the working message live in the composer stats
 * line. Everything is plain text; extensions never supply markup.
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
  if (widgets.length === 0) return null;

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
    </div>
  );
}
