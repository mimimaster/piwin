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

describe('remote skills/read + tool-output projection', () => {
  const context = {
    hostInstanceId: 'host-1',
    mode: 'sdk' as const,
    capabilities: createRemoteCapabilities(),
  };

  it('keeps logical skill identity and strips nothing path-like', () => {
    const projected = projectRemoteResponse(
      { type: 'skills/read', skillId: 'executing-plans' },
      {
        type: 'response',
        command: 'skills/read',
        success: true,
        data: {
          status: 'ready',
          skillId: 'executing-plans',
          name: 'Executing Plans',
          effectiveSource: 'user',
          origin: 'unknown',
          displayRef: 'skill:executing-plans',
          content: '# Executing Plans\n\nbody',
          byteSize: 32,
          truncated: false,
          provenance: 'current-resource',
        },
      },
      context,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    const serialized = JSON.stringify(projected.data);
    expect(serialized).not.toMatch(/\/Users\//);
    expect(serialized).not.toMatch(/\/home\//);
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(projected.data).toMatchObject({
      status: 'ready',
      skillId: 'executing-plans',
      displayRef: 'skill:executing-plans',
      provenance: 'current-resource',
    });
  });

  it('projects typed unavailable with suggestion for skills/read', () => {
    const projected = projectRemoteResponse(
      { type: 'skills/read', skillId: 'missing-skill' },
      {
        type: 'response',
        command: 'skills/read',
        success: true,
        data: {
          status: 'unavailable',
          reason: 'skill-unresolved',
          skillId: 'missing-skill',
          displayRef: 'skill:missing-skill',
          suggestion: 'Re-sync bundled skills',
        },
      },
      context,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    expect(projected.data).toMatchObject({
      status: 'unavailable',
      reason: 'skill-unresolved',
      skillId: 'missing-skill',
      suggestion: 'Re-sync bundled skills',
    });
  });

  it('bounds tool snapshot output and keeps provenance', () => {
    const projected = projectRemoteResponse(
      {
        type: 'session/tool-output',
        sessionId: 'session-1',
        messageId: 'msg-1',
        toolCallId: 'tc-1',
      },
      {
        type: 'response',
        command: 'session/tool-output',
        success: true,
        data: {
          status: 'ready',
          output: '# Skill body\n\nRead by the agent.',
          truncated: false,
          redacted: false,
          provenance: 'tool-snapshot',
        },
      },
      context,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    expect(projected.data).toMatchObject({
      status: 'ready',
      provenance: 'tool-snapshot',
      output: expect.stringContaining('Read by the agent'),
    });
  });

  it('declares skillPreview and toolOutputRead capabilities', () => {
    expect(createRemoteCapabilities()).toMatchObject({
      skillPreview: true,
      toolOutputRead: true,
    });
  });
});
