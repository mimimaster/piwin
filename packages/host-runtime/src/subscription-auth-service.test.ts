import { describe, expect, it } from 'vitest';
import type { HostPush, PiwinConfig } from '@piwin/contracts';
import type { SubscriptionAuthPort } from '@piwin/agent-host';
import { createDefaultPiwinConfig } from './config-store.js';
import { SubscriptionAuthService } from './subscription-auth-service.js';

function fakePort(): SubscriptionAuthPort {
  return {
    listCredentials: async () => [],
    isUsingSubscription: () => false,
    getChatCatalog: () => [],
    login: async () => ({ kind: 'ok' }),
    logout: async () => ({ kind: 'ok' }),
    refreshProvider: async () => undefined,
    refreshLiveCatalog: async () => undefined,
    fetchQuota: async (id) => ({
      providerId: id,
      groups: [],
      lastUpdated: new Date().toISOString(),
    }),
    resetQuota: async () => ({ ok: true }),
    dispose: () => undefined,
  };
}

function loggedInXaiPort(): SubscriptionAuthPort {
  return {
    listCredentials: async () => [{ providerId: 'xai', type: 'oauth' }],
    isUsingSubscription: (providerId) => providerId === 'xai',
    getChatCatalog: (providerId) =>
      providerId === 'xai'
        ? [
            { id: 'grok-4.6', name: 'Grok 4.6' },
            { id: 'grok-4.5', name: 'Grok 4.5' },
          ]
        : [],
    login: async () => ({ kind: 'ok' }),
    logout: async () => ({ kind: 'ok' }),
    refreshProvider: async () => undefined,
    refreshLiveCatalog: async () => undefined,
    fetchQuota: async (id) => ({
      providerId: id,
      groups: [],
      lastUpdated: new Date().toISOString(),
    }),
    resetQuota: async () => ({ ok: true }),
    dispose: () => undefined,
  };
}

function grokSubscriptionProvider(
  overrides: Partial<PiwinConfig['providers'][number]> = {},
): PiwinConfig['providers'][number] {
  return {
    id: 'xai',
    name: 'Grok',
    protocol: 'openai-compatible',
    baseUrl: 'oauth://xai',
    source: 'subscription',
    models: [
      { id: 'grok-4.6', label: 'Grok 4.6', capabilities: ['chat'] },
      { id: 'grok-4.5', label: 'Grok 4.5', capabilities: ['chat'] },
    ],
    ...overrides,
  };
}

