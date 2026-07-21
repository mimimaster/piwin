import type { McpToolSummary } from '@piwin/contracts';

const MCP_PREFIX = 'mcp';

/** Exposed agent tool name: mcp__<serverId>__<toolName> */
export function formatMcpExposedName(serverId: string, toolName: string): string {
  const safeServer = sanitizeSegment(serverId);
  const safeTool = sanitizeSegment(toolName);
  return `${MCP_PREFIX}__${safeServer}__${safeTool}`;
}

export function parseMcpExposedName(
  exposedName: string,
): { serverId: string; toolName: string } | null {
  const parts = exposedName.split('__');
  if (parts.length < 3 || parts[0] !== MCP_PREFIX) {
    return null;
  }
  const serverId = parts[1];
  const toolName = parts.slice(2).join('__');
  if (!serverId || !toolName) {
    return null;
  }
  return { serverId, toolName };
}

export function toMcpToolSummary(
  serverId: string,
  name: string,
  description: string,
): McpToolSummary {
  return {
    serverId,
    name,
    exposedName: formatMcpExposedName(serverId, name),
    description,
  };
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
