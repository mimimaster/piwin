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
import { Button, Field, Notice, Switch, TextInput } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import {
  loadMobileAccessAdvertisedEndpoint,
  saveMobileAccessAdvertisedEndpoint,
} from './mobile-access-local';
import { isDesktopRemoteHostEndpoint } from './remote-host-session';
import { FieldRow } from './settings/field-row';
import { PageTitle } from './settings/page-title';
import { useSettings } from './settings/settings-context';

export function MobileAccessSettings(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).mobileAccess;
  const { hostClient } = useSettings();
  const transport = hostClient?.getTransport?.() ?? 'mock';
  const sidecarAvailable = transport === 'live' && hostClient?.request !== undefined;
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
    const request = hostClient?.request;
    if (!sidecarAvailable || request === undefined) {
      return;
    }
    const [statusResponse, devicesResponse] = await Promise.all([
      request({ type: 'mobile-access/status' }),
      request({ type: 'mobile-access/list-devices' }),
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

  return (
    <div className="settings-section settings-section-card" data-testid="mobile-access-settings">
      <PageTitle title={copy.title} description={copy.description} />
      {!sidecarAvailable ? <Notice tone="warning">{copy.sidecarOnly}</Notice> : null}
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
      <Field label={copy.advertisedLabel}>
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
      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
      {pairing !== undefined ? (
        <div className="settings-section" data-testid="mobile-access-pairing">
          <TextInput
            value={pairing.uri}
            readOnly
            testId="mobile-access-pairing-uri"
          />
          <p className="ui-field-row-description">
            {copy.pairingExpires(new Date(pairing.expiresAt).toLocaleString(locale))}
          </p>
          <div className="ui-field-row">
            <Button
              variant="secondary"
              disabled={busy || !listening}
              onClick={() => {
                void handleGenerate();
              }}
              data-testid="mobile-access-generate"
            >
              {busy ? copy.generating : copy.generate}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void handleCopyUri();
              }}
              data-testid="mobile-access-copy-uri"
            >
              {copied ? copy.copied : copy.copyUri}
            </Button>
          </div>
        </div>
      ) : null}
      {listening && pairing === undefined ? (
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
      ) : null}
      <div data-testid="mobile-access-devices">
        <h3 className="settings-card-heading">{copy.devices}</h3>
        {devices.length === 0 ? (
          <p className="ui-field-row-description">{copy.noDevices}</p>
        ) : (
          <ul>
            {devices.map((device) => (
              <li key={device.id} data-testid={`mobile-access-device-${device.id}`}>
                <div className="ui-field-row">
                  <div className="ui-field-row-content">
                    <span>
                      {device.name}
                      {device.revoked ? ' · revoked' : ''}
                    </span>
                    <p className="ui-field-row-description">{copy.lastSeen(device.lastSeenAt)}</p>
                  </div>
                  {!device.revoked ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        void handleRevoke(device.id);
                      }}
                      data-testid={`mobile-access-revoke-${device.id}`}
                    >
                      {copy.revoke}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
