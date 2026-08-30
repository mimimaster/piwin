import { describe, expect, it } from 'vitest';
import { createUnknownSessionContextSnapshot } from '@piwin/contracts';
import { createRemoteCapabilities, projectRemoteResponse } from './remote-projection.js';

describe('remote session resume context projection', () => {
  it('copies contextSnapshot and lastRequestUsage without inventing occupancy from usage', () => {
    const snapshot = createUnknownSessionContextSnapshot({
      sessionId: 'session-long',
      revision: 1,
      contextVersion: 1,
      contextBoundary: { activeLeafMessageId: null },
      reason: 'never-sampled',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });
    const projected = projectRemoteResponse(
      { type: 'session/resume', sessionId: 'session-long' },
      {
        type: 'response',
        command: 'session/resume',
        success: true,
        data: {
          sessionId: 'session-long',
          live: false,
          messages: [],
          scope: { kind: 'general' },
          contextUsage: {
            sessionId: 'session-long',
            tokensUsed: 505_510,
            updatedAt: '2026-08-09T11:24:22.004Z',
            source: 'assistant-usage',
          },
          contextSnapshot: snapshot,
          lastRequestUsage: null,
        },
      },
      {
        hostInstanceId: 'host-1',
        mode: 'sdk',
        capabilities: createRemoteCapabilities(),
      },
    );
    expect(projected.success).toBe(true);
    if (!projected.success) throw new Error(projected.error);
    const data = projected.data as {
      contextSnapshot: { occupancy: { kind: string; tokensUsed?: number } };
      lastRequestUsage: null;
      contextUsage?: { tokensUsed?: number };
    };
    expect(data.contextSnapshot.occupancy.kind).toBe('unknown');
    expect(data.contextSnapshot.occupancy.tokensUsed).toBeUndefined();
    expect(data.lastRequestUsage).toBeNull();
    expect(data.contextUsage?.tokensUsed).toBe(505_510);
  });
});
