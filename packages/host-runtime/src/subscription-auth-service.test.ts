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
    dispose: () => undefined,
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
});
