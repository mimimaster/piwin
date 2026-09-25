/**
 * Pairing credential card and paired-device list, shared by the local sidecar
 * listener and a remote Host's pairing management.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { MobileAccessPairingCodeData, PairedDeviceSummary } from '@piwin/contracts';
import { Button, QrCode, TextInput } from '@piwin/ui-kit';
import type { MobileAccessCopy } from './desktop-locale-mobile-access.js';

export function PairingCredentialCard(props: {
  pairing: MobileAccessPairingCodeData;
  copy: MobileAccessCopy;
  locale: string;
  busy: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}): ReactElement {
  const { pairing, copy } = props;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
  }, [pairing.uri]);
  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(pairing.uri);
    setCopied(true);
  };
  return (
    <div className="mobile-access-pairing-card" data-testid="mobile-access-pairing">
      <div className="mobile-access-pairing-body">
        <div className="mobile-access-qr-frame">
          <QrCode value={pairing.uri} size={184} label={copy.qrLabel} testId="mobile-access-qr" />
        </div>
        <div className="mobile-access-pairing-text">
          <span className="mobile-access-pairing-title">{copy.qrTitle}</span>
          <p className="mobile-access-pairing-hint">{copy.qrHint}</p>
          <code className="mobile-access-pairing-endpoint" data-testid="mobile-access-pairing-endpoint">
            {pairing.endpoint}
          </code>
          <span className="mobile-access-pairing-expiry">
            {copy.pairingExpires(new Date(pairing.expiresAt).toLocaleString(props.locale))}
          </span>
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
      </div>
      <span className="mobile-access-pairing-uri-label">{copy.uriLabel}</span>
      <div className="mobile-access-pairing-input-row">
        <TextInput value={pairing.uri} readOnly testId="mobile-access-pairing-uri" />
        <Button
          variant="secondary"
          disabled={props.busy}
          onClick={() => {
            // The link stays visible in the field, so a denied clipboard only needs a log.
            void handleCopy().catch((error: unknown) => {
              console.warn('[mobile-access] clipboard write failed', error);
            });
          }}
          data-testid="mobile-access-copy-uri"
        >
          {copied ? copy.copied : copy.copyUri}
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
                  {device.revoked ? copy.revokedSuffix : ''}
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
