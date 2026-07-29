import {
  formatMcpExposedName,
  listEnabledServers,
  loadMcpConfig,
  parseMcpToolSelector,
  type McpLifecycleManager,
  type McpMetadataCatalog,
} from '@piwin/mcp';
import type { HostToolDefinition } from '@piwin/tools-web';
import type { PermissionRuleSet } from '@piwin/contracts';
import { assertMcpToolCallAllowed } from './mcp-call-permission.js';
import type { ToolPermissionGate } from './session-tools.js';

export type BuildMcpGatewayToolOptions = {
  piwinRoot: string;
  lifecycleManager: McpLifecycleManager;
  metadataCatalog?: McpMetadataCatalog;
  rules?: PermissionRuleSet;
  requestPermission?: ToolPermissionGate;
};

/**
 * Stable MCP gateway custom tool for search/describe/call/status.
 * search/describe/status do not start servers; call lazy-connects one server.
 */
export function buildMcpGatewayToolDefinition(
  options: BuildMcpGatewayToolOptions,
): HostToolDefinition {
  const catalog = options.metadataCatalog ?? options.lifecycleManager.getMetadataCatalog();

  return {
    name: 'mcp_gateway',
    description:
      'Discover and call MCP tools through a single gateway. ' +
      "Use action='search' to find tools from cached metadata, " +
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
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, signal) {
      const action = String(args.action ?? '').trim();
      if (action === 'search') {
        const query = String(args.query ?? '');
        const serverId = typeof args.serverId === 'string' ? args.serverId : undefined;
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.floor(args.limit))
            : 20;
        const config = await loadMcpConfig(options.piwinRoot);
        const enabledServers = listEnabledServers(config);
        const validServerIds = new Set(
          (
            await Promise.all(
              enabledServers.map(async ({ id: serverId, config: serverConfig }) =>
                (await catalog.isServerCacheValid(serverId, serverConfig)) ? serverId : null,
              ),
            )
          ).filter((serverId): serverId is string => serverId !== null),
        );
        const searchableServerIds = serverId
          ? validServerIds.has(serverId)
            ? [serverId]
            : []
          : [...validServerIds];
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
        const uncachedServers = enabledServers
          .map((server) => server.id)
          .filter((id) => !validServerIds.has(id));
        return JSON.stringify(
          {
            tools: hits.map((hit) => ({
              selector: hit.selector,
              serverId: hit.serverId,
              toolName: hit.toolName,
              description: hit.description,
            })),
            uncachedOrEmptyServers: uncachedServers,
            note: uncachedServers.length
              ? 'Some servers have no cached metadata. Use describe on a known selector or Discover in Settings.'
              : undefined,
          },
          null,
          2,
        );
      }

      if (action === 'describe') {
        const selector = String(args.selector ?? '').trim();
        if (!selector) {
          throw new Error('mcp_gateway describe requires selector');
        }
        const parsed = parseMcpToolSelector(selector);
        if (!parsed) {
          throw new Error(`Invalid MCP selector: ${selector}`);
        }
        const config = await loadMcpConfig(options.piwinRoot);
        const serverConfig = config.mcpServers[parsed.serverId];
        const hasValidCache =
          serverConfig !== undefined &&
          serverConfig.disabled !== true &&
          (await catalog.isServerCacheValid(parsed.serverId, serverConfig));
        const cached = hasValidCache ? await catalog.describeCached(selector) : null;
        if (cached) {
          return JSON.stringify(
            {
              selector: cached.selector,
              description: cached.description,
              inputSchema: cached.inputSchema,
              source: 'cache',
            },
            null,
            2,
          );
        }
        const discovered = await options.lifecycleManager.discoverTools(parsed.serverId, signal);
        const match = discovered.find((tool) => tool.name === parsed.toolName);
        if (!match) {
          throw new Error(`Unknown MCP tool: ${selector}`);
        }
        return JSON.stringify(
          {
            selector,
            description: match.description,
            inputSchema: match.inputSchema ?? { type: 'object', additionalProperties: true },
            source: 'live-discover',
          },
          null,
          2,
        );
      }

      if (action === 'status') {
        const health = await options.lifecycleManager.listHealth();
        const serverId = typeof args.serverId === 'string' ? args.serverId : undefined;
        const rows = serverId ? health.filter((item) => item.serverId === serverId) : health;
        return JSON.stringify({ servers: rows }, null, 2);
      }

      if (action === 'call') {
        const selector = String(args.selector ?? '').trim();
        if (!selector) {
          throw new Error('mcp_gateway call requires selector');
        }
        const parsed = parseMcpToolSelector(selector);
        if (!parsed) {
          throw new Error(`Invalid MCP selector: ${selector}`);
        }
        const toolArguments =
          args.arguments && typeof args.arguments === 'object'
            ? (args.arguments as Record<string, unknown>)
            : {};

        await assertMcpToolCallAllowed({
          serverId: parsed.serverId,
          toolName: parsed.toolName,
          arguments: toolArguments,
          ...(options.rules ? { rules: options.rules } : {}),
          ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
          ...(signal ? { signal } : {}),
        });

        if (signal?.aborted) {
          throw new Error(`MCP tool aborted: ${selector}`);
        }

        const result = await options.lifecycleManager.callTool(
          parsed.serverId,
          parsed.toolName,
          toolArguments,
          signal,
        );
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      }

      throw new Error(
        `Unknown mcp_gateway action: ${action || '(empty)'}. Use search|describe|call|status.`,
      );
    },
  };
}

export function formatGatewayExposedName(serverId: string, toolName: string): string {
  return formatMcpExposedName(serverId, toolName);
}
