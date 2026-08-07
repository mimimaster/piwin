import {
  formatMcpCallResult,
  formatMcpExposedName,
  listEnabledServers,
  parseMcpToolSelector,
  type McpLifecycleManager,
  type McpMetadataCatalog,
  type McpGenerationSnapshot,
} from '@piwin/mcp';
import type {
  HostToolRegistration,
  McpConfigDocument,
  McpToolMetadata,
  ToolResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

export type BuildMcpGatewayToolOptions = {
  lifecycleManager: McpLifecycleManager;
  /** Frozen MCP config captured when the runtime generation was composed. */
  mcpConfig?: McpConfigDocument;
  /** Explicit immutable generation snapshot used for transport calls. */
  mcpSnapshot?: McpGenerationSnapshot;
  metadataCatalog?: McpMetadataCatalog;
  description?: string;
};

function invalidMcpInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

function mcpFailure(message: string, selector?: string): ToolResult {
  return {
    ok: false,
    code: 'mcp-failed',
    message,
    ...(selector ? { details: { selector } } : {}),
    retryable: true,
  };
}

const DEFAULT_MCP_SEARCH_LIMIT = 20;
const MAX_MCP_SEARCH_LIMIT = 50;
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

function cancelledMcpSearch(): ToolResult {
  return {
    ok: false,
    code: 'aborted',
    message: 'MCP search aborted',
    cancelled: true,
  };
}

/**
 * Stable MCP gateway custom tool for search/describe/call/status.
 * search checks cache first and may perform bounded lazy discovery; describe may
 * discover a known selector; status does not start servers; call lazy-connects
 * one server.
 */
export function buildMcpGatewayToolDefinition(
  options: BuildMcpGatewayToolOptions,
): HostToolRegistration {
  const catalog = options.metadataCatalog ?? options.lifecycleManager.getMetadataCatalog();
  return {
    descriptor: {
      name: 'mcp_gateway',
      description:
        options.description ??
        'Discover and call MCP tools through a single gateway. ' +
          "Use action='search' to check cached metadata first and perform bounded lazy discovery on a cache miss (discover=false keeps it cache-only), " +
          "action='describe' for a tool schema (selector like server.tool), " +
          "action='call' to invoke a tool (lazy-connects only that server), " +
          "action='status' for configured server health without starting servers.",
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['search', 'describe', 'call', 'status'],
          },
          query: { type: 'string' },
          serverId: { type: 'string' },
          selector: { type: 'string' },
          arguments: { type: 'object', additionalProperties: true },
          limit: { type: 'number' },
          discover: {
            type: 'boolean',
            default: true,
            description: 'On search cache miss, perform bounded lazy discovery.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    family: 'mcp',
    permissionSpec: {
      action: 'mcp:trusted',
      risk: 'mcp',
      rememberable: false,
      admission: 'trusted',
    },
    async execute(args, signal) {
      // The gateway is intentionally live: config changes are applied by the
      // Supervisor and do not require rebuilding every session's tool shell.
      await options.lifecycleManager.refreshConfig();
      const config = options.lifecycleManager.getConfig();
      const action = String(args.action ?? '').trim();
      if (action === 'search') {
        const query = String(args.query ?? '');
        const serverId = typeof args.serverId === 'string' ? args.serverId : undefined;
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.min(MAX_MCP_SEARCH_LIMIT, Math.max(1, Math.floor(args.limit)))
            : DEFAULT_MCP_SEARCH_LIMIT;
        const shouldDiscover = args.discover !== false;
        const enabledServers = listEnabledServers(config).sort((left, right) =>
          left.id.localeCompare(right.id),
        );
        let cachedSearch = await searchValidMcpCache(
          catalog,
          enabledServers,
          query,
          serverId,
          limit,
        );
        const discoveryAttempts: DiscoveryAttempt[] = [];

        if (shouldDiscover && cachedSearch.hits.length < limit) {
          const candidateServerIds = enabledServers
            .filter(
              ({ id }) => !cachedSearch.validServerIds.has(id) && (!serverId || serverId === id),
            )
            .map(({ id }) => id)
            .slice(0, serverId ? 1 : MAX_LAZY_DISCOVERY_SERVERS);

          for (
            let offset = 0;
            offset < candidateServerIds.length;
            offset += MAX_LAZY_DISCOVERY_CONCURRENCY
          ) {
            const batch = candidateServerIds.slice(offset, offset + MAX_LAZY_DISCOVERY_CONCURRENCY);
            const batchAttempts = await discoverMcpServers(options.lifecycleManager, batch, signal);
            discoveryAttempts.push(...batchAttempts);
            if (batchAttempts.some((attempt) => attempt.status === 'aborted')) {
              return cancelledMcpSearch();
            }

            cachedSearch = await searchValidMcpCache(
              catalog,
              enabledServers,
              query,
              serverId,
              limit,
            );
            if (cachedSearch.hits.length >= limit) {
              break;
            }
          }
        }

        if (signal.aborted) {
          return cancelledMcpSearch();
        }
        const { remainingUncachedServers, uncachedOrEmptyServers } =
          await findUncachedOrEmptyServers(catalog, enabledServers, cachedSearch.validServerIds);
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

        return {
          ok: true,
          output: JSON.stringify(
            {
              tools: cachedSearch.hits.map((hit) => ({
                selector: hit.selector,
                serverId: hit.serverId,
                toolName: hit.toolName,
                description: hit.description,
              })),
              discoveredServers,
              discoveryFailures,
              remainingUncachedServers,
              uncachedOrEmptyServers,
              note: notes.length > 0 ? notes.join(' ') : undefined,
            },
            null,
            2,
          ),
        };
      }

      if (action === 'describe') {
        const selector = String(args.selector ?? '').trim();
        if (!selector) {
          return invalidMcpInput('mcp_gateway describe requires selector');
        }
        const parsed = parseMcpToolSelector(selector);
        if (!parsed) {
          return invalidMcpInput(`Invalid MCP selector: ${selector}`);
        }
        const serverConfig = config.mcpServers[parsed.serverId];
        const hasValidCache =
          serverConfig !== undefined &&
          serverConfig.disabled !== true &&
          (await catalog.isServerCacheValid(parsed.serverId, serverConfig));
        const cached = hasValidCache ? await catalog.describeCached(selector) : null;
        if (cached) {
          return {
            ok: true,
            output: JSON.stringify(
              {
                selector: cached.selector,
                description: cached.description,
                inputSchema: cached.inputSchema,
                source: 'cache',
              },
              null,
              2,
            ),
          };
        }
        const discovered = await options.lifecycleManager.discoverTools(parsed.serverId, signal);
        const match = discovered.find((tool) => tool.name === parsed.toolName);
        if (!match) {
          return invalidMcpInput(`Unknown MCP tool: ${selector}`);
        }
        return {
          ok: true,
          output: JSON.stringify(
            {
              selector,
              description: match.description,
              inputSchema: match.inputSchema ?? { type: 'object', additionalProperties: true },
              source: 'live-discover',
            },
            null,
            2,
          ),
        };
      }

      if (action === 'status') {
        const health = await options.lifecycleManager.listHealth();
        const serverId = typeof args.serverId === 'string' ? args.serverId : undefined;
        const rows = serverId ? health.filter((item) => item.serverId === serverId) : health;
        return { ok: true, output: JSON.stringify({ servers: rows }, null, 2) };
      }

      if (action === 'call') {
        const selector = String(args.selector ?? '').trim();
        if (!selector) {
          return invalidMcpInput('mcp_gateway call requires selector');
        }
        const parsed = parseMcpToolSelector(selector);
        if (!parsed) {
          return invalidMcpInput(`Invalid MCP selector: ${selector}`);
        }
        const toolArguments =
          args.arguments && typeof args.arguments === 'object'
            ? (args.arguments as Record<string, unknown>)
            : {};

        if (signal.aborted) {
          return {
            ok: false,
            code: 'aborted',
            message: `MCP tool aborted: ${selector}`,
            details: { selector },
            cancelled: true,
          };
        }

        let result: Awaited<ReturnType<McpLifecycleManager['callTool']>>;
        try {
          result = await options.lifecycleManager.callTool(
            parsed.serverId,
            parsed.toolName,
            toolArguments,
            signal,
          );
        } catch (error) {
          const message = formatError(error);
          return mcpFailure(message, selector);
        }
        return { ok: true, output: formatMcpCallResult(result), details: { selector } };
      }

      return invalidMcpInput(
        `Unknown mcp_gateway action: ${action || '(empty)'}. Use search|describe|call|status.`,
      );
    },
  };
}

export function formatGatewayExposedName(serverId: string, toolName: string): string {
  return formatMcpExposedName(serverId, toolName);
}
