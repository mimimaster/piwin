/**
 * Unified MCP visibility view-model (settings catalog + shared tool rows).
 * Catalog = capability sheet; invocation audit lives on the transcript side.
 */
import type { McpServerConfig, McpServerHealth, McpToolSummary } from '@piwin/contracts';

export type McpToolExposure = 'direct' | 'gateway' | 'dormant-pin';

export type McpToolCatalogEntry = {
  serverId: string;
  name: string;
  selector: string;
  exposedName: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  exposure: McpToolExposure;
  source: 'live' | 'cached' | 'pinned-dormant';
};

export type McpSchemaPropertyRow = {
  name: string;
  typeLabel: string;
  required: boolean;
  description: string;
};

export function formatMcpToolSelector(serverId: string, toolName: string): string {
  return `${serverId}.${toolName}`;
}

export function buildMcpToolCatalogEntries(input: {
  serverId: string;
  tools: readonly McpToolSummary[];
  pinnedSelectors: readonly string[];
  source?: 'live' | 'cached';
}): McpToolCatalogEntry[] {
  const pinned = new Set(input.pinnedSelectors);
  const source = input.source ?? 'live';
  const fromLive = input.tools.map((tool) => {
    const selector = formatMcpToolSelector(tool.serverId || input.serverId, tool.name);
    const entry: McpToolCatalogEntry = {
      serverId: tool.serverId || input.serverId,
      name: tool.name,
      selector,
      exposedName: tool.exposedName,
      description: tool.description || tool.name,
      exposure: pinned.has(selector) ? 'direct' : 'gateway',
      source,
    };
    if (tool.inputSchema) {
      entry.inputSchema = tool.inputSchema;
    }
    return entry;
  });

  const seen = new Set(fromLive.map((entry) => entry.selector));
  const dormant: McpToolCatalogEntry[] = [];
  const prefix = `${input.serverId}.`;
  for (const selector of input.pinnedSelectors) {
    if (!selector.startsWith(prefix) || seen.has(selector)) continue;
    const toolName = selector.slice(prefix.length);
    if (!toolName) continue;
    dormant.push({
      serverId: input.serverId,
      name: toolName,
      selector,
      exposedName: `mcp__${input.serverId}__${toolName}`,
      description: toolName,
      exposure: 'dormant-pin',
      source: 'pinned-dormant',
    });
  }
  return [...fromLive, ...dormant];
}

export function listMcpSchemaProperties(
  schema: Record<string, unknown> | undefined,
): McpSchemaPropertyRow[] {
  if (!schema || typeof schema !== 'object') return [];
  const properties = schema['properties'];
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return [];
  }
  const requiredRaw = schema['required'];
  const required = new Set(
    Array.isArray(requiredRaw)
      ? requiredRaw.filter((item): item is string => typeof item === 'string')
      : [],
  );
  const rows: McpSchemaPropertyRow[] = [];
  for (const [name, raw] of Object.entries(properties as Record<string, unknown>)) {
    const property =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const typeValue = property['type'];
    const typeLabel = Array.isArray(typeValue)
      ? typeValue.map(String).join(' | ')
      : typeof typeValue === 'string'
        ? typeValue
        : typeof property['anyOf'] !== 'undefined'
          ? 'anyOf'
          : typeof property['oneOf'] !== 'undefined'
            ? 'oneOf'
            : 'unknown';
    const description =
      typeof property['description'] === 'string' ? property['description'] : '';
    rows.push({
      name,
      typeLabel,
      required: required.has(name),
      description,
    });
  }
  return rows;
}

export function mcpServerCommandLine(server: McpServerConfig | undefined): string {
  if (!server) return '';
  return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
}

export function mcpServerEnvKeys(server: McpServerConfig | undefined): string[] {
  return Object.keys(server?.env ?? {}).sort((left, right) => left.localeCompare(right));
}

export type McpServerRuntimeUiStatus = 'stopped' | 'starting' | 'running' | 'error';

export function resolveMcpServerRuntimeUiStatus(input: {
  enabled: boolean;
  health: McpServerHealth | undefined;
}): McpServerRuntimeUiStatus {
  if (!input.enabled) return 'stopped';
  if (input.health?.status === 'error') return 'error';
  if (input.health?.status === 'starting') return 'starting';
  if (input.health?.status === 'running') return 'running';
  if (input.health?.status === 'stopping') return 'stopped';
  return input.health ? 'stopped' : 'running';
}
