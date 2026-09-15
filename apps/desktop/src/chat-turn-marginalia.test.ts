import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ChatTurnHead,
  ChatTurnMarginalia,
  buildAssistantColophonMeta,
  formatDurationSeconds,
  formatTokensK,
  formatTurnClock,
  formatTurnExactStamp,
  formatTurnRelativeAge,
  hasTurnByline,
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
    expect(shortModelLabel('deepseek-v4-1-flash')).toBe('DeepSeek V4.1 Flash');
    expect(shortModelLabel('deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash');
    expect(shortModelLabel('v4-1-flash')).toBe('V4.1 flash');
    expect(shortModelLabel('grok-4.6')).toBe('Grok 4.6');
    expect(shortModelLabel('grok-4-6')).toBe('Grok 4.6');
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

  it('formats abbreviated relative age with the number stuck to the unit', () => {
    const now = Date.parse('2026-09-14T17:10:00.000Z');
    expect(formatTurnRelativeAge('2026-09-14T17:09:30.000Z', now)).toBe('just now');
    expect(formatTurnRelativeAge('2026-09-14T17:09:00.000Z', now)).toBe('1min ago');
    expect(formatTurnRelativeAge('2026-09-14T16:25:00.000Z', now)).toBe('45min ago');
    expect(formatTurnRelativeAge('2026-09-14T16:10:00.000Z', now)).toBe('1h ago');
    expect(formatTurnRelativeAge('2026-09-14T15:10:00.000Z', now)).toBe('2h ago');
    expect(formatTurnRelativeAge('2026-09-13T17:10:00.000Z', now)).toBe('1d ago');
    expect(formatTurnRelativeAge('invalid', now)).toBe('');
  });

  it('formats an exact stamp for the user-card age title', () => {
    const exact = formatTurnExactStamp('2026-09-14T16:10:00.000Z', 'zh-CN');
    expect(exact.length).toBeGreaterThan(0);
    expect(exact).toMatch(/2026/);
    expect(formatTurnExactStamp('', 'zh-CN')).toBe('');
  });

  it('drops the user "你" byline from rail and inline data', () => {
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
    expect(data.who).toBe('');
    expect(data.avatar).toBeNull();
    expect(data.usage).toBeNull();
    expect(hasTurnByline(data)).toBe(false);
  });

  it('keeps edit/intervention usage on the user byline without "你"', () => {
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
    expect(dataZh.who).toBe('');
    expect(dataZh.usage).toBe('编辑中');
    expect(hasTurnByline(dataZh)).toBe(true);

    const dataEn = resolveTurnMarginalia([userMsg], { editingMessageId: 'msg-1', locale: 'en' });
    expect(dataEn.who).toBe('');
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
    // Tokens belong in the colophon foot, not the rail.
    expect(data.usage).toBe('41s · 1 工具');
  });

  it('resolves assistant turn marginalia with duration only — tokens stay off the rail', () => {
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
    expect(data.usage).toBe('41s');
    expect(data.status).toBe('运行中');

    const dataUnknown = resolveTurnMarginalia(
      [{ ...asstMsg, model: { providerId: 'custom', modelId: 'my-model' } }],
      { themeId: 'piwin-deck-dark' },
    );
    expect(dataUnknown.avatar).toBe('智');
  });

  it('keeps assistant turn marginalia clean in conversation session (no usage/duration; rail age only)', () => {
    const asstMsg: ChatMessageUi = {
      id: 'msg-grok',
      role: 'assistant',
      text: 'reply',
      thinking: 'reasoning content',
      thinkingStartedAt: 1000,
      thinkingEndedAt: 3000,
      tools: [],
      status: 'done',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'xai', modelId: 'grok-4.6' },
    };
    const nowMs = Date.parse('2026-09-05T16:03:00.000Z');
    const data = resolveTurnMarginalia([asstMsg], { isConversationSession: true, nowMs });
    expect(data.who).toBe('Grok 4.6');
    expect(data.avatar).toBe('G');
    expect(data.clock).toBe('2h ago');
    expect(data.clockExact).toMatch(/2026/);
    expect(data.usage).toBeNull();
  });

  it('keeps age off the user rail and on the assistant rail', () => {
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
    const asstMsg: ChatMessageUi = {
      id: 'msg-2',
      role: 'assistant',
      text: 'reply',
      thinking: '',
      tools: [],
      status: 'done',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'xai', modelId: 'grok-4.5' },
    };
    const nowMs = Date.parse('2026-09-05T15:03:00.000Z');
    expect(resolveTurnMarginalia([userMsg], { nowMs }).clock).toBe('');
    expect(resolveTurnMarginalia([userMsg], { isConversationSession: true, nowMs }).clock).toBe('');
    expect(resolveTurnMarginalia([asstMsg], { nowMs }).clock).toBe('1h ago');
    expect(resolveTurnMarginalia([asstMsg], { isConversationSession: true, nowMs }).clock).toBe('1h ago');
  });

  it('builds colophon meta as tokens-only — never repeats the model label', () => {
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
    ).toBe('本轮消耗 1.8k tokens');

    expect(buildAssistantColophonMeta({ message: asstMsg, locale: 'zh-CN' })).toBeNull();
    expect(
      buildAssistantColophonMeta({
        message: asstMsg,
        locale: 'en',
        contextUsage: {
          sessionId: 's',
          updatedAt: '2026-09-05T14:03:00.000Z',
          totalTokens: 13000,
          source: 'assistant-usage',
        },
      }),
    ).toBe('13k tokens this turn');
  });

  it('renders official model icon in ChatTurnMarginalia and ChatTurnHead', () => {
    const grokMsg: ChatMessageUi = {
      id: 'msg-grok',
      role: 'assistant',
      text: 'hello from grok',
      thinking: '',
      tools: [{ toolCallId: 't1', toolName: 'read', status: 'done', output: '' }],
      status: 'done',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'xai', modelId: 'grok-4.5' },
    };
    const data = resolveTurnMarginalia([grokMsg]);
    expect(data.model).toEqual({ providerId: 'xai', modelId: 'grok-4.5' });

    const marginaliaHtml = renderToStaticMarkup(createElement(ChatTurnMarginalia, { data }));
    expect(marginaliaHtml).toContain('turn-model-icon');
    expect(marginaliaHtml).toContain('data-provider-brand="Grok"');
    expect(marginaliaHtml).toContain('has-model-icon');

    const headHtml = renderToStaticMarkup(createElement(ChatTurnHead, { data }));
    expect(headHtml).toContain('turn-model-icon');
    expect(headHtml).toContain('data-provider-brand="Grok"');
    expect(headHtml).toContain('has-model-icon');
    // Byline marks are bare glyphs, not the filled brand chip.
    expect(marginaliaHtml).toContain('is-glyph');
    expect(headHtml).toContain('is-glyph');
  });

  it('tags the byline with the live run tone only while a status is shown', () => {
    const msg: ChatMessageUi = {
      id: 'msg-tone',
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      status: 'streaming',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'google', modelId: 'gemini-3-8-flash' },
    };
    const waiting = resolveTurnMarginalia([msg], {
      isConversationSession: true,
      status: '等待批准',
      statusTone: 'waiting',
    });
    expect(waiting.statusTone).toBe('waiting');
    expect(renderToStaticMarkup(createElement(ChatTurnMarginalia, { data: waiting }))).toContain(
      'data-status-tone="waiting"',
    );
    expect(renderToStaticMarkup(createElement(ChatTurnHead, { data: waiting }))).toContain(
      'data-status-tone="waiting"',
    );

    const idle = resolveTurnMarginalia([msg], { isConversationSession: true, statusTone: 'running' });
    expect(idle.statusTone).toBeUndefined();
    expect(renderToStaticMarkup(createElement(ChatTurnMarginalia, { data: idle }))).not.toContain(
      'data-status-tone',
    );
  });

  it('renders assistant age on the rail with an exact title, never on the cramped head', () => {
    const grokMsg: ChatMessageUi = {
      id: 'msg-grok',
      role: 'assistant',
      text: 'hello from grok',
      thinking: '',
      tools: [],
      status: 'done',
      createdAt: '2026-09-05T14:03:00.000Z',
      attachments: [],
      model: { providerId: 'xai', modelId: 'grok-4.5' },
    };
    const data = resolveTurnMarginalia([grokMsg], { nowMs: Date.parse('2026-09-05T15:03:00.000Z') });
    expect(data.clock).toBe('1h ago');

    const marginaliaHtml = renderToStaticMarkup(createElement(ChatTurnMarginalia, { data }));
    expect(marginaliaHtml).toContain('turn-clock');
    expect(marginaliaHtml).toContain('1h ago');
    expect(marginaliaHtml).toContain(`title="${data.clockExact}"`);

    const headHtml = renderToStaticMarkup(createElement(ChatTurnHead, { data }));
    expect(headHtml).not.toContain('turn-clock');
    expect(headHtml).not.toContain('ago');
  });
});
