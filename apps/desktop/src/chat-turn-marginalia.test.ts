import { describe, expect, it } from 'vitest';
import {
  buildAssistantColophonMeta,
  formatDurationSeconds,
  formatTokensK,
  formatTurnClock,
  resolveTurnMarginalia,
  shortModelLabel,
} from './chat-turn-marginalia';
import type { ChatMessageUi } from './chat-reducer';

describe('chat-turn-marginalia', () => {
  it('formats short model labels cleanly', () => {
    expect(shortModelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(shortModelLabel('claude-3-7-sonnet-20250219')).toBe('Sonnet 3.7');
    expect(shortModelLabel('anthropic/claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
    expect(shortModelLabel('openai-gpt-5-4')).toBe('GPT-5.4');
    expect(shortModelLabel('gpt-4o-2024-11-20')).toBe('GPT-4o');
    expect(shortModelLabel('gpt-4o-mini')).toBe('GPT-4o mini');
    expect(shortModelLabel('custom-model')).toBe('Custom model');
    expect(shortModelLabel('gemini-2-5-pro')).toBe('Gemini 2.5 Pro');
    expect(shortModelLabel('gemini-2.0-flash-thinking-exp-01-21')).toBe('Gemini 2.0 Flash');
    expect(shortModelLabel('deepseek-reasoner')).toBe('DeepSeek R1');
    expect(shortModelLabel('deepseek-chat')).toBe('DeepSeek V3');
  });

  it('formats tokens and duration', () => {
    expect(formatTokensK(500)).toBe('500');
    expect(formatTokensK(3100)).toBe('3.1k');
    expect(formatTokensK(12400)).toBe('12k');
    expect(formatDurationSeconds(41000)).toBe('41s');
  });

  it('formats turn clock from ISO string', () => {
    const clock = formatTurnClock('2026-09-05T14:02:00.000Z');
    expect(clock.length).toBeGreaterThan(0);
    expect(formatTurnClock('invalid')).toBe('');
  });

  it('resolves user turn marginalia with "你"', () => {
    const userMsg: ChatMessageUi = {
      id: 'msg-1',
      role: 'user',
      text: 'hello',
      thinking: '',
      tools: [],
      status: 'done',
      createdAt: '2026-09-05T14:02:00.000Z',
      attachments: [],
    };
    const data = resolveTurnMarginalia([userMsg]);
    expect(data.who).toBe('你');
    expect(data.avatar).toBeNull();
    expect(data.usage).toBeNull();
  });

  it('resolves user turn marginalia with "编辑中" when editing', () => {
    const userMsg: ChatMessageUi = {
      id: 'msg-1',
      role: 'user',
      text: 'hello',
      thinking: '',
      tools: [],
      status: 'done',
      createdAt: '2026-09-05T14:02:00.000Z',
      attachments: [],
    };
    const dataZh = resolveTurnMarginalia([userMsg], { editingMessageId: 'msg-1', locale: 'zh-CN' });
    expect(dataZh.who).toBe('你');
    expect(dataZh.usage).toBe('编辑中');

    const dataEn = resolveTurnMarginalia([userMsg], { editingMessageId: 'msg-1', locale: 'en' });
    expect(dataEn.who).toBe('You');
    expect(dataEn.usage).toBe('Editing');
  });

  it('resolves assistant turn marginalia with model and metrics', () => {
    const asstMsg: ChatMessageUi = {
      id: 'msg-2',
      role: 'assistant',
      text: 'reply',
      thinking: 'some thought',
      thinkingStartedAt: 1000,
      thinkingEndedAt: 42000,
      tools: [{ toolCallId: 't1', toolName: 'read', status: 'done', output: '' }],
      status: 'done',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    };
    const data = resolveTurnMarginalia([asstMsg]);
    expect(data.who).toBe('Sonnet 4.6');
    expect(data.fullModelId).toBe('claude-sonnet-4-6');
    expect(data.avatar).toBe('C');
    expect(data.usage).toBe('41s · 1 工具');
  });

  it('resolves assistant turn marginalia with tokens and duration matching prototype', () => {
    const asstMsg: ChatMessageUi = {
      id: 'msg-3',
      role: 'assistant',
      text: 'done',
      thinking: '',
      tools: [],
      status: 'done',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    };
    const data = resolveTurnMarginalia([asstMsg], {
      elapsedMs: 41000,
      contextUsage: {
        sessionId: 'test-session',
        updatedAt: '2026-09-05T14:03:00.000Z',
        totalTokens: 3100,
        source: 'assistant-usage',
      },
      status: '运行中',
    });
    expect(data.who).toBe('Sonnet 4.6');
    expect(data.avatar).toBe('C');
    expect(data.usage).toBe('3.1k · 41s');
    expect(data.status).toBe('运行中');

    const dataUnknown = resolveTurnMarginalia(
      [{ ...asstMsg, model: { providerId: 'custom', modelId: 'my-model' } }],
      { themeId: 'piwin-deck-dark' },
    );
    expect(dataUnknown.avatar).toBe('智');
  });

  it('builds proto-00 colophon meta from model and usage', () => {
    const asstMsg: ChatMessageUi = {
      id: 'msg-2',
      role: 'assistant',
      text: 'reply',
      thinking: '',
      tools: [],
      status: 'done',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    };
    expect(
      buildAssistantColophonMeta({
        message: asstMsg,
        locale: 'zh-CN',
        contextUsage: {
          sessionId: 's',
          updatedAt: '2026-09-05T14:03:00.000Z',
          totalTokens: 1800,
          source: 'assistant-usage',
        },
      }),
    ).toBe('Sonnet 4.6 · 本轮消耗 1.8k tokens');

    expect(buildAssistantColophonMeta({ message: asstMsg, locale: 'zh-CN' })).toBe('Sonnet 4.6');
  });
});
