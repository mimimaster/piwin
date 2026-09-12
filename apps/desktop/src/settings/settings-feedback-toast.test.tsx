// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import { SettingsFeedbackToast } from './settings-feedback-toast';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('SettingsFeedbackToast', () => {
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

  it('renders the settings bubble for a success save, not an inline field overlay', () => {
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsFeedbackToast error={null} info="自动化设置已保存。" tone="success" />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const host = container!.querySelector('[data-testid="settings-feedback-toast"]');
    expect(host?.className).toContain('settings-feedback-host');
    expect(host?.className).toContain('ui-feedback-host');
    expect(container!.querySelector('[data-testid="settings-feedback-info"]')?.textContent).toBe(
      '自动化设置已保存。',
    );
  });

  it('renders nothing when there is no feedback', () => {
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsFeedbackToast error={null} info={null} />
        </PiwinUiProvider>,
      );
    });

    expect(container!.querySelector('[data-testid="settings-feedback-toast"]')).toBeNull();
  });
});
