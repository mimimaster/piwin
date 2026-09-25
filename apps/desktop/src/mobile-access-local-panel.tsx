/**
 * Phone access for the bundled app: the sidecar listens on the LAN and this
 * panel shows a QR the phone scans. On by default; the switch is remembered by
 * the sidecar (`~/.piwin/devices/mobile-access.json`).
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  LocalMobileAccessCommand,
  MobileAccessPairingCodeData,
  MobileAccessStatusData,
  PairedDeviceSummary,
} from '@piwin/contracts';
import {
  MOBILE_ACCESS_LAN_PROFILE_ID,
  formatError,
  readMobileAccessDeviceListData,
  readMobileAccessPairingCodeData,
  readMobileAccessStatusData,
} from '@piwin/contracts';
import { Button, Field, Notice, Select, StatusBadge, Switch, TextInput } from '@piwin/ui-kit';
import type { MobileAccessCopy } from './desktop-locale-mobile-access.js';
import { isDesktopRemoteHostEndpoint } from './remote-host-session.js';
import { FieldRow } from './settings/field-row.js';
import { PageTitle } from './settings/page-title.js';
import type { SettingsContextValue } from './settings/settings-context.js';
import { PairedDeviceList, PairingCredentialCard } from './mobile-access-pairing-views.js';

/** Picks up a phone that just paired (and a Wi-Fi change) while the page is open. */
const STATUS_POLL_MS = 4000;
const AUTO_ADDRESS = 'auto';
const CUSTOM_ADDRESS = 'custom';

type HostRequest = NonNullable<NonNullable<SettingsContextValue['hostClient']>['request']>;

