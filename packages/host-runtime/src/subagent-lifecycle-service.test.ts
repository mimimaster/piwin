import { describe, expect, it } from 'vitest';
import {
  planSubagentSpawn,
  buildSubagentSeedPrompt,
  resolveSubagentChildPrompt,
  transitionExecutionStatus,
  transitionSummaryStatus,
  transitionIntegrationStatus,
} from './subagent-lifecycle-service.js';
import type { PiwinConfig } from '@piwin/contracts';
import { PIWIN_REPORT_CONTRACT_MARKER } from '@piwin/contracts';
import { PIWIN_REVIEW_PROVENANCE_MARKER } from './subagent-review-context.js';

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
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 0,
    },
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
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        dirtyBasePolicy: 'ask',
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

  it('rejects an unknown profile before workspace allocation', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'explore',
        selector: { profileId: 'missing-profile' },
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect(result).toEqual({ error: 'unknown profile "missing-profile"' });
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
      expect(result.snapshot.capabilities).toBeUndefined();
      expect(result.lifecycle.executionStatus).toBe('queued');
      expect(result.lifecycle.summaryStatus).toBe('not-requested');
      expect(result.lifecycle.integrationStatus).toBe('not-requested');
      expect(result.spawnOptions.deliveryIntent).toBe('report');
      expect(result.spawnOptions.applyPolicy).toBe('none');
      expect(result.legacyManual).toBe(false);
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
      expect(result.snapshot.capabilities).toBeUndefined();
      expect(result.spawnOptions.deliveryIntent).toBe('integrate');
      expect(result.spawnOptions.applyPolicy).toBe('auto');
      expect(result.legacyManual).toBe(false);
    }
  });

  it('keeps explicit auto as integrate/auto on worktree', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'implement feature X',
        selector: { profileId: 'implementer' },
        applyPolicy: 'auto',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.spawnOptions.deliveryIntent).toBe('integrate');
      expect(result.spawnOptions.applyPolicy).toBe('auto');
      expect(result.legacyManual).toBe(false);
    }
  });

  it('marks explicit none as legacy manual without a user candidate', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'implement feature X',
        selector: { profileId: 'implementer' },
        applyPolicy: 'none',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.spawnOptions.deliveryIntent).toBe('integrate');
      expect(result.spawnOptions.applyPolicy).toBe('none');
      expect(result.legacyManual).toBe(true);
    }
  });

  it('does not treat retainWorktree as skip-integrate', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'implement feature X',
        selector: { profileId: 'implementer' },
        applyPolicy: 'auto',
        retainWorktree: true,
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.spawnOptions.deliveryIntent).toBe('integrate');
      expect(result.spawnOptions.applyPolicy).toBe('auto');
      expect(result.spawnOptions.retainWorktree).toBe(true);
    }
  });

  it('rejects report intent on worktree isolation', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'implement feature X',
        selector: { profileId: 'implementer' },
        deliveryIntent: 'report',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect(result).toMatchObject({
      error: 'report deliveryIntent is incompatible with worktree isolation',
      code: 'report-with-write',
    });
  });

  it('rejects integrate intent on readonly isolation', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'review only',
        selector: { profileId: 'explorer' },
        deliveryIntent: 'integrate',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect(result).toMatchObject({
      error: 'integrate deliveryIntent is incompatible with readonly isolation',
      code: 'write-intent-readonly',
    });
  });

  it('maps historical Plan auto on reviewer/explorer to report/none', () => {
    for (const profileId of ['reviewer', 'explorer'] as const) {
      const result = planSubagentSpawn({
        config: makeConfig(),
        request: {
          parentSessionId: 'parent-1',
          task: 'review the change',
          selector: { profileId },
          applyPolicy: 'auto',
          source: 'plan',
        },
        parentDepth: 0,
        parentKind: 'main',
        workingDirectory: '/tmp/project',
        enabledSkillIds: [],
      });
      expect('error' in result, profileId).toBe(false);
      if (!('error' in result)) {
        expect(result.snapshot.isolation).toBe('readonly');
        expect(result.spawnOptions.deliveryIntent).toBe('report');
        expect(result.spawnOptions.applyPolicy).toBe('none');
        expect(result.legacyManual).toBe(false);
      }
    }
  });

  it('keeps Plan auto as integrate/auto for implementer worktree', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'implement feature X',
        selector: { profileId: 'implementer' },
        applyPolicy: 'auto',
        source: 'plan',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.isolation).toBe('worktree');
      expect(result.spawnOptions.deliveryIntent).toBe('integrate');
      expect(result.spawnOptions.applyPolicy).toBe('auto');
      expect(result.legacyManual).toBe(false);
    }
  });

  it('rejects profile-without-mode integrate once isolation resolves readonly', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'review only',
        selector: { profileId: 'explorer' },
        deliveryIntent: 'integrate',
        source: 'model-tool',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect(result).toMatchObject({
      code: 'write-intent-readonly',
    });
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

  it('allows an explicit worktree request without requiring a profile', () => {
    const result = planSubagentSpawn({
      config: makeConfig(),
      request: {
        parentSessionId: 'parent-1',
        task: 'implement the requested change',
        selector: {},
        mode: 'worktree',
        deliveryIntent: 'integrate',
        source: 'model-tool',
      },
      parentDepth: 0,
      parentKind: 'main',
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.snapshot.profileId).toBeUndefined();
      expect(result.snapshot.isolation).toBe('worktree');
      expect(result.spawnOptions.deliveryIntent).toBe('integrate');
      expect(result.spawnOptions.applyPolicy).toBe('auto');
    }
  });
});

