import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  LocalMobileAccessCommand,
  MobileAccessPairingCodeData,
  MobileAccessStatusData,
  PairedDeviceSummary,
} from '@piwin/contracts';
import {
  formatError,
  readMobileAccessDeviceListData,
  readMobileAccessPairingCodeData,
  readMobileAccessStatusData,
} from '@piwin/contracts';
import { Button, Field, Notice, StatusBadge, Switch, TextInput } from '@piwin/ui-kit';
import { saveDesktopHostLaunchMode } from './desktop-host-launch.js';
import { isDesktopShellOnlyBuild } from './desktop-shell-build.js';
import { getDesktopCopy } from './desktop-locale.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import {
  loadMobileAccessAdvertisedEndpoint,
  saveMobileAccessAdvertisedEndpoint,
} from './mobile-access-local.js';
import {
  clearDesktopRemoteHostTarget,
  isDesktopRemoteHostEndpoint,
} from './remote-host-session.js';
import { FieldRow } from './settings/field-row.js';
import { PageTitle } from './settings/page-title.js';
import { useSettings } from './settings/settings-context.js';

export function MobileAccessSettings(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).mobileAccess;
  const { hostClient } = useSettings();
  const transport = hostClient?.getTransport?.() ?? 'mock';
  const sidecarAvailable = transport === 'live' && hostClient?.request !== undefined;
  const isShellOnly = isDesktopShellOnlyBuild();
  const [advertisedEndpoint, setAdvertisedEndpoint] = useState(loadMobileAccessAdvertisedEndpoint);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<MobileAccessStatusData | undefined>();
  const [pairing, setPairing] = useState<MobileAccessPairingCodeData | undefined>();
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);
  const [copied, setCopied] = useState(false);

  const requestAccess = useCallback(
    async (command: LocalMobileAccessCommand) => {
      if (hostClient?.request === undefined) {
        throw new Error(copy.sidecarOnly);
      }
      return hostClient.request(command);
    },
    [copy.sidecarOnly, hostClient],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!sidecarAvailable || hostClient?.request === undefined) {
      return;
    }
    const [statusResponse, devicesResponse] = await Promise.all([
      hostClient.request({ type: 'mobile-access/status' }),
      hostClient.request({ type: 'mobile-access/list-devices' }),
    ]);
    if (statusResponse.success) {
      setStatus(readMobileAccessStatusData(statusResponse.data));
    }
    if (devicesResponse.success) {
      setDevices(readMobileAccessDeviceListData(devicesResponse.data)?.devices ?? []);
    }
  }, [hostClient, sidecarAvailable]);

  useEffect(() => {
    void refresh().catch((refreshError: unknown) => {
      setError(formatError(refreshError));
    });
  }, [refresh]);

  async function handleListenChange(checked: boolean): Promise<void> {
    const trimmed = advertisedEndpoint.trim();
    if (checked && !isDesktopRemoteHostEndpoint(trimmed)) {
      setError(copy.invalidAdvertised);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      saveMobileAccessAdvertisedEndpoint(trimmed);
      const response = await requestAccess(
        checked
          ? { type: 'mobile-access/start', profileId: 'loopback', advertisedEndpoint: trimmed }
          : { type: 'mobile-access/stop' },
      );
      if (!response.success) {
        setError(response.error);
        return;
      }
      const nextStatus = readMobileAccessStatusData(response.data);
      setStatus(nextStatus);
      if (checked && nextStatus?.listening === true) {
        await mintPairingCode();
      } else {
        setPairing(undefined);
      }
      await refresh();
    } catch (listenError) {
      setError(formatError(listenError));
    } finally {
      setBusy(false);
    }
  }

  async function mintPairingCode(): Promise<void> {
    const response = await requestAccess({ type: 'mobile-access/create-pairing-code' });
    if (!response.success) {
      setError(response.error);
      setPairing(undefined);
      return;
    }
    setPairing(readMobileAccessPairingCodeData(response.data));
  }

  async function handleGenerate(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      await mintPairingCode();
    } catch (generateError) {
      setError(formatError(generateError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(deviceId: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await requestAccess({ type: 'mobile-access/revoke-device', deviceId });
      if (!response.success) {
        setError(response.error);
        return;
      }
      await refresh();
    } catch (revokeError) {
      setError(formatError(revokeError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyUri(): Promise<void> {
    if (pairing === undefined) {
      return;
    }
    await navigator.clipboard.writeText(pairing.uri);
    setCopied(true);
  }

  const listening = status?.listening === true;

  const statusBadge = (
    <StatusBadge
      tone={!sidecarAvailable ? 'warning' : listening ? 'success' : 'neutral'}
      label={
        !sidecarAvailable
          ? copy.statusUnavailable
          : listening
            ? copy.statusListening
            : copy.statusIdle
      }
    />
  );

  return (
    <div className="settings-section settings-section-card mobile-access-card" data-testid="mobile-access-settings">
      <PageTitle title={copy.title} description={copy.description} trailing={statusBadge} />
      {!sidecarAvailable ? (
        <Notice
          tone="warning"
          title={isShellOnly ? copy.sidecarOnlyShellTitle : copy.sidecarOnlyTitle}
          action={
            !isShellOnly ? (
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  clearDesktopRemoteHostTarget();
                  saveDesktopHostLaunchMode('sidecar');
                }}
                data-testid="mobile-access-switch-local"
              >
                {copy.switchToLocal}
              </Button>
            ) : undefined
          }
        >
          {isShellOnly ? copy.sidecarOnlyShellDesc : copy.sidecarOnlyDesc}
        </Notice>
      ) : null}

      <div className={`mobile-access-content ${!sidecarAvailable ? 'is-disabled' : ''}`}>
        <FieldRow label={copy.listenLabel} description={copy.listenDescription}>
          <Switch
            checked={listening}
            disabled={busy || !sidecarAvailable}
            onCheckedChange={(checked) => {
              void handleListenChange(checked);
            }}
            testId="mobile-access-listen"
            aria-label={copy.listenLabel}
          />
        </FieldRow>
        <div className="mobile-access-field">
          <Field label={copy.advertisedLabel} description={copy.advertisedHint}>
            <TextInput
              value={advertisedEndpoint}
              onChange={(event) => setAdvertisedEndpoint(event.currentTarget.value)}
              placeholder={copy.advertisedPlaceholder}
              autoComplete="off"
              spellCheck={false}
              disabled={busy || !sidecarAvailable || listening}
              testId="mobile-access-advertised"
            />
          </Field>
        </div>
      </div>

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}

      {pairing !== undefined ? (
        <div className="mobile-access-pairing-card" data-testid="mobile-access-pairing">
          <div className="mobile-access-pairing-header">
            <span className="mobile-access-pairing-title">
              {locale === 'zh-CN' ? '配对凭证' : 'Pairing Credential'}
            </span>
            <span className="mobile-access-pairing-expiry">
              {copy.pairingExpires(new Date(pairing.expiresAt).toLocaleString(locale))}
            </span>
          </div>
          <div className="mobile-access-pairing-input-row">
            <TextInput
              value={pairing.uri}
              readOnly
              testId="mobile-access-pairing-uri"
            />
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void handleCopyUri();
              }}
              data-testid="mobile-access-copy-uri"
            >
              {copied ? copy.copied : copy.copyUri}
            </Button>
          </div>
          <div className="mobile-access-action-row">
            <Button
              variant="secondary"
              size="compact"
              disabled={busy || !listening}
              onClick={() => {
                void handleGenerate();
              }}
              data-testid="mobile-access-generate"
            >
              {busy ? copy.generating : copy.generate}
            </Button>
          </div>
        </div>
      ) : null}

      {listening && pairing === undefined ? (
        <div className="mobile-access-action-row">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void handleGenerate();
            }}
            data-testid="mobile-access-generate"
          >
            {busy ? copy.generating : copy.generate}
          </Button>
        </div>
      ) : null}

      <div className="mobile-access-devices-section" data-testid="mobile-access-devices">
        <h4 className="settings-section-subtitle">{copy.devices}</h4>
        {devices.length === 0 ? (
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
              <p className="mobile-access-empty-desc">{copy.emptyDevicesHint}</p>
            </div>
          </div>
        ) : (
          <ul className="mobile-access-device-list">
            {devices.map((device) => (
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
                {!device.revoked ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    onClick={() => {
                      void handleRevoke(device.id);
                    }}
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
    </div>
  );
}
