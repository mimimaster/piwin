/**
 * Host IPC handlers: cross-session `web_search` call log.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { getPiwinRoot } from '../paths.js';
import { ok } from '../response-helpers.js';
import { getWebSearchLogStore } from '../web-search-log-store.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>(['web/search-log-list', 'web/search-log-clear']);

export function isWebSearchLogCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleWebSearchLogCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!isWebSearchLogCommand(command)) {
    return null;
  }
  const store = getWebSearchLogStore(getPiwinRoot(context.piwinRoot));
  switch (command.type) {
    case 'web/search-log-list': {
      const page = await store.list({
        ...(command.limit !== undefined ? { limit: command.limit } : {}),
        ...(command.offset !== undefined ? { offset: command.offset } : {}),
        ...(command.status !== undefined ? { status: command.status } : {}),
      });
      return ok(requestId, 'web/search-log-list', { page });
    }
    case 'web/search-log-clear': {
      await store.clear();
      return ok(requestId, 'web/search-log-clear', {});
    }
    default:
      return null;
  }
}
