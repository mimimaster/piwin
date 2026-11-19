import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SYSTEM_PROMPTS,
  CONVERSATION_CHAT_SYSTEM_PROMPT,
  createDefaultArtifactConfig,
  createDefaultWebConfig,
  DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
  DEFAULT_REPLY_WRITER_SYSTEM_PROMPT,
  DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT,
  formatSystemPromptFileStack,
  isSupportedSystemPromptFilePath,
  MAX_SYSTEM_PROMPT_STACK_FILES,
  normalizeSystemPromptFileStack,
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

  it('validates .md and .txt file paths and normalizes file stacks', () => {
    expect(isSupportedSystemPromptFilePath('/tmp/persona.md')).toBe(true);
    expect(isSupportedSystemPromptFilePath('rules/style.MD')).toBe(true);
    expect(isSupportedSystemPromptFilePath('~/system-prompts/base.txt')).toBe(true);
    expect(isSupportedSystemPromptFilePath('NOTES.TXT')).toBe(true);

    expect(isSupportedSystemPromptFilePath('')).toBe(false);
    expect(isSupportedSystemPromptFilePath('.md')).toBe(false);
    expect(isSupportedSystemPromptFilePath('dir/.txt')).toBe(false);
    expect(isSupportedSystemPromptFilePath('/tmp/config.json')).toBe(false);
    expect(isSupportedSystemPromptFilePath('/tmp/.env')).toBe(false);
    expect(isSupportedSystemPromptFilePath('/tmp/readme')).toBe(false);
    expect(isSupportedSystemPromptFilePath('/tmp/a.md\0.txt')).toBe(false);

    const normalized = normalizeSystemPromptFileStack([
      '  /a/one.md  ',
      '/a/invalid.json',
      '/a/two.txt',
      '/a/one.md',
      '   ',
    ]);
    expect(normalized).toEqual(['/a/one.md', '/a/two.txt']);

    const many = Array.from({ length: 30 }, (_, idx) => `/tmp/file-${idx}.md`);
    expect(normalizeSystemPromptFileStack(many)).toHaveLength(MAX_SYSTEM_PROMPT_STACK_FILES);
  });

  it('formats ordered file contents by skipping blanks and joining with double newlines', () => {
    expect(formatSystemPromptFileStack(['  # Role\nBe sharp.  ', '   ', 'Always verify.'])).toBe(
      '# Role\nBe sharp.\n\nAlways verify.',
    );
    expect(formatSystemPromptFileStack(['  ', ''])).toBe('');
  });

  it('reads built-in slots safely in read-only mode', () => {
    const config = makeConfig({
      replyWriter: { enabled: true, language: 'zh-CN', systemPrompt: 'Custom writer' },
      visionDelegation: { enabled: true, systemPrompt: 'Custom vision' },
      artifact: {
        ...createDefaultArtifactConfig(),
        decisionPrompt: { mode: 'custom', customPrompt: 'Always Markdown' },
      },
    });
    expect(BUILTIN_SYSTEM_PROMPTS.length).toBeGreaterThanOrEqual(8);
    expect(readBuiltinSystemPromptValue(config, 'agent.default')).toMatchObject({
      isOverridden: false,
      effectiveContent: DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    });
    expect(readBuiltinSystemPromptValue(config, 'conversation.chat').effectiveContent).toBe(
      CONVERSATION_CHAT_SYSTEM_PROMPT,
    );
    expect(readBuiltinSystemPromptValue(config, 'delegate.reply-writer')).toMatchObject({
      isOverridden: true,
      effectiveContent: 'Custom writer',
    });
    expect(readBuiltinSystemPromptValue(config, 'delegate.vision')).toMatchObject({
      isOverridden: true,
      effectiveContent: 'Custom vision',
    });
    expect(readBuiltinSystemPromptValue(config, 'artifact.decision')).toMatchObject({
      isOverridden: true,
      effectiveContent: 'Always Markdown',
    });
    expect(readBuiltinSystemPromptValue(makeConfig(), 'delegate.reply-writer').effectiveContent).toBe(
      DEFAULT_REPLY_WRITER_SYSTEM_PROMPT,
    );
    expect(readBuiltinSystemPromptValue(makeConfig(), 'delegate.vision').effectiveContent).toBe(
      DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT,
    );
  });

  it('resolves session > project > global > builtin precedence with graceful fallback', () => {
    const config = makeConfig({
      systemPrompts: {
        presets: [
          {
            id: 'global-p',
            name: 'Global',
            mode: 'append',
            filePaths: ['/tmp/global.md'],
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
          {
            id: 'proj-p',
            name: 'Project',
            mode: 'replace',
            filePaths: ['/tmp/project.txt'],
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
          {
            id: 'sess-p',
            name: 'Session',
            mode: 'append',
            filePaths: ['/tmp/session.md', '/tmp/session-extra.txt'],
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
