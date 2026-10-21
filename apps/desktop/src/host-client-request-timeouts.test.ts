import { describe, expect, it } from 'vitest';
import { getHostRequestTimeoutMs } from './host-client-request-timeouts.js';

describe('Host request timeouts', () => {
  it('allows native terminal startup and history handoff to finish on local and remote Hosts', () => {
    for (const transport of ['live', 'remote'] as const) {
      expect(getHostRequestTimeoutMs({
        type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 },
      }, transport)).toBe(120_000);
      expect(getHostRequestTimeoutMs({ type: 'agents/cli-sync', sessionId: 's1' }, transport)).toBe(120_000);
      expect(getHostRequestTimeoutMs({ type: 'agents/cli-snapshot', sessionId: 's1' }, transport)).toBe(120_000);
      expect(getHostRequestTimeoutMs({ type: 'agents/cli-status', sessionId: 's1' }, transport)).toBe(15_000);
    }
  });

  it('bounds Live startup and its status/end control waits on mobile remote transport', () => {
    expect(getHostRequestTimeoutMs({ type: 'voice/live/status', input: {
      capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1'] },
    } }, 'remote')).toBe(5_000);
    expect(getHostRequestTimeoutMs({ type: 'voice/live/end', input: { reason: 'user' } }, 'remote')).toBe(5_000);
    expect(getHostRequestTimeoutMs({ type: 'voice/live/start', input: { sessionId: 's1', providerId: 'openai-codex',
      settingsRevision: 1, idempotencyKey: 'start', bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0' } } }, 'remote')).toBe(30_000);
  });
  it('outlasts the Host MCP registry search bound for marketplace searches', () => {
    expect(getHostRequestTimeoutMs({ type: 'marketplace/search', query: 'pg', sources: ['mcp'] })).toBe(60_000);
  });

  it('keeps MCP tool discovery open during browser authorization', () => {
    expect(getHostRequestTimeoutMs({ type: 'mcp/list_tools', serverId: 'cloudflare' })).toBe(
      120_000,
    );
  });
  it('waits for a handoff summary like compaction, on local and remote transports', () => {
    const command = { type: 'session/handoff', sessionId: 's1' } as const;
    expect(getHostRequestTimeoutMs(command)).toBe(0);
    expect(getHostRequestTimeoutMs(command, 'remote')).toBe(0);
  });
});
