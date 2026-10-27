/**
 * Settings → Connection → Current Host: one line says which Host this window
 * uses. "Connect to another Host" opens a two-step guide (copy the pairing
 * link there, paste it here; on the phone, scan its QR code); address + token
 * stays folded for Hosts that predate the encrypted channel (ADR 0101).
 */
import { useId, useState, type ReactElement } from 'react';
import {
  Button,
  Collapse,
  Field,
  GuideStep,
  Notice,
  PasswordInput,
  TextInput,
} from '@piwin/ui-kit';
import { saveDesktopHostLaunchMode } from '../platform/desktop-host-launch.js';
import { isDesktopShellOnlyBuild } from '../platform/desktop-shell-build.js';
import { getDesktopCopy } from '../i18n/desktop-locale.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context.js';
import { getConnectionGuideCopy } from '../i18n/desktop-locale-connection-guide.js';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { PageTitle } from '../settings/page-title.js';
import { useSettings } from '../settings/settings-context.js';
import { canPairOverChannel } from './channel-host-book.js';
import { canScanPairingCode } from './pairing-code-scanner.js';
import { PairedHostList } from './paired-host-list.js';
import {
  clearDesktopRemoteHostTarget,
  loadDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';
import { useHostAttach } from './use-host-attach.js';

export function HostTargetSettings(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).hostTarget;
  const guide = getConnectionGuideCopy(locale);
  const remoteCopy = getRemoteAccessCopy(locale);
  const { hostClient } = useSettings();
  const transport = hostClient?.getTransport?.() ?? 'mock';
  const isShellOnly = isDesktopShellOnlyBuild();
  const channelPairing = canPairOverChannel();
  const scannerAvailable = canScanPairingCode();
  const saved = loadDesktopRemoteHostTarget();
  const connected = transport === 'live' || transport === 'remote';
  // Nothing connected yet: the guide is the whole point of this card.
  const [connectOpen, setConnectOpen] = useState(!connected);
  const [pairLink, setPairLink] = useState('');
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? '');
  const [authToken, setAuthToken] = useState(saved?.authToken ?? '');
  // Without channel pairing the address form is the only way in.
  const [legacyOpen, setLegacyOpen] = useState(!channelPairing);
  const legacyId = useId();
  const connectId = useId();
  const [error, setError] = useState<string | undefined>();

  function attachTo(target: DesktopRemoteHostTarget): void {
    setError(undefined);
    saveDesktopHostLaunchMode('attach');
    saveDesktopRemoteHostTarget(target);
    setPairLink('');
    setConnectOpen(false);
  }

  const attach = useHostAttach({ onConnected: attachTo, onError: setError });
  const busy = attach.busy;

  function handleUseThisMac(): void {
    clearDesktopRemoteHostTarget();
    saveDesktopHostLaunchMode('sidecar');
    setError(undefined);
  }

  const statusText =
    transport === 'live'
      ? guide.usingLocal
      : transport === 'remote'
        ? guide.usingRemote(saved?.endpoint ?? '')
        : guide.usingNone;

  const pasteLinkRow = (
    <div className="remote-access-row">
      <TextInput
        value={pairLink}
        onChange={(event) => setPairLink(event.currentTarget.value)}
        placeholder={remoteCopy.pairLinkPlaceholder}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        testId="host-target-pair-link"
      />
      <Button
        variant={scannerAvailable ? 'secondary' : 'primary'}
        disabled={busy || pairLink.trim().length === 0}
        onClick={() => {
          setError(undefined);
          void attach.pairWithLink(pairLink.trim());
        }}
        data-testid="host-target-pair-link-submit"
      >
        {busy && !attach.scanning ? remoteCopy.pairing : remoteCopy.pairWithLink}
      </Button>
    </div>
  );

  const legacyForm = (
    <div id={legacyId} className="host-target-legacy">
      <div className="host-target-fields">
        <Field label={copy.endpointLabel}>
          <TextInput
            value={endpoint}
            onChange={(event) => setEndpoint(event.currentTarget.value)}
            placeholder={copy.endpointPlaceholder}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            testId="host-target-endpoint"
          />
        </Field>
        <Field label={copy.tokenLabel}>
          <PasswordInput
            value={authToken}
            onChange={(event) => setAuthToken(event.currentTarget.value)}
            placeholder={copy.tokenPlaceholder}
            autoComplete="off"
            disabled={busy}
            testId="host-target-token"
          />
        </Field>
      </div>
      <div className="host-target-actions">
        <Button
          variant={channelPairing ? 'secondary' : 'primary'}
          disabled={busy || endpoint.trim().length === 0}
          onClick={() => {
            setError(undefined);
            void attach.connectWithAddress({ endpoint, authToken });
          }}
          data-testid="host-target-connect"
        >
          {busy ? copy.connecting : copy.connect}
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className="settings-section settings-section-card host-target-card"
      data-testid="host-target-settings"
    >
      <PageTitle title={guide.hostTitle} />
      <div className="host-target-status">
        <span className="host-target-status-text" data-testid="host-target-status">
          {statusText}
        </span>
        <div className="host-target-actions">
          {transport === 'remote' && !isShellOnly ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={handleUseThisMac}
              data-testid="host-target-use-local"
            >
              {copy.useThisMac}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            aria-expanded={connectOpen}
            aria-controls={connectId}
            onClick={() => setConnectOpen((open) => !open)}
            data-testid="host-target-connect-toggle"
          >
            {guide.connectOther}
          </Button>
        </div>
      </div>

      {channelPairing ? (
        <PairedHostList
          onConnect={(target) => {
            attachTo(target);
          }}
          disabled={busy}
        />
      ) : null}

      <Collapse expanded={connectOpen} testId="host-target-connect-guide">
        <div id={connectId} className="connection-guide">
          {channelPairing ? (
            <>
              <GuideStep
                index={1}
                title={scannerAvailable ? guide.stepOpenQr : guide.stepCopyLink}
                summary={scannerAvailable ? guide.stepOpenQrHint : guide.stepCopyLinkHint}
                state="active"
              />
              <GuideStep
                index={2}
                title={scannerAvailable ? guide.stepScan : guide.stepPasteLink}
                state="active"
              >
                {scannerAvailable ? (
                  <div className="host-target-actions">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => {
                        setError(undefined);
                        void attach.scanAndPair();
                      }}
                      data-testid="host-target-scan"
                    >
                      {attach.scanning ? copy.scanning : copy.scanPairingCode}
                    </Button>
                  </div>
                ) : null}
                {scannerAvailable ? (
                  <Field label={guide.orPasteLink}>{pasteLinkRow}</Field>
                ) : (
                  pasteLinkRow
                )}
              </GuideStep>
              <div className="host-target-actions">
                <Button
                  variant="ghost"
                  size="compact"
                  aria-expanded={legacyOpen}
                  aria-controls={legacyId}
                  onClick={() => setLegacyOpen((open) => !open)}
                  data-testid="host-target-legacy-toggle"
                >
                  {copy.legacyEntry}
                </Button>
              </div>
              <Collapse expanded={legacyOpen} testId="host-target-legacy">
                {legacyForm}
              </Collapse>
            </>
          ) : (
            legacyForm
          )}
        </div>
      </Collapse>

      {error !== undefined ? (
        <Notice tone="error" testId="host-target-error">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
