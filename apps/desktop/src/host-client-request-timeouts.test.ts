import { describe, expect, it } from 'vitest';
import { getHostRequestTimeoutMs } from './host-client-request-timeouts.js';

describe('Host request timeouts', () => {
  it('bounds Live startup and its status/end control waits on mobile remote transport', () => {
    expect(getHostRequestTimeoutMs({ type: 'voice/live/status', input: {
      capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1'] },
    } }, 'remote')).toBe(5_000);
    expect(getHostRequestTimeoutMs({ type: 'voice/live/end', input: { reason: 'user' } }, 'remote')).toBe(5_000);
    expect(getHostRequestTimeoutMs({ type: 'voice/live/start', input: { sessionId: 's1', providerId: 'openai-codex',
      settingsRevision: 1, idempotencyKey: 'start', bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0' } } }, 'remote')).toBe(30_000);
  });
  it('keeps MCP tool discovery open during browser authorization', () => {
    expect(getHostRequestTimeoutMs({ type: 'mcp/list_tools', serverId: 'cloudflare' })).toBe(
      120_000,
    );
  });
});
