/**
 * Rarely touched remote-access settings, shown under "Advanced" in phone
 * access: the relay user (rename, enrollment line for a shared relay), the
 * policy for pre-relay clients, and the admin pairing code.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { LegacyAccessMode, RemoteAccessStatusData } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { Button, Notice, Select, TextInput } from '@piwin/ui-kit';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { FieldRow } from '../settings/field-row.js';
import { useRemoteAccessCommand, type RemoteAccessSend } from './use-remote-access-command.js';

const LEGACY_MODES: readonly LegacyAccessMode[] = ['full', 'migrate-only', 'off'];

export function RemoteAccessAdvanced(props: {
  remote: RemoteAccessStatusData;
  locale: string;
  send: RemoteAccessSend;
  onChanged: () => void;
  /** Mints an operator pairing code into the panel's pairing card. */
  onOperatorCode: () => void;
}): ReactElement {
  const copy = getRemoteAccessCopy(props.locale);
  const { remote } = props;
  const { busy, error, setError, run } = useRemoteAccessCommand(props.send, props.onChanged);
  const [userName, setUserName] = useState(remote.user?.name ?? '');
  const [copiedLine, setCopiedLine] = useState(false);

  useEffect(() => setUserName(remote.user?.name ?? ''), [remote.user?.name]);

  return (
    <div className="remote-access-advanced" data-testid="remote-access-section">
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

      <FieldRow label={copy.operatorCode} description={copy.operatorCodeHint}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={props.onOperatorCode}
          data-testid="remote-access-operator-code"
        >
          {copy.operatorCodeAction}
        </Button>
      </FieldRow>

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
