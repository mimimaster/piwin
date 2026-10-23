import { isRemoteMcpServerConfig, type McpServerConfig } from './mcp.js';

/**
 * Adds required-but-unknown env vars to an MCP draft as empty entries, so the
 * saved config shows the user exactly what to fill in. Existing values win.
 * Remote servers take credentials through `headers`, so they are left as is.
 */
export function withMcpEnvPlaceholders(
  draft: McpServerConfig,
  requiredEnv: readonly string[] | undefined,
): McpServerConfig {
  if (!requiredEnv || requiredEnv.length === 0 || isRemoteMcpServerConfig(draft)) return draft;
  return {
    ...draft,
    env: { ...Object.fromEntries(requiredEnv.map((name) => [name, ''])), ...draft.env },
  };
}
