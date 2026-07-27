import { createHash } from 'node:crypto';
import type { McpServerConfig } from '@piwin/contracts';
import { expandEnvMap } from './mcp-config.js';

/**
 * Build a stable fingerprint for a server definition.
 *
 * Environment values are hashed as part of the fingerprint, but the values
 * themselves never leave this function or get persisted in metadata.
 */
export function fingerprintMcpServerConfig(
  serverId: string,
  config: McpServerConfig,
): string {
  const expandedEnvironment = expandEnvMap(config.env);
  const environment = Object.fromEntries(
    Object.entries(expandedEnvironment).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const payload = {
    serverId,
    command: config.command,
    args: config.args ?? [],
    environment,
    disabled: config.disabled === true,
    restartOnCrash: config.restartOnCrash === true,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

export function formatMcpToolSelector(serverId: string, toolName: string): string {
  return `${serverId}.${toolName}`;
}

export function parseMcpToolSelector(
  selector: string,
): { serverId: string; toolName: string } | null {
  const separatorIndex = selector.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === selector.length - 1) {
    return null;
  }
  return {
    serverId: selector.slice(0, separatorIndex),
    toolName: selector.slice(separatorIndex + 1),
  };
}
