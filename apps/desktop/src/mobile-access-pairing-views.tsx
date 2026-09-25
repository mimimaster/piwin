/**
 * Pairing credential card and paired-device list, shared by the local sidecar
 * listener and a remote Host's pairing management.
 */
import type { ReactElement } from 'react';
import type { MobileAccessPairingCodeData, PairedDeviceSummary } from '@piwin/contracts';
import { Button, TextInput } from '@piwin/ui-kit';
import type { DesktopCopy } from './desktop-locale.js';

type MobileAccessCopy = DesktopCopy['mobileAccess'];

export function PairingCredentialCard(props: {
  pairing: MobileAccessPairingCodeData;
  copy: MobileAccessCopy;
  locale: string;
  busy: boolean;
  copied: boolean;
  canRegenerate: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
}): ReactElement {
  const { pairing, copy } = props;
  return (
    <div className="mobile-access-pairing-card" data-testid="mobile-access-pairing">
      <div className="mobile-access-pairing-header">
        <span className="mobile-access-pairing-title">
          {props.locale === 'zh-CN' ? '配对凭证' : 'Pairing Credential'}
        </span>
        <span className="mobile-access-pairing-expiry">
          {copy.pairingExpires(new Date(pairing.expiresAt).toLocaleString(props.locale))}
        </span>
      </div>
      <div className="mobile-access-pairing-input-row">
        <TextInput value={pairing.uri} readOnly testId="mobile-access-pairing-uri" />
        <Button
          variant="primary"
          disabled={props.busy}
          onClick={props.onCopy}
          data-testid="mobile-access-copy-uri"
        >
          {props.copied ? copy.copied : copy.copyUri}
        </Button>
      </div>
      <div className="mobile-access-action-row">
        <Button
          variant="secondary"
          size="compact"
          disabled={props.busy || !props.canRegenerate}
          onClick={props.onRegenerate}
          data-testid="mobile-access-generate"
        >
          {props.busy ? copy.generating : copy.generate}
        </Button>
      </div>
    </div>
  );
}

export function PairedDeviceList(props: {
  devices: readonly PairedDeviceSummary[];
  copy: MobileAccessCopy;
  busy: boolean;
  /** Absent when the viewer may not revoke (a paired phone). */
  onRevoke?: ((deviceId: string) => void) | undefined;
  emptyHint?: string | undefined;
}): ReactElement {
  const { copy } = props;
  return (
    <div className="mobile-access-devices-section" data-testid="mobile-access-devices">
      <h4 className="settings-section-subtitle">{copy.devices}</h4>
      {props.devices.length === 0 ? (
        <div className="mobile-access-empty-devices">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mobile-access-empty-icon"
            aria-hidden="true"
          >
            <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
            <path d="M12 18h.01" />
          </svg>
          <div className="mobile-access-empty-text">
            <p className="mobile-access-empty-title">{copy.noDevices}</p>
            <p className="mobile-access-empty-desc">{props.emptyHint ?? copy.emptyDevicesHint}</p>
          </div>
        </div>
      ) : (
        <ul className="mobile-access-device-list">
          {props.devices.map((device) => (
            <li
              key={device.id}
              className="mobile-access-device-item"
              data-testid={`mobile-access-device-${device.id}`}
            >
              <div className="mobile-access-device-info">
                <span className="mobile-access-device-name">
                  {device.name}
                  {device.revoked ? ' · revoked' : ''}
                </span>
                <span className="mobile-access-device-meta">{copy.lastSeen(device.lastSeenAt)}</span>
              </div>
              {!device.revoked && props.onRevoke ? (
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={props.busy}
                  onClick={() => props.onRevoke?.(device.id)}
                  data-testid={`mobile-access-revoke-${device.id}`}
                >
                  {copy.revoke}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
