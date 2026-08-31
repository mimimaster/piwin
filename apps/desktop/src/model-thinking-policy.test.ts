import { describe, expect, it } from 'vitest';
import {
  canUseThinkingLevel,
  getSupportedThinkingLevels,
  resolveThinkingLevelForModel,
} from './model-thinking-policy';

describe('model thinking policy', () => {
  it('returns explicit levels for an OpenAI-style list without max', () => {
    const model = {
      reasoning: true as const,
      thinkingLevels: ['off' as const, 'low' as const, 'medium' as const, 'high' as const],
    };
    expect(getSupportedThinkingLevels(model, false)).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
    expect(getSupportedThinkingLevels(model, true)).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
  });

  it('returns all levels for an Anthropic-style list including max', () => {
    const model = {
      reasoning: true as const,
      thinkingLevels: [
        'off' as const,
        'low' as const,
        'medium' as const,
        'high' as const,
        'max' as const,
      ],
    };
    expect(getSupportedThinkingLevels(model, false)).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'max',
    ]);
  });

  it('returns an empty list when the model has no thinkingLevels and no protocol', () => {
    expect(getSupportedThinkingLevels({ reasoning: true }, false)).toEqual([]);
    expect(getSupportedThinkingLevels({}, false)).toEqual([]);
    expect(getSupportedThinkingLevels(undefined, false)).toEqual([]);
  });

  it('uses protocol-based defaults when no explicit thinkingLevels are configured', () => {
    expect(
      getSupportedThinkingLevels({ reasoning: true, protocol: 'openai-compatible' }, false),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(
      getSupportedThinkingLevels(
        { reasoning: true, protocol: 'anthropic-compatible' },
        false,
      ),
    ).toEqual(['low', 'medium', 'high', 'max']);
    expect(
      getSupportedThinkingLevels({ reasoning: true, protocol: 'google-gemini' }, false),
    ).toEqual(['low', 'medium', 'high']);
  });

  it('infers default thinking levels for subscription providers without protocol', () => {
    expect(
      getSupportedThinkingLevels({ reasoning: true, providerId: 'openai-codex', source: 'subscription' }, false),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(
      getSupportedThinkingLevels({ reasoning: true, providerId: 'xai', source: 'subscription' }, false),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(
      getSupportedThinkingLevels({ reasoning: true, providerId: 'anthropic', source: 'subscription' }, false),
    ).toEqual(['low', 'medium', 'high', 'max']);
    expect(
      getSupportedThinkingLevels({ reasoning: true, providerId: 'kimi-coding', source: 'subscription' }, false),
    ).toEqual(['low', 'medium', 'high', 'max']);
  });

  it('prefers explicit thinkingLevels over protocol defaults', () => {
    expect(
      getSupportedThinkingLevels(
        {
          reasoning: true,
          protocol: 'openai-compatible',
          thinkingLevels: ['off', 'low', 'high'],
        },
        false,
      ),
    ).toEqual(['off', 'low', 'high']);
  });

  it('returns empty when reasoning is disabled even with protocol', () => {
    expect(
      getSupportedThinkingLevels({ reasoning: false, protocol: 'openai-compatible' }, false),
    ).toEqual([]);
  });

  it('hides reasoning levels when the model explicitly disables reasoning', () => {
    const model = {
      reasoning: false as const,
      thinkingLevels: ['off' as const, 'low' as const, 'high' as const],
    };
    expect(getSupportedThinkingLevels(model, false)).toEqual([]);
  });

  it('filters duplicates and invalid runtime values', () => {
    const model = {
      reasoning: true as const,
      thinkingLevels: [
        'off' as const,
        'low' as const,
        'low' as const,
        ('invalid' as unknown) as 'low',
        'high' as const,
      ],
    };
    expect(getSupportedThinkingLevels(model as typeof model, false)).toEqual([
      'off',
      'low',
      'high',
    ]);
  });

  it('always filters ultra from supported levels', () => {
    const model = {
      reasoning: true as const,
      thinkingLevels: ['off' as const, 'medium' as const, 'ultra' as const],
    };
    expect(getSupportedThinkingLevels(model, false)).toEqual(['off', 'medium']);
    expect(getSupportedThinkingLevels(model, true)).toEqual(['off', 'medium']);
  });

  it('resolves the requested level when supported', () => {
    const model = {
      reasoning: true as const,
      thinkingLevels: ['off' as const, 'low' as const, 'high' as const],
      thinkingLevel: 'low' as const,
    };
    expect(resolveThinkingLevelForModel(model, 'high', false)).toBe('high');
  });

  it('falls back to the configured default then the first level', () => {
    const model = {
      reasoning: true as const,
      thinkingLevels: ['off' as const, 'low' as const, 'high' as const],
      thinkingLevel: 'low' as const,
    };
    expect(resolveThinkingLevelForModel(model, 'max', false)).toBe('low');
    delete (model as { thinkingLevel?: 'low' }).thinkingLevel;
    expect(resolveThinkingLevelForModel(model, 'max', false)).toBe('off');
  });

  it('returns undefined for a model without configured levels', () => {
    expect(resolveThinkingLevelForModel(undefined, 'high', false)).toBeUndefined();
  });

  it('canUseThinkingLevel reflects the supported set', () => {
    const model = {
      reasoning: true as const,
      thinkingLevels: ['off' as const, 'high' as const],
    };
    expect(canUseThinkingLevel(model, 'high', false)).toBe(true);
    expect(canUseThinkingLevel(model, 'low', false)).toBe(false);
    expect(canUseThinkingLevel(model, 'ultra', false)).toBe(false);
  });
});
