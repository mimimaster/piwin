import { basename } from 'node:path';
import { isRemoteMcpServerConfig, type McpServerConfig } from '@piwin/contracts';

// Browser-based OAuth needs time for the user to approve the connection.
const REMOTE_BRIDGE_CONNECT_TIMEOUT_MS = 110_000;

export function resolveMcpConnectTimeoutMs(
  config: McpServerConfig,
  defaultTimeoutMs: number,
): number {
  // A native remote server may also start an OAuth flow in the browser.
  return isMcpRemoteBridge(config) || isRemoteMcpServerConfig(config)
    ? Math.max(defaultTimeoutMs, REMOTE_BRIDGE_CONNECT_TIMEOUT_MS)
    : defaultTimeoutMs;
}

export function isMcpRemoteBridge(config: McpServerConfig): boolean {
  if (isRemoteMcpServerConfig(config)) return false;
  const executable = basename(config.command).toLowerCase();
  return (
    executable === 'mcp-remote' ||
    executable === 'mcp-remote.cmd' ||
    ((executable === 'npx' || executable === 'npx.cmd') &&
      (config.args ?? []).some((arg) => arg === 'mcp-remote' || arg.startsWith('mcp-remote@')))
  );
}
