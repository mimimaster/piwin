/**
 * Human projection of `piwin_toolbox` catalog lookups (search / describe /
 * status). These are the agent finding out which tools exist, not work the
 * user asked for — the transcript shows "查找可用工具 · library · 找到 3 个"
 * instead of the raw args object and a multi-screen JSON result.
 *
 * `call` is excluded on purpose: it runs a real tool and keeps the normal row.
 */
import type { ToolCardUi } from './chat-reducer';

export type ToolboxCatalogAction = 'search' | 'describe' | 'status';

export type ToolboxCatalogView = {
  action: ToolboxCatalogAction;
  /** Search query, describe target, or status server id. */
  subject?: string;
  /** Tool ids returned by a search (may be partial when output was clipped). */
  hitIds: string[];
  /** Search output was clipped or budget-truncated — the count is a floor. */
  partial: boolean;
  /** Describe: first line of the tool description. */
  description?: string;
  /** Status: one `serverId · state` entry per MCP server. */
  servers: Array<{ serverId: string; state?: string }>;
};

const TOOLBOX_TOOL_NAME = 'piwin_toolbox';
const CATALOG_ACTIONS: ReadonlySet<string> = new Set(['search', 'describe', 'status']);

function parseRecord(text: string | undefined): Record<string, unknown> | undefined {
  const trimmed = text?.trim();
  if (!trimmed || !trimmed.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveAction(tool: ToolCardUi, args: Record<string, unknown> | undefined): string | undefined {
  const fromArgs = readString(args, 'action')?.toLowerCase();
  if (fromArgs) return fromArgs;
  // Host verbs: `Tool discovery` (search/describe) and `MCP status`.
  const verb = tool.presentation?.actionVerb?.trim().toLowerCase() ?? '';
  if (verb.includes('status')) return 'status';
  if (verb.includes('discovery')) return 'search';
  return undefined;
}

/** Ids from `{ tools: [{ id }] }`; clipped JSON falls back to scanning `"id": "…"`. */
function readHitIds(output: string): { ids: string[]; partial: boolean } {
  const record = parseRecord(output);
  if (record) {
    const tools = Array.isArray(record.tools) ? record.tools : [];
    const ids = tools
      .map((entry) =>
        entry !== null && typeof entry === 'object'
          ? readString(entry as Record<string, unknown>, 'id')
          : undefined,
      )
      .filter((id): id is string => id !== undefined);
    return { ids, partial: record.truncated === true };
  }
  const ids = [...output.matchAll(/"id"\s*:\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((id): id is string => typeof id === 'string');
  return { ids, partial: output.trim().length > 0 };
}

function readServers(output: string): ToolboxCatalogView['servers'] {
  const servers = parseRecord(output)?.servers;
  if (!Array.isArray(servers)) return [];
  return servers.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const serverId = readString(row, 'serverId');
    if (!serverId) return [];
    const state = readString(row, 'status') ?? readString(row, 'state');
    return [{ serverId, ...(state ? { state } : {}) }];
  });
}

export function resolveToolboxCatalogView(tool: ToolCardUi): ToolboxCatalogView | null {
  if (tool.toolName.trim().toLowerCase() !== TOOLBOX_TOOL_NAME) return null;
  const args = parseRecord(tool.presentation?.inputPreview);
  const action = resolveAction(tool, args);
  if (!action || !CATALOG_ACTIONS.has(action)) return null;

  const output = tool.presentation?.output?.text ?? tool.output;
  const clipped =
    tool.presentation?.output?.truncated === true ||
    tool.presentation?.output?.truncation !== undefined ||
    tool.outputTruncated === true;
  const summary = tool.presentation?.summary?.trim();
  const subject =
    readString(args, action === 'search' ? 'query' : 'target') ??
    (action === 'status' ? readString(args, 'serverId') : undefined) ??
    (summary && !summary.startsWith('{') ? summary : undefined);

  const view: ToolboxCatalogView = {
    action: action as ToolboxCatalogAction,
    ...(subject ? { subject } : {}),
    hitIds: [],
    partial: false,
    servers: [],
  };
  if (tool.status !== 'done') return view;

  if (view.action === 'search') {
    const hits = readHitIds(output);
    view.hitIds = [...new Set(hits.ids)];
    view.partial = hits.partial || clipped;
  } else if (view.action === 'describe') {
    const description = readString(parseRecord(output), 'description')?.split('\n')[0];
    if (description) view.description = description;
  } else {
    view.servers = readServers(output);
  }
  return view;
}

export function toolboxCatalogTitle(action: ToolboxCatalogAction, locale: 'zh-CN' | 'en'): string {
  const zh = locale === 'zh-CN';
  switch (action) {
    case 'search':
      return zh ? '查找可用工具' : 'Find tools';
    case 'describe':
      return zh ? '查看工具说明' : 'Read tool schema';
    case 'status':
      return zh ? '检查 MCP 状态' : 'Check MCP status';
  }
}

/** Trailing result meta: `找到 3 个` / `3+ found` / `未找到`. Empty while running. */
export function toolboxCatalogResultMeta(
  view: ToolboxCatalogView,
  status: ToolCardUi['status'],
  locale: 'zh-CN' | 'en',
): string | undefined {
  if (status !== 'done') return undefined;
  const zh = locale === 'zh-CN';
  if (view.action === 'search') {
    const count = view.hitIds.length;
    if (count === 0) return view.partial ? undefined : zh ? '未找到' : 'None found';
    const shown = view.partial ? `${count}+` : String(count);
    return zh ? `找到 ${shown} 个` : `${shown} found`;
  }
  if (view.action === 'status' && view.servers.length > 0) {
    return zh ? `${view.servers.length} 个服务器` : `${view.servers.length} servers`;
  }
  return undefined;
}