export function LocalMobileAccessPanel(props: {
  request: HostRequest;
  copy: MobileAccessCopy;
  locale: string;
}): ReactElement {
  const { request, copy, locale } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<MobileAccessStatusData | undefined>();
  const [pairing, setPairing] = useState<MobileAccessPairingCodeData | undefined>();
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  // Read inside refresh without making refresh (and the poll) depend on them.
  const pairingRef = useRef<MobileAccessPairingCodeData | undefined>(undefined);
  const deviceCountRef = useRef<number | undefined>(undefined);

  const send = useCallback(
    async (command: LocalMobileAccessCommand): Promise<unknown> => {
      const response = await request(command);
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data;
    },
    [request],
  );

  const mintCode = useCallback(async (): Promise<void> => {
    const next = readMobileAccessPairingCodeData(await send({ type: 'mobile-access/create-pairing-code' }));
    pairingRef.current = next;
    setPairing(next);
  }, [send]);

  const clearCode = useCallback((): void => {
    pairingRef.current = undefined;
    setPairing(undefined);
  }, []);

  /**
   * A shown code is replaced when it no longer works: the address changed,
   * it expired, or a new device appeared (codes are single use).
   */
  const refresh = useCallback(async (): Promise<void> => {
    const [statusData, devicesData] = await Promise.all([
      send({ type: 'mobile-access/status' }),
      send({ type: 'mobile-access/list-devices' }),
    ]);
    const nextStatus = readMobileAccessStatusData(statusData);
    setStatus(nextStatus);
    setDevices(readMobileAccessDeviceListData(devicesData)?.devices ?? []);
    const deviceCountChanged =
      deviceCountRef.current !== undefined && deviceCountRef.current !== nextStatus?.pairedDeviceCount;
    deviceCountRef.current = nextStatus?.pairedDeviceCount;
    if (nextStatus?.listening !== true || nextStatus.advertisedEndpoint === undefined) {
      clearCode();
      return;
    }
    const current = pairingRef.current;
    if (
      current === undefined ||
      current.endpoint !== nextStatus.advertisedEndpoint ||
      current.expiresAt <= Date.now() ||
      deviceCountChanged
    ) {
      await mintCode();
    }
  }, [clearCode, mintCode, send]);

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      void refresh().catch((refreshError: unknown) => {
        if (!cancelled) {
          setError(formatError(refreshError));
        }
      });
    };
    tick();
    const timer = setInterval(tick, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  async function runAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (actionError) {
      setError(formatError(actionError));
    } finally {
      setBusy(false);
    }
  }

  function startListening(advertisedEndpoint?: string): Promise<void> {
    return runAction(async () => {
      await send({
        type: 'mobile-access/start',
        profileId: MOBILE_ACCESS_LAN_PROFILE_ID,
        ...(advertisedEndpoint === undefined ? {} : { advertisedEndpoint }),
      });
      clearCode();
      await refresh();
    });
  }

  function handleListenChange(checked: boolean): Promise<void> {
    if (checked) {
      return startListening();
    }
    return runAction(async () => {
      await send({ type: 'mobile-access/stop' });
      clearCode();
      await refresh();
    });
  }

  function handleAddressChange(value: string): void {
    if (value === CUSTOM_ADDRESS) {
      setCustomDraft(status?.advertisedEndpointSource === 'custom' ? (status.advertisedEndpoint ?? '') : '');
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    void startListening(value === AUTO_ADDRESS ? '' : value);
  }

  function handleApplyCustom(): void {
    const trimmed = customDraft.trim();
    if (!isDesktopRemoteHostEndpoint(trimmed)) {
      setError(copy.invalidAdvertised);
      return;
    }
    void startListening(trimmed).then(() => {
      setCustomOpen(false);
    });
  }

  const listening = status?.listening === true;
  const candidates = status?.endpointCandidates ?? [];
  const autoCandidate = candidates[0]?.url;
  const addressValue = customOpen ? CUSTOM_ADDRESS : selectedAddress(status);
  const addressOptions = [
    {
      value: AUTO_ADDRESS,
      label: autoCandidate === undefined ? copy.addressAutoNone : copy.addressAuto(autoCandidate),
    },
    ...candidates.map((candidate) => ({
      value: candidate.url,
      label: `${candidate.url} · ${
        candidate.kind === 'tailscale' ? copy.addressKindTailscale : copy.addressKindLan
      } (${candidate.interfaceName})`,
    })),
    ...(addressValue === CUSTOM_ADDRESS && !customOpen && status?.advertisedEndpoint !== undefined
      ? [{ value: CUSTOM_ADDRESS, label: status.advertisedEndpoint }]
      : [{ value: CUSTOM_ADDRESS, label: copy.addressCustom }]),
  ];
  const startError = !listening && error === undefined ? status?.lastError : undefined;

  return (
    <div
      className="settings-section settings-section-card mobile-access-card"
      data-testid="mobile-access-settings"
    >
      <PageTitle
        title={copy.title}
        description={copy.description}
        trailing={
          <StatusBadge
            tone={listening ? 'success' : 'neutral'}
            label={listening ? copy.statusListening : copy.statusIdle}
          />
        }
      />
      <div className="mobile-access-content">
        <FieldRow
          label={copy.listenLabel}
          description={
            listening && status?.bindPort !== undefined
              ? `${copy.listenDescription} ${copy.listeningOn(status.bindPort)}`
              : copy.listenDescription
          }
        >
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

        {listening ? (
          <div className="mobile-access-field">
            <Field label={copy.advertisedLabel} description={copy.advertisedHint}>
              <Select
                value={addressValue}
                data={addressOptions}
                disabled={busy}
                onChange={(event) => {
                  handleAddressChange(event.currentTarget.value);
                }}
                testId="mobile-access-address"
                aria-label={copy.advertisedLabel}
              />
            </Field>
            {customOpen ? (
              <div className="mobile-access-custom-row">
                <TextInput
                  value={customDraft}
                  onChange={(event) => setCustomDraft(event.currentTarget.value)}
                  placeholder={copy.advertisedPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  testId="mobile-access-advertised"
                />
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={handleApplyCustom}
                  data-testid="mobile-access-apply-address"
                >
                  {copy.apply}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
      {startError !== undefined ? <Notice tone="error">{copy.startFailed(startError)}</Notice> : null}
      {listening && status?.advertisedEndpoint === undefined ? (
        <Notice tone="warning">{copy.noNetworkAddress}</Notice>
      ) : null}

      {pairing !== undefined ? (
        <PairingCredentialCard
          pairing={pairing}
          copy={copy}
          locale={locale}
          busy={busy}
          canRegenerate={listening}
          onRegenerate={() => {
            void runAction(mintCode);
          }}
        />
      ) : null}
      {listening ? <p className="mobile-access-listen-meta">{copy.securityHint}</p> : null}

      <PairedDeviceList
        devices={devices}
        copy={copy}
        busy={busy}
        onRevoke={(deviceId) => {
          void runAction(async () => {
            await send({ type: 'mobile-access/revoke-device', deviceId });
            await refresh();
          });
        }}
      />
    </div>
  );
}

function selectedAddress(status: MobileAccessStatusData | undefined): string {
  if (status?.advertisedEndpointSource !== 'custom' || status.advertisedEndpoint === undefined) {
    return AUTO_ADDRESS;
  }
  const match = status.endpointCandidates?.find((candidate) => candidate.url === status.advertisedEndpoint);
  return match?.url ?? CUSTOM_ADDRESS;
}
