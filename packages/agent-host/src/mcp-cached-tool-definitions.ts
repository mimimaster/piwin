import type { McpToolMetadata, PermissionRuleSet } from '@piwin/contracts';
import { createDefaultMcpExposurePolicy } from '@piwin/contracts';
import {
  formatMcpCallResult,
  formatMcpExposedName,
  listEnabledServers,
  loadMcpConfig,
  type McpLifecycleManager,
  type McpMetadataCatalog,
} from '@piwin/mcp';
import type { HostToolDefinition } from '@piwin/tools-web';
import { selectDirectMcpTools } from './mcp-exposure-policy.js';
import { assertMcpToolCallAllowed } from './mcp-call-permission.js';
import type { ToolPermissionGate } from './session-tools.js';

export type BuildCachedMcpToolsOptions = {
  piwinRoot: string;
  lifecycleManager: McpLifecycleManager;
  metadataCatalog?: McpMetadataCatalog;
  rules?: PermissionRuleSet;
  requestPermission?: ToolPermissionGate;
};

/**
 * Build direct MCP host tools from **cached metadata only**.
 * Never performs MCP transport I/O.
 */
export async function buildCachedMcpToolDefinitions(options: BuildCachedMcpToolsOptions): Promise<{
  tools: HostToolDefinition[];
  directCount: number;
  cachedToolCount: number;
  warnings: string[];
}> {
  const catalog = options.metadataCatalog ?? options.lifecycleManager.getMetadataCatalog();
  const document = await loadMcpConfig(options.piwinRoot);
  const enabled = listEnabledServers(document);
  const warnings: string[] = [];
  const validTools: McpToolMetadata[] = [];

  for (const { id: serverId, config } of enabled) {
    const valid = await catalog.isServerCacheValid(serverId, config);
    if (!valid) {
      warnings.push(
        `mcp server ${serverId} has no valid cached metadata (use Settings Discover or mcp_gateway describe)`,
      );
      continue;
    }
    const tools = await catalog.listCachedForServer(serverId);
    validTools.push(...tools);
  }

  const { direct } = selectDirectMcpTools(validTools, createDefaultMcpExposurePolicy());

  const hostTools = direct.map((metadata) => buildDirectHostTool(metadata, options));

  return {
    tools: hostTools,
    directCount: hostTools.length,
    cachedToolCount: validTools.length,
    warnings,
  };
}

function buildDirectHostTool(
  metadata: McpToolMetadata,
  options: BuildCachedMcpToolsOptions,
): HostToolDefinition {
  const exposedName = formatMcpExposedName(metadata.serverId, metadata.toolName);
  return {
    name: exposedName,
    description:
      metadata.description.trim() ||
      `MCP tool ${metadata.toolName} from server ${metadata.serverId}`,
    parameters: metadata.inputSchema,
    async execute(args, signal) {
      await assertMcpToolCallAllowed({
        serverId: metadata.serverId,
        toolName: metadata.toolName,
        arguments: args,
        ...(options.rules ? { rules: options.rules } : {}),
        ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) {
        throw new Error(`MCP tool aborted: ${exposedName}`);
      }
      // Resolve live client at call time — never close over a create-time client.
      const result = await options.lifecycleManager.callTool(
        metadata.serverId,
        metadata.toolName,
        args,
        signal,
      );
      return formatMcpCallResult(result);
    },
  };
}
