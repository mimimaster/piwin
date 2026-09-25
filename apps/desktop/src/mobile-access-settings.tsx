import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  HostPairingStatusData,
  LocalMobileAccessCommand,
  MobileAccessPairingCodeData,
  MobileAccessStatusData,
  PairedDeviceSummary,
} from '@piwin/contracts';
import {
  formatError,
  readHostPairingStatusData,
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
import { PairedDeviceList, PairingCredentialCard } from './mobile-access-pairing-views.js';

export function MobileAccessSettings(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).mobileAccess;
  const { hostClient } = useSettings();
  const transport = hostClient?.getTransport?.() ?? 'mock';
  const sidecarAvailable = transport === 'live' && hostClient?.request !== undefined;
  const isShellOnly = isDesktopShellOnlyBuild();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);

  // Local sidecar state
  const [advertisedEndpoint, setAdvertisedEndpoint] = useState(loadMobileAccessAdvertisedEndpoint);
  const [status, setStatus] = useState<MobileAccessStatusData | undefined>();
  const [pairing, setPairing] = useState<MobileAccessPairingCodeData | undefined>();
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);

  // Remote Host pairing state
  const [remoteStatus, setRemoteStatus] = useState<HostPairingStatusData | undefined>();
  const [remoteDevices, setRemoteDevices] = useState<PairedDeviceSummary[]>([]);
  const [remotePairing, setRemotePairing] = useState<MobileAccessPairingCodeData | undefined>();
  const [remoteSupported, setRemoteSupported] = useState(true);

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
    if (hostClient?.request === undefined) {
      return;
    }
    if (sidecarAvailable) {
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
      return;
    }

    // Remote Host pairing mode
    const statusResponse = await hostClient.request({ type: 'host/pairing-status' });
    if (!statusResponse.success) {
      setRemoteSupported(false);
      return;
    }
    const data = readHostPairingStatusData(statusResponse.data);
    if (!data) {
      setRemoteSupported(false);
      return;
    }
    setRemoteSupported(true);
    setRemoteStatus(data);
    if (data.enabled) {
      const devicesResponse = await hostClient.request({ type: 'host/pairing-list-devices' });
      if (devicesResponse.success) {
        setRemoteDevices(readMobileAccessDeviceListData(devicesResponse.data)?.devices ?? []);
      }
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
        await mintLocalPairingCode();
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

  async function mintLocalPairingCode(): Promise<void> {
    const response = await requestAccess({ type: 'mobile-access/create-pairing-code' });
    if (!response.success) {
      setError(response.error);
      setPairing(undefined);
      return;
    }
    setPairing(readMobileAccessPairingCodeData(response.data));
  }

  async function handleLocalGenerate(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      await mintLocalPairingCode();
    } catch (generateError) {
      setError(formatError(generateError));
    } finally {
      setBusy(false);
    }
  }

  async function handleLocalRevoke(deviceId: string): Promise<void> {
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

  async function handleRemoteGenerate(): Promise<void> {
    if (hostClient?.request === undefined) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      const response = await hostClient.request({ type: 'host/pairing-create-code' });
      if (!response.success) {
        setError(response.error);
        setRemotePairing(undefined);
        return;
      }
      setRemotePairing(readMobileAccessPairingCodeData(response.data));
    } catch (generateError) {
      setError(formatError(generateError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoteRevoke(deviceId: string): Promise<void> {
    if (hostClient?.request === undefined) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await hostClient.request({
        type: 'host/pairing-revoke-device',
        deviceId,
      });
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

  async function handleCopyUri(uri: string): Promise<void> {
    await navigator.clipboard.writeText(uri);
    setCopied(true);
  }

  async function handleCopyEnv(): Promise<void> {
    await navigator.clipboard.writeText('PIWIN_HOST_PAIRING=1');
    setCopiedEnv(true);
    setTimeout(() => {
      setCopiedEnv(false);
    }, 2000);
  }

  function handleSwitchToLocal(): void {
    clearDesktopRemoteHostTarget();
    saveDesktopHostLaunchMode('sidecar');
  }

  const listening = status?.listening === true;

  if (sidecarAvailable) {
    const statusBadge = (
      <StatusBadge
        tone={listening ? 'success' : 'neutral'}
        label={listening ? copy.statusListening : copy.statusIdle}
      />
    );

    return (
      <div
        className="settings-section settings-section-card mobile-access-card"
        data-testid="mobile-access-settings"
      >
        <PageTitle title={copy.title} description={copy.description} trailing={statusBadge} />
        <div className="mobile-access-content">
          <FieldRow label={copy.listenLabel} description={copy.listenDescription}>
            <Switch
              checked={listening}
              disabled={busy}
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
                disabled={busy || listening}
                testId="mobile-access-advertised"
              />
            </Field>
          </div>
        </div>

        {error !== undefined ? <Notice tone="error">{error}</Notice> : null}

        {pairing !== undefined ? (
          <PairingCredentialCard
            pairing={pairing}
            copy={copy}
            locale={locale}
            busy={busy}
            copied={copied}
            canRegenerate={listening}
            onCopy={() => {
              void handleCopyUri(pairing.uri);
            }}
            onRegenerate={() => {
              void handleLocalGenerate();
            }}
          />
        ) : null}

        {listening && pairing === undefined ? (
          <div className="mobile-access-action-row">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void handleLocalGenerate();
              }}
              data-testid="mobile-access-generate"
            >
              {busy ? copy.generating : copy.generate}
            </Button>
          </div>
        ) : null}

        <PairedDeviceList
          devices={devices}
          copy={copy}
          busy={busy}
          onRevoke={(deviceId) => {
            void handleLocalRevoke(deviceId);
          }}
        />
      </div>
    );
  }

  // Remote Host / thin-shell pairing mode
  const remoteTone = !remoteSupported
    ? 'neutral'
    : remoteStatus?.enabled
      ? 'success'
      : 'neutral';
  const remoteBadgeLabel = !remoteSupported
    ? copy.statusUnsupported
    : remoteStatus?.enabled
      ? copy.statusEnabled
      : copy.statusDisabled;

  const statusBadge = <StatusBadge tone={remoteTone} label={remoteBadgeLabel} />;

  const switchLocalButton = !isShellOnly ? (
    <Button
      variant="secondary"
      size="compact"
      onClick={handleSwitchToLocal}
      data-testid="mobile-access-switch-local"
    >
      {copy.switchToLocal}
    </Button>
  ) : undefined;

  return (
    <div
      className="settings-section settings-section-card mobile-access-card"
      data-testid="mobile-access-settings"
    >
      <PageTitle
        title={copy.title}
        description={copy.hostPairingDesc}
        trailing={statusBadge}
      />

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}

      {!remoteSupported ? (
        <div className="mobile-access-guide-card" data-testid="mobile-access-unsupported">
          <div className="mobile-access-guide-header">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mobile-access-guide-icon"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="mobile-access-guide-text">
              <h4 className="mobile-access-guide-title">{copy.hostPairingUnsupportedTitle}</h4>
              <p className="mobile-access-guide-desc">{copy.hostPairingUnsupportedDesc}</p>
              {!isShellOnly ? (
                <div className="mobile-access-guide-footer">
                  {switchLocalButton}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : remoteStatus !== undefined && !remoteStatus.enabled ? (
        <>
          <div className="mobile-access-guide-card" data-testid="mobile-access-guide">
            <div className="mobile-access-guide-header">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mobile-access-guide-icon"
                aria-hidden="true"
              >
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                <path d="M12 18h.01" />
              </svg>
              <div className="mobile-access-guide-text">
                <h4 className="mobile-access-guide-title">{copy.hostPairingDisabledTitle}</h4>
                <p className="mobile-access-guide-desc">{copy.hostPairingDisabledDesc}</p>
                <div className="mobile-access-code-row">
                  <div className="mobile-access-code-pill">
                    <code>PIWIN_HOST_PAIRING=1</code>
                    <Button
                      variant="secondary"
                      size="compact"
                      onClick={() => {
                        void handleCopyEnv();
                      }}
                      data-testid="mobile-access-copy-env"
                    >
                      {copiedEnv ? copy.copied : copy.copyCode}
                    </Button>
                  </div>
                </div>
                {!isShellOnly ? (
                  <div className="mobile-access-guide-footer">
                    {switchLocalButton}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mobile-access-shell-note">{copy.hostPairingEnvHint}</p>
        </>
      ) : null}

      {remoteStatus?.enabled ? (
        <div className="mobile-access-content">
          {remoteStatus.advertisedEndpoint ? (
            <div className="mobile-access-field">
              <Field label={copy.advertisedLabel} description={copy.advertisedHint}>
                <TextInput
                  value={remoteStatus.advertisedEndpoint}
                  readOnly
                  testId="mobile-access-advertised"
                />
              </Field>
            </div>
          ) : null}

          {!remoteStatus.canManage ? (
            <Notice tone="info">{copy.readOnlyHint}</Notice>
          ) : null}

          {remotePairing !== undefined ? (
            <PairingCredentialCard
              pairing={remotePairing}
              copy={copy}
              locale={locale}
              busy={busy}
              copied={copied}
              canRegenerate={remoteStatus.canManage}
              onCopy={() => {
                void handleCopyUri(remotePairing.uri);
              }}
              onRegenerate={() => {
                void handleRemoteGenerate();
              }}
            />
          ) : null}

          {remoteStatus.canManage && remotePairing === undefined ? (
            <div className="mobile-access-action-row">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void handleRemoteGenerate();
                }}
                data-testid="mobile-access-generate"
              >
                {busy ? copy.generating : copy.generate}
              </Button>
            </div>
          ) : null}

          <PairedDeviceList
            devices={remoteDevices}
            copy={copy}
            busy={busy}
            {...(remoteStatus.canManage
              ? {
                  onRevoke: (deviceId: string) => {
                    void handleRemoteRevoke(deviceId);
                  },
                }
              : {})}
          />

          {!isShellOnly ? (
            <div className="mobile-access-action-row" style={{ marginTop: 'var(--s-4)' }}>
              {switchLocalButton}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
