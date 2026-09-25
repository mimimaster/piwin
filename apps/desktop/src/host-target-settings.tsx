import { useState, type ReactElement } from 'react';
import { Button, Field, Notice, PasswordInput, StatusBadge, TextInput } from '@piwin/ui-kit';
import { saveDesktopHostLaunchMode } from './desktop-host-launch.js';
import { isDesktopShellOnlyBuild } from './desktop-shell-build.js';
import { getDesktopCopy } from './desktop-locale.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { probeDesktopRemoteHost } from './probe-desktop-remote-host.js';
import { PageTitle } from './settings/page-title.js';
import { useSettings } from './settings/settings-context.js';
import {
  clearDesktopRemoteHostTarget,
  loadDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
} from './remote-host-session.js';

export function HostTargetSettings(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).hostTarget;
  const { hostClient } = useSettings();
  const transport = hostClient?.getTransport?.() ?? 'mock';
  const isShellOnly = isDesktopShellOnlyBuild();
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

  const statusBadge = (
    <StatusBadge
      tone={transport === 'live' ? 'success' : transport === 'remote' ? 'running' : 'neutral'}
      label={
        transport === 'live'
          ? copy.statusLive
          : transport === 'remote'
            ? copy.statusRemote
            : copy.statusDisconnected
      }
    />
  );

  return (
    <div className="settings-section settings-section-card host-target-card" data-testid="host-target-settings">
      <PageTitle title={copy.title} description={copy.description} trailing={statusBadge} />
      <div className="host-target-form">
        <div className="host-target-fields">
          <Field label={copy.endpointLabel} description={copy.endpointHint}>
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
            variant="primary"
            disabled={busy}
            onClick={() => {
              void handleConnect();
            }}
            data-testid="host-target-connect"
          >
            {busy ? copy.connecting : copy.connect}
          </Button>
          {!isShellOnly ? (
            <Button
              variant="secondary"
              disabled={busy || transport === 'live'}
              onClick={handleUseThisMac}
              data-testid="host-target-use-local"
            >
              {copy.useThisMac}
            </Button>
          ) : null}
        </div>
        {isShellOnly ? (
          <p className="host-target-shell-note">{copy.shellOnlyNote}</p>
        ) : null}
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
