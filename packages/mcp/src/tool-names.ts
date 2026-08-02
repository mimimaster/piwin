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
  inputSchema?: Record<string, unknown>,
): McpToolSummary {
  const summary: McpToolSummary = {
    serverId,
    name,
    exposedName: formatMcpExposedName(serverId, name),
    description,
  };
  if (inputSchema) {
    summary.inputSchema = inputSchema;
  }
  return summary;
}

/**
 * Normalize an MCP tools/call result into a host tool string.
 *
 * Official SDK / MCP protocol return `{ content: [{ type: 'text', text }] }`.
 * Prefer joined text parts so the model and UI see readable output instead of
 * a JSON envelope. Fall back to JSON for non-text structured results.
 */
export function formatMcpCallResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (!result || typeof result !== 'object') {
    return String(result ?? '');
  }
  const record = result as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const part = item as Record<string, unknown>;
      if (part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text);
      }
    }
    if (texts.length > 0) {
      return texts.join('\n');
    }
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