describe('buildSubagentSeedPrompt', () => {
  it('prefixes readonly tasks with readonly warning', () => {
    const prompt = buildSubagentSeedPrompt('explore the code', {
      isolation: 'readonly',
    });
    expect(prompt).toContain('READONLY');
    expect(prompt).toContain('explore the code');
  });

  it('prefixes worktree tasks with worktree warning', () => {
    const prompt = buildSubagentSeedPrompt('implement feature', {
      isolation: 'worktree',
    });
    expect(prompt).toContain('WORKTREE');
    expect(prompt).toContain('implement feature');
  });

  it('prepends a report contract block when provided', () => {
    const prompt = buildSubagentSeedPrompt(
      'find auth middleware',
      { isolation: 'readonly' },
      { reportContract: 'First line: complete | partial | blocked.' },
    );
    expect(prompt).toContain(PIWIN_REPORT_CONTRACT_MARKER);
    expect(prompt).toContain('First line: complete | partial | blocked.');
    expect(prompt).toContain('find auth middleware');
    expect(prompt.indexOf(PIWIN_REPORT_CONTRACT_MARKER)).toBeLessThan(
      prompt.indexOf('find auth middleware'),
    );
  });

  it('injects Host-authored review provenance before the task text', () => {
    const prompt = buildSubagentSeedPrompt(
      'judge the candidate',
      { isolation: 'readonly' },
      {
        reviewProvenance: `${PIWIN_REVIEW_PROVENANCE_MARKER}\nHost-authored review evidence.`,
      },
    );
    expect(prompt).toContain(PIWIN_REVIEW_PROVENANCE_MARKER);
    expect(prompt.indexOf(PIWIN_REVIEW_PROVENANCE_MARKER)).toBeLessThan(
      prompt.indexOf('judge the candidate'),
    );
    expect(prompt).toContain('---\njudge the candidate');
  });
});

describe('resolveSubagentChildPrompt', () => {
  it('wraps initial tasks and leaves continuations raw', () => {
    const initial = resolveSubagentChildPrompt({
      task: 'scout the repo',
      isolationOverride: 'readonly',
      reportContract: 'Return citations only.',
    });
    expect(initial).toContain(PIWIN_REPORT_CONTRACT_MARKER);
    expect(initial).toContain('scout the repo');

    const continuation = resolveSubagentChildPrompt({
      task: 'look at the follow-up file',
      isolationOverride: 'readonly',
      reportContract: 'Return citations only.',
      continuationSessionId: 'child-1',
    });
    expect(continuation).toBe('look at the follow-up file');
  });

  it('injects Host review provenance on first reviewer prompts only', () => {
    const initial = resolveSubagentChildPrompt({
      task: 'judge the candidate',
      isolationOverride: 'readonly',
      reviewTarget: {
        result: { resultId: 'result-1', revision: 1 },
        changes: { changeSetId: 'cs-child', revision: 1 },
      },
    });
    expect(initial).toContain(PIWIN_REVIEW_PROVENANCE_MARKER);
    expect(initial).toContain('---\njudge the candidate');

    const continuation = resolveSubagentChildPrompt({
      task: 'look again',
      isolationOverride: 'readonly',
      continuationSessionId: 'child-1',
      reviewTarget: {
        result: { resultId: 'result-1', revision: 1 },
        changes: { changeSetId: 'cs-child', revision: 1 },
      },
    });
    expect(continuation).toBe('look again');
  });
});

describe('lifecycle state transitions', () => {
  it('transitions execution status without mutating input', () => {
    const state = {
      executionStatus: 'queued',
      summaryStatus: 'not-requested',
      integrationStatus: 'not-requested',
    } as const;
    const next = transitionExecutionStatus(state, 'running');
    expect(next.executionStatus).toBe('running');
    expect(state.executionStatus).toBe('queued');
  });

  it('transitions summary status', () => {
    const state = {
      executionStatus: 'completed',
      summaryStatus: 'pending',
      integrationStatus: 'not-requested',
    } as const;
    const next = transitionSummaryStatus(state, 'merged');
    expect(next.summaryStatus).toBe('merged');
  });

  it('transitions integration status', () => {
    const state = {
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'pending',
    } as const;
    const next = transitionIntegrationStatus(state, 'applied');
    expect(next.integrationStatus).toBe('applied');
  });
});

describe('worktree seed prompt dependency guidance', () => {
  it('reports the Host dependency install to worktree children only', () => {
    const lease = {
      mode: 'worktree' as const,
      cwd: '/wt',
      parentRepoPath: '/repo',
      worktreePath: '/wt',
      worktreeBranch: 'piwin/subagent/x',
      baseCommit: 'abc',
      dependencySetup: { status: 'installed' as const, manager: 'pnpm' as const },
    };
    const worktreePrompt = resolveSubagentChildPrompt(
      { task: 'implement it', isolationOverride: 'worktree' },
      lease,
    );
    expect(worktreePrompt).toContain('installed in this worktree by the Host (pnpm)');
    expect(worktreePrompt).toContain('Never symlink node_modules');

    const readonlyPrompt = resolveSubagentChildPrompt({ task: 'look', isolationOverride: 'readonly' });
    expect(readonlyPrompt).not.toContain('node_modules');
  });
});
