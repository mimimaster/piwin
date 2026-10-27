/**
 * Runs one ADR 0101 remote-access command for the relay step or the advanced
 * options: tracks busy/error and asks the panel to re-read its status.
 */
import { useState } from 'react';
import type { HostCommand } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

export type RemoteAccessSend = (command: HostCommand) => Promise<unknown>;

export function useRemoteAccessCommand(
  send: RemoteAccessSend,
  onChanged: () => void,
): {
  busy: boolean;
  error: string | undefined;
  setError: (message: string | undefined) => void;
  /** Resolves true when the Host applied the command. */
  run: (command: HostCommand) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function run(command: HostCommand): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      await send(command);
      onChanged();
      return true;
    } catch (runError) {
      setError(formatError(runError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}
