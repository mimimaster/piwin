// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { TurnErrorCard } from './turn-error-card';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('TurnErrorCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders nothing when there is no error', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard messageId="m1" error={null} />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="turn-error-card"]')).toBeNull();
  });

  it('renders structured authentication failures with title and shaded detail', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="Invalid API key provided for anthropic provider (401)"
            failure={{
              code: 'provider-authentication',
              origin: 'provider',
              message: 'Invalid API key provided for anthropic provider (401)',
              retriable: false,
              httpStatus: 401,
            }}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="turn-error-card"]')).not.toBeNull();
    expect(container.textContent).toContain('模型认证失败');
    expect(container.querySelector('[data-testid="turn-error-detail"]')?.textContent).toContain(
      'Invalid API key',
    );
    expect(container.querySelector('.turn-error-category-tag')?.textContent).toBe('auth');
  });

  it('does not classify a structured stream stall as network', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="fetch failed: ECONNREFUSED"
            failure={{
              code: 'model-stream-stalled',
              origin: 'transport',
              message: 'fetch failed: ECONNREFUSED',
              retriable: true,
            }}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const card = container.querySelector('[data-testid="turn-error-card"]');
    expect(card?.getAttribute('data-category')).toBe('stream');
    expect(container.textContent).toContain('模型输出中断');
    expect(container.textContent).not.toContain('网络请求或连接超时');
  });

  it('intercepts Unknown / Unexpected prose with a human title and clean detail', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="Unknown: Unexpected error."
            failure={{
              code: 'unknown-agent-failure',
              origin: 'runtime',
              message: 'Unexpected error.',
              retriable: false,
            }}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const card = container.querySelector('[data-testid="turn-error-card"]');
    expect(card?.getAttribute('data-category')).toBe('unknown');
    expect(container.textContent).toContain('生成失败');
    expect(container.querySelector('.turn-error-category-tag')).toBeNull();
    expect(container.querySelector('[data-testid="turn-error-detail"]')?.textContent).toBe(
      'Unexpected error.',
    );
  });

  it('shows a generic generation failure for legacy message-only errors', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard messageId="m1" error="fetch failed: ECONNREFUSED" locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="turn-error-card"]')?.getAttribute('data-category')).toBe(
      'unknown',
    );
    expect(container.textContent).toContain('生成失败');
    expect(container.querySelector('[data-testid="turn-error-detail"]')?.textContent).toBe(
      'fetch failed: ECONNREFUSED',
    );
  });

  it('renders continue and start-over when work already landed', () => {
    const onContinue = vi.fn();
    const onRestart = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="Provider finish_reason: max_tokens"
            onContinue={onContinue}
            onRestart={onRestart}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const continueBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-error-continue-btn"]',
    );
    const restartBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-error-restart-btn"]',
    );
    expect(continueBtn?.textContent).toBe('继续');
    expect(restartBtn?.textContent).toBe('从头再来');
    expect(container.querySelector('[data-testid="turn-error-retry-btn"]')).toBeNull();
    act(() => {
      continueBtn?.click();
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it('renders retry button and triggers onRetry callback', () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="Failed to generate response"
            onRetry={onRetry}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const retryBtn = container.querySelector<HTMLButtonElement>('[data-testid="turn-error-retry-btn"]');
    expect(retryBtn).not.toBeNull();
    expect(retryBtn?.textContent).toBe('Retry');
    act(() => {
      retryBtn?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render configure-key or switch-model special-case actions', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="401 Unauthorized API key"
            failure={{
              code: 'provider-authentication',
              origin: 'provider',
              message: '401 Unauthorized API key',
              retriable: false,
              httpStatus: 401,
            }}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="turn-error-settings-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="turn-error-switch-model-btn"]')).toBeNull();
  });

  it('allows copying the error details to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    const onFeedback = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="Detailed error reason"
            onFeedback={onFeedback}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const copyBtn = container.querySelector<HTMLButtonElement>('[data-testid="turn-error-copy-btn"]');
    expect(copyBtn).not.toBeNull();
    await act(async () => {
      copyBtn?.click();
    });
    expect(writeTextMock).toHaveBeenCalledWith('Detailed error reason');
    expect(onFeedback).toHaveBeenCalledWith('报错详情已复制到剪贴板', 'success');
  });
});
