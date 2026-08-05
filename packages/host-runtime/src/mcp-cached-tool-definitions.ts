import type {
  HostToolRegistration,
  McpConfigDocument,
  McpToolMetadata,
  ToolResult,
} from '@piwin/contracts';
import { createDefaultMcpExposurePolicy } from '@piwin/contracts';
import {
  formatMcpCallResult,
  formatMcpExposedName,
  listEnabledServers,
  createMcpGenerationSnapshot,
  type McpLifecycleManager,
  type McpGenerationSnapshot,
  type McpMetadataCatalog,
} from '@piwin/mcp';
import { selectDirectMcpTools } from './mcp-exposure-policy.js';

export type BuildCachedMcpToolsOptions = {
  lifecycleManager: McpLifecycleManager;
  /** Frozen MCP config captured when the runtime generation was composed. */
  mcpConfig?: McpConfigDocument;
  /** Explicit immutable generation snapshot used for transport calls. */
  mcpSnapshot?: McpGenerationSnapshot;
  metadataCatalog?: McpMetadataCatalog;
};

function mcpFailure(message: string, selector: string, signal: AbortSignal): ToolResult {
  if (signal.aborted) {
    return {
      ok: false,
      code: 'aborted',
      message,
      details: { selector },
      cancelled: true,
    };
  }
  return {
    ok: false,
    code: 'mcp-failed',
    message,
    details: { selector },
    retryable: true,
  };
}

/**
 * Build direct MCP host tools from **cached metadata only**.
 * Never performs MCP transport I/O.
 */
export async function buildCachedMcpToolDefinitions(options: BuildCachedMcpToolsOptions): Promise<{
  tools: HostToolRegistration[];
  directCount: number;
  cachedToolCount: number;
  warnings: string[];
}> {
  const catalog = options.metadataCatalog ?? options.lifecycleManager.getMetadataCatalog();
  // The generation owns the MCP snapshot. Missing configuration is an empty
  // snapshot; execution must never reopen the mutable config store.
  const snapshot =
    options.mcpSnapshot ??
    createMcpGenerationSnapshot(options.mcpConfig ?? { mcpServers: {} }, 'direct');
  const document = snapshot.config;
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

  const hostTools = direct.map((metadata) => buildDirectHostTool(metadata, options, snapshot));

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
  snapshot: McpGenerationSnapshot,
): HostToolRegistration {
  const exposedName = formatMcpExposedName(metadata.serverId, metadata.toolName);
  return {
    descriptor: {
      name: exposedName,
      description:
        metadata.description.trim() ||
        `MCP tool ${metadata.toolName} from server ${metadata.serverId}`,
      parameters: metadata.inputSchema,
    },
    family: 'mcp',
    permissionSpec: {
      action: 'mcp:tool-call',
      risk: 'mcp',
      rememberable: false,
      subjectBuilder: () => ({
        kind: 'mcp',
        selector: `${metadata.serverId}.${metadata.toolName}`,
      }),
    },
    async execute(args, signal) {
      const selector = `${metadata.serverId}.${metadata.toolName}`;
      if (signal.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: `MCP tool aborted: ${exposedName}`,
          details: { selector },
          cancelled: true,
        };
      }
      // Resolve live client at call time — never close over a create-time client.
      let result: Awaited<ReturnType<McpLifecycleManager['callTool']>>;
      try {
        result = await options.lifecycleManager.callTool(
          metadata.serverId,
          metadata.toolName,
          args,
          signal,
          snapshot,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return mcpFailure(message, selector, signal);
      }
      return {
        ok: true,
        output: formatMcpCallResult(result),
        details: { selector },
      };
    },
  };
}
