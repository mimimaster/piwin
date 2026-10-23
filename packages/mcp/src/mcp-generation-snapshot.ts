import { createHash } from 'node:crypto';
import {
  isRemoteMcpServerConfig,
  type McpConfigDocument,
  type McpRemoteServerConfig,
  type McpServerConfig,
  type McpStdioServerConfig,
} from '@piwin/contracts';
import { fingerprintMcpServerConfig } from './mcp-fingerprint.js';

/**
 * Immutable, Host-local MCP input for one runtime generation.
 *
 * The config is copied and frozen at construction time. Runtime execution
 * receives this object explicitly; it never asks the mutable config store for
 * a replacement document.
 */
export type McpGenerationSnapshot = {
  generationId: string;
  revision: string;
  config: McpConfigDocument;
  enabledServerIds: readonly string[];
  serverFingerprints: Readonly<Record<string, string>>;
};

export function createMcpGenerationSnapshot(
  document: McpConfigDocument,
  generationId: string,
): McpGenerationSnapshot {
  const config = cloneAndFreezeMcpConfig(document);
  const enabledServerIds = Object.keys(config.mcpServers)
    .filter((serverId) => config.mcpServers[serverId]?.disabled !== true)
    .sort((left, right) => left.localeCompare(right));
  const serverFingerprints: Record<string, string> = {};
  for (const [serverId, serverConfig] of Object.entries(config.mcpServers)) {
    serverFingerprints[serverId] = fingerprintMcpServerConfig(serverId, serverConfig);
  }
  const revision = createHash('sha256')
    .update(
      JSON.stringify(
        {
          servers: Object.entries(serverFingerprints).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
          pinnedSelectors: config.pinnedSelectors ?? [],
        },
      ),
    )
    .digest('hex')
    .slice(0, 24);
  Object.freeze(serverFingerprints);

  return Object.freeze({
    generationId,
    revision,
    config,
    enabledServerIds: Object.freeze(enabledServerIds),
    serverFingerprints,
  });
}

function cloneServerTransport(source: McpServerConfig): McpServerConfig {
  if (isRemoteMcpServerConfig(source)) {
    const remote: McpRemoteServerConfig = { url: source.url };
    if (source.type !== undefined) remote.type = source.type;
    if (source.headers !== undefined) remote.headers = Object.freeze({ ...source.headers });
    return remote;
  }
  const stdio: McpStdioServerConfig = { command: source.command };
  if (source.type !== undefined) stdio.type = source.type;
  if (source.args !== undefined) stdio.args = Object.freeze([...source.args]) as string[];
  if (source.env !== undefined) stdio.env = Object.freeze({ ...source.env });
  return stdio;
}

function cloneAndFreezeMcpConfig(document: McpConfigDocument): McpConfigDocument {
  const servers: Record<string, McpServerConfig> = {};
  for (const [serverId, source] of Object.entries(document.mcpServers)) {
    const config = cloneServerTransport(source);
    if (source.disabled !== undefined) {
      config.disabled = source.disabled;
    }
    if (source.restartOnCrash !== undefined) {
      config.restartOnCrash = source.restartOnCrash;
    }
    Object.freeze(config);
    servers[serverId] = config;
  }
  Object.freeze(servers);
  const pinnedSelectors = [...(document.pinnedSelectors ?? [])];
  Object.freeze(pinnedSelectors);
  const frozenDocument = { mcpServers: servers, pinnedSelectors };
  Object.freeze(frozenDocument);
  // The returned document is owned by the snapshot and is frozen above. The
  // public config contract remains mutable for save/edit workflows elsewhere.
  return frozenDocument;
}
