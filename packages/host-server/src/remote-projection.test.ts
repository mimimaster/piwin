import { describe, expect, it } from 'vitest';
import { createRemoteCapabilities, projectRemoteResponse } from './remote-projection.js';

describe('remote session resume projection', () => {
  it('preserves sanitized restored context usage', () => {
    const projected = projectRemoteResponse(
      { type: 'session/resume', sessionId: 'session-long' },
      {
        type: 'response',
        command: 'session/resume',
        success: true,
        data: {
          sessionId: 'session-long',
          live: true,
          messages: [],
          scope: { kind: 'general' },
          contextUsage: {
            sessionId: 'session-long',
            totalTokens: 505_510,
            cacheReadTokens: 503_680,
            updatedAt: '2026-08-09T11:24:22.004Z',
            source: 'assistant-usage',
          },
        },
      },
      {
        hostInstanceId: 'host-1',
        mode: 'sdk',
        capabilities: createRemoteCapabilities(),
      },
    );

    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    expect(projected.data).toMatchObject({
      contextUsage: {
        sessionId: 'session-long',
        totalTokens: 505_510,
        cacheReadTokens: 503_680,
        source: 'assistant-usage',
      },
    });
  });
});
