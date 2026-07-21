import type { PermissionDecision } from '@piwin/contracts';
import {
  formatMcpExposedName,
  listEnabledServers,
  loadMcpConfig,
  type McpClientSession,
  type McpLifecycleManager,
  type McpListedTool,
} from '@piwin/mcp';
import { getProjectMcpPolicy } from '@piwin/project';
import type { HostToolDefinition } from '@piwin/tools-web';
import type { ToolPermissionGate } from './session-tools.js';

export type McpSessionBridge = {
  tools: HostToolDefinition[];
  serverCount: number;
  toolCount: number;
  close: () => Promise<void>;
};

export type CreateMcpSessionBridgeOptions = {
  piwinRoot: string;
  sessionId: string;
  requestPermission?: ToolPermissionGate;
  /** Project path for project-scoped MCP connect remember. */
  projectPath?: string;
  /** ~/.piwin/projects.json path. */
  projectsFilePath?: string;
  /**
   * Optional host-owned lifecycle manager. When provided, reuses long-lived
   * clients and does not stop them when the session closes.
   */
  lifecycleManager?: McpLifecycleManager;
};

type McpRoute = {
  serverId: string;
  toolName: string;
  client: McpClientSession;
};

/**
 * Connect enabled MCP servers for one agent session and expose tools as host tools.
 * Failures connecting individual servers are non-fatal (logged via return diagnostics).
 */
export async function createMcpSessionBridge(
  options: CreateMcpSessionBridgeOptions,
): Promise<McpSessionBridge & { warnings: string[] }> {
  const document = await loadMcpConfig(options.piwinRoot);
  const enabled = listEnabledServers(document);
  const ownedClients: McpClientSession[] = [];
  const routes = new Map<string, McpRoute>();
  const tools: HostToolDefinition[] = [];
  const warnings: string[] = [];
  const manager = options.lifecycleManager;

  for (const { id: serverId, config } of enabled) {
    try {
      if (options.requestPermission) {
        const remembered = await isMcpServerRemembered(
          serverId,
          options.projectPath,
          options.projectsFilePath,
        );
        if (!remembered) {
          const decision = await options.requestPermission({
            action: 'mcp:connect',
            detail: `${serverId}: ${config.command}`,
            defaultDecision: 'ask',
          });
          if (decision !== 'allow') {
            warnings.push(`mcp server ${serverId} skipped (permission ${decision})`);
            continue;
          }
        }
      }

      let client: McpClientSession;
      if (manager) {
        client = await manager.ensureStarted(serverId);
      } else {
        const { connectMcpStdio } = await import('@piwin/mcp');
        client = await connectMcpStdio(serverId, config);
        ownedClients.push(client);
      }

      const listed = await client.listTools();
      for (const listedTool of listed) {
        const exposedName = formatMcpExposedName(serverId, listedTool.name);
        if (routes.has(exposedName)) {
          warnings.push(`mcp tool name collision: ${exposedName}`);
          continue;
        }
        routes.set(exposedName, {
          serverId,
          toolName: listedTool.name,
          client,
        });
        tools.push(buildMcpHostTool(exposedName, listedTool, routes, options));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`mcp server ${serverId} failed: ${message}`);
    }
  }

  return {
    tools,
    serverCount: new Set([...routes.values()].map((route) => route.serverId)).size,
    toolCount: tools.length,
    warnings,
    async close() {
      // Only close clients owned by this bridge (no lifecycle manager).
      await Promise.all(
        ownedClients.map(async (client) => {
          try {
            await client.close();
          } catch {
            // ignore shutdown races
          }
        }),
      );
    },
  };
}

async function isMcpServerRemembered(
  serverId: string,
  projectPath: string | undefined,
  projectsFilePath: string | undefined,
): Promise<boolean> {
  if (!projectPath || !projectsFilePath) {
    return false;
  }
  try {
    const policy = await getProjectMcpPolicy(projectsFilePath, projectPath);
    return policy.allowedServerIds.includes(serverId);
  } catch {
    return false;
  }
}

function buildMcpHostTool(
  exposedName: string,
  listedTool: McpListedTool,
  routes: Map<string, McpRoute>,
  options: CreateMcpSessionBridgeOptions,
): HostToolDefinition {
  return {
    name: exposedName,
    description:
      listedTool.description?.trim() ||
      `MCP tool ${listedTool.name} from server ${routes.get(exposedName)?.serverId ?? 'unknown'}`,
    parameters: {
      type: 'object',
      additionalProperties: true,
    },
    async execute(args, signal) {
      const route = routes.get(exposedName);
      if (!route) {
        throw new Error(`Unknown MCP route: ${exposedName}`);
      }
      if (options.requestPermission) {
        const toolRemembered = await isMcpServerRemembered(
          route.serverId,
          options.projectPath,
          options.projectsFilePath,
        );
        if (!toolRemembered) {
          const decision: PermissionDecision = await options.requestPermission({
            action: 'mcp:tool-call',
            detail: `${route.serverId}/${route.toolName}`,
            defaultDecision: 'ask',
          });
          if (decision !== 'allow') {
            throw new Error(`Permission ${decision} for MCP tool ${exposedName}`);
          }
        }
      }
      if (signal?.aborted) {
        throw new Error(`MCP tool aborted: ${exposedName}`);
      }
      const result = await route.client.callTool(route.toolName, args);
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    },
  };
}
