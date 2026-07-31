/**
 * Host IPC handlers: usage ledger (CE-OBS).
 * Reads the append-only ledger and returns token rollups for the panel.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { readUsageRollup } from '@piwin/session';
import { getPiwinRoot, getPiwinUsageLedgerPath } from '../paths.js';
import { ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>(['usage/get-rollup']);

export function isUsageCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleUsageCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!isUsageCommand(command)) {
    return null;
  }
  switch (command.type) {
    case 'usage/get-rollup': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const ledgerPath = getPiwinUsageLedgerPath(rootDir);
      const rollup = await readUsageRollup(ledgerPath, {
        ...(command.scope ? { scope: command.scope } : {}),
        ...(command.projectPath ? { projectPath: command.projectPath } : {}),
        ...(command.window ? { window: command.window } : {}),
        ...(command.topSessions !== undefined ? { topSessions: command.topSessions } : {}),
      });
      return ok(requestId, 'usage/get-rollup', { rollup });
    }
    default:
      return null;
  }
}
