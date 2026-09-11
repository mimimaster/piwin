/**
 * Host-facing port over Pi ModelRuntime login/logout/listCredentials.
 * Apps and host-runtime never import Pi packages.
 */
import { join } from 'node:path';
import {
  isV1SubscriptionProviderId,
  type AuthPromptOption,
  type SubscriptionAccountQuota,
} from '@piwin/contracts';
import {
  fetchSubscriptionQuota,
  resetSubscriptionQuota,
} from './subscription-quota-fetcher.js';
import { thinkingLevelsFromPiMap } from './map-thinking-level.js';

export type SubscriptionCredentialType = 'oauth' | 'api_key';

export type SubscriptionCredentialInfo = {
  providerId: string;
  type: SubscriptionCredentialType;
  availableModelIds?: readonly string[];
};

export type SubscriptionCatalogModel = {
  id: string;
  name: string;
  reasoning?: boolean;
  thinkingLevels?: readonly string[];
  input?: readonly ('text' | 'image')[];
  contextWindow?: number;
  maxOutputTokens?: number;
  api?: string;
};

export type HostAuthPrompt = {
  type: 'text' | 'secret' | 'select' | 'manual_code';
  message: string;
  placeholder?: string;
  options?: readonly AuthPromptOption[];
  signal?: AbortSignal;
};

export type HostAuthEvent =
  | { type: 'info'; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: 'progress'; message: string };

export type HostAuthInteraction = {
  signal?: AbortSignal;
  prompt: (prompt: HostAuthPrompt) => Promise<string>;
  notify: (event: HostAuthEvent) => void;
};

export type SubscriptionLoginOutcome =
  | { kind: 'ok' }
  | { kind: 'sync-error'; message: string }
  | { kind: 'failed'; message: string; code?: string };

export type SubscriptionLogoutOutcome =
  | { kind: 'ok' }
  | { kind: 'sync-error'; message: string }
  | { kind: 'failed'; message: string };

export type SubscriptionAuthPort = {
  listCredentials: () => Promise<readonly SubscriptionCredentialInfo[]>;
  isUsingSubscription: (providerId: string) => boolean;
  getChatCatalog: (providerId: string) => readonly SubscriptionCatalogModel[];
  login: (providerId: string, interaction: HostAuthInteraction) => Promise<SubscriptionLoginOutcome>;
  logout: (providerId: string) => Promise<SubscriptionLogoutOutcome>;
  refreshProvider: (providerId: string) => Promise<void>;
  fetchQuota: (providerId: string) => Promise<SubscriptionAccountQuota>;
  resetQuota: (
    providerId: string,
  ) => Promise<{ ok: boolean; message?: string; quota?: SubscriptionAccountQuota }>;
  dispose: () => void;
};

type PiAuthPrompt = {
  type: 'text' | 'secret' | 'select' | 'manual_code';
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
  signal?: AbortSignal;
};

type PiAuthEvent = {
  type: 'info' | 'auth_url' | 'device_code' | 'progress';
  message?: string;
  url?: string;
  instructions?: string;
  links?: readonly { url: string; label?: string }[];
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
};

type PiCatalogModel = {
  id: string;
  name?: string;
  reasoning?: boolean;
  thinkingLevels?: readonly string[];
  thinkingLevelMap?: Readonly<Record<string, string | null | undefined>>;
  input?: readonly ('text' | 'image')[];
  contextWindow?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
  api?: string;
};

type PiModelRuntimeLike = {
  listCredentials: () => Promise<
    readonly { providerId: string; type: string; availableModelIds?: readonly string[] }[]
  >;
  isUsingSubscription: (providerId: string) => boolean;
  getModels: (providerId?: string) => readonly PiCatalogModel[];
  getAvailableModels?: (providerId?: string) => readonly PiCatalogModel[];
  login: (
    providerId: string,
    type: 'oauth',
    interaction: {
      signal?: AbortSignal;
      prompt: (prompt: PiAuthPrompt) => Promise<string>;
      notify: (event: PiAuthEvent) => void;
    },
  ) => Promise<unknown>;
  logout: (providerId: string) => Promise<void>;
  refresh: (options: { providers?: string[]; allowNetwork: boolean }) => Promise<unknown>;
};

