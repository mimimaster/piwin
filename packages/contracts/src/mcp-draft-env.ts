import type { McpServerConfig } from './mcp.js';

/**
 * Adds required-but-unknown env vars to an MCP draft as empty entries, so the
 * saved config shows the user exactly what to fill in. Existing values win.
 */
export function withMcpEnvPlaceholders(
  draft: McpServerConfig,
  requiredEnv: readonly string[] | undefined,
): McpServerConfig {
  if (!requiredEnv || requiredEnv.length === 0) return draft;
  return {
    ...draft,
    env: { ...Object.fromEntries(requiredEnv.map((name) => [name, ''])), ...draft.env },
  };
}
