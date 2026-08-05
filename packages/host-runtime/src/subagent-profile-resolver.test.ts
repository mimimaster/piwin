import { describe, expect, it } from 'vitest';
import {
  resolveSubagentProfiles,
  resolveSubagentProfile,
  resolveSubagentModel,
  resolveSubagentThinking,
  resolveSubagentIsolation,
  resolveSubagentCapabilities,
  resolveSubagentSkillIds,
  buildSubagentRuntimeSnapshot,
  validateProfileModel,
  validateProfileCapabilities,
} from './subagent-profile-resolver.js';
import { BUILTIN_SUBAGENT_PROFILES } from './subagent-profile-defaults.js';
import type {
  PiwinConfig,
  SubagentProfileSettings,
  SubagentProfileSelector,
} from '@piwin/contracts';

function makeConfig(overrides: Partial<PiwinConfig> = {}): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'local-provider',
        protocol: 'openai-compatible',
        name: 'Local',
        baseUrl: 'http://localhost:1234/v1',
        models: [{ id: 'fast-coder' }, { id: 'slow-coder' }],
      },
    ],
    media: { maxPasteBytes: 0, allowedMimeTypes: [] },
    artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 0 },
    ...overrides,
  };
}

describe('resolveSubagentProfiles', () => {
  it('returns built-ins when Settings has no custom profiles', () => {
    const config = makeConfig();
    const profiles = resolveSubagentProfiles(config);
    expect(profiles.map((p) => p.id)).toEqual(
      BUILTIN_SUBAGENT_PROFILES.map((p) => p.id),
    );
    for (const profile of profiles) {
      expect(profile.source).toBe('builtin');
    }
  });

  it('merges settings profiles over built-ins by id', () => {
    const customExplorer: SubagentProfileSettings = {
      id: 'explorer',
      description: 'My custom explorer',
      capabilities: ['read', 'network'],
      isolation: 'readonly',
    };
    const config = makeConfig({
      subagents: {
        profiles: [customExplorer],
        maxConcurrency: 4,
        maxTasksPerRun: 8,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        dirtyBasePolicy: 'ask',
      },
    });
    const profiles = resolveSubagentProfiles(config);
    const explorer = profiles.find((p) => p.id === 'explorer');
    expect(explorer?.description).toBe('My custom explorer');
    expect(explorer?.source).toBe('settings');
    expect(explorer?.capabilities).toContain('network');
  });

  it('appends settings-only profiles after built-ins in stable order', () => {
    const custom: SubagentProfileSettings = {
      id: 'custom-1',
      description: 'Custom profile',
      capabilities: ['read'],
      isolation: 'readonly',
    };
    const config = makeConfig({
      subagents: {
        profiles: [custom],
        maxConcurrency: 4,
        maxTasksPerRun: 8,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        dirtyBasePolicy: 'ask',
      },
    });
    const profiles = resolveSubagentProfiles(config);
    const builtinIds = BUILTIN_SUBAGENT_PROFILES.map((p) => p.id);
    const customIdx = profiles.findIndex((p) => p.id === 'custom-1');
    for (const id of builtinIds) {
      const idx = profiles.findIndex((p) => p.id === id);
      expect(idx).toBeLessThan(customIdx);
    }
  });
});

