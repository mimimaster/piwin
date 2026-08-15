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

describe('remote session/list projection', () => {
  const context = {
    hostInstanceId: 'host-1',
    mode: 'sdk' as const,
    capabilities: createRemoteCapabilities(),
  };

  it('projects summaries plus count metadata and redacts Host paths', () => {
    const projected = projectRemoteResponse(
      {
        type: 'session/list',
        scope: { kind: 'general' },
        order: 'alphabetical',
        maxItems: 2000,
      },
      {
        type: 'response',
        command: 'session/list',
        success: true,
        data: {
          sessions: [
            {
              id: 'session-1',
              name: 'Remote chat',
              scope: { kind: 'general' },
              workingDirectory: '/Users/private/General',
              projectPath: '/Users/private/Projects/example',
              updatedAt: '2026-08-09T00:00:00.000Z',
              messageCount: 2,
            },
          ],
          totalCount: 7,
          truncated: true,
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
    expect(serialized).not.toContain('projectPath');
    expect(serialized).not.toContain('workingDirectory');
    expect(projected.data).toEqual({
      sessions: [
        {
          sessionId: 'session-1',
          name: 'Remote chat',
          scope: 'general',
          updatedAt: '2026-08-09T00:00:00.000Z',
          messageCount: 2,
        },
      ],
      totalCount: 7,
      truncated: true,
    });
  });

  it('defaults omitted metadata without exposing Host paths', () => {
    const projected = projectRemoteResponse(
      { type: 'session/list' },
      {
        type: 'response',
        command: 'session/list',
        success: true,
        data: {
          sessions: [
            {
              id: 'session-legacy',
              scope: { kind: 'general' },
              workingDirectory: '/Users/private/General',
              projectPath: '/Users/private/Projects/example',
            },
          ],
        },
      },
      context,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    expect(JSON.stringify(projected.data)).not.toContain('/Users/private');
    expect(projected.data).toMatchObject({
      sessions: [{ sessionId: 'session-legacy', scope: 'general' }],
      totalCount: 1,
      truncated: false,
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
      contextSummary: true,
    });
  });
});

describe('remote queued-turn projection', () => {
  const context = {
    hostInstanceId: 'host-1',
    mode: 'sdk' as const,
    capabilities: createRemoteCapabilities(),
    remoteMediaPaths: new Map([['asset-1', '/Users/private/.piwin/media/asset-1.png']]),
  };

  it('restores opaque media refs without exposing Host paths', () => {
    const projected = projectRemoteResponse(
      {
        type: 'session/queued-turn-submit',
        sessionId: 'session-1',
        queuedTurnId: 'queued-1',
        userMessageId: 'user-1',
        input: { text: 'look at this' },
      },
      {
        type: 'response',
        command: 'session/queued-turn-submit',
        success: true,
        data: {
          queuedTurn: {
            queuedTurnId: 'queued-1',
            revision: 1,
            sessionId: 'session-1',
            sequence: 1,
            userMessageId: 'user-1',
            mode: 'next',
            status: 'pending',
            input: {
              text: 'look at this',
              attachments: [
                {
                  id: 'asset-1',
                  kind: 'media',
                  path: '/Users/private/.piwin/media/asset-1.png',
                  mimeType: 'image/png',
                  byteSize: 12,
                  source: 'paste',
                },
              ],
            },
            submittedAt: '2026-08-15T10:00:00.000Z',
            updatedAt: '2026-08-15T10:00:00.000Z',
          },
        },
      },
      context,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) throw new Error(projected.error);
    expect(JSON.stringify(projected.data)).not.toContain('/Users/private');
    expect(projected.data).toMatchObject({
      queuedTurn: { input: { attachments: [{ path: 'remote-asset:asset-1' }] } },
    });
  });
});
