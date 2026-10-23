/**
 * Unified MCP visibility view-model (settings catalog + shared tool rows).
 * Catalog = capability sheet; invocation audit lives on the transcript side.
 */
import type { McpServerConfig, McpServerHealth, McpToolSummary } from '@piwin/contracts';
import { describeMcpServerLaunch, isRemoteMcpServerConfig } from '@piwin/contracts';

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

/** `command args…` for stdio, the redacted URL for a remote server. */
export function mcpServerCommandLine(server: McpServerConfig | undefined): string {
  return server ? describeMcpServerLaunch(server) : '';
}

/**
 * Names (never values) of what a server reads its credentials from: env keys
 * for stdio, header names for a remote server.
 */
export function mcpServerCredentialKeys(server: McpServerConfig | undefined): {
  kind: 'env' | 'headers';
  keys: string[];
} {
  const remote = server !== undefined && isRemoteMcpServerConfig(server);
  const source = server === undefined ? undefined : remote ? server.headers : server.env;
  return {
    kind: remote ? 'headers' : 'env',
    keys: Object.keys(source ?? {}).sort((left, right) => left.localeCompare(right)),
  };
}

export type McpServerRuntimeUiStatus = 'stopped' | 'starting' | 'running' | 'error';

export function getMcpConnectionFailure(
  health: McpServerHealth | undefined,
  isChinese: boolean,
): string | null {
  if (health?.status === 'running' && !health.lastError) return null;
  return health?.lastError ?? (isChinese ? '连接失败。' : 'Connection failed.');
}

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

const MCP_RUNTIME_STATUS_LABELS: Record<McpServerRuntimeUiStatus, { zh: string; en: string }> = {
  running: { zh: '运行中', en: 'Running' },
  starting: { zh: '启动中', en: 'Starting' },
  error: { zh: '运行错误', en: 'Error' },
  stopped: { zh: '已停止', en: 'Stopped' },
};

export function mcpServerRuntimeStatusLabel(
  status: McpServerRuntimeUiStatus,
  isChinese: boolean,
): string {
  const label = MCP_RUNTIME_STATUS_LABELS[status];
  return isChinese ? label.zh : label.en;
}
