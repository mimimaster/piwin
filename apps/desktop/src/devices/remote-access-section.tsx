/**
 * ADR 0101 remote access inside the phone-access settings: relay, relay user
 * and legacy clients. Shared by the bundled app (sidecar intercepts the
 * commands) and an operator shell attached to a remote Host.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { HostCommand, LegacyAccessMode, RemoteAccessStatusData } from '@piwin/contracts';
import { formatError, readRemoteAccessStatusData } from '@piwin/contracts';
import { Button, Field, Notice, Select, StatusBadge, Switch, TextInput } from '@piwin/ui-kit';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { FieldRow } from '../settings/field-row.js';

export type RemoteAccessSend = (command: HostCommand) => Promise<unknown>;

const LEGACY_MODES: readonly LegacyAccessMode[] = ['full', 'migrate-only', 'off'];

export function RemoteAccessSection(props: {
  remote: RemoteAccessStatusData;
  locale: string;
  send: RemoteAccessSend;
  /** A change was applied; the panel re-reads its status. */
  onChanged: () => void;
  /** Mints an operator pairing code into the panel's pairing card. */
  onOperatorCode: () => void;
}): ReactElement {
  const copy = getRemoteAccessCopy(props.locale);
  const { remote } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [relayUrl, setRelayUrl] = useState(remote.relay.url ?? '');
  const [enrollToken, setEnrollToken] = useState('');
  const [userName, setUserName] = useState(remote.user?.name ?? '');
  const [copiedLine, setCopiedLine] = useState(false);

  // Follow the Host when nothing is being edited here.
  useEffect(() => setRelayUrl(remote.relay.url ?? ''), [remote.relay.url]);
  useEffect(() => setUserName(remote.user?.name ?? ''), [remote.user?.name]);

  async function run(command: HostCommand): Promise<RemoteAccessStatusData | undefined> {
    setBusy(true);
    setError(undefined);
    try {
      const data = await props.send(command);
      props.onChanged();
      return readRemoteAccessStatusData(data);
    } catch (runError) {
      setError(formatError(runError));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const relay = remote.relay;
  const relayTone =
    relay.state === 'ready'
      ? 'success'
      : relay.state === 'error'
        ? 'danger'
        : relay.state === 'connecting'
          ? 'running'
          : 'neutral';

  return (
    <div className="remote-access-section" data-testid="remote-access-section">
      <h4 className="settings-section-subtitle">{copy.sectionTitle}</h4>
      <p className="remote-access-description">{copy.sectionDescription}</p>

      <FieldRow label={copy.relayLabel} description={copy.relayDescription}>
        <div className="remote-access-inline">
          <StatusBadge
            tone={relayTone}
            label={copy.relayState[relay.enabled ? relay.state : 'off']}
          />
          <Switch
            checked={relay.enabled}
            disabled={busy || (relay.url === undefined && relayUrl.trim().length === 0)}
            onCheckedChange={(checked) => {
              void run({
                type: 'host/remote-access-configure',
                relay: checked ? { enabled: true, url: relayUrl.trim() } : { enabled: false },
              });
            }}
            testId="remote-access-relay"
            aria-label={copy.relayLabel}
          />
        </div>
      </FieldRow>
      <div className="remote-access-field">
        <Field label={copy.relayUrlLabel}>
          <div className="remote-access-row">
            <TextInput
              value={relayUrl}
              onChange={(event) => setRelayUrl(event.currentTarget.value)}
              placeholder={copy.relayUrlPlaceholder}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              testId="remote-access-relay-url"
            />
            <Button
              variant="secondary"
              disabled={busy || relayUrl.trim().length === 0 || relayUrl.trim() === relay.url}
              onClick={() => {
                void run({
                  type: 'host/remote-access-configure',
                  relay: { enabled: true, url: relayUrl.trim() },
                });
              }}
              data-testid="remote-access-relay-save"
            >
              {copy.save}
            </Button>
          </div>
        </Field>
        <Field label={copy.enrollTokenLabel} description={copy.enrollTokenHint}>
          <div className="remote-access-row">
            <TextInput
              value={enrollToken}
              onChange={(event) => setEnrollToken(event.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              testId="remote-access-enroll-token"
            />
            <Button
              variant="secondary"
              disabled={busy || enrollToken.trim().length === 0}
              onClick={() => {
                void run({
                  type: 'host/remote-access-configure',
                  relay: { enrollToken: enrollToken.trim() },
                }).then(() => setEnrollToken(''));
              }}
              data-testid="remote-access-enroll-save"
            >
              {copy.save}
            </Button>
          </div>
        </Field>
      </div>
      {relay.enabled && relay.state === 'error' && relay.lastCloseCode !== undefined ? (
        <Notice tone="warning">{copy.relayCloseHint(relay.lastCloseCode)}</Notice>
      ) : null}

      {remote.user !== undefined ? (
        <FieldRow label={copy.userLabel} description={copy.userDescription(remote.user.userId)}>
          <div className="remote-access-row">
            <TextInput
              value={userName}
              onChange={(event) => setUserName(event.currentTarget.value)}
              disabled={busy}
              testId="remote-access-user-name"
            />
            <Button
              variant="secondary"
              disabled={
                busy || userName.trim().length === 0 || userName.trim() === remote.user.name
              }
              onClick={() => {
                void run({ type: 'host/relay-user-rename', name: userName.trim() });
              }}
              data-testid="remote-access-user-rename"
            >
              {copy.rename}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void props
                  .send({ type: 'host/relay-user-enrollment-line' })
                  .then(async (data) => {
                    await navigator.clipboard.writeText((data as { line: string }).line);
                    setCopiedLine(true);
                  })
                  .catch((copyError: unknown) => setError(formatError(copyError)));
              }}
              data-testid="remote-access-copy-line"
            >
              {copiedLine ? copy.copied : copy.copyEnrollmentLine}
            </Button>
          </div>
        </FieldRow>
      ) : null}

      <FieldRow label={copy.legacyLabel} description={copy.legacyDescription}>
        <Select
          value={remote.legacyAccess}
          data={LEGACY_MODES.map((mode) => ({ value: mode, label: copy.legacyModes[mode] }))}
          disabled={busy}
          onChange={(event) => {
            const mode = event.currentTarget.value as LegacyAccessMode;
            void run({ type: 'host/remote-access-configure', legacyAccess: mode });
          }}
          testId="remote-access-legacy"
          aria-label={copy.legacyLabel}
        />
      </FieldRow>

      <div className="remote-access-actions">
        <Button
          variant="secondary"
          size="compact"
          disabled={busy}
          onClick={props.onOperatorCode}
          data-testid="remote-access-operator-code"
        >
          {copy.operatorCode}
        </Button>
        <span className="remote-access-hint">{copy.operatorCodeHint}</span>
      </div>

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

/** `· 管理员 · 旧版连接` after a device's last-seen time. */
export function remoteAccessDeviceNote(
  locale: string,
): (device: { role?: 'member' | 'operator'; secureChannel?: boolean }) => string | undefined {
  const copy = getRemoteAccessCopy(locale);
  return (device) => {
    const notes = [
      device.role === 'operator' ? copy.deviceOperator : undefined,
      device.secureChannel === true ? undefined : copy.deviceLegacy,
    ].filter((note) => note !== undefined);
    return notes.length === 0 ? undefined : ` · ${notes.join(' · ')}`;
  };
}
