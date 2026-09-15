// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { SubscriptionBillingNoticeBanner } from './subscription-billing-notice.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('SubscriptionBillingNoticeBanner', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it('renders the Claude extra-usage warning and skips other providers', async () => {
    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubscriptionBillingNoticeBanner providerId="anthropic" locale="zh-CN" variant="card" />
        </PiwinUiProvider>,
      );
    });
    expect(container!.querySelector('[data-testid="subscription-billing-notice"]')?.textContent).toContain(
      '不走套餐内额度',
    );

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubscriptionBillingNoticeBanner providerId="openai-codex" locale="zh-CN" variant="card" />
        </PiwinUiProvider>,
      );
    });
    expect(container!.querySelector('[data-testid="subscription-billing-notice"]')).toBeNull();
  });

  it('renders a one-line composer bar', async () => {
    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubscriptionBillingNoticeBanner providerId="anthropic" locale="en" variant="compact" />
        </PiwinUiProvider>,
      );
    });
    expect(container!.querySelector('[data-testid="composer-billing-notice"]')?.textContent).toMatch(
      /extra usage/i,
    );
  });
});
