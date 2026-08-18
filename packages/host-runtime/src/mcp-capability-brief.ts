/**
 * Generation-time MCP capability brief for the model.
 *
 * Goal: the model must know MCP exists and how to use it without registering
 * every remote tool as a first-class custom tool.
 *
 * Sources are frozen config + cached metadata only (no transport I/O).
 */

import type { McpConfigDocument, McpToolMetadata } from '@piwin/contracts';
import { formatMcpExposedName, listEnabledServers } from '@piwin/mcp';

/** Hard caps so system prompt / tool description stay bounded. */
export const MCP_BRIEF_MAX_SERVERS = 24;
export const MCP_BRIEF_MAX_TOOLS_PER_SERVER = 8;
export const MCP_BRIEF_MAX_TOOL_NAME_CHARS = 40;
export const MCP_BRIEF_MAX_SELECTOR_CHARS = 160;
export const MCP_BRIEF_MAX_DESCRIPTION_CHARS = 1_200;
export const MCP_BRIEF_MAX_SYSTEM_CHARS = 1_600;

export type McpServerBriefEntry = {
  serverId: string;
  cached: boolean;
  toolCount: number;
  /** Sample tool names from valid cache (not full catalog). */
  sampleToolNames: string[];
  /** Exact selector samples from valid cache (not full catalog). */
  sampleToolSelectors: string[];
};

export type McpCapabilityBrief = {
  enabledServerCount: number;
  /** Valid cached tools across all enabled servers, including omitted entries. */
  cachedToolCount: number;
  uncachedServerIds: string[];
  omittedServerCount: number;
  servers: McpServerBriefEntry[];
  pinnedSelectors: string[];
  /** First-class direct tool names already on the session surface. */
  directExposedNames: string[];
};

export type BuildMcpCapabilityBriefInput = {
  config: McpConfigDocument;
  /** Valid-cache tools only; caller must filter fingerprint/stale. */
  cachedToolsByServer: Record<string, readonly McpToolMetadata[]>;
  /** Direct tools already registered for this generation (optional). */
  directExposedNames?: readonly string[];
};

export function buildMcpCapabilityBrief(input: BuildMcpCapabilityBriefInput): McpCapabilityBrief {
  const enabled = listEnabledServers(input.config);
  const pinnedSelectors = [...(input.config.pinnedSelectors ?? [])];
  const servers: McpServerBriefEntry[] = [];
  const uncachedServerIds: string[] = [];
  let cachedToolCount = 0;

  for (const { id: serverId } of enabled) {
    const tools = input.cachedToolsByServer[serverId] ?? [];
    const toolCount = tools.length;
    const cached = toolCount > 0;
    if (cached) {
      cachedToolCount += toolCount;
    }
    if (servers.length >= MCP_BRIEF_MAX_SERVERS) {
      continue;
    }
    if (!cached) {
      uncachedServerIds.push(serverId);
    }
    const sampleTools = tools.slice(0, MCP_BRIEF_MAX_TOOLS_PER_SERVER);
    servers.push({
      serverId,
      cached,
      toolCount,
      sampleToolNames: sampleTools.map((tool) =>
        truncate(tool.toolName, MCP_BRIEF_MAX_TOOL_NAME_CHARS),
      ),
      sampleToolSelectors: sampleTools.map((tool) => tool.selector),
    });
  }

  // Keep display overflow separate from servers whose metadata is not cached.
  const omittedServerCount = Math.max(0, enabled.length - MCP_BRIEF_MAX_SERVERS);

  const directExposedNames = [
    ...(input.directExposedNames ??
      pinnedSelectors.map((selector) => {
        const separatorIndex = selector.indexOf('.');
        if (separatorIndex <= 0) {
          return selector;
        }
        const serverId = selector.slice(0, separatorIndex);
        const toolName = selector.slice(separatorIndex + 1);
        return formatMcpExposedName(serverId, toolName);
      })),
  ];

  return {
    enabledServerCount: enabled.length,
    cachedToolCount,
    uncachedServerIds,
    omittedServerCount,
    servers,
    pinnedSelectors,
    directExposedNames,
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 1)}…`;
}
