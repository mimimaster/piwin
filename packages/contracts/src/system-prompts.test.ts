import { describe, expect, it } from 'vitest';
import {
  applyBuiltinSystemPromptOverride,
  BUILTIN_SYSTEM_PROMPTS,
  CONVERSATION_CHAT_SYSTEM_PROMPT,
  createDefaultArtifactConfig,
  createDefaultWebConfig,
  DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
  DEFAULT_REPLY_WRITER_SYSTEM_PROMPT,
  DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT,
  readBuiltinSystemPromptValue,
  resolveActiveSystemPromptSelection,
  slugifySystemPromptPresetId,
  SYSTEM_PROMPT_BUILTIN_ID,
  SYSTEM_PROMPT_INHERIT_ID,
  type PiwinConfig,
} from './index.js';

function makeConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
    artifact: createDefaultArtifactConfig(),
    web: createDefaultWebConfig(),
    ...overrides,
  };
}

describe('system-prompts contracts', () => {
  it('slugifies ASCII and non-ASCII names safely without collisions', () => {
    expect(slugifySystemPromptPresetId('Strict Reviewer')).toBe('strict-reviewer');
    expect(slugifySystemPromptPresetId('严格审查官')).toBe('preset');
    expect(slugifySystemPromptPresetId('严格审查官', ['preset', 'preset-1'])).toBe('preset-2');
  });

  it('reads, overrides, and resets built-in slots across existing and new config domains', () => {
    let config = makeConfig();
    expect(BUILTIN_SYSTEM_PROMPTS.length).toBeGreaterThanOrEqual(8);
    expect(readBuiltinSystemPromptValue(config, 'agent.default').isOverridden).toBe(false);
    expect(readBuiltinSystemPromptValue(config, 'conversation.chat').effectiveContent).toBe(
      CONVERSATION_CHAT_SYSTEM_PROMPT,
    );

    config = applyBuiltinSystemPromptOverride(config, 'agent.default', 'Custom Agent Rules');
    expect(readBuiltinSystemPromptValue(config, 'agent.default')).toMatchObject({
      isOverridden: true,
      effectiveContent: 'Custom Agent Rules',
    });

    config = applyBuiltinSystemPromptOverride(config, 'delegate.reply-writer', 'Rewrite concisely');
    expect(config.replyWriter?.systemPrompt).toBe('Rewrite concisely');
    expect(readBuiltinSystemPromptValue(config, 'delegate.reply-writer').isOverridden).toBe(true);

    config = applyBuiltinSystemPromptOverride(config, 'delegate.vision', 'Vision concise');
    expect(config.visionDelegation?.systemPrompt).toBe('Vision concise');

    config = applyBuiltinSystemPromptOverride(config, 'artifact.decision', 'Always Markdown');
    expect(config.artifact.decisionPrompt).toEqual({
      mode: 'custom',
      customPrompt: 'Always Markdown',
    });

    // Resetting clears overrides and restores defaults.
    config = applyBuiltinSystemPromptOverride(config, 'agent.default', null);
    config = applyBuiltinSystemPromptOverride(config, 'delegate.reply-writer', null);
    config = applyBuiltinSystemPromptOverride(config, 'delegate.vision', null);
    config = applyBuiltinSystemPromptOverride(config, 'artifact.decision', '');

    expect(readBuiltinSystemPromptValue(config, 'agent.default').effectiveContent).toBe(
      DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    );
    expect(readBuiltinSystemPromptValue(config, 'delegate.reply-writer').effectiveContent).toBe(
      DEFAULT_REPLY_WRITER_SYSTEM_PROMPT,
    );
    expect(readBuiltinSystemPromptValue(config, 'delegate.vision').effectiveContent).toBe(
      DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT,
    );
    expect(config.artifact.decisionPrompt.mode).toBe('default');
  });

  it('resolves session > project > global > builtin precedence with graceful fallback', () => {
    const config = makeConfig({
      systemPrompts: {
        presets: [
          {
            id: 'global-p',
            name: 'Global',
            mode: 'append',
            content: 'Global rule',
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
          {
            id: 'proj-p',
            name: 'Project',
            mode: 'replace',
            content: 'Project persona',
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
          {
            id: 'sess-p',
            name: 'Session',
            mode: 'append',
            content: 'Session rule',
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
        ],
        defaultPresetId: 'global-p',
        projectPresetIds: { '/repo/a': 'proj-p' },
      },
    });

    expect(
      resolveActiveSystemPromptSelection({
        config,
        projectPath: '/repo/a',
        sessionPresetId: 'sess-p',
      }).sourceKind,
    ).toBe('session-preset');

    expect(
      resolveActiveSystemPromptSelection({
        config,
        projectPath: '/repo/a',
        sessionPresetId: SYSTEM_PROMPT_INHERIT_ID,
      }).preset?.id,
    ).toBe('proj-p');

    expect(
      resolveActiveSystemPromptSelection({
        config,
        projectPath: '/repo/a',
        sessionPresetId: SYSTEM_PROMPT_BUILTIN_ID,
      }).sourceKind,
    ).toBe('session-builtin');

    expect(
      resolveActiveSystemPromptSelection({
        config,
        projectPath: '/repo/b',
      }).preset?.id,
    ).toBe('global-p');

    const fallback = resolveActiveSystemPromptSelection({
      config,
      projectPath: '/repo/a',
      sessionPresetId: 'deleted-preset',
    });
    expect(fallback.preset?.id).toBe('proj-p');
    expect(fallback.missingPresetId).toBe('deleted-preset');
  });
});
