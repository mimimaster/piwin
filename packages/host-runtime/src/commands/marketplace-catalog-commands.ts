/** Host IPC: curated marketplace catalog and the unified installed inventory. */
import type {
  HostCommand,
  HostResponse,
  MarketplaceCatalogGetData,
  MarketplaceCatalogListData,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { findCatalogEntry, listCatalogEntries } from '@piwin/marketplace';
import { purgeUnreferencedExtensions, readMarketplaceInventory } from '../marketplace/inventory-reader.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'marketplace/catalog-list',
  'marketplace/catalog-get',
  'marketplace/installed-list',
]);

export async function handleMarketplaceCatalogCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
    case 'marketplace/catalog-list': {
      const data: MarketplaceCatalogListData = {
        entries: listCatalogEntries({
          ...(command.query !== undefined ? { query: command.query } : {}),
          ...(command.kinds !== undefined ? { kinds: command.kinds } : {}),
          ...(command.category !== undefined ? { category: command.category } : {}),
          ...(command.includeWithdrawn !== undefined
            ? { includeWithdrawn: command.includeWithdrawn }
            : {}),
        }),
      };
      return ok(requestId, command.type, data);
    }
    case 'marketplace/catalog-get': {
      const entry = findCatalogEntry(command.entryId);
      if (!entry) {
        return fail(requestId, command.type, `Unknown marketplace entry: ${command.entryId}`);
      }
      const data: MarketplaceCatalogGetData = { entry };
      return ok(requestId, command.type, data);
    }
    case 'marketplace/installed-list': {
      try {
        // Reading the inventory is the natural moment to finish uninstalls
        // whose last referencing runtime has since gone away.
        await purgeUnreferencedExtensions(context);
        const data = await readMarketplaceInventory(context, {
          ...(command.sessionId ? { sessionId: command.sessionId } : {}),
          ...(command.projectPath ? { projectPath: command.projectPath } : {}),
        });
        return ok(requestId, command.type, data);
      } catch (error) {
        return fail(requestId, command.type, formatError(error));
      }
    }
    default:
      return null;
  }
}
