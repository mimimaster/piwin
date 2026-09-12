/**
 * Host IPC: search npm `pi-package` and GitHub `topic:pi-package`.
 */
import type { HostCommand, HostResponse, MarketplaceSearchResult } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { searchMarketplaceSources } from '@piwin/marketplace';
import { ok } from '../response-helpers.js';

const TYPES = new Set<HostCommand['type']>(['marketplace/search']);

export type MarketplaceSearchCommandDeps = {
  fetch?: typeof fetch;
};

export async function handleMarketplaceSearchCommand(
  command: HostCommand,
  requestId: string | undefined,
  deps: MarketplaceSearchCommandDeps = {},
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  if (command.type !== 'marketplace/search') {
    return null;
  }
  const query = command.query.trim();
  if (!query) {
    const empty: MarketplaceSearchResult = { query: '', hits: [] };
    return ok(requestId, 'marketplace/search', empty);
  }
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const result = await searchMarketplaceSources({
      query,
      ...(command.limit !== undefined ? { limit: command.limit } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(githubToken ? { githubToken } : {}),
    });
    return ok(requestId, 'marketplace/search', result);
  } catch (error) {
    const result: MarketplaceSearchResult = {
      query,
      hits: [],
      remoteError: formatError(error),
    };
    return ok(requestId, 'marketplace/search', result);
  }
}
