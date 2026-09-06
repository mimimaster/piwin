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
    expect(shortModelLabel('openai-gpt-5-4')).toBe('Gpt 5.4');
    expect(shortModelLabel('custom-model')).toBe('Custom model');
    expect(shortModelLabel('gemini-2-5-pro')).toBe('2 5 pro');
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

  it('resolves user turn marginalia with "我"', () => {
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
    expect(data.who).toBe('我');
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
    expect(dataZh.who).toBe('我');
    expect(dataZh.usage).toBe('编辑中');

    const dataEn = resolveTurnMarginalia([userMsg], { editingMessageId: 'msg-1', locale: 'en' });
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
    expect(data.avatar).toBe('墨');
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
    expect(data.avatar).toBe('墨');
    expect(data.usage).toBe('3.1k · 41s');
    expect(data.status).toBe('运行中');

    const dataDeck = resolveTurnMarginalia([asstMsg], { themeId: 'piwin-deck-dark' });
    expect(dataDeck.avatar).toBe('智');
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
