import { useEffect, useState, type ReactElement } from 'react';
import { formatError } from '@piwin/contracts';
import { Button, ConfirmDialog, Field, showErrorNotification } from '@piwin/ui-kit';
import { getDesktopCopy } from '../i18n/desktop-locale.js';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context.js';
import { forgetDeviceCredential } from '../devices/device-admission.js';
import { describeHostConnectFailure } from './host-connect-failure.js';
import { probeDesktopRemoteHost } from '../run-activity/probe-desktop-remote-host.js';
import {
  listSavedRemoteTargets,
  removeSavedRemoteTarget,
  type SavedRemoteTarget,
} from './saved-remote-targets.js';
import type { DesktopRemoteHostTarget } from './remote-host-session.js';

export type SavedRemoteTargetListProps = {
  onConnect: (target: DesktopRemoteHostTarget) => void;
  disabled?: boolean;
};

/**
 * Saved legacy-attached Hosts: one-click reconnect and forget for addresses
 * paired through the address + one-time-token flow. Remount (React key) to
 * re-read after a save.
 */
export function SavedRemoteTargetList(props: SavedRemoteTargetListProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const copy = getRemoteAccessCopy(locale);
  const hostCopy = getDesktopCopy(locale).hostTarget;
  const failureCopy = { ...hostCopy, channelFailures: copy.channelFailures };
  const [entries, setEntries] = useState<SavedRemoteTarget[]>(listSavedRemoteTargets);
  const [forgetting, setForgetting] = useState<SavedRemoteTarget | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEntries(listSavedRemoteTargets());
  }, []);

  if (entries.length === 0) return null;

  async function connect(entry: SavedRemoteTarget): Promise<void> {
    setBusy(true);
    try {
      // The probe primes this endpoint's device credential before the hello,
      // so the reconnect needs no token.
      const result = await probeDesktopRemoteHost({
        endpoint: entry.endpoint,
        invalidEndpointMessage: hostCopy.invalidEndpoint,
      });
      if (!result.ok) {
        showErrorNotification(
          describeHostConnectFailure(result.failure, failureCopy, entry.endpoint),
        );
        return;
      }
      props.onConnect(result.target);
    } catch (error) {
      showErrorNotification(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function forget(entry: SavedRemoteTarget): Promise<void> {
    setBusy(true);
    try {
      await forgetDeviceCredential(entry.endpoint);
      setEntries(removeSavedRemoteTarget(entry.endpoint));
      setForgetting(undefined);
    } catch (error) {
      showErrorNotification(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || props.disabled === true;
  return (
    <>
      <Field label={copy.savedHostsLabel}>
        <ul className="paired-host-list" data-testid="saved-remote-target-list">
          {entries.map((entry) => (
            <li
              key={entry.endpoint}
              className="paired-host-row"
              data-testid={`saved-remote-target-${entry.endpoint}`}
            >
              <div className="paired-host-text">
                <span className="paired-host-name">{entry.endpoint}</span>
                <span className="paired-host-meta">
                  {new Date(entry.savedAt).toLocaleDateString(locale)}
                </span>
              </div>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => {
                  void connect(entry);
                }}
                data-testid={`saved-remote-target-connect-${entry.endpoint}`}
              >
                {copy.connectHost}
              </Button>
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => setForgetting(entry)}
                data-testid={`saved-remote-target-forget-${entry.endpoint}`}
              >
                {copy.forgetHost}
              </Button>
            </li>
          ))}
        </ul>
      </Field>
      <ConfirmDialog
        open={forgetting !== undefined}
        onOpenChange={(open) => {
          if (!open) setForgetting(undefined);
        }}
        title={copy.forgetTitle(forgetting?.endpoint ?? '')}
        description={copy.forgetDescription}
        confirmLabel={copy.forgetHost}
        cancelLabel={copy.cancel}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          if (forgetting !== undefined) void forget(forgetting);
        }}
        testId="saved-remote-target-forget-dialog"
      />
    </>
  );
}
