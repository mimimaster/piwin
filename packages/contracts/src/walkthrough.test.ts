import { describe, expect, it } from 'vitest';
import type { ModelRef } from './host.js';
import type { WalkthroughConfig } from './walkthrough.js';
import {
  createDefaultWalkthroughConfig,
  DEFAULT_CONCISE_PROMPT,
  DEFAULT_WALKTHROUGH_PROMPT,
  MAX_WALKTHROUGH_PROMPT_BYTES,
  normalizeWalkthroughConfig,
  validateWalkthroughConfig,
} from './walkthrough.js';

const VALID_MODEL_REFS: ModelRef[] = [
  { protocol: 'openai-compatible', providerId: 'p1', modelId: 'gpt-4o' },
  { protocol: 'anthropic-compatible', providerId: 'p2', modelId: 'claude-3' },
  { protocol: 'google-gemini', providerId: 'p3', modelId: 'gemini-1.5' },
];

describe('walkthrough config', () => {
  it('createDefaultWalkthroughConfig defaults prompt injection on (ADR 0026)', () => {
    const config = createDefaultWalkthroughConfig();
    expect(config.enabled).toBe(true);
    expect(config.autoGenerate).toBe(false);
    expect(config.concisePrompt).toBe(DEFAULT_CONCISE_PROMPT);
    expect(config.mode).toBe('default');
    expect(config.custom.model).toBeNull();
    expect(config.custom.prompt).toBe(DEFAULT_WALKTHROUGH_PROMPT);
  });

  it('default prompt is non-empty and within byte limit', () => {
    expect(DEFAULT_WALKTHROUGH_PROMPT.trim()).not.toBe('');
    expect(new TextEncoder().encode(DEFAULT_WALKTHROUGH_PROMPT).length).toBeLessThanOrEqual(
      MAX_WALKTHROUGH_PROMPT_BYTES,
    );
  });

  it('default prompt includes all rich-text delivery format requirements', () => {
    // 1. File-change action badges with language tag + path
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('[MODIFY] TS src/utils.ts');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('[NEW] TS src/logger.ts');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('[DELETE] TS src/legacy.ts');
    // 2. diff fence with +/- prefixed lines
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('```diff');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('- const OLD_TIMEOUT_MS = 5_000;');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('+ const TIMEOUT_MS = 10_000;');
    // 3. long code sample targeting the >16-line fold
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('20+ lines');
    // 4. HTML <details> collapsible for logs
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('<details>');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('<summary>');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('</details>');
    // 5. task checklist markers
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('- [x]');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('- [ ]');
    // 6. GitHub-style callouts
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('> [!NOTE]');
    expect(DEFAULT_WALKTHROUGH_PROMPT).toContain('> [!TIP]');
  });

  it('default concise prompt is non-empty', () => {
    expect(DEFAULT_CONCISE_PROMPT.trim()).not.toBe('');
    expect(DEFAULT_CONCISE_PROMPT).toContain('<walkthrough-context priority="critical">');
    expect(DEFAULT_CONCISE_PROMPT).toContain('</walkthrough-context>');
  });

  it('WalkthroughConfig accepts all three provider protocols', () => {
    for (const model of VALID_MODEL_REFS) {
      const config: WalkthroughConfig = {
        ...createDefaultWalkthroughConfig(),
        mode: 'custom',
        custom: { model, prompt: 'explain' },
      };
      expect(validateWalkthroughConfig(config)).toEqual([]);
    }
  });

  it('rejects empty prompt in custom mode', () => {
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'custom',
      custom: { model: null, prompt: '   ' },
    };
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.custom.prompt')).toBe(true);
  });

  it('rejects over-limit prompt in custom mode', () => {
    const over = 'x'.repeat(MAX_WALKTHROUGH_PROMPT_BYTES + 1);
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'custom',
      custom: { model: null, prompt: over },
    };
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.custom.prompt')).toBe(true);
  });

  it('rejects empty prompt in default mode (prompt always used, ADR 0026)', () => {
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'default',
      custom: { model: null, prompt: '   ' },
    };
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.custom.prompt')).toBe(true);
  });

  it('rejects over-limit prompt in default mode (prompt always used, ADR 0026)', () => {
    const over = 'x'.repeat(MAX_WALKTHROUGH_PROMPT_BYTES + 1);
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'default',
      custom: { model: null, prompt: over },
    };
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.custom.prompt')).toBe(true);
  });

  it('rejects invalid mode', () => {
    const config = {
      ...createDefaultWalkthroughConfig(),
      mode: 'auto' as unknown as WalkthroughConfig['mode'],
    } as WalkthroughConfig;
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.mode')).toBe(true);
  });

  it('rejects non-boolean enabled', () => {
    const config = {
      ...createDefaultWalkthroughConfig(),
      enabled: 'yes' as unknown as boolean,
    } as WalkthroughConfig;
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.enabled')).toBe(true);
  });

  it('rejects model with unsupported protocol', () => {
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'custom',
      custom: {
        model: { protocol: 'foo' as ModelRef['protocol'], providerId: 'p', modelId: 'm' },
        prompt: 'explain',
      },
    };
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.custom.model.protocol')).toBe(true);
  });

  it('rejects model with missing providerId/modelId', () => {
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'custom',
      custom: {
        model: { protocol: 'openai-compatible', providerId: '', modelId: 'm' },
        prompt: 'explain',
      },
    };
    const issues = validateWalkthroughConfig(config);
    expect(issues.some((i) => i.path === 'walkthrough.custom.model')).toBe(true);
  });

  it('allows null model even if mode field says custom (ADR 0026 ignores model)', () => {
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'custom',
      custom: { model: null, prompt: 'explain' },
    };
    expect(validateWalkthroughConfig(config)).toEqual([]);
  });

  it('accepts null model in default mode', () => {
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      mode: 'default',
      custom: { model: null, prompt: 'explain' },
    };
    expect(validateWalkthroughConfig(config)).toEqual([]);
  });

  it('accepts a fully valid custom config', () => {
    const config: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      enabled: false,
      mode: 'custom',
      custom: {
        model: { protocol: 'google-gemini', providerId: 'p', modelId: 'm' },
        prompt: 'custom prompt',
      },
    };
    expect(validateWalkthroughConfig(config)).toEqual([]);
  });
});

