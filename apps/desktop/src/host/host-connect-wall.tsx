import { useEffect, useId, useState, type ReactElement } from 'react';
import type { PairingLinkV3 } from '@piwin/contracts';
import { classifyChannelFailure, classifyPairingInput } from '@piwin/host-client';
import { HostHandshakeError } from '@piwin/host-transport';
import {
  Button,
  Collapse,
  Field,
  PasswordInput,
  TextInput,
  showErrorNotification,
} from '@piwin/ui-kit';
import { getDesktopCopy } from '../i18n/desktop-locale.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context.js';
import { desktopShellDefaultEndpoint } from '../platform/desktop-shell-build.js';
import { formatError } from '@piwin/contracts';
import { canScanPairingCode, scanPairingCode } from './pairing-code-scanner.js';
import { probeDesktopRemoteHost } from '../run-activity/probe-desktop-remote-host.js';
import {
  DESKTOP_HOST_CLIENT_VERSION,
  desktopRemoteClientId,
  loadDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';
import {
  canPairOverChannel,
  channelHostDisplayEndpoint,
  pairWorkbenchChannelHost,
} from './channel-host-book.js';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { PairedHostList } from './paired-host-list.js';

export type HostConnectWallProps = {
  /** After a successful probe; caller persists target + launch mode. */
  onConnected: (target: DesktopRemoteHostTarget, hostInstanceId?: string) => void;
  /** Switch to local sidecar instead of attaching. */
  onUseLocal?: () => void;
  /** Hide the local button (thin shell package). */
  allowLocal?: boolean;
};

export function HostConnectWall(props: HostConnectWallProps): ReactElement {
  const allowLocal = props.allowLocal !== false;
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).hostTarget;
  const gate = getDesktopCopy(locale).hostGate;
  const saved = loadDesktopRemoteHostTarget();
  const [endpoint, setEndpoint] = useState(
    saved?.endpoint ?? desktopShellDefaultEndpoint() ?? 'ws://127.0.0.1:8787',
  );
  const [authToken, setAuthToken] = useState(saved?.authToken ?? '');
  const [busy, setBusy] = useState(false);
  const remoteCopy = getRemoteAccessCopy(locale);
  const channelPairing = canPairOverChannel();
  const [pairLink, setPairLink] = useState('');

  const [scanning, setScanning] = useState(false);
  const scannerAvailable = canScanPairingCode();
  // Where a camera can pair, scanning is the path and the address form folds.
  const [manualOpen, setManualOpen] = useState(!scannerAvailable);
  const manualId = useId();

  async function connectWith(input: {
    endpoint: string;
    authToken: string;
    pairingToken?: string;
  }): Promise<void> {
    setBusy(true);
    try {
      const result = await probeDesktopRemoteHost({
        endpoint: input.endpoint,
        authToken: input.authToken,
        ...(input.pairingToken === undefined ? {} : { pairingToken: input.pairingToken }),
        invalidEndpointMessage: copy.invalidEndpoint,
      });
      if (!result.ok) {
        showErrorNotification(
          result.reason === undefined
            ? copy.connectFailed(result.error)
            : copy.rejectReasons[result.reason],
        );
        return;
      }
      props.onConnected(result.target, result.hostInstanceId);
    } catch (connectError) {
      showErrorNotification(copy.connectFailed(formatError(connectError)));
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect(): Promise<void> {
    await connectWith({ endpoint, authToken });
  }

  /** ADR 0101: pair over the encrypted channel from a v3 link or QR. */
  async function pairChannel(link: PairingLinkV3): Promise<void> {
    setBusy(true);
    try {
      const entry = await pairWorkbenchChannelHost({
        link,
        clientId: desktopRemoteClientId(),
        clientVersion: DESKTOP_HOST_CLIENT_VERSION,
      });
      props.onConnected({ endpoint: channelHostDisplayEndpoint(entry), hostId: entry.hostId });
    } catch (pairError) {
      const failure = classifyChannelFailure(pairError);
      showErrorNotification(
        pairError instanceof HostHandshakeError && pairError.reason !== undefined
          ? copy.rejectReasons[pairError.reason]
          : failure !== undefined
            ? remoteCopy.channelFailures[failure]
            : copy.connectFailed(formatError(pairError)),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePairLink(raw: string): Promise<void> {
    try {
      const input = classifyPairingInput(raw);
      if (input.kind === 'channel') {
        await pairChannel(input.link);
        return;
      }
      setEndpoint(input.data.endpoint);
      await connectWith({
        endpoint: input.data.endpoint,
        authToken: input.data.authToken ?? '',
        ...(input.data.pairingToken === undefined ? {} : { pairingToken: input.data.pairingToken }),
      });
    } catch (linkError) {
      showErrorNotification(formatError(linkError));
    }
  }

  // A browser opened from `https://relay/#pair=…`: pair once, then drop the
  // secret from the address bar and history.
  useEffect(() => {
    if (!channelPairing || !window.location.hash.startsWith('#pair=')) {
      return;
    }
    const href = window.location.href;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    void handlePairLink(href);
    // Runs once on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pairing token is single use, so a scan connects straight away instead of
  // parking the token in a field the user then has to submit.
  async function handleScan(): Promise<void> {
    setScanning(true);
    try {
      const scanned = await scanPairingCode();
      if (scanned === undefined) {
        showErrorNotification(copy.scanEmpty);
        return;
      }
      if (scanned.kind === 'channel') {
        await pairChannel(scanned.link);
        return;
      }
      const pairing = scanned.data;
      setEndpoint(pairing.endpoint);
      setAuthToken(pairing.authToken ?? '');
      await connectWith({
        endpoint: pairing.endpoint,
        authToken: pairing.authToken ?? '',
        ...(pairing.pairingToken === undefined ? {} : { pairingToken: pairing.pairingToken }),
      });
    } catch (scanError) {
      showErrorNotification(formatError(scanError));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="host-gate" data-testid="host-connect-wall">
      <div className="host-gate-card">
        <h1 className="host-gate-title">{gate.connectTitle}</h1>
        {channelPairing ? (
          <PairedHostList onConnect={(target) => props.onConnected(target)} disabled={busy} />
        ) : null}
        {scannerAvailable ? (
          <>
            <p className="host-gate-description">{copy.scanHint}</p>
            <div className="host-gate-actions host-gate-actions-stack">
              <Button
                variant="primary"
                disabled={busy || scanning}
                onClick={() => {
                  void handleScan();
                }}
                data-testid="host-gate-scan"
              >
                {scanning ? copy.scanning : copy.scanPairingCode}
              </Button>
              <Button
                variant="ghost"
                aria-expanded={manualOpen}
                aria-controls={manualId}
                onClick={() => setManualOpen((open) => !open)}
                data-testid="host-gate-manual-toggle"
              >
                {copy.manualEntry}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="host-gate-description">{gate.connectDescription}</p>
            <p className="host-gate-description muted">{gate.rootLockNote}</p>
          </>
        )}
        <Collapse expanded={manualOpen} testId="host-gate-manual">
          <div id={manualId} className="host-gate-manual">
            {channelPairing ? (
              <Field label={remoteCopy.pairLinkLabel}>
                <div className="remote-access-row">
                  <TextInput
                    value={pairLink}
                    onChange={(event) => setPairLink(event.currentTarget.value)}
                    placeholder={remoteCopy.pairLinkPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    testId="host-gate-pair-link"
                  />
                  <Button
                    variant="primary"
                    disabled={busy || pairLink.trim().length === 0}
                    onClick={() => {
                      void handlePairLink(pairLink.trim());
                    }}
                    data-testid="host-gate-pair-link-submit"
                  >
                    {busy ? remoteCopy.pairing : remoteCopy.pairWithLink}
                  </Button>
                </div>
              </Field>
            ) : null}
            <Field label={copy.endpointLabel}>
              <TextInput
                value={endpoint}
                onChange={(event) => setEndpoint(event.currentTarget.value)}
                placeholder={copy.endpointPlaceholder}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                testId="host-gate-endpoint"
              />
            </Field>
            <Field label={copy.tokenLabel}>
              <PasswordInput
                value={authToken}
                onChange={(event) => setAuthToken(event.currentTarget.value)}
                placeholder={copy.tokenPlaceholder}
                autoComplete="off"
                disabled={busy}
                testId="host-gate-token"
              />
            </Field>
            <div className="ui-field-row host-gate-actions">
              <Button
                variant={scannerAvailable ? 'secondary' : 'primary'}
                disabled={busy || scanning}
                onClick={() => {
                  void handleConnect();
                }}
                data-testid="host-gate-connect"
              >
                {busy && !scanning ? copy.connecting : copy.connect}
              </Button>
              {allowLocal ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    props.onUseLocal?.();
                  }}
                  data-testid="host-gate-use-local"
                >
                  {copy.useThisMac}
                </Button>
              ) : null}
            </div>
          </div>
        </Collapse>
      </div>
    </div>
  );
}

export type HostLaunchChooserProps = {
  onChooseSidecar: () => void;
  onChooseAttach: () => void;
};

export function HostLaunchChooser(props: HostLaunchChooserProps): ReactElement {
  const { locale } = useDesktopLocale();
  const gate = getDesktopCopy(locale).hostGate;

  return (
    <div className="host-gate" data-testid="host-launch-chooser">
      <div className="host-gate-card">
        <h1 className="host-gate-title">{gate.chooserTitle}</h1>
        <p className="host-gate-description">{gate.chooserDescription}</p>
        <div className="host-gate-actions host-gate-actions-stack">
          <Button
            variant="primary"
            onClick={props.onChooseSidecar}
            data-testid="host-gate-choose-sidecar"
          >
            {gate.chooseSidecar}
          </Button>
          <Button
            variant="secondary"
            onClick={props.onChooseAttach}
            data-testid="host-gate-choose-attach"
          >
            {gate.chooseAttach}
          </Button>
        </div>
      </div>
    </div>
  );
}
