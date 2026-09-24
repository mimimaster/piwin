/**
 * MCP install steps shared by the `mcp/*` IPC commands and the agent's
 * `capability_install` tool, so both paths keep the same no-overwrite rule
 * and the same "running + tools discovered" definition of success.
 */
import type { McpConfigApplyReport, McpConfigDocument, McpServerConfig, McpServerHealth } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { draftToServerConfig } from '@piwin/marketplace';
import type { McpLifecycleManager } from '@piwin/mcp';
import { loadMcpConfig, saveMcpConfig } from '@piwin/mcp';

export class McpServerConflictError extends Error {
  override readonly name = 'McpServerConflictError';
  constructor(readonly serverId: string) {
    super(`MCP server "${serverId}" is already configured with different settings.`);
  }
}

/**
 * Add a server draft to Host MCP config and apply it. An identical existing
 * entry is reused; a different one is never overwritten.
 */
export async function saveMcpServerDraft(
  rootDir: string,
  manager: Pick<McpLifecycleManager, 'applyConfig'>,
  requestedServerId: string,
  draft: McpServerConfig,
): Promise<{ serverId: string; document: McpConfigDocument; report: McpConfigApplyReport }> {
  const document = await loadMcpConfig(rootDir);
  const { serverId, config } = draftToServerConfig(requestedServerId, draft);
  const existing = document.mcpServers[serverId];
  if (existing && JSON.stringify(existing) !== JSON.stringify(config)) {
    throw new McpServerConflictError(serverId);
  }
  document.mcpServers[serverId] = config;
  await saveMcpConfig(rootDir, document);
  const report = await manager.applyConfig(document);
  return { serverId, document, report };
}

/** Start a server and prime its tool cache so the next session can expose its tools. */
export async function startMcpServerWithDiscovery(
  manager: Pick<McpLifecycleManager, 'start' | 'discoverTools' | 'listHealth'>,
  serverId: string,
): Promise<McpServerHealth> {
  let health = await manager.start(serverId);
  if (health.status !== 'running') {
    return health;
  }
  try {
    await manager.discoverTools(serverId);
    const refreshed = (await manager.listHealth()).find((item) => item.serverId === serverId);
    if (refreshed) {
      health = refreshed;
    }
  } catch (error) {
    const message = formatError(error);
    health = {
      ...health,
      lastError: health.lastError ? `${health.lastError}; discover: ${message}` : `discover: ${message}`,
    };
  }
  return health;
}
