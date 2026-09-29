/**
 * Grok pushes these notifications with MCP env secrets or irrelevant config.
 * Drop them at the JSON-RPC layer before listeners or protocol-issue hooks.
 */
export const GROK_DROPPED_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  '_x.ai/mcp/servers_updated',
  '_x.ai/settings/update',
  '_x.ai/announcements/update',
]);

export const GROK_XAI_METHODS = {
  sessionsList: '_x.ai/sessions/list',
  sessionRename: '_x.ai/session/rename',
  sessionDelete: '_x.ai/session/delete',
  interject: '_x.ai/interject',
} as const;
