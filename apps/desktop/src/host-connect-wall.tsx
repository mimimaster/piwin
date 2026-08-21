import { useState, type ReactElement } from 'react';
import { Button, Field, Notice, PasswordInput, TextInput } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale.js';
import { useDesktopLocale } from './desktop-locale-context.js';
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
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? 'ws://127.0.0.1:8787');
  const [authToken, setAuthToken] = useState(saved?.authToken ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleConnect(): Promise<void> {
    setBusy(true);
    setError(undefined);
    const result = await probeDesktopRemoteHost({
      endpoint,
      authToken,
      invalidEndpointMessage: copy.invalidEndpoint,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    props.onConnected(result.target, result.hostInstanceId);
  }

  return (
    <div className="host-gate" data-testid="host-connect-wall">
      <div className="host-gate-card">
        <h1 className="host-gate-title">{gate.connectTitle}</h1>
        <p className="host-gate-description">{gate.connectDescription}</p>
        <p className="host-gate-description muted">{gate.rootLockNote}</p>
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
            variant="primary"
            disabled={busy}
            onClick={() => {
              void handleConnect();
            }}
            data-testid="host-gate-connect"
          >
            {busy ? copy.connecting : copy.connect}
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
        {error !== undefined ? (
          <Notice tone="error" testId="host-gate-error">
            {error}
          </Notice>
        ) : null}
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
