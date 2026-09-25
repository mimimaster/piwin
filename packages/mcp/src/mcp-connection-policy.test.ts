import { describe, expect, it } from 'vitest';
import { isMcpRemoteBridge, resolveMcpConnectTimeoutMs } from './mcp-connection-policy.js';

describe('MCP connection timeout policy', () => {
  it('allows browser authorization through npx mcp-remote', () => {
    expect(
      resolveMcpConnectTimeoutMs(
        {
          command: '/opt/homebrew/bin/npx',
          args: ['-y', 'mcp-remote', 'https://mcp.cloudflare.com/mcp'],
        },
        12_000,
      ),
    ).toBe(110_000);
    expect(
      isMcpRemoteBridge({
        command: 'npx',
        args: ['-y', 'mcp-remote@latest', 'https://example.com/mcp'],
      }),
    ).toBe(true);
  });

  it('keeps the short timeout for local servers and honors a larger override', () => {
    expect(resolveMcpConnectTimeoutMs({ command: 'node', args: ['server.js'] }, 12_000)).toBe(
      12_000,
    );
    expect(resolveMcpConnectTimeoutMs({ command: 'mcp-remote' }, 120_000)).toBe(120_000);
  });
});
