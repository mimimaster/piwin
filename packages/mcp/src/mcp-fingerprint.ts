import { createHash } from 'node:crypto';
import { isRemoteMcpServerConfig, type McpServerConfig } from '@piwin/contracts';
import { expandEnvMap } from './mcp-config.js';

/**
 * Build a stable fingerprint for a server definition.
 *
 * Environment and header values are hashed as part of the fingerprint, but
 * the values themselves never leave this function or get persisted in metadata.
 */
export function fingerprintMcpServerConfig(
  serverId: string,
  config: McpServerConfig,
): string {
  const common = {
    serverId,
    disabled: config.disabled === true,
    restartOnCrash: config.restartOnCrash === true,
  };
  // The stdio payload keeps its original keys so existing fingerprints, and
  // the tool metadata cached under them, stay valid.
  const payload = isRemoteMcpServerConfig(config)
    ? { ...common, url: config.url, type: config.type ?? 'auto', headers: sortedExpanded(config.headers) }
    : {
        serverId,
        command: config.command,
        args: config.args ?? [],
        environment: sortedExpanded(config.env),
        disabled: common.disabled,
        restartOnCrash: common.restartOnCrash,
      };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

function sortedExpanded(values: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(expandEnvMap(values)).sort(([left], [right]) => left.localeCompare(right)),
  );
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
