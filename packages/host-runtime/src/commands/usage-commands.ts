/**
 * Host IPC handlers: usage ledger (CE-OBS).
 * Reads the append-only ledger and returns token rollups for the panel.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { getModelCatalogStatus } from '@piwin/agent-host';
import { createUsageCostEstimator } from '../usage-reference-pricing.js';
import { computeUsageCallLog, readUsageCallLog, readUsageRollup } from '@piwin/session';
import { getPiwinRoot, getPiwinUsageLedgerPath } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'usage/get-rollup',
  'usage/get-session',
  'usage/list-recent',
]);

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
        ...(command.timeZone !== undefined ? { timeZone: command.timeZone } : {}),
        estimateCost: createUsageCostEstimator(),
      });
      rollup.pricingCatalog = getModelCatalogStatus();
      return ok(requestId, 'usage/get-rollup', { rollup });
    }
    case 'usage/get-session': {
      // The session's own measurements, not the global ledger: cheap enough
      // to refresh after every finalized request.
      if (!context.getSessionUsageTotals) {
        return fail(requestId, 'usage/get-session', 'session usage is unavailable on this host');
      }
      return ok(requestId, 'usage/get-session', {
        totals: await context.getSessionUsageTotals(command.sessionId),
      });
    }
    case 'usage/list-recent': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const ledgerPath = getPiwinUsageLedgerPath(rootDir);
      const now = new Date();
      const window = computeUsageCallLog([], {
        now, ...(command.windowMinutes !== undefined ? { windowMinutes: command.windowMinutes } : {}),
      });
      const { from } = window;
      const requestRecords = await context.getBackendRequestUsage?.(from);
      const log = await readUsageCallLog(ledgerPath, {
        now,
        ...(requestRecords !== undefined ? { requestRecords } : {}),
        ...(command.scope ? { scope: command.scope } : {}),
        ...(command.projectPath ? { projectPath: command.projectPath } : {}),
        ...(command.windowMinutes !== undefined ? { windowMinutes: command.windowMinutes } : {}),
        ...(command.limit !== undefined ? { limit: command.limit } : {}),
        ...(command.offset !== undefined ? { offset: command.offset } : {}),
        estimateCost: createUsageCostEstimator(),
      });
      log.pricingCatalog = getModelCatalogStatus();
      return ok(requestId, 'usage/list-recent', { log });
    }
    default:
      return null;
  }
}
