/**
 * Host IPC for the read-only reference catalog (search / status / sync).
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import {
  getModelCatalogStatus,
  searchPiCatalog,
  searchPiImagesCatalog,
} from '@piwin/agent-host';
import {
  ModelCatalogSyncError,
  syncModelCatalogFromModelsDev,
} from '../model-catalog-store.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'models/catalog/search',
  'models/catalog/status',
  'models/catalog/sync',
  'models/image-catalog/search',
]);

export function isModelCatalogCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleModelCatalogCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
    case 'models/catalog/search': {
      try {
        const result = searchPiCatalog(command.input ?? {});
        return ok(requestId, 'models/catalog/search', result);
      } catch (error) {
        return fail(requestId, 'models/catalog/search', formatError(error));
      }
    }
    case 'models/catalog/status': {
      try {
        return ok(requestId, 'models/catalog/status', getModelCatalogStatus());
      } catch (error) {
        return fail(requestId, 'models/catalog/status', formatError(error));
      }
    }
    case 'models/catalog/sync': {
      try {
        const result = await syncModelCatalogFromModelsDev({
          ...(context.piwinRoot === undefined ? {} : { rootDir: context.piwinRoot }),
        });
        return ok(requestId, 'models/catalog/sync', result);
      } catch (error) {
        const message =
          error instanceof ModelCatalogSyncError ? error.message : formatError(error);
        return fail(requestId, 'models/catalog/sync', message);
      }
    }
    case 'models/image-catalog/search': {
      try {
        return ok(requestId, 'models/image-catalog/search', searchPiImagesCatalog());
      } catch (error) {
        return fail(requestId, 'models/image-catalog/search', formatError(error));
      }
    }
    default:
      return null;
  }
}