describe('SubscriptionAuthService', () => {
  it('pushes prompt-cancelled when Pi aborts a prompt', async () => {
    const pushes: HostPush[] = [];
    const port = fakePort();
    port.login = async (_providerId, interaction) => {
      const signal = new AbortController();
      const pending = interaction.prompt({
        type: 'manual_code',
        message: 'paste code',
        signal: signal.signal,
      });
      signal.abort();
      await pending.catch(() => undefined);
      return { kind: 'ok' };
    };
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    service.bindPush((message) => {
      pushes.push(message);
    });
    await service.login({
      providerId: 'openai-codex',
      ownerDeviceId: 'desktop-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushes.some((message) => message.type === 'auth/prompt' && message.prompt.kind === 'prompt-cancelled')).toBe(
      true,
    );
  });

  it('auto-selects Codex browser login instead of headless device code', async () => {
    const selected: string[] = [];
    const port = fakePort();
    port.login = async (_providerId, interaction) => {
      selected.push(
        await interaction.prompt({
          type: 'select',
          message: 'Select OpenAI Codex login method:',
          options: [
            { id: 'browser', label: 'Browser login (default)' },
            { id: 'device_code', label: 'Device code login (headless)' },
          ],
        }),
      );
      interaction.notify({
        type: 'auth_url',
        url: 'https://auth.openai.com/oauth/authorize?client_id=app',
      });
      return { kind: 'ok' };
    };
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    await service.login({
      providerId: 'openai-codex',
      ownerDeviceId: 'desktop-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(selected).toEqual(['browser']);
  });

  it('opens the auth URL on the Host when Pi notifies', async () => {
    const opened: string[] = [];
    const port = fakePort();
    port.login = async (_providerId, interaction) => {
      interaction.notify({
        type: 'auth_url',
        url: 'https://chatgpt.com/connect',
        instructions: 'finish in browser',
      });
      return { kind: 'ok' };
    };
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port, openAuthUrl: (url) => opened.push(url) },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    await service.login({
      providerId: 'openai-codex',
      ownerDeviceId: 'desktop-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toEqual(['https://chatgpt.com/connect']);
  });

  it('refreshProvider forwards to the auth port', async () => {
    const refreshed: string[] = [];
    const port = fakePort();
    port.refreshProvider = async (providerId) => {
      refreshed.push(providerId);
    };
    const config: PiwinConfig = createDefaultPiwinConfig();
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    await service.refreshProvider('openai-codex');
    expect(refreshed).toEqual(['openai-codex']);
  });

  it('refreshes the live catalog with network after seeding logged-in providers', async () => {
    const live: Array<{ providers?: readonly string[]; signal?: AbortSignal }> = [];
    let catalog = [{ id: 'builtin', name: 'Builtin' }];
    const port: SubscriptionAuthPort = {
      ...fakePort(),
      listCredentials: async () => [{ providerId: 'openai-codex', type: 'oauth' }],
      isUsingSubscription: (id) => id === 'openai-codex',
      getChatCatalog: () => catalog,
      refreshLiveCatalog: async (options) => {
        live.push(options ?? {});
        catalog = [{ id: 'overlay-model', name: 'Overlay' }];
      },
    };
    let saved: PiwinConfig | undefined;
    const service = new SubscriptionAuthService(
      { port },
      {
        loadConfig: async () => createDefaultPiwinConfig(),
        saveConfig: async (config) => {
          saved = config;
        },
      },
    );
    await service.ensureLoggedInProviders();
    expect(live).toHaveLength(1);
    expect(live[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(service.catalogModelIds('openai-codex')).toEqual(['overlay-model']);
    expect(saved?.providers.some((provider) => provider.id === 'openai-codex')).toBe(true);
  });

  it('keeps the builtin catalog when live refresh fails', async () => {
    const port: SubscriptionAuthPort = {
      ...fakePort(),
      listCredentials: async () => [{ providerId: 'openai-codex', type: 'oauth' }],
      isUsingSubscription: (id) => id === 'openai-codex',
      getChatCatalog: () => [{ id: 'builtin', name: 'Builtin' }],
      refreshLiveCatalog: async () => {
        throw new Error('pi.dev unreachable');
      },
    };
    const service = new SubscriptionAuthService(
      { port },
      {
        loadConfig: async () => createDefaultPiwinConfig(),
        saveConfig: async () => undefined,
      },
    );
    await expect(service.ensureLoggedInProviders()).resolves.toBeTruthy();
    expect(service.catalogModelIds('openai-codex')).toEqual(['builtin']);
  });

  it('does not resurrect catalog models from a disabled subscription provider', async () => {
    const config: PiwinConfig = {
      ...createDefaultPiwinConfig(),
      providers: [grokSubscriptionProvider({ enabled: false })],
    };
    const service = new SubscriptionAuthService(
      { port: loggedInXaiPort() },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    const merged = await service.mergeConfiguredModels({ models: [] });
    expect(merged.models).toEqual([]);
  });

  it('does not resurrect a disabled model from an enabled subscription provider', async () => {
    const config: PiwinConfig = {
      ...createDefaultPiwinConfig(),
      providers: [
        grokSubscriptionProvider({
          models: [
            { id: 'grok-4.6', label: 'Grok 4.6', capabilities: ['chat'] },
            { id: 'grok-4.5', label: 'Grok 4.5', capabilities: ['chat'], enabled: false },
          ],
        }),
      ],
    };
    const service = new SubscriptionAuthService(
      { port: loggedInXaiPort() },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    const merged = await service.mergeConfiguredModels({ models: [] });
    expect(merged.models).toEqual([
      {
        providerId: 'xai',
        modelId: 'grok-4.6',
        label: 'Grok 4.6',
        source: 'subscription',
        group: 'subscription',
      },
    ]);
  });

  it('overlays catalog thinkingLevels onto already projected subscription models', async () => {
    const port = loggedInXaiPort();
    port.getChatCatalog = (providerId) =>
      providerId === 'xai'
        ? [
            {
              id: 'grok-4.5',
              name: 'Grok 4.5',
              reasoning: true,
              thinkingLevels: ['low', 'medium', 'high'],
            },
          ]
        : [];
    const config: PiwinConfig = {
      ...createDefaultPiwinConfig(),
      providers: [grokSubscriptionProvider()],
    };
    const service = new SubscriptionAuthService(
      { port },
      { loadConfig: async () => config, saveConfig: async () => undefined },
    );
    const merged = await service.mergeConfiguredModels({
      models: [
        {
          providerId: 'xai',
          modelId: 'grok-4.5',
          label: 'Grok 4.5',
          thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        },
      ],
    });
    expect(merged.models.find((model) => model['modelId'] === 'grok-4.5')?.['thinkingLevels']).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('removes subscription providers from config on logout', async () => {
    let credentials: Array<{ providerId: string; type: 'oauth' }> = [{ providerId: 'xai', type: 'oauth' }];
    const port = loggedInXaiPort();
    port.listCredentials = async () => credentials;
    port.logout = async () => {
      credentials = [];
      return { kind: 'ok' };
    };
    let config: PiwinConfig = {
      ...createDefaultPiwinConfig(),
      defaultProviderId: 'xai',
      defaultModelId: 'grok-4.6',
      providers: [
        grokSubscriptionProvider(),
        {
          id: 'custom-openai',
          name: 'Local',
          protocol: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: [{ id: 'llama' }],
        },
      ],
    };
    const service = new SubscriptionAuthService(
      { port },
      {
        loadConfig: async () => config,
        saveConfig: async (next) => {
          config = next;
        },
      },
    );
    await service.logout('xai');
    expect(config.providers.map((provider) => provider.id)).toEqual(['custom-openai']);
    expect(config.defaultProviderId).toBeUndefined();
    expect(config.defaultModelId).toBeUndefined();
  });
});
