import { describe, expect, it } from 'vitest';
import {
  formatComposerModelKey,
  findComposerModelByKey,
  resolveBootstrapSelectedModelKey,
  resolveComposerModelSelection,
  shouldPreserveComposerModelPicker,
} from './composer-model-selection-policy.js';

const modelOptions = [
  { providerId: 'acme', modelId: 'gpt-a', protocol: 'openai-compatible' as const },
  { providerId: 'acme', modelId: 'gpt-b', protocol: 'openai-compatible' as const },
];

describe('formatComposerModelKey', () => {
  it('joins provider and model with the composer delimiter', () => {
    expect(formatComposerModelKey('acme', 'gpt-a')).toBe('acme::gpt-a');
  });
});

describe('findComposerModelByKey', () => {
  it('returns undefined for an empty key', () => {
    expect(findComposerModelByKey(modelOptions, '')).toBeUndefined();
  });
});

describe('shouldPreserveComposerModelPicker', () => {
  it('preserves a valid pick in draft mode (no active session)', () => {
    expect(
      shouldPreserveComposerModelPicker({
        sessionChanged: false,
        activeSessionId: null,
        selectedModelKey: 'acme::gpt-b',
        modelOptions,
      }),
    ).toBe(true);
  });

  it('preserves a valid pick on the same active session', () => {
    expect(
      shouldPreserveComposerModelPicker({
        sessionChanged: false,
        activeSessionId: 'session-1',
        selectedModelKey: 'acme::gpt-b',
        modelOptions,
      }),
    ).toBe(true);
  });

  it('re-resolves when switching sessions', () => {
    expect(
      shouldPreserveComposerModelPicker({
        sessionChanged: true,
        activeSessionId: 'session-2',
        selectedModelKey: 'acme::gpt-b',
        modelOptions,
      }),
    ).toBe(false);
  });

  it('allows initial default resolve for an empty draft composer', () => {
    expect(
      shouldPreserveComposerModelPicker({
        sessionChanged: false,
        activeSessionId: null,
        selectedModelKey: '',
        modelOptions,
      }),
    ).toBe(false);
  });

  it('re-resolves when the selected model disappeared from the catalog', () => {
    expect(
      shouldPreserveComposerModelPicker({
        sessionChanged: false,
        activeSessionId: 'session-1',
        selectedModelKey: 'acme::removed',
        modelOptions,
      }),
    ).toBe(false);
  });

  it('keeps an empty key on a live session without thrashing', () => {
    expect(
      shouldPreserveComposerModelPicker({
        sessionChanged: false,
        activeSessionId: 'session-1',
        selectedModelKey: '',
        modelOptions,
      }),
    ).toBe(true);
  });
});

describe('resolveBootstrapSelectedModelKey', () => {
  it('keeps a user pick when host config arrives late', () => {
    expect(resolveBootstrapSelectedModelKey('acme::gpt-b', 'acme', 'gpt-a')).toBe('acme::gpt-b');
  });

  it('seeds the default when nothing is selected yet', () => {
    expect(resolveBootstrapSelectedModelKey('', 'acme', 'gpt-a')).toBe('acme::gpt-a');
  });
});

describe('resolveComposerModelSelection', () => {
  it('applies the session model when switching into a session', () => {
    expect(
      resolveComposerModelSelection({
        sessionChanged: true,
        activeSessionId: 'session-1',
        selectedModelKey: '',
        modelOptions,
        activeSessionModel: {
          providerId: 'acme',
          modelId: 'gpt-b',
          protocol: 'openai-compatible',
        },
        activeSessionThinkingLevel: 'high',
      }),
    ).toEqual({
      kind: 'apply',
      modelKey: 'acme::gpt-b',
      thinkingLevel: 'high',
      markSessionId: 'session-1',
    });
  });

  it('preserves a draft pick instead of falling back to defaults', () => {
    expect(
      resolveComposerModelSelection({
        sessionChanged: false,
        activeSessionId: null,
        selectedModelKey: 'acme::gpt-b',
        modelOptions,
        composerProfileModel: {
          providerId: 'acme',
          modelId: 'gpt-a',
          protocol: 'openai-compatible',
        },
        defaultProviderId: 'acme',
        defaultModelId: 'gpt-a',
      }),
    ).toEqual({ kind: 'preserve' });
  });

  it('seeds composerProfile/default for an empty draft composer', () => {
    expect(
      resolveComposerModelSelection({
        sessionChanged: false,
        activeSessionId: null,
        selectedModelKey: '',
        modelOptions,
        composerProfileModel: {
          providerId: 'acme',
          modelId: 'gpt-b',
          protocol: 'openai-compatible',
        },
        composerProfileThinkingLevel: 'medium',
        defaultProviderId: 'acme',
        defaultModelId: 'gpt-a',
      }),
    ).toEqual({
      kind: 'apply',
      modelKey: 'acme::gpt-b',
      thinkingLevel: 'medium',
      markSessionId: null,
    });
  });

  it('restores the session model after a catalog refresh drops the current pick', () => {
    expect(
      resolveComposerModelSelection({
        sessionChanged: false,
        activeSessionId: 'session-1',
        selectedModelKey: 'acme::removed',
        modelOptions,
        activeSessionModel: {
          providerId: 'acme',
          modelId: 'gpt-b',
          protocol: 'openai-compatible',
        },
        activeSessionThinkingLevel: 'high',
        defaultProviderId: 'acme',
        defaultModelId: 'gpt-a',
      }),
    ).toEqual({
      kind: 'apply',
      modelKey: 'acme::gpt-b',
      thinkingLevel: 'high',
      markSessionId: 'session-1',
    });
  });

  it('matches a session model when catalog protocol annotation changed', () => {
    expect(
      resolveComposerModelSelection({
        sessionChanged: true,
        activeSessionId: 'session-1',
        selectedModelKey: '',
        modelOptions,
        activeSessionModel: {
          providerId: 'acme',
          modelId: 'gpt-b',
          protocol: 'google-gemini',
        },
      }),
    ).toEqual({
      kind: 'apply',
      modelKey: 'acme::gpt-b',
      thinkingLevel: undefined,
      markSessionId: 'session-1',
    });
  });
});
