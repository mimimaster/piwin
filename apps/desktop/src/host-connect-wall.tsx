import { useId, useState, type ReactElement } from 'react';
import { Button, Collapse, Field, PasswordInput, TextInput, showErrorNotification } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { desktopShellDefaultEndpoint } from './desktop-shell-build.js';
import { formatError } from '@piwin/contracts';
import { canScanPairingCode, scanPairingCode } from './pairing-code-scanner.js';
import { probeDesktopRemoteHost } from './probe-desktop-remote-host.js';
import {
  loadDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';

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

  // A pairing token is single use, so a scan connects straight away instead of
  // parking the token in a field the user then has to submit.
  async function handleScan(): Promise<void> {
    setScanning(true);
    try {
      const pairing = await scanPairingCode();
      if (pairing === undefined) {
        showErrorNotification(copy.scanEmpty);
        return;
      }
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
