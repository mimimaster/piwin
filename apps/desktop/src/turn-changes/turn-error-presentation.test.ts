import { describe, expect, it } from 'vitest';
import { presentTurnErrorCard, resolveTurnErrorMessage } from './turn-error-presentation';

const failedRun = {
  messageStatus: 'error' as const,
  messageError: 'Provider returned error',
  runOutcome: 'failed' as const,
  runTerminalMessage: 'Provider returned error',
  locale: 'zh-CN',
};

describe('presentTurnErrorCard', () => {
  it('uses a human title and strips Unknown: labels from vague failures', () => {
    expect(
      presentTurnErrorCard({
        error: 'Unknown: Unexpected error.',
        failure: {
          code: 'unknown-agent-failure',
          origin: 'runtime',
          message: 'Unexpected error.',
          retriable: false,
        },
        locale: 'zh-CN',
      }),
    ).toEqual({
      title: '生成失败',
      // No code to explain it: the raw detail stays the message, unfolded.
      hint: null,
      detail: 'Unexpected error.',
      category: 'unknown',
      showCategoryTag: false,
    });
  });

  it('falls back when the detail shell is empty after stripping', () => {
    expect(
      presentTurnErrorCard({
        error: 'Unknown:',
        locale: 'zh-CN',
      }),
    ).toMatchObject({
      title: '生成失败',
      detail: '没有更多详细信息。',
      showCategoryTag: false,
    });
  });

  it('rewrites Anthropic extra-usage failures into product copy', () => {
    expect(
      presentTurnErrorCard({
        error:
          'Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.',
        failure: {
          code: 'provider-quota',
          origin: 'provider',
          message:
            'Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.',
          retriable: false,
          httpStatus: 400,
        },
        locale: 'zh-CN',
      }),
    ).toMatchObject({
      title: '需开通 extra usage',
      detail: expect.stringContaining('claude.ai/settings/usage'),
      category: 'quota',
      showCategoryTag: true,
    });
  });

  it('keeps concrete detail prose under a structured title', () => {
    expect(
      presentTurnErrorCard({
        error: 'Connection error (spacexai · https://api.example/v1)',
        failure: {
          code: 'provider-unavailable',
          origin: 'provider',
          message: 'Connection error (spacexai · https://api.example/v1)',
          retriable: true,
        },
        locale: 'zh-CN',
      }),
    ).toMatchObject({
      title: '无法连接模型服务',
      detail: 'Connection error (spacexai · https://api.example/v1)',
      category: 'http',
      showCategoryTag: true,
    });
  });

  it('strips an Unknown: prefix when the remainder is useful', () => {
    expect(
      presentTurnErrorCard({
        error: 'Unknown: provider returned 502 bad gateway',
        locale: 'en',
      }),
    ).toMatchObject({
      title: 'Generation failed',
      detail: 'provider returned 502 bad gateway',
      category: 'unknown',
      showCategoryTag: false,
    });
  });
});

describe('presentTurnErrorCard image input rejection', () => {
  it('explains the wrong Vision flag above the provider detail', () => {
    const message = "400 messages.content.type 参数非法，取值范围 ['text']";
    const card = presentTurnErrorCard({
      error: message,
      failure: {
        code: 'provider-image-input-rejected',
        origin: 'provider',
        message,
        retriable: false,
        httpStatus: 400,
      },
      locale: 'zh-CN',
    });
    expect(card.title).toBe('模型不接受图片输入');
    expect(card.hint).toContain('「视觉」标识');
    expect(card.detail).toBe(message);
  });
});

describe('presentTurnErrorCard hints', () => {
  it('says what a rate limit means and what to do, keeping the raw text as detail', () => {
    const message = '429: {"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}';
    const card = presentTurnErrorCard({
      error: message,
      failure: { code: 'provider-rate-limit', origin: 'provider', message, retriable: true, httpStatus: 429 },
      locale: 'zh-CN',
    });
    expect(card.title).toBe('模型调用受限');
    expect(card.hint).toContain('换一个模型');
    expect(card.detail).toBe(message);
  });

  it('speaks English to an English shell', () => {
    const card = presentTurnErrorCard({
      error: 'context length exceeded',
      failure: { code: 'context-limit-exceeded', origin: 'provider', message: 'context length exceeded', retriable: false },
      locale: 'en',
    });
    expect(card.hint).toContain('context window');
  });
});

describe('resolveTurnErrorMessage', () => {
  it('hides a run-level error from earlier assistant responses', () => {
    expect(
      resolveTurnErrorMessage({
        ...failedRun,
        isLastAssistantInTurn: false,
      }),
    ).toBeNull();
  });

  it('renders one run-level error on the last assistant response', () => {
    expect(
      resolveTurnErrorMessage({
        ...failedRun,
        isLastAssistantInTurn: true,
      }),
    ).toBe('Provider returned error');
  });

  it('hides message error evidence until Host fails the Run', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'error',
        messageError: 'A message failed',
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'streaming',
        messageError: 'Provider returned error',
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: 'Connection error.',
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: 'Unexpected non-whitespace character after JSON',
        runOutcome: 'completed',
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'zh-CN',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'error',
        messageError: 'Unexpected non-whitespace character after JSON',
        runOutcome: 'failed',
        runTerminalMessage: 'Unexpected non-whitespace character after JSON',
        isLastAssistantInTurn: true,
        locale: 'zh-CN',
      }),
    ).toBe('Unexpected non-whitespace character after JSON');
  });

  it('hides leftover evidence after a completed or cancelled Run', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'error',
        messageError: 'The operation was aborted',
        runOutcome: 'cancelled',
        runTerminalMessage: 'Stopped',
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: 'Provider returned error',
        runOutcome: 'completed',
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
  });

  it('falls back to a locale default when the failed Run has no prose', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: undefined,
        runOutcome: 'failed',
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'zh-CN',
      }),
    ).toBe('生成失败');
  });

  it('resolves failure message when structured failure is present even without runRecord outcome', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: undefined,
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'zh-CN',
        failure: {
          code: 'provider-quota',
          origin: 'provider',
          message: '402: Insufficient Balance',
          retriable: false,
          httpStatus: 402,
        },
      }),
    ).toBe('402: Insufficient Balance');
  });
});
