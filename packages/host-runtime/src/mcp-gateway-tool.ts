import {
  formatMcpCallResult,
  formatMcpExposedName,
  listEnabledServers,
  parseMcpToolSelector,
  createMcpGenerationSnapshot,
  type McpLifecycleManager,
  type McpMetadataCatalog,
  type McpGenerationSnapshot,
} from '@piwin/mcp';
import type { HostToolRegistration, McpConfigDocument, ToolResult } from '@piwin/contracts';

export type BuildMcpGatewayToolOptions = {
  lifecycleManager: McpLifecycleManager;
  /** Frozen MCP config captured when the runtime generation was composed. */
  mcpConfig?: McpConfigDocument;
  /** Explicit immutable generation snapshot used for transport calls. */
  mcpSnapshot?: McpGenerationSnapshot;
  metadataCatalog?: McpMetadataCatalog;
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

/**
 * Stable MCP gateway custom tool for search/describe/call/status.
 * search/describe/status do not start servers; call lazy-connects one server.
 */
export function buildMcpGatewayToolDefinition(
  options: BuildMcpGatewayToolOptions,
): HostToolRegistration {
  const catalog = options.metadataCatalog ?? options.lifecycleManager.getMetadataCatalog();
  // The generation owns the MCP snapshot. Missing configuration is treated as
  // an empty snapshot; tool execution must not reopen mutable config storage.
  const snapshot =
    options.mcpSnapshot ??
    createMcpGenerationSnapshot(options.mcpConfig ?? { mcpServers: {} }, 'direct');
  const config = snapshot.config;

  return {
    descriptor: {
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
    },
    family: 'mcp',
    permissionSpec: {
      action: 'mcp:tool-call',
      risk: 'mcp',
      rememberable: false,
      subjectBuilder: (args) => {
        const selector = String(args.selector ?? '').trim();
        return selector ? { kind: 'mcp', selector } : undefined;
      },
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
        return {
          ok: true,
          output: JSON.stringify(
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
        const discovered = await options.lifecycleManager.discoverTools(
          parsed.serverId,
          signal,
          snapshot,
        );
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
        const health = await options.lifecycleManager.listHealth(snapshot);
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
            snapshot,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
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
