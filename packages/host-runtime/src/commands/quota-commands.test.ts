import { describe, expect, it, vi } from 'vitest';
import type {
  HostPush,
  SubscriptionAccountQuota,
} from '@piwin/contracts';
import type { SubscriptionAuthPort } from '@piwin/agent-host';
import { handleAuthCommand } from './auth-commands.js';
import type { HostCommandContext } from './host-command-context.js';
import { SubscriptionQuotaService } from '../subscription-quota-service.js';

describe('Quota Commands & SubscriptionQuotaService', () => {
  const mockCodexQuota: SubscriptionAccountQuota = {
    providerId: 'openai-codex',
    accountEmailOrId: 'codex@example.com',
    planType: 'Plus',
    activeResets: {
      count: 2,
      slots: [{ index: 1, label: '第 1 次', expiresText: '10/04 09:10 · 25天后' }],
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
          {
            label: '周限额',
            type: 'remaining',
            percentage: 90,
            valueText: '剩余 90%',
            colorTone: 'mint',
          },
        ],
      },
    ],
    lastUpdated: new Date().toISOString(),
  };

  function createMockPort(): SubscriptionAuthPort {
    return {
      listCredentials: vi.fn(async () => []),
      isUsingSubscription: vi.fn(() => true),
      getChatCatalog: vi.fn(() => []),
      login: vi.fn(async () => ({ kind: 'ok' as const })),
      logout: vi.fn(async () => ({ kind: 'ok' as const })),
      refreshProvider: vi.fn(async () => {}),
      refreshLiveCatalog: vi.fn(async () => {}),
      fetchQuota: vi.fn(async () => mockCodexQuota),
      resetQuota: vi.fn(async () => ({
        ok: true,
        quota: {
          ...mockCodexQuota,
          activeResets: { count: 1, slots: [], canTriggerReset: true },
        },
      })),
      dispose: vi.fn(() => {}),
    };
  }

  function createMockContext(quotaService: SubscriptionQuotaService, pushes: HostPush[]): HostCommandContext {
    return {
      push: (msg: HostPush) => pushes.push(msg),
      subscriptionQuota: quotaService,
      requireSession: vi.fn() as any,
      getMcpManager: vi.fn() as any,
      getJobController: vi.fn() as any,
      todoStore: {} as any,
      petStateStore: {} as any,
      runCronJob: vi.fn() as any,
      pendingPermissions: new Map(),
      pendingExtensionUi: new Map(),
      rememberProjectPermission: vi.fn() as any,
      rememberSessionPermission: vi.fn(),
      sessionPermissionOverrides: new Map(),
      setSessionPermissionOverride: vi.fn(),
      clearSessionPermissionOverride: vi.fn(),
    };
  }

  it('handles auth/quota command with caching and push', async () => {
    const port = createMockPort();
    const service = new SubscriptionQuotaService({ port, cacheTtlMs: 10000 });
    const pushes: HostPush[] = [];
    const ctx = createMockContext(service, pushes);

    const res1 = await handleAuthCommand(
      { type: 'auth/quota', input: { providerId: 'openai-codex' } },
      'req-1',
      ctx,
    );

    expect(res1?.success).toBe(true);
    if (res1?.success) {
      expect(res1.data).toMatchObject({ quota: { providerId: 'openai-codex', planType: 'Plus' } });
    }
    expect(port.fetchQuota).toHaveBeenCalledTimes(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.type).toBe('auth/quota-updated');

    // Cached call without forceRefresh
    const res2 = await handleAuthCommand(
      { type: 'auth/quota', input: { providerId: 'openai-codex' } },
      'req-2',
      ctx,
    );
    expect(res2?.success).toBe(true);
    expect(port.fetchQuota).toHaveBeenCalledTimes(1);

    // Force refresh call
    const res3 = await handleAuthCommand(
      { type: 'auth/quota', input: { providerId: 'openai-codex', forceRefresh: true } },
      'req-3',
      ctx,
    );
    expect(res3?.success).toBe(true);
    expect(port.fetchQuota).toHaveBeenCalledTimes(2);
  });

  it('handles auth/reset-quota command and invalidates cache', async () => {
    const port = createMockPort();
    const service = new SubscriptionQuotaService({ port });
    const pushes: HostPush[] = [];
    const ctx = createMockContext(service, pushes);

    const res = await handleAuthCommand(
      { type: 'auth/reset-quota', input: { providerId: 'openai-codex' } },
      'req-reset',
      ctx,
    );

    expect(res?.success).toBe(true);
    if (res?.success) {
      expect(res.data).toMatchObject({ ok: true });
    }
    expect(port.resetQuota).toHaveBeenCalledWith('openai-codex');
    expect(pushes.some((p) => p.type === 'auth/quota-updated')).toBe(true);
  });
});
