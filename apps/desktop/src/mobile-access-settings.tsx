import type { ReactElement } from 'react';
import { saveDesktopHostLaunchMode } from './desktop-host-launch.js';
import { isDesktopShellOnlyBuild } from './desktop-shell-build.js';
import { getDesktopCopy } from './desktop-locale.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { LocalMobileAccessPanel } from './mobile-access-local-panel.js';
import { RemoteMobileAccessPanel } from './mobile-access-remote-panel.js';
import { clearDesktopRemoteHostTarget } from './remote-host-session.js';
import { useSettings } from './settings/settings-context.js';

/**
 * Phone access settings. The bundled app's own sidecar owns a LAN listener
 * (local panel); an attached Host manages pairing on its own listener
 * (remote panel, ADR 0075).
 */
export function MobileAccessSettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).mobileAccess;
  const { hostClient } = useSettings();
  const request = hostClient?.request;
  if (request === undefined) {
    return null;
  }
  if (hostClient?.getTransport?.() === 'live') {
    return <LocalMobileAccessPanel request={request} copy={copy} locale={locale} />;
  }
  return (
    <RemoteMobileAccessPanel
      request={request}
      copy={copy}
      locale={locale}
      onSwitchToLocal={
        isDesktopShellOnlyBuild()
          ? undefined
          : () => {
              clearDesktopRemoteHostTarget();
              saveDesktopHostLaunchMode('sidecar');
            }
      }
    />
  );
}
