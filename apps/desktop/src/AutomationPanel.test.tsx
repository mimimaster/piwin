// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWalkthroughConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from './settings/settings-context';
import { AutomationPanel } from './AutomationPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function baseConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
    walkthrough: createDefaultWalkthroughConfig(),
    automation: { enabled: false, cronEnabled: false, hooksEnabled: false },
    visionDelegation: { enabled: false },
  };
}

describe('AutomationPanel', () => {
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

  it('reports a save through settings setInfo instead of a page-local overlay', async () => {
    const setInfo = vi.fn();
    const setError = vi.fn();
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'config/get') {
        return {
          type: 'response' as const,
          command: 'config/get',
          success: true as const,
          data: { config: baseConfig() },
        };
      }
      return {
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: command.type === 'cron/list' ? { jobs: [] } : { hooks: [] },
      };
    });

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider
              value={{ setInfo, setError } as unknown as SettingsContextValue}
            >
              <AutomationPanel projectPath={null} request={request} variant="inline" />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const toggle = container!.querySelector<HTMLInputElement>(
      '[data-testid="automation-enabled-switch"]',
    );
    expect(toggle).not.toBeNull();
    expect(container!.querySelector('.ui-feedback-host')).toBeNull();

    await act(async () => {
      toggle?.click();
    });

    expect(setInfo).toHaveBeenCalledWith('自动化设置已保存。', 'success');
    expect(container!.querySelector('.ui-feedback-host')).toBeNull();
    expect(container!.querySelector('[data-testid="notice"]')).toBeNull();
  });

  it('folds empty cron and hook lists instead of painting placeholder cards', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'config/get') {
        return {
          type: 'response' as const,
          command: 'config/get',
          success: true as const,
          data: { config: { ...baseConfig(), automation: { enabled: true, cronEnabled: true, hooksEnabled: true } } },
        };
      }
      return {
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: command.type === 'cron/list' ? { jobs: [] } : { hooks: [] },
      };
    });

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider
              value={{ setInfo: vi.fn(), setError: vi.fn() } as unknown as SettingsContextValue}
            >
              <AutomationPanel projectPath={null} request={request} variant="inline" />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container!.textContent).not.toContain('暂无定时任务');
    expect(container!.textContent).not.toContain('暂无钩子');
    expect(container!.querySelector('[data-testid="automation-cron-section"]')).toBeNull();
    expect(container!.querySelector('[data-testid="automation-hooks-section"]')).toBeNull();
    expect(container!.querySelector('[data-testid="automation-enabled-switch"]')).not.toBeNull();
  });

  it('renders cron jobs when the list has items', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'config/get') {
        return {
          type: 'response' as const,
          command: 'config/get',
          success: true as const,
          data: { config: { ...baseConfig(), automation: { enabled: true, cronEnabled: true, hooksEnabled: true } } },
        };
      }
      if (command.type === 'cron/list') {
        return {
          type: 'response' as const,
          command: 'cron/list',
          success: true as const,
          data: {
            jobs: [
              {
                id: 'job-1',
                name: 'Nightly review',
                enabled: true,
                schedule: '@daily',
                type: 'prompt',
                promptText: 'Review the tree',
                createdAt: '2026-09-12T00:00:00.000Z',
                updatedAt: '2026-09-12T00:00:00.000Z',
              },
            ],
          },
        };
      }
      return {
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: { hooks: [] },
      };
    });

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider
              value={{ setInfo: vi.fn(), setError: vi.fn() } as unknown as SettingsContextValue}
            >
              <AutomationPanel projectPath={null} request={request} variant="inline" />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container!.querySelector('[data-testid="automation-cron-section"]')?.textContent).toContain(
      'Nightly review',
    );
    expect(container!.querySelector('[data-testid="automation-hooks-section"]')).toBeNull();
  });
});
