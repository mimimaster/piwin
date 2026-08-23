import { describe, expect, it } from 'vitest';
import {
  createRemoteCapabilities,
  projectRemoteResponse,
  projectRemoteSettingsData,
} from './remote-projection.js';

describe('remote settings projection', () => {
  it('keeps renderable settings while removing secrets, Host paths, and remote credentials', () => {
    const projected = projectRemoteSettingsData({
      root: '/Users/private/.piwin',
      snapshot: {
        schemaVersion: 2,
        revision: 'settings-revision',
        runtimeRevision: 'runtime-revision',
        domainRevisions: { thinking: 'abc' },
        config: {
          hostMode: 'sdk',
          providers: [
            {
              id: 'provider-1',
              protocol: 'openai-compatible',
              name: 'Private provider',
              baseUrl: 'https://models.example.test/v1',
              apiKeyEnv: 'PRIVATE_API_KEY',
              apiKeyRef: 'keychain:provider-1',
              headers: { Authorization: 'Bearer secret' },
              models: [{ id: 'model-1', label: 'Model One' }],
            },
          ],
          desktop: {
            lastSession: {
              sessionId: 'session-1',
              scope: { kind: 'project', projectPath: '/Users/private/Projects/piwin' },
            },
          },
          skills: {
            extraPaths: ['/Users/private/.cursor/skills'],
            disabledIds: ['disabled-skill'],
          },
          subagents: {
            profiles: [],
            schemes: [{ id: 'scheme-1', name: 'Visual review' }],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
          },
          remote: {
            enabled: true,
            gatewayUrl: 'wss://gateway.example.test',
            tokenRef: 'keychain:remote',
          },
        },
      },
    });

    expect(projected).toMatchObject({
      snapshot: {
        schemaVersion: 2,
        revision: 'settings-revision',
        runtimeRevision: 'runtime-revision',
        domainRevisions: { thinking: 'abc' },
        config: {
          hostMode: 'sdk',
          providers: [
            {
              id: 'provider-1',
              name: 'Private provider',
              baseUrl: 'https://models.example.test/v1',
              apiKeyEnv: '[stored-secret]',
              apiKeyRef: '[stored-secret]',
              models: [{ id: 'model-1', label: 'Model One' }],
            },
          ],
          desktop: {
            lastSession: {
              sessionId: 'session-1',
            },
          },
          skills: { disabledIds: ['disabled-skill'] },
          subagents: {
            schemes: [{ id: 'scheme-1', name: 'Visual review' }],
          },
        },
      },
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('/Users/private');
    expect(serialized).not.toContain('PRIVATE_API_KEY');
    expect(serialized).not.toContain('Bearer secret');
    expect(serialized).not.toContain('keychain:');
    expect(serialized).toContain('[stored-secret]');
    expect(serialized).toContain('"desktop"');
    expect(serialized).not.toContain('"remote"');
  });

  it('keeps knowledge reranker and notes extras in the settings projection', () => {
    const projected = projectRemoteSettingsData({
      snapshot: {
        schemaVersion: 2,
        revision: 'rev-1',
        runtimeRevision: 'rev-1',
        domainRevisions: { knowledge: 'hash-k', notes: 'hash-n' },
        config: {
          knowledge: {
            reranker: {
              enabled: true,
              provider: 'openai-compatible',
              baseUrl: 'https://api.example.com/v1',
              model: 'Qwen/Qwen3-Reranker-8B',
              apiKeyRef: 'keychain:knowledge-reranker',
            },
          },
          notes: {
            knowledgeExtras: {
              reranker: {
                enabled: true,
                model: 'Qwen/Qwen3-Reranker-8B',
                apiKeyRef: 'keychain:knowledge-reranker',
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(projected)).toContain('Qwen/Qwen3-Reranker-8B');
    expect(JSON.stringify(projected)).toContain('[stored-secret]');
    expect(JSON.stringify(projected)).not.toContain('keychain:knowledge-reranker');
  });

  it('keeps a CLI search source visible without leaking its Host launcher', () => {
    const projected = projectRemoteSettingsData({
      snapshot: {
        schemaVersion: 2,
        revision: 'settings-revision',
        config: {
          web: {
            searchProvider: 'cli',
            searchSources: [
              {
                id: 'cli',
                kind: 'cli',
                enabled: true,
                command: '/Users/private/.local/share/fnm/node-versions/v24.11.1/installation/bin/node',
                args: ['/Users/private/.piwin/bin/windsurf-search.mjs', '{{query}}'],
              },
            ],
          },
        },
      },
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).toContain('"id":"cli"');
    expect(serialized).toContain('"kind":"cli"');
    expect(serialized).toContain('"enabled":true');
    expect(serialized).not.toContain('command');
    expect(serialized).not.toContain('args');
    expect(serialized).not.toContain('/Users/private');
    expect(serialized).not.toContain('[host-path]');
  });
});

describe('remote session list storage projection', () => {
  it('projects offloaded residency without Host pack paths', () => {
    const projected = projectRemoteResponse(
      { type: 'session/list', scope: { kind: 'general' } },
      {
        type: 'response',
        command: 'session/list',
        success: true,
        data: {
          sessions: [
            {
              id: 'ses_off',
              scope: { kind: 'general' },
              workingDirectory: '',
              projectPath: '',
              updatedAt: '2026-08-12T00:00:00.000Z',
              messageCount: 2,
              isArchived: true,
              storage: {
                state: 'offloaded',
                packId: 'pack-1',
                packPath: '/Users/me/Drive/session.piwin-pack',
                packArchiveSha256: 'abc',
                coldPreview: 'preview',
                offloadedBytes: 99,
              },
            },
          ],
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
    const sessions = (projected.data as { sessions: Array<Record<string, unknown>> }).sessions;
    expect(sessions[0]?.storage).toEqual({
      state: 'offloaded',
      packId: 'pack-1',
      coldPreview: 'preview',
      offloadedBytes: 99,
    });
    expect(JSON.stringify(projected.data)).not.toContain('/Users/me/Drive');
  });
});

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

  it('attaches opaque projectId for project-scoped sessions and keeps paths out', () => {
    const projected = projectRemoteResponse(
      { type: 'session/list', allScopes: true },
      {
        type: 'response',
        command: 'session/list',
        success: true,
        data: {
          sessions: [
            {
              id: 'session-project',
              name: 'Piwin work',
              scope: { kind: 'project', projectPath: '/Users/private/Projects/piwin' },
              workingDirectory: '/Users/private/Projects/piwin',
              projectPath: '/Users/private/Projects/piwin',
              updatedAt: '2026-08-17T00:00:00.000Z',
              messageCount: 3,
            },
          ],
          totalCount: 1,
          truncated: false,
        },
      },
      context,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    const serialized = JSON.stringify(projected.data);
    expect(serialized).not.toContain('/Users/private');
    expect(serialized).not.toContain('projectPath');
    expect(projected.data).toMatchObject({
      sessions: [
        {
          sessionId: 'session-project',
          name: 'Piwin work',
          scope: 'project',
          projectId: expect.stringMatching(/^project-[a-f0-9]{24}$/),
        },
      ],
    });
  });

  it('projects project/open onto an opaque projectId and drops the Host path', () => {
    const projected = projectRemoteResponse(
      { type: 'project/open', path: '/home/host/work/app' },
      {
        type: 'response',
        command: 'project/open',
        success: true,
        data: {
          path: '/home/host/work/app',
          projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
          trusted: true,
          trust: 'trusted',
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
    expect(JSON.stringify(projected.data)).not.toContain('/home/host');
    expect(projected.data).toEqual({
      projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
      trusted: true,
      trust: 'trusted',
    });
  });
});

describe('remote models/configured projection', () => {
  it('keeps model ids and drops secret-like extras', () => {
    const projected = projectRemoteResponse(
      { type: 'models/configured' },
      {
        type: 'response',
        command: 'models/configured',
        success: true,
        data: {
          defaultProviderId: 'custom-anthropic',
          defaultModelId: 'deepseek-v4-flash',
          models: [
            {
              providerId: 'custom-anthropic',
              protocol: 'openai-compatible',
              modelId: 'deepseek-v4-flash',
              label: 'Flash',
              apiKey: 'sk-leak',
            },
          ],
          apiKey: 'sk-root',
          baseUrl: 'http://127.0.0.1:8317/v1',
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
    const serialized = JSON.stringify(projected.data);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('8317');
    expect(serialized).not.toContain('sk-');
    expect(projected.data).toEqual({
      defaultProviderId: 'custom-anthropic',
      defaultModelId: 'deepseek-v4-flash',
      models: [
        {
          providerId: 'custom-anthropic',
          protocol: 'openai-compatible',
          modelId: 'deepseek-v4-flash',
          label: 'Flash',
        },
      ],
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

  it('declares skillPreview, toolOutputRead and mediaRead capabilities', () => {
    expect(createRemoteCapabilities()).toMatchObject({
      skillPreview: true,
      toolOutputRead: true,
      mediaRead: true,
      trustedTextPreview: true,
      contextSummary: true,
    });
  });

  it('advertises the Host OS path style, not the connecting shell OS', () => {
    const caps = createRemoteCapabilities();
    expect(caps.platform === 'darwin' || caps.platform === 'linux' || caps.platform === 'win32' || caps.platform === 'other').toBe(
      true,
    );
    expect(caps.pathStyle).toBe(caps.platform === 'win32' ? 'windows' : 'posix');
  });

  it('passes media/read base64 payloads through untouched', () => {
    const context: Parameters<typeof projectRemoteResponse>[2] = {
      hostInstanceId: 'host-1',
      mode: 'sdk',
      capabilities: createRemoteCapabilities(),
      remoteMediaPaths: new Map<string, string>(),
    };
    const projected = projectRemoteResponse(
      { type: 'media/read', input: { sessionId: 'sess-1', assetId: 'asset-1' } },
      {
        type: 'response',
        command: 'media/read',
        success: true,
        data: {
          status: 'ready',
          assetId: 'asset-1',
          sessionId: 'sess-1',
          mimeType: 'image/png',
          byteSize: 4,
          base64Data: 'AQIDBA==',
        },
      },
      context,
    );
    expect(projected).toEqual({
      type: 'response',
      command: 'media/read',
      success: true,
      data: {
        status: 'ready',
        assetId: 'asset-1',
        sessionId: 'sess-1',
        mimeType: 'image/png',
        byteSize: 4,
        base64Data: 'AQIDBA==',
      },
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

describe('remote transcript tool projection', () => {
  it('keeps slim tool cards and drops host paths from tool output', () => {
    const projected = projectRemoteResponse(
      { type: 'session/messages', sessionId: 'session-1' },
      {
        type: 'response',
        command: 'session/messages',
        success: true,
        data: {
          sessionId: 'session-1',
          messages: [
            {
              id: 'assistant-1',
              role: 'assistant',
              text: 'done',
              createdAt: '2026-08-17T00:00:00.000Z',
              status: 'done',
              tools: [
                {
                  toolCallId: 'call-1',
                  toolName: 'read',
                  status: 'done',
                  output: 'contents of /Users/private/.piwin/secret.txt',
                  runId: 'run-1',
                  presentation: {
                    kind: 'filesystem',
                    title: 'Read',
                    actionVerb: 'Read',
                    summary: 'a.ts',
                    targetPaths: ['/Users/private/Projects/example/src/a.ts'],
                  },
                },
                {
                  toolCallId: 'call-2',
                  toolName: 'bash',
                  status: 'done',
                  output: 'ok',
                  presentation: {
                    kind: 'shell',
                    title: 'bash',
                    actionVerb: 'Ran command',
                    command: 'cat /Users/private/secret.txt',
                    summary: 'cat /Users/private/secret.txt',
                  },
                },
              ],
            },
          ],
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
    expect(JSON.stringify(projected.data)).not.toContain('/Users/private');
    expect(projected.data).toMatchObject({
      messages: [
        {
          id: 'assistant-1',
          tools: [
            {
              toolCallId: 'call-1',
              toolName: 'read',
              status: 'done',
              runId: 'run-1',
              presentation: {
                kind: 'filesystem',
                title: 'Read',
                actionVerb: 'Read',
                summary: 'a.ts',
                targetPaths: ['a.ts'],
              },
            },
            {
              toolCallId: 'call-2',
              toolName: 'bash',
              status: 'done',
              presentation: {
                kind: 'shell',
                title: 'bash',
                actionVerb: 'Ran command',
                command: 'cat [host-path]',
                summary: 'cat [host-path]',
              },
            },
          ],
        },
      ],
    });
  });

  it('keeps a shell command summary so resume does not collapse to a bare verb', () => {
    const projected = projectRemoteResponse(
      { type: 'session/resume', sessionId: 'session-1' },
      {
        type: 'response',
        command: 'session/resume',
        success: true,
        data: {
          sessionId: 'session-1',
          live: false,
          messages: [
            {
              id: 'assistant-1',
              role: 'assistant',
              text: 'ok',
              createdAt: '2026-08-21T00:00:00.000Z',
              status: 'done',
              tools: [
                {
                  toolCallId: 'call-bash',
                  toolName: 'bash',
                  status: 'done',
                  output: 'tick 1\n',
                  presentation: {
                    kind: 'shell',
                    title: 'bash',
                    actionVerb: 'Ran command',
                    command: 'for i in $(seq 1 12); do echo tick $i; sleep 1; done',
                    summary: 'for i in $(seq 1 12); do echo tick $i; sleep 1; done',
                  },
                },
              ],
            },
          ],
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
      messages: [
        {
          tools: [
            {
              presentation: {
                kind: 'shell',
                actionVerb: 'Ran command',
                command: 'for i in $(seq 1 12); do echo tick $i; sleep 1; done',
                summary: 'for i in $(seq 1 12); do echo tick $i; sleep 1; done',
              },
            },
          ],
        },
      ],
    });
  });
});

describe('remote activity/summary projection', () => {
  it('strips Host paths and permission detail', () => {
    const projected = projectRemoteResponse(
      { type: 'activity/summary' },
      {
        type: 'response',
        command: 'activity/summary',
        success: true,
        data: {
          items: [
            {
              sessionId: 'session-1',
              runId: 'run-1',
              status: 'running',
              pendingPermission: true,
              permissionRequestId: 'perm-1',
              permissionAction: 'bash',
              detail: 'cat /Users/private/secret',
              projectPath: '/Users/private/Projects/example',
            },
          ],
          truncated: false,
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
    expect(JSON.stringify(projected.data)).not.toContain('/Users/private');
    expect(JSON.stringify(projected.data)).not.toContain('detail');
    expect(projected.data).toEqual({
      items: [
        {
          sessionId: 'session-1',
          runId: 'run-1',
          status: 'running',
          pendingPermission: true,
          permissionRequestId: 'perm-1',
          permissionAction: 'bash',
        },
      ],
      truncated: false,
    });
  });
});
