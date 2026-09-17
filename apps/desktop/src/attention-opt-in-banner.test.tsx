// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_LIGHT } from './appearance-tokens';
import { AttentionOptInBanner } from './attention-opt-in-banner';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('AN-T49 AttentionOptInBanner', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    host?.remove();
    host = null;
    root = null;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('renders nothing when not visible', () => {
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <AttentionOptInBanner
            visible={false}
            locale="zh-CN"
            onEnable={() => undefined}
            onDismiss={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    expect(host?.querySelector('[data-testid="attention-opt-in-banner"]')).toBeNull();
  });

  it('renders copy and fires Enable / Later callbacks', () => {
    const onEnable = vi.fn();
    const onDismiss = vi.fn();
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <AttentionOptInBanner
            visible
            locale="zh-CN"
            onEnable={onEnable}
            onDismiss={onDismiss}
          />
        </PiwinUiProvider>,
      );
    });
    expect(host?.textContent).toContain('任务在后台完成或需要批准时提醒你？');
    act(() => {
      host?.querySelector<HTMLButtonElement>('[data-testid="attention-opt-in-enable"]')?.click();
    });
    act(() => {
      host?.querySelector<HTMLButtonElement>('[data-testid="attention-opt-in-later"]')?.click();
    });
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
