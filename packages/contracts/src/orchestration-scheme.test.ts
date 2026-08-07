import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ULTRA_CODE_SCHEME,
  ORCHESTRATION_SCHEME_OFF_ID,
  OrchestrationSchemeError,
  applySchemeToSubagentSpawnInput,
  clampThinkingLevelToMax,
  compareThinkingLevel,
  formatOrchestrationSchemePreamble,
  listOrchestrationSchemes,
  mergeOrchestrationSchemeIntoPrompt,
  resolveOrchestrationScheme,
} from './orchestration-scheme.js';
import type { OrchestrationSchemeConfigSlice, OrchestrationSchemeSettings } from './orchestration-scheme.js';

function baseConfig(
  overrides?: Partial<OrchestrationSchemeConfigSlice> & {
    schemes?: OrchestrationSchemeSettings[];
  },
): OrchestrationSchemeConfigSlice {
  return {
    maxConcurrency: 4,
    maxTasksPerRun: 8,
    ...(overrides ?? {}),
  };
}

describe('resolveOrchestrationScheme', () => {
  it('returns undefined for off / omit / empty', () => {
    const config = baseConfig();
    expect(resolveOrchestrationScheme(config, undefined)).toBeUndefined();
    expect(resolveOrchestrationScheme(config, ORCHESTRATION_SCHEME_OFF_ID)).toBeUndefined();
    expect(resolveOrchestrationScheme(config, '  ')).toBeUndefined();
    expect(resolveOrchestrationScheme(config, 'off')).toBeUndefined();
  });

  it('resolves builtin ultra-code with clamps', () => {
    const config = baseConfig({ maxConcurrency: 4, maxTasksPerRun: 8 });
    const resolved = resolveOrchestrationScheme(config, 'ultra-code', {
      knownProfileIds: ['explorer', 'reviewer'],
    });
    expect(resolved?.schemeId).toBe('ultra-code');
    expect(resolved?.defaultProfileId).toBe('explorer');
    expect(resolved?.exposeSpawnMetadata).toBe(false);
    expect(resolved?.maxConcurrency).toBe(4); // min(6, 4)
    expect(resolved?.maxTasksPerRun).toBe(8);
    expect(resolved?.maxSubagentThinkingLevel).toBe('low');
    expect(resolved?.systemPreamble.length).toBeGreaterThan(20);
    expect(resolved?.scheme.source).toBe('builtin');
  });

  it('throws on unknown scheme id (never silent off)', () => {
    const config = baseConfig();
    expect(() => resolveOrchestrationScheme(config, 'nope')).toThrow(OrchestrationSchemeError);
    try {
      resolveOrchestrationScheme(config, 'nope');
    } catch (error) {
      expect(error).toBeInstanceOf(OrchestrationSchemeError);
      expect((error as OrchestrationSchemeError).code).toBe('unknown-scheme');
    }
  });

  it('throws when default profile is unknown', () => {
    const config = baseConfig();
    expect(() =>
      resolveOrchestrationScheme(config, 'ultra-code', { knownProfileIds: ['reviewer'] }),
    ).toThrow(/unknown profile/);
  });

  it('merges settings override for ultra-code', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'ultra-code',
          name: 'Ultra Custom',
          description: 'override',
          defaultProfileId: 'explorer',
          exposeSpawnMetadata: true,
          waitPolicy: 'await-all',
          systemPreamble: 'custom preamble for ultra',
          maxConcurrency: 2,
        },
      ],
    });
    const resolved = resolveOrchestrationScheme(config, 'ultra-code', {
      knownProfileIds: ['explorer'],
    });
    expect(resolved?.scheme.name).toBe('Ultra Custom');
    expect(resolved?.exposeSpawnMetadata).toBe(true);
    expect(resolved?.scheme.source).toBe('settings');
    expect(resolved?.maxConcurrency).toBe(2);
  });

  it('lists custom schemes after builtins', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'my-review',
          name: 'My Review',
          description: 'custom',
          defaultProfileId: 'reviewer',
          exposeSpawnMetadata: true,
          waitPolicy: 'await-all',
          systemPreamble: 'review carefully',
        },
      ],
    });
    const list = listOrchestrationSchemes(config);
    expect(list.map((item) => item.id)).toEqual(['ultra-code', 'my-review']);
  });
});

describe('thinking clamp helpers', () => {
  it('orders thinking levels', () => {
    expect(compareThinkingLevel('low', 'high')).toBeLessThan(0);
    expect(compareThinkingLevel('ultra', 'max')).toBeGreaterThan(0);
  });

  it('clamps to max', () => {
    expect(clampThinkingLevelToMax('high', 'low')).toBe('low');
    expect(clampThinkingLevelToMax('minimal', 'low')).toBe('minimal');
    expect(clampThinkingLevelToMax(undefined, 'low')).toBe('low');
  });
});

describe('preamble merge', () => {
  it('prefixes model-facing text without losing user body', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), 'ultra-code', {
      knownProfileIds: ['explorer'],
    })!;
    const merged = mergeOrchestrationSchemeIntoPrompt(resolved, 'find the bug');
    expect(merged.startsWith('[piwin-scheme:ultra-code]')).toBe(true);
    expect(merged.includes('find the bug')).toBe(true);
    expect(formatOrchestrationSchemePreamble(resolved)).toContain(BUILTIN_ULTRA_CODE_SCHEME.id);
  });
});

describe('applySchemeToSubagentSpawnInput', () => {
  it('forces default profile and clears model when generic', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), 'ultra-code', {
      knownProfileIds: ['explorer'],
    })!;
    const applied = applySchemeToSubagentSpawnInput(resolved, {
      profileId: 'implementer',
      model: { protocol: 'openai-compatible', providerId: 'x', modelId: 'y' },
      thinkingLevel: 'high',
    });
    expect(applied.profileId).toBe('explorer');
    expect(applied.forcedProfile).toBe(true);
    expect(applied.clearedModel).toBe(true);
    expect(applied.thinkingLevel).toBe('low');
  });

  it('passes through when no scheme', () => {
    const applied = applySchemeToSubagentSpawnInput(undefined, {
      profileId: 'reviewer',
      thinkingLevel: 'medium',
    });
    expect(applied.profileId).toBe('reviewer');
    expect(applied.thinkingLevel).toBe('medium');
    expect(applied.forcedProfile).toBe(false);
  });
});
