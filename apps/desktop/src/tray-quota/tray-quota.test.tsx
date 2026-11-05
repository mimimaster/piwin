// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
  type HostServerMessage,
  type SubscriptionAccount,
  type SubscriptionAccountQuota,
} from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import {
  createTrayQuotaStateRelay,
  filterConnectedOauthAccounts,
  shouldShowTrayQuotaIcon,
  type TrayQuotaStatePayload,
} from './tray-quota-state-bridge.js';
import { TrayQuotaView } from './TrayQuotaApp.js';
import { useTrayQuotaSync } from './use-tray-quota-sync.js';

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve());
const emitMock = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const listenMock = vi.fn<(...args: unknown[]) => Promise<() => void>>(() =>
  Promise.resolve(() => {}),
);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: (...args: unknown[]) => emitMock(...args),
  listen: (...args: unknown[]) => listenMock(...args),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeAccount(
  providerId: string,
  state: SubscriptionAccount['state'],
  surface: SubscriptionAccount['surface'] = 'v1',
): SubscriptionAccount {
  return {
    providerId,
    surface,
    state,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('tray-quota visibility & ordering rules', () => {
  it('hides the tray icon when no OAuth account is logged in ("没有oauth就不展示")', () => {
    expect(shouldShowTrayQuotaIcon([])).toBe(false);
    expect(
      shouldShowTrayQuotaIcon([
        makeAccount('openai-codex', 'logged-out'),
        makeAccount('anthropic', 'needs-reauth'),
        makeAccount('kimi-coding', 'sync-error'),
      ]),
    ).toBe(false);
  });

  it('shows the tray icon only when at least one v1 OAuth account is logged-in', () => {
    expect(
      shouldShowTrayQuotaIcon([
        makeAccount('openai-codex', 'logged-out'),
        makeAccount(CLAUDE_CODE_OAUTH_PROVIDER_ID, 'logged-in'),
      ]),
    ).toBe(true);
  });

  it('orders connected OAuth accounts in canonical built-in order followed by extensions', () => {
    const accounts: SubscriptionAccount[] = [
      {
        ...makeAccount('custom-ext-oauth', 'logged-in'),
        extension: { displayName: 'Custom OAuth' },
      },
      makeAccount('xai', 'logged-in'),
      makeAccount('kimi-coding', 'logged-in'),
      makeAccount('openai-codex', 'logged-out'),
      makeAccount(CLAUDE_CODE_OAUTH_PROVIDER_ID, 'logged-in'),
    ];
    const ordered = filterConnectedOauthAccounts(accounts);
    expect(ordered.map((a) => a.providerId)).toEqual([
      'kimi-coding',
      CLAUDE_CODE_OAUTH_PROVIDER_ID,
      'xai',
      'custom-ext-oauth',
    ]);
  });

  it('replays the latest published state when the popover requests state on boot', () => {
    const emitted: TrayQuotaStatePayload[] = [];
    const relay = createTrayQuotaStateRelay({
      emitState: (state) => emitted.push(state),
    });

    const payload: TrayQuotaStatePayload = {
      accounts: [makeAccount('openai-codex', 'logged-in')],
      quotas: {},
      loadingProviderIds: [],
      locale: 'zh-CN',
      themeMode: 'dark',
    };

    relay.publish(payload);
    expect(emitted).toHaveLength(1);

    relay.handleRequest();
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual(payload);
  });
});

describe('TrayQuotaView & useTrayQuotaSync', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockClear();
    emitMock.mockClear();
    listenMock.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders connected OAuth plan quotas and triggers piwin navigation on click', () => {
    const sampleQuota: SubscriptionAccountQuota = {
      providerId: 'openai-codex',
      accountEmailOrId: 'dev@piwin.ai',
      planType: 'Plus',
      renewalInfo: '3 小时后重置',
      activeResets: {
        count: 2,
        canTriggerReset: true,
        slots: [],
      },
      groups: [
        {
          id: 'codex-main',
          title: 'Codex',
          windows: [
            {
              id: '5h',
              label: '5 小时窗口',
              type: 'remaining',
              percentage: 78,
              valueText: '剩余 78%',
              resetTimeText: '2h 15m',
              colorTone: 'mint',
            },
            {
              id: '7d',
              label: '7 天窗口',
              type: 'used',
              percentage: 65,
              valueText: '已用 65%',
              resetTimeText: '4d 10h',
              colorTone: 'amber',
            },
          ],
        },
      ],
      lastUpdated: '2026-11-04T08:00:00.000Z',
    };

    const onRefreshProvider = vi.fn();
    const onOpenPiwin = vi.fn();

    act(() => {
      root.render(
        <TrayQuotaView
          state={{
            accounts: [
              makeAccount('openai-codex', 'logged-in'),
              makeAccount('anthropic', 'logged-out'),
            ],
            quotas: { 'openai-codex': sampleQuota },
            loadingProviderIds: [],
            locale: 'zh-CN',
            themeMode: 'dark',
          }}
          onRefreshProvider={onRefreshProvider}
          onOpenPiwin={onOpenPiwin}
        />,
      );
    });

    expect(container.textContent).toContain('ChatGPT Codex');
    expect(container.textContent).toContain('Plus');
    expect(container.textContent).toContain('dev@piwin.ai');
    expect(container.textContent).toContain('剩余 78%');
    expect(container.textContent).toContain('已用 65%');

    // Progress bar fill: 78% remaining -> 78%, 65% used -> 35% remaining fill
    const fill0 = container.querySelector<HTMLElement>(
      '[data-testid="tray-meter-fill-openai-codex-0"]',
    );
    const fill1 = container.querySelector<HTMLElement>(
      '[data-testid="tray-meter-fill-openai-codex-1"]',
    );
    expect(fill0?.style.width).toBe('78%');
    expect(fill1?.style.width).toBe('35%');

    // Clicking provider refresh button only refreshes that provider without opening piwin
    const refreshBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="tray-provider-refresh-openai-codex"]',
    );
    act(() => {
      refreshBtn?.click();
    });
    expect(onRefreshProvider).toHaveBeenCalledWith('openai-codex');
    expect(onOpenPiwin).not.toHaveBeenCalled();

    // Clicking the provider row/icon opens piwin
    const card = container.querySelector<HTMLElement>(
      '[data-testid="tray-provider-card-openai-codex"]',
    );
    act(() => {
      card?.click();
    });
    expect(onOpenPiwin).toHaveBeenCalledTimes(1);
  });

  it('toggles tray icon visibility and fetches quota when OAuth accounts log in and out', async () => {
    function Harness({
      hostClient,
      hostReady,
    }: {
      hostClient: HostClient;
      hostReady: boolean;
    }) {
      useTrayQuotaSync({
        hostClient,
        hostReady,
        locale: 'zh-CN',
        themeMode: 'dark',
        openSettingsSection: vi.fn(),
      });
      return null;
    }

    let pushListener: ((msg: HostServerMessage) => void) | undefined;
    const requestMock = vi.fn(async (command: { type: string; input?: { providerId?: string } }) => {
      if (command.type === 'auth/status') {
        return {
          success: true,
          data: {
            accounts: [makeAccount('openai-codex', 'logged-out')],
          },
        };
      }
      if (command.type === 'auth/quota') {
        return {
          success: true,
          data: {
            quota: {
              providerId: command.input?.providerId ?? 'openai-codex',
              planType: 'Plus',
              groups: [],
              lastUpdated: '2026-11-04T08:00:00.000Z',
            },
          },
        };
      }
      return { success: true, data: {} };
    });

    const mockHostClient = {
      request: requestMock,
      subscribe: (cb: (msg: HostServerMessage) => void) => {
        pushListener = cb;
        return () => {};
      },
      supportsCommand: () => true,
    } as unknown as HostClient;

    act(() => {
      root.render(<Harness hostClient={mockHostClient} hostReady={true} />);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    // Initially logged-out -> tray_quota_set_visible(false)
    expect(invokeMock).toHaveBeenCalledWith('tray_quota_set_visible', { visible: false });

    // Simulate OAuth login push -> tray_quota_set_visible(true) + auth/quota fetch
    await act(async () => {
      pushListener?.({
        type: 'auth/updated',
        accounts: [makeAccount('openai-codex', 'logged-in')],
      } as HostServerMessage);
      await flushMicrotasks();
    });

    expect(invokeMock).toHaveBeenCalledWith('tray_quota_set_visible', { visible: true });
    expect(requestMock).toHaveBeenCalledWith({
      type: 'auth/quota',
      input: { providerId: 'openai-codex', forceRefresh: false },
    });

    // Simulate OAuth logout push -> tray_quota_set_visible(false)
    invokeMock.mockClear();
    await act(async () => {
      pushListener?.({
        type: 'auth/updated',
        accounts: [makeAccount('openai-codex', 'logged-out')],
      } as HostServerMessage);
      await flushMicrotasks();
    });

    expect(invokeMock).toHaveBeenCalledWith('tray_quota_set_visible', { visible: false });
  });
});