export type CreateSubscriptionAuthPortOptions = {
  authPath: string;
  modelsPath?: string;
  createRuntime?: (options: {
    authPath: string;
    modelsPath?: string;
  }) => Promise<PiModelRuntimeLike>;
};

export function isOauthProviderAuth(
  auth: { kind: string },
): auth is { kind: 'oauth'; providerId: string } {
  return auth.kind === 'oauth';
}

export function shouldRegisterCompiledProvider(auth: { kind: string }): boolean {
  return auth.kind !== 'oauth';
}

export async function createSubscriptionAuthPort(
  options: CreateSubscriptionAuthPortOptions,
): Promise<SubscriptionAuthPort> {
  const runtime = options.createRuntime
    ? await options.createRuntime({
        authPath: options.authPath,
        ...(options.modelsPath !== undefined ? { modelsPath: options.modelsPath } : {}),
      })
    : await createDefaultRuntime(options.authPath, options.modelsPath);
  const entitlements = new Map<string, ReadonlySet<string>>();

  return {
    async listCredentials() {
      const listed = await runtime.listCredentials();
      entitlements.clear();
      return listed.flatMap((entry) => {
        if (entry.type !== 'oauth' && entry.type !== 'api_key') {
          return [];
        }
        const listedEntry: SubscriptionCredentialInfo = {
          providerId: entry.providerId,
          type: entry.type,
        };
        if (Array.isArray(entry.availableModelIds) && entry.availableModelIds.length > 0) {
          const ids = entry.availableModelIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          );
          listedEntry.availableModelIds = ids;
          entitlements.set(entry.providerId, new Set(ids));
        }
        return [listedEntry];
      });
    },
    isUsingSubscription(providerId) {
      return runtime.isUsingSubscription(providerId);
    },
    getChatCatalog(providerId) {
      const raw =
        typeof runtime.getAvailableModels === 'function'
          ? runtime.getAvailableModels(providerId)
          : runtime.getModels(providerId);
      const models = raw.map(mapCatalogModel);
      const allowed = entitlements.get(providerId);
      return allowed ? models.filter((model) => allowed.has(model.id)) : models;
    },
    async login(providerId, interaction) {
      if (!isV1SubscriptionProviderId(providerId)) {
        return {
          kind: 'failed',
          message: `Unsupported subscription provider: ${providerId}`,
          code: 'unsupported-subscription-provider',
        };
      }
      try {
        await runtime.login(providerId, 'oauth', {
          ...(interaction.signal !== undefined ? { signal: interaction.signal } : {}),
          prompt: (prompt) => interaction.prompt(mapPrompt(prompt)),
          notify: (event) => interaction.notify(mapEvent(event)),
        });
        return { kind: 'ok' };
      } catch (error) {
        return mapCredentialError(error, 'login');
      }
    },
    async logout(providerId) {
      try {
        await runtime.logout(providerId);
        return { kind: 'ok' };
      } catch (error) {
        return mapLogoutError(error);
      }
    },
    async refreshProvider(providerId) {
      const result = await runtime.refresh({ providers: [providerId], allowNetwork: true });
      const errors = readRefreshErrors(result);
      if (errors.length > 0) {
        throw Object.assign(new Error(errors.join('; ')), { code: 'credential-sync-failed' });
      }
    },
    async fetchQuota(providerId) {
      return fetchSubscriptionQuota({
        authPath: options.authPath,
        providerId,
        refreshCredentials: async () => {
          await runtime.refresh({ providers: [providerId], allowNetwork: true });
        },
      });
    },
    async resetQuota(providerId) {
      return resetSubscriptionQuota({
        authPath: options.authPath,
        providerId,
        refreshCredentials: async () => {
          await runtime.refresh({ providers: [providerId], allowNetwork: true });
        },
      });
    },
    dispose() {
      // Pi ModelRuntime has no dispose; Host owns one instance for the process.
    },
  };
}

export function defaultPiAuthPaths(agentDir: string): { authPath: string; modelsPath: string } {
  return {
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  };
}

