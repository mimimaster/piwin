import { createMcpLifecycleManager, type McpLifecycleManager } from '@piwin/mcp';
import type { HostToolDefinition } from '@piwin/tools-web';
import type { PermissionRuleSet } from '@piwin/contracts';
import { buildCachedMcpToolDefinitions } from './mcp-cached-tool-definitions.js';
import { buildMcpGatewayToolDefinition } from './mcp-gateway-tool.js';
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
  /**
   * Merged permission ruleset (bundled + user/project layers). When omitted,
   * MCP tool calls are allowed without prompting (ADR 0019 §5).
   */
  rules?: PermissionRuleSet;
  /**
   * Host-owned lifecycle manager. When omitted, a temporary manager is created
   * for this bridge (disposed on close). Prefer injecting HostRuntime's manager.
   */
  lifecycleManager?: McpLifecycleManager;
};

/**
 * Build MCP tools for one agent session from **cached metadata + mcp_gateway**.
 *
 * Invariant: this function performs **no MCP transport I/O**. Connecting and
 * tools/list only happen later inside gateway describe/call or direct tool execute.
 */
export async function createMcpSessionBridge(
  options: CreateMcpSessionBridgeOptions,
): Promise<McpSessionBridge & { warnings: string[] }> {
  const ownedManager = options.lifecycleManager
    ? null
    : createMcpLifecycleManager(options.piwinRoot);
  const manager = options.lifecycleManager ?? ownedManager;
  if (!manager) {
    throw new Error('MCP lifecycle manager is required');
  }

  const cached = await buildCachedMcpToolDefinitions({
    piwinRoot: options.piwinRoot,
    lifecycleManager: manager,
    ...(options.rules ? { rules: options.rules } : {}),
    ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
  });

  const gateway = buildMcpGatewayToolDefinition({
    piwinRoot: options.piwinRoot,
    lifecycleManager: manager,
    ...(options.rules ? { rules: options.rules } : {}),
    ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
  });

  const tools = [...cached.tools, gateway];
  const directServerIds = new Set(
    cached.tools
      .map((tool) => tool.name.split('__')[1])
      .filter((segment): segment is string => Boolean(segment)),
  );

  return {
    tools,
    serverCount: directServerIds.size,
    toolCount: tools.length,
    warnings: cached.warnings,
    async close() {
      if (ownedManager) {
        await ownedManager.dispose();
      }
    },
  };
}
