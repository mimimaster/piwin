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

  it('renders structured authentication failures', () => {
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
    expect(container.textContent).toContain('Invalid API key');
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

  it('renders switch model button for quota errors', () => {
    const onSwitchModel = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnErrorCard
            messageId="m1"
            error="Rate limit exceeded 429: out of quota"
            failure={{
              code: 'provider-quota',
              origin: 'provider',
              message: 'Rate limit exceeded 429: out of quota',
              retriable: true,
              httpStatus: 429,
            }}
            onSwitchModel={onSwitchModel}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const switchBtn = container.querySelector<HTMLButtonElement>('[data-testid="turn-error-switch-model-btn"]');
    expect(switchBtn).not.toBeNull();
    expect(switchBtn?.textContent).toBe('切换模型');
    act(() => {
      switchBtn?.click();
    });
    expect(onSwitchModel).toHaveBeenCalledTimes(1);
  });

  it('renders configure key button for auth errors', () => {
    const onOpenSettings = vi.fn();
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
            onOpenSettings={onOpenSettings}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const settingsBtn = container.querySelector<HTMLButtonElement>('[data-testid="turn-error-settings-btn"]');
    expect(settingsBtn).not.toBeNull();
    expect(settingsBtn?.textContent).toBe('配置密钥');
    act(() => {
      settingsBtn?.click();
    });
    expect(onOpenSettings).toHaveBeenCalledWith('providers');
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
