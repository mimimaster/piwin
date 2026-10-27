import { useEffect, useId, useState, type ReactElement } from 'react';
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
import { canScanPairingCode } from './pairing-code-scanner.js';
import {
  loadDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';
import { canPairOverChannel } from './channel-host-book.js';
import { useHostAttach } from './use-host-attach.js';
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
  const remoteCopy = getRemoteAccessCopy(locale);
  const channelPairing = canPairOverChannel();
  const [pairLink, setPairLink] = useState('');

  const scannerAvailable = canScanPairingCode();
  // Where a camera can pair, scanning is the path and the address form folds.
  const [manualOpen, setManualOpen] = useState(!scannerAvailable);
  const manualId = useId();
  // Hosts that predate the encrypted channel still need address + token.
  const [legacyOpen, setLegacyOpen] = useState(!channelPairing);
  const legacyId = useId();

  const attach = useHostAttach({
    onConnected: props.onConnected,
    onError: showErrorNotification,
  });
  const busy = attach.busy;
  const scanning = attach.scanning;

  async function handleConnect(): Promise<void> {
    await attach.connectWithAddress({ endpoint, authToken });
  }

  async function handlePairLink(raw: string): Promise<void> {
    await attach.pairWithLink(raw);
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
                  void attach.scanAndPair();
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
        ) : // With channel pairing the link is the way in; the address form is the older path.
        channelPairing ? (
          <p className="host-gate-description">{copy.pairLinkHint}</p>
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
            {channelPairing ? (
              <div className="ui-field-row host-gate-actions">
                <Button
                  variant="ghost"
                  size="compact"
                  aria-expanded={legacyOpen}
                  aria-controls={legacyId}
                  onClick={() => setLegacyOpen((open) => !open)}
                  data-testid="host-gate-legacy-toggle"
                >
                  {copy.legacyEntry}
                </Button>
              </div>
            ) : null}
            <Collapse expanded={legacyOpen} testId="host-gate-legacy">
              <div id={legacyId} className="host-gate-manual">
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
                    variant={scannerAvailable || channelPairing ? 'secondary' : 'primary'}
                    disabled={busy || scanning}
                    onClick={() => {
                      void handleConnect();
                    }}
                    data-testid="host-gate-connect"
                  >
                    {busy && !scanning ? copy.connecting : copy.connect}
                  </Button>
                </div>
              </div>
            </Collapse>
            {allowLocal ? (
              <div className="ui-field-row host-gate-actions">
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
              </div>
            ) : null}
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
