import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_CAPABILITIES,
  type SubagentProfileSettings,
  type SubagentRuntimeSnapshot,
  type SubagentProfileSelector,
} from './subagent-profile.js';
import { createDefaultSubagentLifecycleState } from './subagent-lifecycle.js';
import { createDefaultSubagentConfig } from './config.js';

describe('SubagentProfileSettings', () => {
  it('accepts a minimal read-only profile', () => {
    const profile: SubagentProfileSettings = {
      id: 'explorer',
      description: 'Read-only codebase exploration',
      capabilities: ['read'],
      skillIds: [],
      isolation: 'readonly',
    };
    expect(profile.isolation).toBe('readonly');
    expect(profile.capabilities).toContain('read');
  });

  it('accepts a profile with a model ref and thinking level', () => {
    const profile: SubagentProfileSettings = {
      id: 'fast-explorer',
      description: 'Fast read-only exploration',
      model: {
        protocol: 'openai-compatible',
        providerId: 'local-provider',
        modelId: 'fast-coder',
      },
      thinkingLevel: 'low',
      capabilities: ['read'],
      isolation: 'readonly',
    };
    expect(profile.model?.modelId).toBe('fast-coder');
    expect(profile.thinkingLevel).toBe('low');
  });

  it('accepts a write+execute worktree profile without a model (inherits)', () => {
    const profile: SubagentProfileSettings = {
      id: 'implementer',
      description: 'Isolated implementation',
      capabilities: ['read', 'write', 'execute'],
      isolation: 'worktree',
    };
    expect(profile.model).toBeUndefined();
    expect(profile.isolation).toBe('worktree');
    expect(profile.capabilities).toEqual(['read', 'write', 'execute']);
  });
});

describe('SUBAGENT_CAPABILITIES', () => {
  it('enumerates all product capability ids', () => {
    expect(SUBAGENT_CAPABILITIES).toEqual([
      'read',
      'write',
      'execute',
      'network',
      'mcp',
      'browser',
      'planning',
      'delegate',
    ]);
  });
});

describe('SubagentProfileSelector', () => {
  it('allows per-call model and thinking overrides without a profile id', () => {
    const selector: SubagentProfileSelector = {
      model: {
        protocol: 'anthropic-compatible',
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
      },
      thinkingLevel: 'medium',
    };
    expect(selector.profileId).toBeUndefined();
    expect(selector.model?.modelId).toBe('claude-sonnet');
  });
});

describe('SubagentRuntimeSnapshot', () => {
  it('captures immutable runtime fields including working directory', () => {
    const snapshot: SubagentRuntimeSnapshot = {
      profileId: 'explorer',
      capabilities: ['read'],
      skillIds: [],
      isolation: 'readonly',
      workingDirectory: '/tmp/project',
    };
    expect(snapshot.workingDirectory).toBe('/tmp/project');
    expect(snapshot.isolation).toBe('readonly');
  });
});

describe('createDefaultSubagentConfig', () => {
  it('returns safe defaults matching the plan', () => {
    const config = createDefaultSubagentConfig();
    expect(config.profiles).toEqual([]);
    expect(config.maxConcurrency).toBe(4);
    expect(config.maxTasksPerRun).toBe(8);
    expect(config.processIsolation).toBe('required');
    expect(config.parallelWritePolicy).toBe('worktree-only');
    expect(config.dirtyBasePolicy).toBe('ask');
  });
});

describe('createDefaultSubagentLifecycleState', () => {
  it('starts queued with not-requested summary and integration', () => {
    const state = createDefaultSubagentLifecycleState();
    expect(state.executionStatus).toBe('queued');
    expect(state.summaryStatus).toBe('not-requested');
    expect(state.integrationStatus).toBe('not-requested');
  });
});
