import { useState, type ReactElement } from 'react';
import { formatError } from '@piwin/contracts';
import { Button, Field, Notice, PasswordInput, TextInput } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';
import {
  clearDesktopRemoteHostTarget,
  createDesktopRemoteHostClient,
  isDesktopRemoteHostEndpoint,
  loadDesktopRemoteHostTarget,
  readRemoteHostInstanceId,
  saveDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session';

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
    const normalizedEndpoint = endpoint.trim();
    if (!isDesktopRemoteHostEndpoint(normalizedEndpoint)) {
      setHostInstanceId(undefined);
      setError(copy.invalidEndpoint);
      return;
    }

    const trimmedToken = authToken.trim();
    const target: DesktopRemoteHostTarget =
      trimmedToken.length === 0
        ? { endpoint: normalizedEndpoint }
        : { endpoint: normalizedEndpoint, authToken: trimmedToken };

    setBusy(true);
    setError(undefined);
    const probe = createDesktopRemoteHostClient(target);
    try {
      await probe.connect();
      const status = await probe.request({ type: 'host/status' });
      if (!status.success) {
        setHostInstanceId(undefined);
        setError(status.error);
        return;
      }
      const instanceId =
        readRemoteHostInstanceId(status.data) ?? probe.getHostHello()?.hostInstanceId;
      saveDesktopRemoteHostTarget(target);
      setHostInstanceId(instanceId);
    } catch (connectError) {
      setHostInstanceId(undefined);
      setError(formatError(connectError));
    } finally {
      try {
        await probe.close();
      } catch {
        // Probe is only used to validate host/status; App owns the live client.
      }
      setBusy(false);
    }
  }

  function handleUseThisMac(): void {
    clearDesktopRemoteHostTarget();
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
        <Button
          variant="secondary"
          disabled={busy}
          onClick={handleUseThisMac}
          data-testid="host-target-use-local"
        >
          {copy.useThisMac}
        </Button>
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
