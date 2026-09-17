/**
 * Session-scoped MCP opt-outs. The global MCP config decides which servers
 * exist and are enabled; a session may switch some of them off for itself.
 * The override is folded into the config before the generation snapshot is
 * frozen, so tool definitions, the capability brief, and gateway calls all
 * see the same narrowed server set.
 */
import type { McpConfigDocument } from '@piwin/contracts';

/** Trimmed, de-duplicated, sorted server ids. */
export function normalizeSessionMcpServerIds(ids: readonly string[] | undefined): string[] {
  if (!ids) return [];
  const unique = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim();
    if (trimmed.length > 0) unique.add(trimmed);
  }
  return [...unique].sort((left, right) => left.localeCompare(right));
}

/** Stable identity of a session's opt-out set, compared across generations. */
export function sessionMcpOverrideKey(ids: readonly string[] | undefined): string {
  return normalizeSessionMcpServerIds(ids).join('\n');
}

/** Mark session-disabled servers as disabled; unknown ids are ignored. */
export function applySessionMcpOverrides(
  document: McpConfigDocument,
  disabledServerIds: readonly string[] | undefined,
): McpConfigDocument {
  const disabled = normalizeSessionMcpServerIds(disabledServerIds).filter(
    (serverId) => document.mcpServers[serverId] !== undefined,
  );
  if (disabled.length === 0) return document;
  const mcpServers = { ...document.mcpServers };
  for (const serverId of disabled) {
    mcpServers[serverId] = { ...mcpServers[serverId]!, disabled: true };
  }
  return { ...document, mcpServers };
}
