/**
 * Phone access on an attached Host (thin shell or remote attach, ADR 0075):
 * the Host's own listener is used, so this panel toggles pairing admission and
 * shows its QR; it never opens a listener.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  HostCommand,
  HostPairingStatusData,
  MobileAccessPairingCodeData,
  PairedDeviceSummary,
} from '@piwin/contracts';
import {
  formatError,
  readHostPairingStatusData,
  readMobileAccessDeviceListData,
  readMobileAccessPairingCodeData,
} from '@piwin/contracts';
import { Button, GuideStep, Notice, Switch } from '@piwin/ui-kit';
import { FieldRow } from '../settings/field-row.js';
import type { MobileAccessCopy } from '../i18n/desktop-locale-mobile-access.js';
import { PageTitle } from '../settings/page-title.js';
import type { SettingsContextValue } from '../settings/settings-context.js';
import {
  PairedDeviceList,
  PairingCredentialCard,
  pairingReachFor,
} from './mobile-access-pairing-views.js';
import { RemoteAccessAdvanced, remoteAccessDeviceNote } from './remote-access-advanced.js';
import { RelayStep } from './relay-step.js';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { getConnectionGuideCopy } from '../i18n/desktop-locale-connection-guide.js';
import { AdvancedFold } from '../settings/advanced-fold.js';

type HostRequest = NonNullable<NonNullable<SettingsContextValue['hostClient']>['request']>;

export function RemoteMobileAccessPanel(props: {
  request: HostRequest;
  copy: MobileAccessCopy;
  locale: string;
  /** Absent in a shell-only build, which has no local Host to switch to. */
  onSwitchToLocal: (() => void) | undefined;
}): ReactElement {
  const { request, copy, locale } = props;
  const guide = getConnectionGuideCopy(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<HostPairingStatusData | undefined>();
  const [supported, setSupported] = useState(true);
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);
  const [pairing, setPairing] = useState<MobileAccessPairingCodeData | undefined>();
  const pairingRef = useRef<MobileAccessPairingCodeData | undefined>(undefined);
  const [operatorCode, setOperatorCode] = useState(false);

  const send = useCallback(
    async (command: HostCommand): Promise<unknown> => {
      const response = await request(command);
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data;
    },
    [request],
  );

  const showCode = useCallback((next: MobileAccessPairingCodeData | undefined): void => {
    pairingRef.current = next;
    setPairing(next);
  }, []);

  const mintCode = useCallback(
    async (role: 'member' | 'operator' = 'member'): Promise<void> => {
      showCode(
        readMobileAccessPairingCodeData(await send({ type: 'host/pairing-create-code', role })),
      );
      setOperatorCode(role === 'operator');
    },
    [send, showCode],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const response = await request({ type: 'host/pairing-status' });
    const data = response.success ? readHostPairingStatusData(response.data) : undefined;
    if (data === undefined) {
      setSupported(false);
      return;
    }
    setSupported(true);
    setStatus(data);
    if (!data.enabled) {
      showCode(undefined);
      setDevices([]);
      return;
    }
    setDevices(
      readMobileAccessDeviceListData(await send({ type: 'host/pairing-list-devices' }))?.devices ??
        [],
    );
    if (data.canManage && pairingRef.current === undefined) {
      await mintCode();
    }
  }, [mintCode, request, send, showCode]);

  useEffect(() => {
    void refresh().catch((refreshError: unknown) => {
      setError(formatError(refreshError));
    });
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

  const enabled = status?.enabled === true;
  const reach = pairingReachFor(status?.remote, status?.advertisedEndpoint);
  const canManage = status?.canManage === true;
  const remote = status?.remote;
  // Only an operator may change the relay; members just see the pairing path.
  const relayStepShown = canManage && remote !== undefined;
  const refreshQuietly = (): void => {
    void refresh().catch((refreshError: unknown) => setError(formatError(refreshError)));
  };
  const switchLocalButton =
    props.onSwitchToLocal === undefined ? null : (
      <Button
        variant="secondary"
        size="compact"
        onClick={props.onSwitchToLocal}
        data-testid="mobile-access-switch-local"
      >
        {copy.switchToLocal}
      </Button>
    );

  return (
    <div
      className="settings-section settings-section-card mobile-access-card"
      data-testid="mobile-access-settings"
    >
      <PageTitle title={copy.title} />

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}

      {!supported ? (
        <GuideCard
          testId="mobile-access-unsupported"
          title={copy.hostPairingUnsupportedTitle}
          description={copy.hostPairingUnsupportedDesc}
          footer={switchLocalButton}
        />
      ) : (
        <>
          {!canManage && status !== undefined ? (
            <Notice tone="info">{copy.readOnlyHint}</Notice>
          ) : null}
          <div className="connection-guide">
            <GuideStep
              index={1}
              title={guide.stepAllow}
              summary={enabled ? guide.stepAllowOn : guide.stepAllowOff}
              state={enabled ? 'done' : 'active'}
              trailing={
                <Switch
                  checked={enabled}
                  disabled={busy || !canManage}
                  onCheckedChange={(checked) => {
                    void runAction(async () => {
                      await send({ type: 'host/pairing-set-enabled', enabled: checked });
                      showCode(undefined);
                      await refresh();
                    });
                  }}
                  testId="mobile-access-listen"
                  aria-label={copy.listenLabel}
                />
              }
              testId="mobile-access-step-allow"
            />

            {enabled && relayStepShown && remote !== undefined ? (
              <RelayStep
                index={2}
                remote={remote}
                locale={locale}
                send={send}
                onChanged={refreshQuietly}
              />
            ) : null}

            {enabled ? (
              <GuideStep
                index={relayStepShown ? 3 : 2}
                title={guide.stepPair}
                state={devices.length > 0 ? 'done' : 'active'}
                testId="mobile-access-step-pair"
              >
                {reach.kind === 'local' ? (
                  <Notice tone="warning">{guide.pairLocalOnly}</Notice>
                ) : null}
                {pairing !== undefined && reach.kind !== 'local' ? (
                  <PairingCredentialCard
                    pairing={pairing}
                    copy={copy}
                    locale={locale}
                    busy={busy}
                    canRegenerate={canManage}
                    onRegenerate={() => {
                      void runAction(() => mintCode());
                    }}
                    reach={reach}
                    bare
                    note={operatorCode ? getRemoteAccessCopy(locale).operatorCodeHint : undefined}
                  />
                ) : null}
              </GuideStep>
            ) : null}
          </div>

          {enabled ? (
            <PairedDeviceList
              devices={devices}
              copy={copy}
              busy={busy}
              deviceNote={remote === undefined ? undefined : remoteAccessDeviceNote(locale)}
              {...(canManage
                ? {
                    onRevoke: (deviceId: string) => {
                      void runAction(async () => {
                        await send({ type: 'host/pairing-revoke-device', deviceId });
                        await refresh();
                      });
                    },
                  }
                : {})}
            />
          ) : null}

          {enabled && (relayStepShown || status?.advertisedEndpoint !== undefined) ? (
            <AdvancedFold label={guide.advanced} testId="mobile-access-advanced">
              {status?.advertisedEndpoint !== undefined ? (
                <FieldRow label={copy.advertisedLabel}>
                  <code
                    className="mobile-access-pairing-endpoint"
                    data-testid="mobile-access-advertised"
                  >
                    {status.advertisedEndpoint}
                  </code>
                </FieldRow>
              ) : null}
              {relayStepShown && remote !== undefined ? (
                <RemoteAccessAdvanced
                  remote={remote}
                  locale={locale}
                  send={send}
                  onChanged={refreshQuietly}
                  onOperatorCode={() => {
                    void runAction(() => mintCode('operator'));
                  }}
                />
              ) : null}
            </AdvancedFold>
          ) : null}

          {switchLocalButton !== null ? (
            <div className="mobile-access-action-row">{switchLocalButton}</div>
          ) : null}
        </>
      )}
    </div>
  );
}

function GuideCard(props: {
  testId: string;
  title: string;
  description: string;
  footer: ReactElement | null;
}): ReactElement {
  return (
    <div className="mobile-access-guide-card" data-testid={props.testId}>
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
          <h4 className="mobile-access-guide-title">{props.title}</h4>
          <p className="mobile-access-guide-desc">{props.description}</p>
          {props.footer !== null ? (
            <div className="mobile-access-guide-footer">{props.footer}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
