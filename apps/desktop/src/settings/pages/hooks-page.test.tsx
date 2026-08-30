// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createDefaultWalkthroughConfig,
  type HookDefinition,
  type PiwinConfig,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens.js';
import { DesktopLocaleProvider } from '../../desktop-locale-context.js';
import { SettingsProvider, type SettingsContextValue } from '../settings-context.js';
import { HooksPage } from './hooks-page.js';
import {
  createUserHook,
  formatHookAction,
  isHooksArmed,
  removeHook,
  replaceHook,
} from './hooks-page-model.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SAMPLE_HOOK: HookDefinition = {
  id: 'hook-1',
  enabled: true,
  event: 'turn_end',
  action: { type: 'shell', command: 'echo', args: ['done'] },
};

function baseConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
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
    automation: { enabled: true, cronEnabled: false, hooksEnabled: true },
    visionDelegation: { enabled: true },
    ...overrides,
  };
}

describe('hooks-page-model', () => {
  it('formats shell and http actions', () => {
    expect(formatHookAction({ type: 'shell', command: 'echo', args: ['done'] })).toBe('echo done');
    expect(formatHookAction({ type: 'http', url: 'https://example.test' })).toBe(
      'https://example.test',
    );
  });

  it('creates a shell hook from a command line', () => {
    const hook = createUserHook({
      event: 'agent_end',
      actionType: 'shell',
      commandOrUrl: 'notify-send done',
    });
    expect(hook).toMatchObject({
      enabled: true,
      event: 'agent_end',
      action: { type: 'shell', command: 'notify-send', args: ['done'] },
    });
  });

  it('toggles and removes hooks by id', () => {
    expect(replaceHook([SAMPLE_HOOK], 'hook-1', { enabled: false })[0]?.enabled).toBe(false);
    expect(removeHook([SAMPLE_HOOK], 'hook-1')).toEqual([]);
  });

  it('requires both automation master and hooksEnabled to arm', () => {
    expect(isHooksArmed({ enabled: true, hooksEnabled: true })).toBe(true);
    expect(isHooksArmed({ enabled: true, hooksEnabled: false })).toBe(false);
    expect(isHooksArmed({ enabled: false, hooksEnabled: true })).toBe(false);
  });
});

describe('HooksPage', () => {
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

  it('lists extension intercepts, vision delegation, and user hooks', async () => {
    const requestAutomation = vi.fn(async (command: { type: string }) => {
      if (command.type === 'hooks/list') {
        return {
          type: 'response' as const,
          command: 'hooks/list',
          success: true as const,
          data: { version: 1, hooks: [SAMPLE_HOOK] },
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });
    const requestExtensions = vi.fn(async () => ({
      type: 'response' as const,
      command: 'extensions/list',
      success: true as const,
      data: {
        extensions: [
          {
            id: 'path-guard',
            name: 'path-guard',
            description: 'Block write/edit targeting secret-like paths.',
            source: 'bundled',
            path: '/mock/path-guard.ts',
            enabled: true,
            hookEvents: ['tool_call'],
          },
        ],
      },
    }));
    const selectSection = vi.fn();
    const contextValue = {
      config: baseConfig(),
      saveConfig: vi.fn(async () => true),
      projectPath: null,
      requestAutomation,
      requestExtensions,
      selectSection,
      hostClient: { supportsCommand: () => true },
      setError: vi.fn(),
      setInfo: vi.fn(),
    } as unknown as SettingsContextValue;

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <HooksPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container!.querySelector('[data-testid="settings-hooks"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="hook-ext-path-guard"]')?.textContent).toContain(
      'tool_call',
    );
    expect(container!.querySelector('[data-testid="hook-related-vision"]')?.textContent).toContain(
      '视觉委托',
    );
    expect(container!.querySelector('[data-testid="hook-user-hook-1"]')?.textContent).toContain(
      'echo done',
    );

    const openModels = container!.querySelector('[data-testid="hook-related-vision"] button');
    expect(openModels).toBeTruthy();
    await act(async () => {
      openModels?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(selectSection).toHaveBeenCalledWith('models');
  });
});
