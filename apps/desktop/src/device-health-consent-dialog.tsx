/**
 * Asks before a Host-requested Apple Health read leaves the phone. Closing
 * the dialog any other way than a button is a denial: the read is waiting on
 * this answer and must never proceed by default.
 */
import type { ReactElement } from 'react';
import { Button, Modal } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context.js';
import { resolveDeviceHealthConsent } from './device-health.js';
import { DEVICE_HEALTH_COPY } from './device-health-copy.js';
import {
  formatDesktopRemoteHostDisplay,
  loadDesktopRemoteHostTarget,
} from './remote-host-session.js';
import { useDeviceHealth } from './use-device-health.js';

export function DeviceHealthConsentDialog(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const health = useDeviceHealth();
  const request = health.consentRequest;
  if (request === undefined) {
    return null;
  }
  const copy = DEVICE_HEALTH_COPY[locale];
  const endpoint = loadDesktopRemoteHostTarget()?.endpoint ?? '';
  const hostLabel = formatDesktopRemoteHostDisplay(endpoint) ?? 'Host';
  const provider = request.display.provider;
  const destination =
    provider === undefined
      ? hostLabel
      : `${hostLabel} · ${provider.label}（${provider.processing === 'local' ? copy.consentLocal : copy.consentExternal}）`;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          resolveDeviceHealthConsent('deny');
        }
      }}
      title={copy.consentTitle}
      size="sm"
      testId="device-health-consent"
      closeOnClickOutside={false}
    >
      <div className="device-health-consent">
        <p>{request.display.metricLabels.join('、')}</p>
        <p className="muted">{request.display.periodLabel}</p>
        <p className="muted">{copy.consentDestination(destination)}</p>
        <p className="muted">{copy.consentReadOnly}</p>
        <div className="device-health-consent-actions">
          <Button variant="primary" onClick={() => resolveDeviceHealthConsent('once')}>
            {copy.allowOnce}
          </Button>
          <Button variant="secondary" onClick={() => resolveDeviceHealthConsent('session')}>
            {copy.allowSession}
          </Button>
          {health.alwaysAllowUnlocked ? (
            <Button variant="secondary" onClick={() => resolveDeviceHealthConsent('always')}>
              {copy.allowAlways}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => resolveDeviceHealthConsent('deny')}>
            {copy.deny}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
