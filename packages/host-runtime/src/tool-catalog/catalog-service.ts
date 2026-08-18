/**
 * Live MCP catalog operations plus merged Host/MCP search.
 *
 * Host target ranking is pure (catalog-index). MCP search/describe/call/status
 * is the former mcp_gateway executor, moved here so the model-visible shell
 * can be a single piwin_toolbox.
 */

import {
  formatMcpCallResult,
  listEnabledServers,
  parseMcpToolSelector,
  type McpLifecycleManager,
  type McpMetadataCatalog,
  type McpGenerationSnapshot,
} from '@piwin/mcp';
import type {
  HostToolDescriptor,
  HostToolRegistration,
  McpConfigDocument,
  McpToolMetadata,
  ToolResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { compactModelToolDescriptor } from '../model-tool-descriptor.js';
import {
  applyCatalogSearchBudget,
  clampCatalogSearchLimit,
  rankCatalogHits,
  scoreCatalogQuery,
  searchHostCatalog,
  type CatalogSearchHit,
} from './catalog-index.js';

export type ToolCatalogServiceOptions = {
  lifecycleManager: McpLifecycleManager;
  mcpConfig?: McpConfigDocument;
  mcpSnapshot?: McpGenerationSnapshot;
  metadataCatalog?: McpMetadataCatalog;
};

const DEFAULT_MCP_SEARCH_LIMIT = 20;
const MAX_LAZY_DISCOVERY_SERVERS = 8;
const MAX_LAZY_DISCOVERY_CONCURRENCY = 4;

type EnabledMcpServer = ReturnType<typeof listEnabledServers>[number];

type CachedSearch = {
  validServerIds: Set<string>;
  hits: McpToolMetadata[];
};

type DiscoveryAttempt =
  | { serverId: string; status: 'discovered' }
  | { serverId: string; status: 'failed'; message: string }
  | { serverId: string; status: 'aborted' };

export type CatalogSearchRequest = {
  query: string;
  hostTargets: readonly HostToolRegistration[];
  limit?: unknown;
  discover?: boolean;
  serverId?: string;
};

export type CatalogSearchOutput = {
  tools: Array<{
    id: string;
    source: 'host' | 'mcp';
    description: string;
    schema?: HostToolDescriptor;
  }>;
  truncated: boolean;
  discoveredServers: string[];
  discoveryFailures: Array<{ serverId: string; message: string }>;
  remainingUncachedServers: string[];
  uncachedOrEmptyServers: string[];
  note?: string;
};

export type ToolCatalogService = {
  search: (request: CatalogSearchRequest, signal: AbortSignal) => Promise<ToolResult>;
  searchMcp: (
    args: { query: string; limit?: unknown; discover?: boolean; serverId?: string },
    signal: AbortSignal,
  ) => Promise<ToolResult>;
  describeMcp: (selector: string, signal: AbortSignal) => Promise<ToolResult>;
  callMcp: (
    selector: string,
    toolArguments: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ToolResult>;
  status: (serverId?: string) => Promise<ToolResult>;
};

export function createToolCatalogService(options: ToolCatalogServiceOptions): ToolCatalogService {
  const catalog = options.metadataCatalog ?? options.lifecycleManager.getMetadataCatalog();

  async function refreshConfig() {
    await options.lifecycleManager.refreshConfig();
    return options.lifecycleManager.getConfig();
  }

  return {
    async search(request, signal) {
      const hostHits = searchHostCatalog(request.hostTargets, request.query);
      const mcpEnabled = true;
      const mcpResult = mcpEnabled
        ? await searchMcpHits(
            options.lifecycleManager,
            catalog,
            {
              query: request.query,
              ...(request.limit !== undefined ? { limit: request.limit } : {}),
              ...(request.discover !== undefined ? { discover: request.discover } : {}),
              ...(request.serverId ? { serverId: request.serverId } : {}),
            },
            signal,
          )
        : null;
      if (mcpResult && isFailedCatalogResult(mcpResult)) {
        return mcpResult;
      }
      const mcpHits = mcpResult?.hits ?? [];
      const merged = rankCatalogHits([...hostHits, ...mcpHits]);
      const budget = applyCatalogSearchBudget(merged);
      const output: CatalogSearchOutput = {
        tools: budget.tools.map(toPublicHit),
        truncated: budget.truncated,
        discoveredServers: mcpResult?.discoveredServers ?? [],
        discoveryFailures: mcpResult?.discoveryFailures ?? [],
        remainingUncachedServers: mcpResult?.remainingUncachedServers ?? [],
        uncachedOrEmptyServers: mcpResult?.uncachedOrEmptyServers ?? [],
        ...(mcpResult?.note ? { note: mcpResult.note } : {}),
      };
      return { ok: true, output: JSON.stringify(output, null, 2) };
    },

    async searchMcp(args, signal) {
      const mcpResult = await searchMcpHits(options.lifecycleManager, catalog, args, signal);
      if (isFailedCatalogResult(mcpResult)) {
        return mcpResult;
      }
      return {
        ok: true,
        output: JSON.stringify(
          {
            tools: mcpResult.hits.map(toPublicHit),
            discoveredServers: mcpResult.discoveredServers,
            discoveryFailures: mcpResult.discoveryFailures,
            remainingUncachedServers: mcpResult.remainingUncachedServers,
            uncachedOrEmptyServers: mcpResult.uncachedOrEmptyServers,
            ...(mcpResult.note ? { note: mcpResult.note } : {}),
          },
          null,
          2,
        ),
      };
    },

    async describeMcp(selector, signal) {
      const config = await refreshConfig();
      const trimmed = selector.trim();
      if (!trimmed) {
        return invalidCatalogInput('describe requires target');
      }
      const parsed = parseMcpToolSelector(trimmed);
      if (!parsed) {
        return invalidCatalogInput(`Invalid MCP selector: ${trimmed}`);
      }
      const serverConfig = config.mcpServers[parsed.serverId];
      const hasValidCache =
        serverConfig !== undefined &&
        serverConfig.disabled !== true &&
        (await catalog.isServerCacheValid(parsed.serverId, serverConfig));
      const cached = hasValidCache ? await catalog.describeCached(trimmed) : null;
      if (cached) {
        return {
          ok: true,
          output: JSON.stringify(
            compactModelToolDescriptor({
              name: cached.selector,
              description: cached.description,
              parameters: cached.inputSchema,
            }),
            null,
            2,
          ),
        };
      }
      const discovered = await options.lifecycleManager.discoverTools(parsed.serverId, signal);
      const match = discovered.find((tool) => tool.name === parsed.toolName);
      if (!match) {
        return invalidCatalogInput(`Unknown MCP tool: ${trimmed}`);
      }
      return {
        ok: true,
        output: JSON.stringify(
          compactModelToolDescriptor({
            name: trimmed,
            description: match.description,
            parameters: match.inputSchema ?? { type: 'object', additionalProperties: true },
          }),
          null,
          2,
        ),
      };
    },

    async callMcp(selector, toolArguments, signal) {
      await refreshConfig();
      const trimmed = selector.trim();
      if (!trimmed) {
        return invalidCatalogInput('call requires target');
      }
      const parsed = parseMcpToolSelector(trimmed);
      if (!parsed) {
        return invalidCatalogInput(`Invalid MCP selector: ${trimmed}`);
      }
      if (signal.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: `MCP tool aborted: ${trimmed}`,
          details: { selector: trimmed },
          cancelled: true,
        };
      }
      try {
        const result = await options.lifecycleManager.callTool(
          parsed.serverId,
          parsed.toolName,
          toolArguments,
          signal,
        );
        return { ok: true, output: formatMcpCallResult(result), details: { selector: trimmed } };
      } catch (error) {
        return {
          ok: false,
          code: 'mcp-failed',
          message: formatError(error),
          details: { selector: trimmed },
          retryable: true,
        };
      }
    },

    async status(serverId) {
      await refreshConfig();
      const health = await options.lifecycleManager.listHealth();
      const rows = serverId ? health.filter((item) => item.serverId === serverId) : health;
      return { ok: true, output: JSON.stringify({ servers: rows }, null, 2) };
    },
  };
}

function invalidCatalogInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

function cancelledMcpSearch(): Extract<ToolResult, { ok: false }> {
  return {
    ok: false,
    code: 'aborted',
    message: 'MCP search aborted',
    cancelled: true,
  };
}

type McpSearchHits = {
  hits: CatalogSearchHit[];
  discoveredServers: string[];
  discoveryFailures: Array<{ serverId: string; message: string }>;
  remainingUncachedServers: string[];
  uncachedOrEmptyServers: string[];
  note?: string;
};

function isFailedCatalogResult(result: McpSearchHits | ToolResult): result is Extract<ToolResult, { ok: false }> {
  return 'ok' in result && result.ok === false;
}

async function searchMcpHits(
  lifecycleManager: McpLifecycleManager,
  catalog: McpMetadataCatalog,
  args: { query: string; limit?: unknown; discover?: boolean; serverId?: string },
  signal: AbortSignal,
): Promise<McpSearchHits | Extract<ToolResult, { ok: false }>> {
  await lifecycleManager.refreshConfig();
  const config = lifecycleManager.getConfig();
  const query = String(args.query ?? '');
  const serverId = typeof args.serverId === 'string' ? args.serverId : undefined;
  const limit = clampCatalogSearchLimit(args.limit ?? DEFAULT_MCP_SEARCH_LIMIT);
  const shouldDiscover = args.discover !== false;
  const enabledServers = listEnabledServers(config).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  let cachedSearch = await searchValidMcpCache(catalog, enabledServers, query, serverId, limit);
  const discoveryAttempts: DiscoveryAttempt[] = [];

  if (shouldDiscover && cachedSearch.hits.length < limit) {
    const candidateServerIds = enabledServers
      .filter(({ id }) => !cachedSearch.validServerIds.has(id) && (!serverId || serverId === id))
      .map(({ id }) => id)
      .slice(0, serverId ? 1 : MAX_LAZY_DISCOVERY_SERVERS);

    for (let offset = 0; offset < candidateServerIds.length; offset += MAX_LAZY_DISCOVERY_CONCURRENCY) {
      const batch = candidateServerIds.slice(offset, offset + MAX_LAZY_DISCOVERY_CONCURRENCY);
      const batchAttempts = await discoverMcpServers(lifecycleManager, batch, signal);
      discoveryAttempts.push(...batchAttempts);
      if (batchAttempts.some((attempt) => attempt.status === 'aborted')) {
        return cancelledMcpSearch();
      }
      cachedSearch = await searchValidMcpCache(catalog, enabledServers, query, serverId, limit);
      if (cachedSearch.hits.length >= limit) {
        break;
      }
    }
  }

  if (signal.aborted) {
    return cancelledMcpSearch();
  }
  const { remainingUncachedServers, uncachedOrEmptyServers } = await findUncachedOrEmptyServers(
    catalog,
    enabledServers,
    cachedSearch.validServerIds,
  );
  if (signal.aborted) {
    return cancelledMcpSearch();
  }

  const discoveredServers = discoveryAttempts
    .filter((attempt) => attempt.status === 'discovered')
    .map((attempt) => attempt.serverId)
    .sort((left, right) => left.localeCompare(right));
  const discoveryFailures = discoveryAttempts
    .filter(
      (attempt): attempt is Extract<DiscoveryAttempt, { status: 'failed' }> =>
        attempt.status === 'failed',
    )
    .map(({ serverId: failedServerId, message }) => ({
      serverId: failedServerId,
      message,
    }))
    .sort((left, right) => left.serverId.localeCompare(right.serverId));
  const notes: string[] = [];
  if (!shouldDiscover) {
    notes.push('Lazy discovery was disabled; this search used cached metadata only.');
  } else if (discoveryAttempts.length > 0) {
    notes.push(
      `Cache-miss discovery was bounded to ${MAX_LAZY_DISCOVERY_SERVERS} server(s) per search and ${MAX_LAZY_DISCOVERY_CONCURRENCY} concurrent connection(s).`,
    );
  }
  if (discoveryFailures.length > 0) {
    notes.push(
      'Failed discoveries were omitted from tool hits; the Supervisor remains authoritative for retry and cooldown behavior.',
    );
  }
  if (uncachedOrEmptyServers.length > 0) {
    notes.push(
      'Some enabled servers remain uncached or have empty metadata; search returned only confirmed cached tool metadata.',
    );
  }

  const hits = cachedSearch.hits.map((hit) => mcpMetadataToHit(hit, query));
  return {
    hits,
    discoveredServers,
    discoveryFailures,
    remainingUncachedServers,
    uncachedOrEmptyServers,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}

function mcpMetadataToHit(hit: McpToolMetadata, query: string): CatalogSearchHit {
  const descriptor = compactModelToolDescriptor({
    name: hit.selector,
    description: hit.description,
    parameters: hit.inputSchema,
  });
  const haystack = `${hit.selector} ${hit.description} ${hit.toolName}`;
  const scored = scoreCatalogQuery(hit.selector, haystack, query);
  return {
    id: hit.selector,
    source: 'mcp',
    description: hit.description,
    schema: descriptor,
    exact: scored.exact,
    prefix: scored.prefix,
    keywordHits: scored.keywordHits,
  };
}

function toPublicHit(hit: CatalogSearchHit): CatalogSearchOutput['tools'][number] {
  return {
    id: hit.id,
    source: hit.source,
    description: hit.description,
    ...(hit.schema ? { schema: hit.schema } : {}),
  };
}

async function searchValidMcpCache(
  catalog: McpMetadataCatalog,
  enabledServers: readonly EnabledMcpServer[],
  query: string,
  serverId: string | undefined,
  limit: number,
): Promise<CachedSearch> {
  const validity = await Promise.all(
    enabledServers.map(async ({ id, config }) => ({
      id,
      valid: await catalog.isServerCacheValid(id, config),
    })),
  );
  const validServerIds = new Set(validity.filter((entry) => entry.valid).map((entry) => entry.id));
  const searchableServerIds = enabledServers
    .filter(({ id }) => validServerIds.has(id) && (!serverId || id === serverId))
    .map(({ id }) => id);
  const hits = (
    await Promise.all(
      searchableServerIds.map((cachedServerId) =>
        catalog.searchCached(query, {
          serverId: cachedServerId,
          limit,
        }),
      ),
    )
  )
    .flat()
    .sort((left, right) => left.selector.localeCompare(right.selector))
    .slice(0, limit);

  return { validServerIds, hits };
}

async function findUncachedOrEmptyServers(
  catalog: McpMetadataCatalog,
  enabledServers: readonly EnabledMcpServer[],
  validServerIds: ReadonlySet<string>,
): Promise<{ remainingUncachedServers: string[]; uncachedOrEmptyServers: string[] }> {
  const remainingUncachedServers = enabledServers
    .filter(({ id }) => !validServerIds.has(id))
    .map(({ id }) => id);
  const emptyCachedServers = await Promise.all(
    enabledServers
      .filter(({ id }) => validServerIds.has(id))
      .map(async ({ id }) => ({ id, empty: (await catalog.listCachedForServer(id)).length === 0 })),
  );
  const uncachedOrEmptyServers = [
    ...remainingUncachedServers,
    ...emptyCachedServers.filter((entry) => entry.empty).map((entry) => entry.id),
  ].sort((left, right) => left.localeCompare(right));

  return { remainingUncachedServers, uncachedOrEmptyServers };
}

async function discoverMcpServers(
  lifecycleManager: McpLifecycleManager,
  serverIds: readonly string[],
  signal: AbortSignal,
): Promise<DiscoveryAttempt[]> {
  const attempts: DiscoveryAttempt[] = [];
  for (let offset = 0; offset < serverIds.length; offset += MAX_LAZY_DISCOVERY_CONCURRENCY) {
    if (signal.aborted) {
      return [
        ...attempts,
        ...serverIds.slice(offset).map((serverId) => ({ serverId, status: 'aborted' as const })),
      ];
    }
    const batch = serverIds.slice(offset, offset + MAX_LAZY_DISCOVERY_CONCURRENCY);
    const batchAttempts = await Promise.all(
      batch.map(async (serverId): Promise<DiscoveryAttempt> => {
        try {
          await lifecycleManager.discoverTools(serverId, signal);
          return { serverId, status: 'discovered' };
        } catch (error) {
          if (signal.aborted) {
            return { serverId, status: 'aborted' };
          }
          return {
            serverId,
            status: 'failed',
            message: formatError(error),
          };
        }
      }),
    );
    attempts.push(...batchAttempts);
    if (batchAttempts.some((attempt) => attempt.status === 'aborted')) {
      return [
        ...attempts,
        ...serverIds.slice(offset + batch.length).map((serverId) => ({
          serverId,
          status: 'aborted' as const,
        })),
      ];
    }
  }
  return attempts;
}
