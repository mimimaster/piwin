import { describe, expect, it } from 'vitest';
import type { HostPush, HostResponse, PiwinConfig } from '@piwin/contracts';
import type { SubscriptionAuthPort } from '@piwin/agent-host';
import { createDefaultPiwinConfig } from '../config-store.js';
import { SubscriptionAuthService } from '../subscription-auth-service.js';
import { handleAuthCommand } from './auth-commands.js';
import type { HostCommandContext } from './host-command-context.js';

function fakePort(): {
  credentials: { providerId: string; type: 'oauth' | 'api_key' }[];
  port: SubscriptionAuthPort;
} {
  const credentials: { providerId: string; type: 'oauth' | 'api_key' }[] = [];
  return {
    credentials,
    port: {
      listCredentials: async () => credentials,
      isUsingSubscription: (id) =>
        credentials.some((entry) => entry.providerId === id && entry.type === 'oauth'),
      getChatCatalog: (id) =>
        id === 'openai-codex' ? [{ id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex' }] : [],
      login: async () => {
        credentials.push({ providerId: 'openai-codex', type: 'oauth' });
        return { kind: 'ok' };
      },
      logout: async () => {
        credentials.splice(0, credentials.length);
        return { kind: 'ok' };
      },
      refreshProvider: async () => undefined,
      dispose: () => undefined,
    },
  };
}

function context(service: SubscriptionAuthService, pushes: HostPush[]): HostCommandContext {
  return {
    push: (message) => {
      pushes.push(message);
    },
    requireSession: () => {
      throw new Error('unused');
    },
    getMcpManager: () => {
      throw new Error('unused');
    },
    getJobController: () => {
      throw new Error('unused');
    },
    todoStore: {} as HostCommandContext['todoStore'],
    petStateStore: {} as HostCommandContext['petStateStore'],
    runCronJob: async () => ({ ok: true }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => undefined,
    rememberSessionPermission: () => undefined,
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => undefined,
    clearSessionPermissionOverride: () => undefined,
    subscriptionAuth: service,
    devicePrincipalId: 'desktop-1',
  };
}

function responseData(response: HostResponse | null): unknown {
  if (!response?.success) {
    throw new Error(response?.error ?? 'expected success');
  }
  return response.data;
}

describe('auth commands', () => {
  it('lists Pi oauth cards and rejects unknown providers', async () => {
    const { port } = fakePort();
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    const ctx = context(service, []);
    const status = await handleAuthCommand({ type: 'auth/status' }, '1', ctx);
    const data = responseData(status) as { accounts: { providerId: string }[] };
    expect(data.accounts.map((account) => account.providerId)).toEqual([
      'kimi-coding',
      'openai-codex',
      'anthropic',
      'xai',
      'github-copilot',
    ]);

    const unknown = await handleAuthCommand(
      { type: 'auth/login', input: { providerId: 'antigravity', ownerDeviceId: 'desktop-1' } },
      '2',
      ctx,
    );
    expect(unknown?.success).toBe(false);
    if (unknown?.success === false) {
      expect(unknown.problem?.code).toBe('unsupported-subscription-provider');
    }
  });

  it('logs into Codex and merges subscription models', async () => {
    const { port, credentials } = fakePort();
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      {
        loadConfig: async () => config,
        saveConfig: async (next) => {
          Object.assign(config, next);
        },
      },
    );
    const ctx = context(service, []);
    const login = await handleAuthCommand(
      {
        type: 'auth/login',
        input: { providerId: 'openai-codex', ownerDeviceId: 'desktop-1' },
      },
      '1',
      ctx,
    );
    expect(login?.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(credentials).toEqual([{ providerId: 'openai-codex', type: 'oauth' }]);
    expect(config.providers[0]).toMatchObject({
      id: 'openai-codex',
      source: 'subscription',
      models: [{ id: 'gpt-5.4-codex', label: 'GPT-5.4 Codex' }],
    });
    const merged = await service.mergeConfiguredModels({ models: [] });
    expect(merged.models).toEqual([
      {
        providerId: 'openai-codex',
        modelId: 'gpt-5.4-codex',
        label: 'GPT-5.4 Codex',
        source: 'subscription',
        group: 'subscription',
      },
    ]);
  });

  it('overlays the catalog context window, input, and reasoning onto already-projected models', async () => {
    const port: SubscriptionAuthPort = {
      listCredentials: async () => [{ providerId: 'xai', type: 'oauth' }],
      isUsingSubscription: () => true,
      getChatCatalog: (id) =>
        id === 'xai'
          ? [
              {
                id: 'grok-4.6',
                name: 'Grok 4.6',
                input: ['text', 'image'],
                reasoning: true,
                contextWindow: 500_000,
                maxOutputTokens: 500_000,
              },
            ]
          : [],
      login: async () => ({ kind: 'ok' }),
      logout: async () => ({ kind: 'ok' }),
      refreshProvider: async () => undefined,
      dispose: () => undefined,
    };
    const service = new SubscriptionAuthService(
      { port },
      {
        loadConfig: async () => createDefaultPiwinConfig(),
        saveConfig: async () => undefined,
      },
    );
    const merged = await service.mergeConfiguredModels({
      models: [
        {
          providerId: 'xai',
          modelId: 'grok-4.6',
          source: 'subscription',
          group: 'subscription',
          contextWindow: 128_000,
        },
      ],
    });
    expect(merged.models).toEqual([
      {
        providerId: 'xai',
        modelId: 'grok-4.6',
        source: 'subscription',
        group: 'subscription',
        input: ['text', 'image'],
        reasoning: true,
        contextWindow: 500_000,
        maxOutputTokens: 500_000,
      },
    ]);
  });

  it('rejects respond from a different device', async () => {
    const { port } = fakePort();
    port.login = async (_providerId, interaction) => {
      await interaction.prompt({ type: 'text', message: 'code' });
      return { kind: 'ok' };
    };
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    const ctx = context(service, []);
    const login = await handleAuthCommand(
      {
        type: 'auth/login',
        input: { providerId: 'openai-codex', ownerDeviceId: 'desktop-1' },
      },
      '1',
      ctx,
    );
    expect(login?.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = await handleAuthCommand({ type: 'auth/status' }, '2', ctx);
    const promptId = (responseData(status) as { activeLogin?: { currentPrompt?: { promptId: string } } })
      .activeLogin?.currentPrompt?.promptId;
    expect(promptId).toBeTruthy();
    const rejected = await handleAuthCommand(
      {
        type: 'auth/respond',
        input: {
          loginId: (responseData(login) as { loginId: string }).loginId,
          promptId: promptId ?? '',
          value: 'secret',
          ownerDeviceId: 'other-device',
        },
      },
      '3',
      ctx,
    );
    expect(rejected?.success).toBe(false);
    if (rejected?.success === false) {
      expect(rejected.problem?.code).toBe('auth-not-owner');
    }
  });

  it('allows claim only after the owner device disconnects', async () => {
    const { port } = fakePort();
    port.login = async (_providerId, interaction) => {
      await interaction.prompt({ type: 'text', message: 'code' });
      return { kind: 'ok' };
    };
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    service.noteDeviceConnected('desktop-1');
    const ctx = context(service, []);
    const login = await handleAuthCommand(
      {
        type: 'auth/login',
        input: { providerId: 'openai-codex', ownerDeviceId: 'desktop-1' },
      },
      '1',
      ctx,
    );
    expect(login?.success).toBe(true);
    const loginId = (responseData(login) as { loginId: string }).loginId;
    const blocked = await handleAuthCommand(
      { type: 'auth/claim', input: { loginId, ownerDeviceId: 'desktop-2' } },
      '2',
      ctx,
    );
    expect(blocked?.success).toBe(false);
    service.noteDeviceDisconnected('desktop-1');
    const claimed = await handleAuthCommand(
      { type: 'auth/claim', input: { loginId, ownerDeviceId: 'desktop-2' } },
      '3',
      ctx,
    );
    expect(claimed?.success).toBe(true);
  });

  it('does not delete credentials when logout teardown fails', async () => {
    const { port, credentials } = fakePort();
    credentials.push({ providerId: 'openai-codex', type: 'oauth' });
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    const ctx = {
      ...context(service, []),
      cancelRunsForProvider: async () => {
        throw new Error('teardown failed');
      },
    };
    const logout = await handleAuthCommand(
      { type: 'auth/logout', input: { providerId: 'openai-codex' } },
      '1',
      ctx,
    );
    expect(logout?.success).toBe(false);
    expect(credentials).toEqual([{ providerId: 'openai-codex', type: 'oauth' }]);
  });
});
