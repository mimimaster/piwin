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

/**
 * Always-on system prompt section. Injected via blueprint appendSystemPrompt
 * so the model sees MCP capability even before deciding which tools to call.
 */
export function formatMcpCapabilitySystemPrompt(brief: McpCapabilityBrief): string {
  if (brief.enabledServerCount === 0) {
    return [
      '## MCP tools',
      'No MCP servers are enabled in this session generation.',
      'If the user configures MCP later, a new generation rebuilds this surface.',
    ].join('\n');
  }

  const lines: string[] = [
    '## MCP tools (use them proactively)',
    'Use a pinned direct tool when it matches; otherwise use `mcp_gateway` proactively.',
    'Gateway flow: `search(query)` → `describe(server.tool)` → `call(server.tool, arguments)`. Never invent selectors. Search may lazily discover uncached servers.',
    'Configured servers:',
  ];

  if (brief.omittedServerCount > 0) {
    lines.push(
      `Configured server list truncated: ${brief.omittedServerCount} more configured server(s) omitted from this bounded list.`,
    );
  }

  for (const server of brief.servers) {
    if (server.cached) {
      const samples =
        server.sampleToolNames.length > 0 ? ` e.g. ${server.sampleToolNames.join(', ')}` : '';
      const more =
        server.toolCount > server.sampleToolNames.length
          ? ` (+${server.toolCount - server.sampleToolNames.length} more)`
          : '';
      lines.push(`- \`${server.serverId}\`: ${server.toolCount} cached tool(s)${samples}${more}`);
    } else {
      lines.push(
        `- \`${server.serverId}\`: metadata not cached yet — a normal search will try bounded lazy discovery; describe/call with a known selector also remain available`,
      );
    }
  }

  if (brief.directExposedNames.length > 0) {
    lines.push(`Pinned direct: ${brief.directExposedNames.slice(0, 16).join(', ')}`);
    if (brief.directExposedNames.length > 16) {
      lines.push(`- …(+${brief.directExposedNames.length - 16} more)`);
    }
  }

  return truncate(lines.join('\n'), MCP_BRIEF_MAX_SYSTEM_CHARS);
}

/**
 * Rich tool descriptor text for `mcp_gateway`. Models always see this with the
 * tool schema; keep workflow + live inventory compact.
 */
export function formatMcpGatewayToolDescription(brief: McpCapabilityBrief): string {
  const serverSummary =
    brief.enabledServerCount === 0
      ? 'No enabled MCP servers in this generation'
      : brief.servers
          .map((server) =>
            server.cached
              ? `${server.serverId}(${server.toolCount})`
              : `${server.serverId}(uncached)`,
          )
          .join(', ');

  const sampleSelectors = brief.servers
    .filter((server) => server.cached)
    .flatMap((server) =>
      server.sampleToolSelectors
        .filter((selector) => selector.length <= Math.min(MCP_BRIEF_MAX_SELECTOR_CHARS, 96))
        .slice(0, 3),
    )
    .slice(0, 3);

  const parts = [
    'Discover and call external MCP tools proactively when a configured server matches the task.',
    'Use search(query), describe(server.tool), call(server.tool, arguments), or status. Search checks cache then bounded lazy discovery unless discover=false. Never invent selectors.',
  ];

  if (sampleSelectors.length > 0) {
    const exampleSelectors: string[] = [];
    const descriptionPrefixLength = parts.join(' ').length;
    for (const selector of sampleSelectors) {
      const nextExample = `Example selectors: ${[...exampleSelectors, selector].join(', ')}.`;
      if (descriptionPrefixLength + 1 + nextExample.length > MCP_BRIEF_MAX_DESCRIPTION_CHARS) {
        continue;
      }
      exampleSelectors.push(selector);
    }
    if (exampleSelectors.length > 0) {
      parts.push(`Example selectors: ${exampleSelectors.join(', ')}.`);
    }
  }
  if (brief.omittedServerCount > 0) {
    parts.push(
      `Configured server list truncated: ${brief.omittedServerCount} more configured server(s) omitted from this bounded summary.`,
    );
  }
  parts.push(
    `Enabled servers (${brief.enabledServerCount}): ${serverSummary || '(none)'}. Cached tools visible to search: ${brief.cachedToolCount}.`,
  );
  if (brief.uncachedServerIds.length > 0) {
    parts.push(
      `Uncached: ${brief.uncachedServerIds.join(', ')}; search can discover them lazily.`,
    );
  }
  if (brief.directExposedNames.length > 0) {
    parts.push(
      `Pinned direct: ${brief.directExposedNames.slice(0, 8).join(', ')}.`,
    );
  }
  return truncate(parts.join(' '), MCP_BRIEF_MAX_DESCRIPTION_CHARS);
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
