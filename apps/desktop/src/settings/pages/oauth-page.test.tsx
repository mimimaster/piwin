// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWalkthroughConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens.js';
import { DesktopLocaleProvider } from '../../desktop-locale-context.js';
import { SettingsProvider, type SettingsContextValue } from '../settings-context.js';
import { OauthPage } from './oauth-page.js';

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
  };
}

describe('OauthPage & SubscriptionAccountsPanel', () => {
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

  it('renders all 5 subscription providers with brand icons and badges', async () => {
    const mockRequest = vi.fn(async (command) => {
      if (command.type === 'auth/status') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            accounts: [
              { providerId: 'kimi-coding', surface: 'v1', state: 'logged-out' },
              { providerId: 'openai-codex', surface: 'v1', state: 'logged-in' },
              { providerId: 'anthropic', surface: 'v1', state: 'logged-out' },
              { providerId: 'xai', surface: 'v1', state: 'logged-out' },
              { providerId: 'github-copilot', surface: 'v1', state: 'logged-out' },
            ],
          },
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });

    const hostClient = {
      request: mockRequest,
      subscribe: vi.fn(() => () => {}),
      getTransport: () => 'local',
    };

    const contextValue = {
      config: baseConfig(),
      hostClient,
      setError: vi.fn(),
      setInfo: vi.fn(),
    } as unknown as SettingsContextValue;

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <OauthPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container!.querySelector('[data-testid="settings-oauth"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="subscription-accounts"]')).toBeTruthy();

    for (const id of ['kimi-coding', 'openai-codex', 'anthropic', 'xai', 'github-copilot']) {
      const card = container!.querySelector(`[data-testid="subscription-account-${id}"]`);
      expect(card).toBeTruthy();
      const stateBadge = container!.querySelector(`[data-testid="subscription-account-state-${id}"]`);
      expect(stateBadge).toBeTruthy();
    }

    const codexState = container!.querySelector('[data-testid="subscription-account-state-openai-codex"]');
    expect(codexState?.textContent).toContain('已连接');
  });

  it('sends auth/login with a caller-owned idempotency key', async () => {
    const mockRequest = vi.fn(async (command) => {
      if (command.type === 'auth/status') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: { accounts: [] },
        };
      }
      return {
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: { loginId: 'login-1' },
      };
    });
    const hostClient = {
      request: mockRequest,
      subscribe: vi.fn(() => () => {}),
      getTransport: () => 'remote' as const,
      getRemoteTarget: () => ({ endpoint: 'ws://127.0.0.1:8787' }),
    };
    const contextValue = {
      config: baseConfig(),
      hostClient,
      setError: vi.fn(),
      setInfo: vi.fn(),
    } as unknown as SettingsContextValue;

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <OauthPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const login = container!.querySelector(
      '[data-testid="subscription-account-kimi-coding"] button',
    );
    expect(login).toBeTruthy();
    await act(async () => {
      login!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const loginCall = mockRequest.mock.calls.find(
      (call) => (call[0] as { type?: string }).type === 'auth/login',
    ) as [unknown, { idempotencyKey: string } | undefined] | undefined;
    expect(loginCall?.[0]).toMatchObject({
      type: 'auth/login',
      input: { providerId: 'kimi-coding', preferLoopback: true },
    });
    expect(loginCall?.[1]).toEqual({
      idempotencyKey: expect.any(String),
    });
  });

  it('renders device code prompt dialog with copyable user code and verification link', async () => {
    const mockRequest = vi.fn(async (command) => {
      if (command.type === 'auth/status') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            accounts: [
              { providerId: 'xai', surface: 'v1', state: 'logging-in' },
            ],
            activeLogin: {
              loginId: 'login-123',
              providerId: 'xai',
              ownerDeviceId: 'device-1',
              ownerConnected: true,
              startedAt: new Date().toISOString(),
              currentPrompt: {
                loginId: 'login-123',
                promptId: 'prompt-1',
                providerId: 'xai',
                kind: 'device_code',
                userCode: 'ABCD-1234',
                verificationUri: 'https://x.ai/verify',
                expiresInSeconds: 600,
              },
            },
          },
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });

    const hostClient = {
      request: mockRequest,
      subscribe: vi.fn(() => () => {}),
      getTransport: () => 'local',
    };

    const contextValue = {
      config: baseConfig(),
      hostClient,
      setError: vi.fn(),
      setInfo: vi.fn(),
    } as unknown as SettingsContextValue;

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <OauthPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container!.querySelector('[data-testid="subscription-inline-drawer-xai"]')).toBeTruthy();
    const prompt = container!.querySelector('[data-testid="subscription-login-prompt"]');
    expect(prompt).toBeTruthy();
    const code = container!.querySelector('[data-testid="subscription-device-code"]');
    expect(code?.textContent).toBe('ABCD-1234');
  });

  it('toggles quota drawer and displays heterogeneous quota windows on connected cards', async () => {
    const mockRequest = vi.fn(async (command) => {
      if (command.type === 'auth/status') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            accounts: [
              { providerId: 'openai-codex', surface: 'v1', state: 'logged-in' },
            ],
          },
        };
      }
      if (command.type === 'auth/quota') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            quota: {
              providerId: 'openai-codex',
              accountEmailOrId: 'codex@example.com',
              planType: 'Plus',
              activeResets: {
                count: 2,
                slots: [{ index: 1, label: '第 1 次', expiresText: '10/04 09:10' }],
                canTriggerReset: true,
              },
              groups: [
                {
                  windows: [
                    {
                      label: '5 小时限额',
                      type: 'used',
                      percentage: 37,
                      valueText: '已用 37%',
                      colorTone: 'amber',
                    },
                  ],
                },
              ],
              lastUpdated: new Date().toISOString(),
            },
          },
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });

    const hostClient = {
      request: mockRequest,
      subscribe: vi.fn(() => () => {}),
      getTransport: () => 'local',
    };

    const contextValue = {
      config: baseConfig(),
      hostClient,
      setError: vi.fn(),
      setInfo: vi.fn(),
    } as unknown as SettingsContextValue;

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <OauthPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const toggleBtn = container!.querySelector('[data-testid="subscription-quota-toggle-openai-codex"]') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();

    // Click toggle to fetch and open drawer
    await act(async () => {
      toggleBtn.click();
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'auth/quota',
        input: { providerId: 'openai-codex', forceRefresh: false },
      }),
    );

    const drawer = container!.querySelector('[data-testid="subscription-quota-drawer-openai-codex"]');
    expect(drawer).toBeTruthy();
    expect(drawer?.textContent).toContain('codex@example.com');
    expect(drawer?.textContent).toContain('5 小时限额');
    expect(drawer?.textContent).toContain('已用 37%');
    expect(drawer?.textContent).toContain('主动重置可用次数');
  });

  it('shows vendor error text in the drawer instead of a settings toast', async () => {
    const setError = vi.fn();
    const mockRequest = vi.fn(async (command) => {
      if (command.type === 'auth/status') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            accounts: [{ providerId: 'xai', surface: 'v1', state: 'logged-in' }],
          },
        };
      }
      if (command.type === 'auth/quota') {
        return {
          type: 'response' as const,
          command: command.type,
          success: false as const,
          error: 'Unhandled command',
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });

    const hostClient = {
      request: mockRequest,
      subscribe: vi.fn(() => () => {}),
      getTransport: () => 'local',
    };

    const contextValue = {
      config: baseConfig(),
      hostClient,
      setError,
      setInfo: vi.fn(),
    } as unknown as SettingsContextValue;

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <OauthPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const toggleBtn = container!.querySelector('[data-testid="subscription-quota-toggle-xai"]') as HTMLButtonElement;
    await act(async () => {
      toggleBtn.click();
    });

    expect(setError).not.toHaveBeenCalled();
    const empty = container!.querySelector('[data-testid="subscription-quota-empty"]');
    expect(empty?.textContent).toContain('Unhandled command');
  });
});
