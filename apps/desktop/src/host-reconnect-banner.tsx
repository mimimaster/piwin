import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { isDesktopShellOnlyBuild } from './desktop-shell-build.js';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import { retryHostConnectionNow } from './host-wake-events.js';
import {
  clearDesktopRemoteHostTarget,
  formatDesktopRemoteHostDisplay,
  loadDesktopRemoteHostTarget,
} from './remote-host-session.js';

/**
 * A reconnect normally settles within a few seconds; saying more than
 * "connecting" before that would flash on every brief drop.
 */
export const HOST_UNREACHABLE_AFTER_MS = 6_000;

/**
 * Shown while the remote Host link is down. Once the outage outlasts a normal
 * reconnect it names the Host and offers a way out: retry now, or point the
 * shell at another Host (the address may simply have changed).
 */
export function HostReconnectBanner(props: { locale: DesktopLocale }): ReactElement {
  const copy = getDesktopCopy(props.locale).composer;
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setUnreachable(true), HOST_UNREACHABLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!unreachable) {
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

  const endpoint = loadDesktopRemoteHostTarget()?.endpoint ?? '';
  const host = formatDesktopRemoteHostDisplay(endpoint) ?? 'Host';
  return (
    <div
      className="transcript-awaiting-banner host-unreachable-banner"
      data-testid="host-reconnect-banner"
      data-state="unreachable"
      role="status"
      aria-live="polite"
    >
      <span>{copy.hostUnreachable(host)}</span>
      <span className="host-unreachable-actions">
        <Button variant="secondary" onClick={retryHostConnectionNow} data-testid="host-reconnect-retry">
          {copy.hostRetry}
        </Button>
        {/* Clearing the target returns a shell-only build to its connect wall.
            The Desktop app would fall back to its own sidecar instead, which is
            not what "change Host" means there; it uses Settings. */}
        {isDesktopShellOnlyBuild() ? (
          <Button
            variant="secondary"
            onClick={clearDesktopRemoteHostTarget}
            data-testid="host-reconnect-switch"
          >
            {copy.hostSwitch}
          </Button>
        ) : null}
      </span>
    </div>
  );
}