async function createDefaultRuntime(
  authPath: string,
  modelsPath?: string,
): Promise<PiModelRuntimeLike> {
  const piModule = (await import('@earendil-works/pi-coding-agent')) as {
    ModelRuntime?: {
      create: (options: {
        authPath: string;
        modelsPath?: string;
        refreshOnCreate?: boolean;
        allowModelNetwork?: boolean;
      }) => Promise<PiModelRuntimeLike>;
    };
  };
  if (!piModule.ModelRuntime?.create) {
    throw new Error('Pi ModelRuntime export missing from @earendil-works/pi-coding-agent');
  }
  return piModule.ModelRuntime.create({
    authPath,
    ...(modelsPath !== undefined ? { modelsPath } : {}),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
}

function mapPrompt(prompt: PiAuthPrompt): HostAuthPrompt {
  const mapped: HostAuthPrompt = {
    type: prompt.type,
    message: prompt.message,
  };
  if (prompt.placeholder !== undefined) {
    mapped.placeholder = prompt.placeholder;
  }
  if (prompt.options !== undefined) {
    mapped.options = prompt.options.map((option) => {
      const mappedOption: AuthPromptOption = { id: option.id, label: option.label };
      if (option.description !== undefined) {
        mappedOption.description = option.description;
      }
      return mappedOption;
    });
  }
  if (prompt.signal !== undefined) {
    mapped.signal = prompt.signal;
  }
  return mapped;
}

function mapCatalogModel(model: PiCatalogModel): SubscriptionCatalogModel {
  const mapped: SubscriptionCatalogModel = {
    id: model.id,
    name: model.name?.trim() || model.id,
  };
  if (typeof model.reasoning === 'boolean') {
    mapped.reasoning = model.reasoning;
  }
  if (Array.isArray(model.thinkingLevels) && model.thinkingLevels.length > 0) {
    mapped.thinkingLevels = model.thinkingLevels;
  } else {
    const fromMap = thinkingLevelsFromPiMap(model.thinkingLevelMap);
    if (fromMap) {
      mapped.thinkingLevels = fromMap;
    }
  }
  if (Array.isArray(model.input) && model.input.length > 0) {
    mapped.input = model.input;
  }
  if (typeof model.contextWindow === 'number') {
    mapped.contextWindow = model.contextWindow;
  }
  const maxTokens = model.maxOutputTokens ?? model.maxTokens;
  if (typeof maxTokens === 'number') {
    mapped.maxOutputTokens = maxTokens;
  }
  if (typeof model.api === 'string' && model.api.length > 0) {
    mapped.api = model.api;
  }
  return mapped;
}

function readRefreshErrors(result: unknown): string[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const errors = (result as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) {
      return [entry];
    }
    if (entry && typeof entry === 'object' && 'message' in entry) {
      const message = (entry as { message?: unknown }).message;
      return typeof message === 'string' && message.trim() ? [message] : [];
    }
    return [];
  });
}

function mapEvent(event: PiAuthEvent): HostAuthEvent {
  switch (event.type) {
    case 'auth_url':
      return {
        type: 'auth_url',
        url: event.url ?? '',
        ...(event.instructions !== undefined ? { instructions: event.instructions } : {}),
      };
    case 'device_code':
      return {
        type: 'device_code',
        userCode: event.userCode ?? '',
        verificationUri: event.verificationUri ?? '',
        ...(event.intervalSeconds !== undefined ? { intervalSeconds: event.intervalSeconds } : {}),
        ...(event.expiresInSeconds !== undefined ? { expiresInSeconds: event.expiresInSeconds } : {}),
      };
    case 'progress':
      return { type: 'progress', message: event.message ?? '' };
    case 'info':
      return {
        type: 'info',
        message: event.message ?? '',
        ...(event.links !== undefined ? { links: event.links } : {}),
      };
  }
}

function mapCredentialError(error: unknown, operation: 'login'): SubscriptionLoginOutcome {
  if (isCredentialSynchronizationError(error)) {
    return { kind: 'sync-error', message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/EADDRINUSE|address already in use|listen EADDRINUSE/i.test(message)) {
    return { kind: 'failed', message, code: 'oauth-callback-port-busy' };
  }
  return { kind: 'failed', message, ...(operation === 'login' ? {} : {}) };
}

function mapLogoutError(error: unknown): SubscriptionLogoutOutcome {
  if (isCredentialSynchronizationError(error)) {
    return { kind: 'sync-error', message: error.message };
  }
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
}

function isCredentialSynchronizationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === 'CredentialSynchronizationError' ||
      /CredentialSynchronizationError/.test(error.constructor.name))
  );
}
