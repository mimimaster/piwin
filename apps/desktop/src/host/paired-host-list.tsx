import { useEffect, useState, type ReactElement } from 'react';
import type { HostBookEntry } from '@piwin/contracts';
import { Button, ConfirmDialog, Field, showErrorNotification } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context.js';
import {
  channelHostBook,
  channelHostDisplayEndpoint,
  channelVault,
  primeChannelHost,
} from './channel-host-book.js';
import type { DesktopRemoteHostTarget } from './remote-host-session.js';

export type PairedHostListProps = {
  onConnect: (target: DesktopRemoteHostTarget) => void;
  disabled?: boolean;
};

/**
 * ADR 0101 host book on the connect wall: every Host this device paired with,
 * to switch to or forget. Renders nothing until something is paired.
 */
export function PairedHostList(props: PairedHostListProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const copy = getRemoteAccessCopy(locale);
  const [entries, setEntries] = useState<HostBookEntry[]>([]);
  const [forgetting, setForgetting] = useState<HostBookEntry | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    channelHostBook()
      .list()
      .then((listed) => {
        if (live) setEntries(listed);
      })
      .catch((error: unknown) => console.warn('[piwin] host book could not be read', error));
    return () => {
      live = false;
    };
  }, []);

  if (entries.length === 0) return null;

  async function connect(entry: HostBookEntry): Promise<void> {
    setBusy(true);
    try {
      if (!(await primeChannelHost(entry.hostId))) {
        showErrorNotification(copy.secretsMissing);
        return;
      }
      props.onConnect({ endpoint: channelHostDisplayEndpoint(entry), hostId: entry.hostId });
    } catch (error) {
      showErrorNotification(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function forget(entry: HostBookEntry): Promise<void> {
    setBusy(true);
    try {
      await channelVault()?.clear(entry.hostId);
      await channelHostBook().remove(entry.hostId);
      setEntries((current) => current.filter((item) => item.hostId !== entry.hostId));
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
      <Field label={copy.pairedHostsLabel}>
        <ul className="paired-host-list" data-testid="paired-host-list">
          {entries.map((entry) => (
            <li
              key={entry.hostId}
              className="paired-host-row"
              data-testid={`paired-host-${entry.hostId}`}
            >
              <div className="paired-host-text">
                <span className="paired-host-name">{entry.alias ?? entry.hostName}</span>
                <span className="paired-host-meta">
                  {copy.pairedHostMeta({
                    userName: entry.userName,
                    relay: entry.relayUrl !== undefined,
                    operator: entry.role === 'operator',
                  })}
                </span>
              </div>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => {
                  void connect(entry);
                }}
                data-testid={`paired-host-connect-${entry.hostId}`}
              >
                {copy.connectHost}
              </Button>
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => setForgetting(entry)}
                data-testid={`paired-host-forget-${entry.hostId}`}
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
        title={copy.forgetTitle(forgetting?.alias ?? forgetting?.hostName ?? '')}
        description={copy.forgetDescription}
        confirmLabel={copy.forgetHost}
        cancelLabel={copy.cancel}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          if (forgetting !== undefined) void forget(forgetting);
        }}
        testId="paired-host-forget-dialog"
      />
    </>
  );
}