describe('resolveSubagentProfile', () => {
  it('returns the requested profile by id', () => {
    const config = makeConfig();
    const selector: SubagentProfileSelector = { profileId: 'explorer' };
    const result = resolveSubagentProfile(config, selector);
    expect(result.profile?.id).toBe('explorer');
    expect(result.issues).toEqual([]);
  });

  it('falls back to defaultProfileId when selector omits profileId', () => {
    const config = makeConfig({
      subagents: {
        profiles: [],
        defaultProfileId: 'reviewer',
        maxConcurrency: 4,
        maxTasksPerRun: 8,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        dirtyBasePolicy: 'ask',
      },
    });
    const result = resolveSubagentProfile(config, {});
    expect(result.profile?.id).toBe('reviewer');
  });

  it('returns undefined profile when no profileId and no default', () => {
    const config = makeConfig();
    const result = resolveSubagentProfile(config, {});
    expect(result.profile).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it('reports issue for unknown profile id', () => {
    const config = makeConfig();
    const result = resolveSubagentProfile(config, { profileId: 'nope' });
    expect(result.profile).toBeUndefined();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('nope');
  });

  it('reports issue when profile model references unknown provider', () => {
    const custom: SubagentProfileSettings = {
      id: 'bad-model',
      description: 'Bad model ref',
      model: {
        protocol: 'openai-compatible',
        providerId: 'missing-provider',
        modelId: 'missing-model',
      },
      capabilities: ['read'],
      isolation: 'readonly',
    };
    const config = makeConfig({
      subagents: {
        profiles: [custom],
        maxConcurrency: 4,
        maxTasksPerRun: 8,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        dirtyBasePolicy: 'ask',
      },
    });
    const result = resolveSubagentProfile(config, { profileId: 'bad-model' });
    expect(result.profile).toBeDefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('resolveSubagentModel', () => {
  it('uses per-call model over profile model', () => {
    const profile = BUILTIN_SUBAGENT_PROFILES[0];
    const selector: SubagentProfileSelector = {
      model: {
        protocol: 'openai-compatible',
        providerId: 'local-provider',
        modelId: 'fast-coder',
      },
    };
    expect(resolveSubagentModel(profile, selector)?.modelId).toBe('fast-coder');
  });

  it('uses profile model when no per-call model', () => {
    const profile: SubagentProfileSettings = {
      id: 'with-model',
      description: 'Has model',
      model: {
        protocol: 'openai-compatible',
        providerId: 'local-provider',
        modelId: 'slow-coder',
      },
      capabilities: ['read'],
      isolation: 'readonly',
    };
    expect(resolveSubagentModel(profile, {})?.modelId).toBe('slow-coder');
  });

  it('returns undefined when neither per-call nor profile model', () => {
    expect(resolveSubagentModel(undefined, {})).toBeUndefined();
  });
});

describe('resolveSubagentIsolation', () => {
  it('caller can make worktree profile stricter (readonly)', () => {
    const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.id === 'implementer');
    expect(resolveSubagentIsolation(profile, 'readonly')).toBe('readonly');
  });

  it('caller cannot widen readonly profile to worktree', () => {
    const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.id === 'explorer');
    expect(resolveSubagentIsolation(profile, 'worktree')).toBe('readonly');
  });

  it('defaults to profile isolation when caller omits mode', () => {
    const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.id === 'implementer');
    expect(resolveSubagentIsolation(profile, undefined)).toBe('worktree');
  });
});

describe('resolveSubagentCapabilities', () => {
  it('uses profile capabilities when caller omits', () => {
    const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.id === 'implementer');
    const caps = resolveSubagentCapabilities(profile, undefined);
    expect(caps).toEqual(['read', 'write', 'execute']);
  });

  it('intersects caller capabilities with profile (caller cannot widen)', () => {
    const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.id === 'explorer');
    const caps = resolveSubagentCapabilities(profile, ['read', 'write']);
    expect(caps).toEqual(['read']);
  });

  it('returns caller capabilities when no profile', () => {
    const caps = resolveSubagentCapabilities(undefined, ['read']);
    expect(caps).toEqual(['read']);
  });
});

describe('resolveSubagentSkillIds', () => {
  it('filters profile skillIds by globally enabled skills', () => {
    const profile: SubagentProfileSettings = {
      id: 'with-skills',
      description: 'Has skills',
      skillIds: ['skill-a', 'skill-b', 'skill-c'],
      capabilities: ['read'],
      isolation: 'readonly',
    };
    const result = resolveSubagentSkillIds(profile, ['skill-a', 'skill-c']);
    expect(result).toEqual(['skill-a', 'skill-c']);
  });

  it('returns undefined when profile has no skillIds', () => {
    expect(resolveSubagentSkillIds(undefined, ['skill-a'])).toBeUndefined();
  });
});

describe('buildSubagentRuntimeSnapshot', () => {
  it('captures all resolved fields', () => {
    const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.id === 'implementer');
    const snapshot = buildSubagentRuntimeSnapshot({
      profile,
      selector: {
        model: {
          protocol: 'openai-compatible',
          providerId: 'local-provider',
          modelId: 'fast-coder',
        },
        thinkingLevel: 'medium',
      },
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect(snapshot.profileId).toBe('implementer');
    expect(snapshot.model?.modelId).toBe('fast-coder');
    expect(snapshot.thinkingLevel).toBe('medium');
    expect(snapshot.isolation).toBe('worktree');
    expect(snapshot.capabilities).toEqual(['read', 'write', 'execute']);
    expect(snapshot.workingDirectory).toBe('/tmp/project');
  });

  it('uses readonly default when no profile', () => {
    const snapshot = buildSubagentRuntimeSnapshot({
      profile: undefined,
      selector: {},
      workingDirectory: '/tmp/project',
      enabledSkillIds: [],
    });
    expect(snapshot.isolation).toBe('readonly');
    expect(snapshot.profileId).toBeUndefined();
  });
});

describe('validateProfileModel', () => {
  it('returns no issues for valid model ref', () => {
    const profile: SubagentProfileSettings = {
      id: 'p',
      description: 'd',
      model: {
        protocol: 'openai-compatible',
        providerId: 'local-provider',
        modelId: 'fast-coder',
      },
      capabilities: ['read'],
      isolation: 'readonly',
    };
    const config = makeConfig();
    expect(validateProfileModel(profile, config.providers)).toEqual([]);
  });

  it('returns issue for unknown provider', () => {
    const profile: SubagentProfileSettings = {
      id: 'p',
      description: 'd',
      model: {
        protocol: 'openai-compatible',
        providerId: 'nope',
        modelId: 'fast-coder',
      },
      capabilities: ['read'],
      isolation: 'readonly',
    };
    const config = makeConfig();
    const issues = validateProfileModel(profile, config.providers);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('nope');
  });
});

describe('validateProfileCapabilities', () => {
  it('returns no issues for valid capabilities', () => {
    const profile: SubagentProfileSettings = {
      id: 'p',
      description: 'd',
      capabilities: ['read', 'write'],
      isolation: 'worktree',
    };
    expect(validateProfileCapabilities(profile)).toEqual([]);
  });

  it('returns issue for unknown capability', () => {
    const profile = {
      id: 'p',
      description: 'd',
      capabilities: ['read', 'bogus'],
      isolation: 'readonly',
    } as unknown as SubagentProfileSettings;
    const issues = validateProfileCapabilities(profile);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('bogus');
  });
});