describe('normalizeWalkthroughConfig', () => {
  it('returns default for missing walkthrough (old config)', () => {
    const normalized = normalizeWalkthroughConfig(undefined);
    expect(normalized).toEqual(createDefaultWalkthroughConfig());
  });

  it('returns default for non-object input', () => {
    expect(normalizeWalkthroughConfig(null)).toEqual(createDefaultWalkthroughConfig());
    expect(normalizeWalkthroughConfig('walkthrough')).toEqual(createDefaultWalkthroughConfig());
  });

  it('fills missing fields with defaults while preserving prompt (ADR 0026)', () => {
    const normalized = normalizeWalkthroughConfig({
      mode: 'custom',
      custom: {
        model: { protocol: 'anthropic-compatible', providerId: 'p2', modelId: 'claude' },
        prompt: 'keep me',
      },
    });
    expect(normalized.enabled).toBe(true);
    expect(normalized.autoGenerate).toBe(false);
    expect(normalized.mode).toBe('default');
    expect(normalized.custom.prompt).toBe('keep me');
    expect(normalized.custom.model).toBeNull();
  });

  it('coerces invalid mode back to default', () => {
    const normalized = normalizeWalkthroughConfig({ mode: 'auto', custom: {} });
    expect(normalized.mode).toBe('default');
    expect(normalized.custom.prompt).toBe(DEFAULT_WALKTHROUGH_PROMPT);
    expect(normalized.custom.model).toBeNull();
  });

  it('drops a model with unsupported protocol', () => {
    const normalized = normalizeWalkthroughConfig({
      custom: {
        model: { protocol: 'foo', providerId: 'p', modelId: 'm' },
        prompt: 'p',
      },
    });
    expect(normalized.custom.model).toBeNull();
  });
});

  it('normalizeWalkthroughConfig drops auto/custom-model (ADR 0026)', () => {
    const config = normalizeWalkthroughConfig({
      enabled: true,
      autoGenerate: true,
      mode: 'custom',
      custom: {
        model: { protocol: 'openai-compatible', providerId: 'p', modelId: 'm' },
        prompt: 'custom prompt',
      },
    });
    expect(config.enabled).toBe(true);
    expect(config.autoGenerate).toBe(false);
    expect(config.mode).toBe('default');
    expect(config.custom.model).toBeNull();
    expect(config.custom.prompt).toBe('custom prompt');
  });
