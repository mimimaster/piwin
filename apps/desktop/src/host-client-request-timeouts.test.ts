import { describe, expect, it } from 'vitest';
import { getHostRequestTimeoutMs } from './host-client-request-timeouts.js';

describe('Host request timeouts', () => {
  it('keeps MCP tool discovery open during browser authorization', () => {
    expect(getHostRequestTimeoutMs({ type: 'mcp/list_tools', serverId: 'cloudflare' })).toBe(
      120_000,
    );
  });
});
