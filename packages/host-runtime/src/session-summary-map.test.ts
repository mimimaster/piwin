import { describe, expect, it } from 'vitest';
import { indexRecordToSummary } from './session-summary-map.js';
import type { SessionIndexRecord } from '@piwin/contracts';

describe('indexRecordToSummary', () => {
  it('projects subagent runtime snapshot safe fields', () => {
    const record: SessionIndexRecord = {
      id: 'child-1',
      projectPath: '/tmp/project',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      workingDirectory: '/tmp/project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      parentSessionId: 'parent-1',
      depth: 1,
      kind: 'subagent',
      subagentRuntime: {
        profileId: 'explorer',
        model: {
          protocol: 'openai-compatible',
          providerId: 'cpa',
          modelId: 'fast-coder',
        },
        thinkingLevel: 'low',
        capabilities: ['read'],
        skillIds: [],
        isolation: 'readonly',
        workingDirectory: '/tmp/project',
      },
    };
    const summary = indexRecordToSummary(record);
    expect(summary.subagentProfileId).toBe('explorer');
    expect(summary.subagentModel?.modelId).toBe('fast-coder');
    expect(summary.subagentThinkingLevel).toBe('low');
    expect(summary.subagentMode).toBe('readonly');
  });

  it('projects subagent lifecycle state axes', () => {
    const record: SessionIndexRecord = {
      id: 'child-2',
      projectPath: '/tmp/project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      subagentLifecycle: {
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'applied',
      },
    };
    const summary = indexRecordToSummary(record);
    expect(summary.subagentExecutionStatus).toBe('completed');
    expect(summary.subagentSummaryStatus).toBe('merged');
    expect(summary.subagentIntegrationStatus).toBe('applied');
  });

  it('does not expose skill bodies or secrets from snapshot', () => {
    const record: SessionIndexRecord = {
      id: 'child-3',
      projectPath: '/tmp/project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      subagentRuntime: {
        profileId: 'implementer',
        capabilities: ['read', 'write', 'execute'],
        skillIds: ['skill-a', 'skill-b'],
        isolation: 'worktree',
        workingDirectory: '/tmp/worktree',
      },
    };
    const summary = indexRecordToSummary(record);
    expect(summary.subagentProfileId).toBe('implementer');
    expect(summary.subagentMode).toBe('worktree');
    // Summary never exposes skillIds or capabilities directly.
    expect('subagentSkillIds' in summary).toBe(false);
    expect('subagentCapabilities' in summary).toBe(false);
  });

  it('projects last composer model and thinking level', () => {
    const record: SessionIndexRecord = {
      id: 'main-1',
      projectPath: '/tmp/project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 2,
      model: {
        protocol: 'openai-compatible',
        providerId: 'custom-openai',
        modelId: 'deepseek-v4-flash',
      },
      thinkingLevel: 'medium',
    };
    const summary = indexRecordToSummary(record);
    expect(summary.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'custom-openai',
      modelId: 'deepseek-v4-flash',
    });
    expect(summary.thinkingLevel).toBe('medium');
  });

  it('projects non-local storage residency onto summaries', () => {
    const record: SessionIndexRecord = {
      id: 'main-off',
      projectPath: '/tmp/project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 4,
      isArchived: true,
      storage: {
        state: 'offloaded',
        packId: 'pack-1',
        packPath: '/tmp/packs/pack-1.piwin-pack',
        coldPreview: 'old chat',
      },
    };
    const summary = indexRecordToSummary(record);
    expect(summary.storage).toEqual(record.storage);
    const { storage: _ignored, ...localRecord } = record;
    expect(indexRecordToSummary(localRecord).storage).toBeUndefined();
  });
});
