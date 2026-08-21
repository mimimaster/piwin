import { useState, type ReactElement } from 'react';
import { Button, Field, Notice, PasswordInput, TextInput } from '@piwin/ui-kit';
import { saveDesktopHostLaunchMode } from './desktop-host-launch.js';
import { isDesktopShellOnlyBuild } from './desktop-shell-build.js';
import { getDesktopCopy } from './desktop-locale.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { probeDesktopRemoteHost } from './probe-desktop-remote-host.js';
import { PageTitle } from './settings/page-title.js';
import {
  clearDesktopRemoteHostTarget,
  loadDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
} from './remote-host-session.js';

export function HostTargetSettings(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).hostTarget;
  const saved = loadDesktopRemoteHostTarget();
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? '');
  const [authToken, setAuthToken] = useState(saved?.authToken ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hostInstanceId, setHostInstanceId] = useState<string | undefined>();

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
      setHostInstanceId(undefined);
      setError(result.error);
      return;
    }
    saveDesktopHostLaunchMode('attach');
    saveDesktopRemoteHostTarget(result.target);
    setHostInstanceId(result.hostInstanceId);
  }

  function handleUseThisMac(): void {
    clearDesktopRemoteHostTarget();
    saveDesktopHostLaunchMode('sidecar');
    setHostInstanceId(undefined);
    setError(undefined);
  }

  return (
    <div className="settings-section settings-section-card" data-testid="host-target-settings">
      <PageTitle title={copy.title} description={copy.description} />
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
      <div className="ui-field-row">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            void handleConnect();
          }}
          data-testid="host-target-connect"
        >
          {busy ? copy.connecting : copy.connect}
        </Button>
        {isDesktopShellOnlyBuild() ? null : (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={handleUseThisMac}
          data-testid="host-target-use-local"
        >
          {copy.useThisMac}
        </Button>
        )}
      </div>
      {hostInstanceId !== undefined ? (
        <Notice tone="success" testId="host-target-instance">
          {copy.instanceId(hostInstanceId)}
        </Notice>
      ) : null}
      {error !== undefined ? (
        <Notice tone="error" testId="host-target-error">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
