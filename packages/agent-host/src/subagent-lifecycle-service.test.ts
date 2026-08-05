import { describe, expect, it } from 'vitest';
import {
  planSubagentSpawn,
  buildSubagentSeedPrompt,
  transitionExecutionStatus,
  transitionSummaryStatus,
  transitionIntegrationStatus,
} from './subagent-lifecycle-service.js';
import type { PiwinConfig } from '@piwin/contracts';

function makeConfig(overrides: Partial<PiwinConfig> = {}): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'local-provider',
        protocol: 'openai-compatible',
        name: 'Local',
        baseUrl: 'http://localhost:1234/v1',
        models: [{ id: 'fast-coder' }],
      },
    ],
    media: { maxPasteBytes: 0, allowedMimeTypes: [] },
    artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 0 },
    ...overrides,
  };
}

describe('planSubagentSpawn', () => {
  it('rejects nested subagent (depth >= 1)', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'do something',
        selector: {},
      },
      parentDepth: 1,
      parentKind: 'subagent',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('depth max is 1');
    }
  });

  it('rejects empty task', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: '   ',
        selector: {},
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('task is required');
    }
  });

  it('rejects profile with unknown provider in model ref', () => {
    const config = makeConfig({
      subagents: {
        profiles: [
          {
            id: 'bad',
            description: 'Bad model',
            model: {
              protocol: 'openai-compatible',
              providerId: 'missing',
              modelId: 'missing',
            },
            capabilities: ['read'],
            isolation: 'readonly',
          },
        ],
        maxConcurrency: 4,
        maxTasksPerRun: 8,
        maxParallelWriteTasks: 4,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        requireCleanBaseForParallelWrites: true,
      },
    });
    const result = planSubagentSpawn({
      config,
      request: {
        parentSessionId: 'parent-1',
        task: 'explore',
        selector: { profileId: 'bad' },
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('missing');
    }
  });

  it('resolves explorer profile with readonly isolation', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'explore the codebase',
        selector: { profileId: 'explorer' },
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.profileId).toBe('explorer');
      expect(result.snapshot.isolation).toBe('readonly');
      expect(result.snapshot.capabilities).toEqual(['read']);
      expect(result.lifecycle.executionStatus).toBe('queued');
      expect(result.lifecycle.summaryStatus).toBe('not-requested');
      expect(result.lifecycle.integrationStatus).toBe('not-requested');
    }
  });

  it('resolves implementer profile with worktree isolation', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'implement feature X',
        selector: { profileId: 'implementer' },
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.isolation).toBe('worktree');
      expect(result.snapshot.capabilities).toEqual(['read', 'write', 'execute']);
    }
  });

  it('per-call model overrides profile model', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'explore',
        selector: {
          profileId: 'explorer',
          model: {
            protocol: 'openai-compatible',
            providerId: 'local-provider',
            modelId: 'fast-coder',
          },
        },
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.model?.modelId).toBe('fast-coder');
      expect(result.createInput.model?.modelId).toBe('fast-coder');
    }
  });

  it('per-call thinking level overrides profile thinking', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'explore',
        selector: { profileId: 'explorer', thinkingLevel: 'high' },
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.thinkingLevel).toBe('high');
      expect(result.createInput.thinkingLevel).toBe('high');
    }
  });

  it('caller can make worktree profile stricter (readonly)', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'review only',
        selector: { profileId: 'implementer' },
        mode: 'readonly',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.isolation).toBe('readonly');
    }
  });

  it('legacy spawn without profile uses readonly default', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'do a thing',
        selector: {},
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.profileId).toBeUndefined();
      expect(result.snapshot.isolation).toBe('readonly');
    }
  });
});

describe('buildSubagentSeedPrompt', () => {
  it('prefixes readonly tasks with readonly warning', () => {
    const prompt = buildSubagentSeedPrompt('explore the code', {
      isolation: 'readonly',
      workingDirectory: '/tmp/project',
    });
    expect(prompt).toContain('READONLY');
    expect(prompt).toContain('explore the code');
  });

  it('prefixes worktree tasks with worktree warning', () => {
    const prompt = buildSubagentSeedPrompt('implement feature', {
      isolation: 'worktree',
      workingDirectory: '/tmp/worktree',
    });
    expect(prompt).toContain('WORKTREE');
    expect(prompt).toContain('implement feature');
  });
});

describe('lifecycle state transitions', () => {
  it('transitions execution status without mutating input', () => {
    const state = { executionStatus: 'queued', summaryStatus: 'not-requested', integrationStatus: 'not-requested' } as const;
    const next = transitionExecutionStatus(state, 'running');
    expect(next.executionStatus).toBe('running');
    expect(state.executionStatus).toBe('queued');
  });

  it('transitions summary status', () => {
    const state = { executionStatus: 'completed', summaryStatus: 'pending', integrationStatus: 'not-requested' } as const;
    const next = transitionSummaryStatus(state, 'merged');
    expect(next.summaryStatus).toBe('merged');
  });

  it('transitions integration status', () => {
    const state = { executionStatus: 'completed', summaryStatus: 'merged', integrationStatus: 'pending' } as const;
    const next = transitionIntegrationStatus(state, 'applied');
    expect(next.integrationStatus).toBe('applied');
  });
});
