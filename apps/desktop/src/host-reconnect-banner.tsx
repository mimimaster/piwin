import type { ReactElement } from 'react';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

export function HostReconnectBanner(props: { locale: DesktopLocale }): ReactElement {
  const copy = getDesktopCopy(props.locale).composer;
  return (
    <div
      className="transcript-awaiting-banner"
      data-testid="host-reconnect-banner"
      role="status"
      aria-live="polite"
    >
      {copy.hostConnecting}
    </div>
  );
}
