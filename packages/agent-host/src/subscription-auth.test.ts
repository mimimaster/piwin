import { describe, expect, it, vi } from 'vitest';
import {
  createSubscriptionAuthPort,
  shouldRegisterCompiledProvider,
} from './subscription-auth.js';

describe('subscription auth port', () => {
  it('skips registerProvider for oauth envelopes', () => {
    expect(shouldRegisterCompiledProvider({ kind: 'oauth' })).toBe(false);
    expect(shouldRegisterCompiledProvider({ kind: 'env' })).toBe(true);
    expect(shouldRegisterCompiledProvider({ kind: 'none' })).toBe(true);
  });

  it('rejects providers Pi does not ship as oauth builtins', async () => {
    const login = vi.fn();
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [],
          isUsingSubscription: () => false,
          getModels: () => [],
          login,
          logout: async () => undefined,
          refresh: async () => undefined,
        }) as never,
    });
    const result = await port.login('antigravity', {
      prompt: async () => '',
      notify: () => undefined,
    });
    expect(result).toEqual({
      kind: 'failed',
      message: 'Unsupported subscription provider: antigravity',
      code: 'unsupported-subscription-provider',
    });
    expect(login).not.toHaveBeenCalled();
  });

  it('treats stored oauth as the only subscription signal', async () => {
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [
            { providerId: 'openai-codex', type: 'oauth' },
            { providerId: 'xai', type: 'api_key' },
          ],
          isUsingSubscription: (id: string) => id === 'openai-codex',
          getModels: () => [{ id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex' }],
          login: async () => undefined,
          logout: async () => undefined,
          refresh: async () => undefined,
        }) as never,
    });
    const credentials = await port.listCredentials();
    expect(credentials).toEqual([
      { providerId: 'openai-codex', type: 'oauth' },
      { providerId: 'xai', type: 'api_key' },
    ]);
    expect(port.isUsingSubscription('openai-codex')).toBe(true);
    expect(port.isUsingSubscription('xai')).toBe(false);
    expect(port.getChatCatalog('openai-codex')).toEqual([
      { id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex' },
    ]);
  });

  it('maps CredentialSynchronizationError to sync-error', async () => {
    const error = new Error('snapshot failed');
    error.name = 'CredentialSynchronizationError';
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [],
          isUsingSubscription: () => false,
          getModels: () => [],
          login: async () => {
            throw error;
          },
          logout: async () => undefined,
          refresh: async () => undefined,
        }) as never,
    });
    await expect(
      port.login('openai-codex', { prompt: async () => '', notify: () => undefined }),
    ).resolves.toEqual({ kind: 'sync-error', message: 'snapshot failed' });
  });

  it('prefers getAvailableModels and applies Copilot entitlements', async () => {
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [
            {
              providerId: 'github-copilot',
              type: 'oauth',
              availableModelIds: ['gpt-4.1'],
            },
          ],
          isUsingSubscription: () => true,
          getModels: () => [
            { id: 'gpt-4.1', name: 'GPT-4.1', reasoning: true, contextWindow: 128000 },
            { id: 'o3', name: 'o3' },
          ],
          getAvailableModels: () => [
            {
              id: 'gpt-4.1',
              name: 'GPT-4.1',
              reasoning: true,
              thinkingLevels: ['low'],
              input: ['text', 'image'],
              contextWindow: 128000,
              maxTokens: 16384,
              api: 'openai-completions',
            },
            { id: 'o3', name: 'o3' },
          ],
          login: async () => undefined,
          logout: async () => undefined,
          refresh: async () => undefined,
        }) as never,
    });
    await port.listCredentials();
    expect(port.getChatCatalog('github-copilot')).toEqual([
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        reasoning: true,
        thinkingLevels: ['low'],
        input: ['text', 'image'],
        contextWindow: 128000,
        maxOutputTokens: 16384,
        api: 'openai-completions',
      },
    ]);
  });

  it('projects supported thinkingLevelMap entries when thinkingLevels is absent', async () => {
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [{ providerId: 'openai-codex', type: 'oauth' }],
          isUsingSubscription: () => true,
          getModels: () => [],
          getAvailableModels: () => [
            {
              id: 'gpt-6-astra',
              name: 'GPT-6 Astra',
              reasoning: true,
              thinkingLevelMap: {
                off: null,
                minimal: 'low',
                low: 'low',
                medium: 'medium',
                high: 'high',
                xhigh: 'xhigh',
                max: 'max',
              },
              input: ['text', 'image'],
            },
          ],
          login: async () => undefined,
          logout: async () => undefined,
          refresh: async () => undefined,
        }) as never,
    });
    expect(port.getChatCatalog('openai-codex')).toEqual([
      {
        id: 'gpt-6-astra',
        name: 'GPT-6 Astra',
        reasoning: true,
        thinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        input: ['text', 'image'],
      },
    ]);
  });

  it('does not treat null thinkingLevelMap entries as UI options', async () => {
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [{ providerId: 'xai', type: 'oauth' }],
          isUsingSubscription: () => true,
          getModels: () => [],
          getAvailableModels: () => [
            {
              id: 'grok-4.5',
              name: 'Grok 4.5',
              reasoning: true,
              thinkingLevelMap: {
                off: null,
                minimal: null,
                low: 'low',
                medium: 'medium',
                high: 'high',
                xhigh: null,
                max: null,
              },
            },
          ],
          login: async () => undefined,
          logout: async () => undefined,
          refresh: async () => undefined,
        }) as never,
    });
    expect(port.getChatCatalog('xai')).toEqual([
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        reasoning: true,
        thinkingLevels: ['low', 'medium', 'high'],
      },
    ]);
  });

  it('fails refresh when Pi returns errors without throwing', async () => {
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [],
          isUsingSubscription: () => false,
          getModels: () => [],
          login: async () => undefined,
          logout: async () => undefined,
          refresh: async () => ({ errors: [{ message: 'token expired' }] }),
        }) as never,
    });
    await expect(port.refreshProvider('openai-codex')).rejects.toThrow('token expired');
  });

  it('forwards per-prompt abort signals', async () => {
    const seen: AbortSignal[] = [];
    const port = await createSubscriptionAuthPort({
      authPath: '/tmp/auth.json',
      createRuntime: async () =>
        ({
          listCredentials: async () => [],
          isUsingSubscription: () => false,
          getModels: () => [],
          login: async (
            _id: string,
            _type: 'oauth',
            interaction: {
              prompt: (prompt: { type: 'manual_code'; message: string; signal: AbortSignal }) => Promise<string>;
            },
          ) => {
            await interaction.prompt({
              type: 'manual_code',
              message: 'code',
              signal: AbortSignal.timeout(1),
            });
          },
          logout: async () => undefined,
          refresh: async () => undefined,
        }) as never,
    });
    await port.login('openai-codex', {
      prompt: async (prompt) => {
        if (prompt.signal) {
          seen.push(prompt.signal);
        }
        return 'skip';
      },
      notify: () => undefined,
    });
    expect(seen).toHaveLength(1);
  });
});
