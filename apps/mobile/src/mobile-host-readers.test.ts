import { describe, expect, it } from 'vitest';
import type { RemoteProjectSummary } from '@piwin/contracts';
import { readConfiguredChatModels, readProjects } from './mobile-host-readers.js';

describe('mobile project display metadata', () => {
  it('preserves the public project/list projection, including linked and missing checkouts', () => {
    // Mirrors host-server remote-projection.test.ts; no lease or executor internals.
    const projects: RemoteProjectSummary[] = [true, false].map((primary) => ({
      projectId: primary ? 'project-primary' : 'project-linked',
      displayName: primary ? 'piwin' : 'display-parity',
      path: primary ? '/host/projects/piwin' : '/host/projects/display-parity',
      trust: 'trusted', lastOpenedAt: '2026-10-02T00:00:00.000Z',
      gitRepositoryId: 'abcd1234abcd1234', isPrimaryWorktree: primary,
      currentBranch: primary ? 'main' : 'display-parity',
      gitRootPath: primary ? '/host/projects/piwin' : '/host/projects/display-parity',
      isCheckoutRoot: true, ...(primary ? {} : { workspaceAvailability: 'missing' as const }),
    }));
    const actual = readProjects({
      type: 'response', command: 'project/list', success: true,
      data: { projects: [...projects, { projectId: 'malformed' }], worktrees: [] },
    });
    expect(actual).toEqual(projects);
    expect(readProjects({ type: 'response', command: 'project/list', success: false,
      error: 'unavailable' })).toEqual([]);
  });
});

describe('mobile configured chat models', () => {
  it('keeps subscription rows that have no BYOK protocol', () => {
    const data = readConfiguredChatModels({
      type: 'response',
      command: 'models/configured',
      success: true,
      data: {
        models: [
          {
            providerId: 'openai-codex',
            modelId: 'gpt-5.4-codex',
            source: 'subscription',
            group: 'subscription',
            contextWindow: 272_000,
          },
          {
            providerId: 'custom-openai',
            modelId: 'grok-4.6',
            protocol: 'openai-compatible',
            source: 'channel',
          },
          {
            providerId: 'broken',
            modelId: 'x',
          },
        ],
        defaultProviderId: 'openai-codex',
        defaultModelId: 'gpt-5.4-codex',
      },
    });
    expect(data.models).toEqual([
      {
        providerId: 'openai-codex',
        modelId: 'gpt-5.4-codex',
        source: 'subscription',
        group: 'subscription',
        contextWindow: 272_000,
      },
      {
        providerId: 'custom-openai',
        modelId: 'grok-4.6',
        protocol: 'openai-compatible',
        source: 'channel',
        group: 'channel',
      },
    ]);
    expect(data.defaultProviderId).toBe('openai-codex');
  });
});
