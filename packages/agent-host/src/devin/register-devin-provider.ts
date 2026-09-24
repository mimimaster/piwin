import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import type { SerializableProviderRuntime } from '../rpc/serializable-blueprint.js';
import { loginDevin, refreshDevinCredentials } from './oauth.js';
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEVIN_FALLBACK_MODELS,
  discoverDevinModels,
} from './discovery.js';
import { DEVIN_API, DEVIN_HOST, DEVIN_PROVIDER_ID } from './protocol.js';
import { streamDevin } from './stream.js';

/**
 * Structural seam: Pi's product registration type only allows openai/anthropic/google.
 * Devin uses api `devin-cloud` and must go through a widened registerProvider.
 */
export type DevinModelRuntime = {
  registerProvider(id: string, config: object): void;
};

type RefreshModelsContext = {
  credential?: { type: string; access?: string };
  allowNetwork: boolean;
  signal: AbortSignal;
};

/**
 * Register Devin with the models this session may select.
 *
 * The fallback list only names two models, while the picker offers the live
 * account catalog (e.g. `swe-1-6-slow`). A session runtime never refreshes
 * models, so registering the fallback alone made every catalog-only pick fail
 * with "Configured model is unavailable". The compiled provider envelope
 * carries that catalog; it wins over the fallback for the same id.
 */
export function registerDevinOauthProvider(
  runtime: DevinModelRuntime,
  provider?: Pick<SerializableProviderRuntime, 'models'>,
): void {
  runtime.registerProvider(
    DEVIN_PROVIDER_ID,
    buildDevinProviderConfig(mergeDevinModels(provider?.models ?? [])),
  );
}

export function mergeDevinModels(
  catalog: SerializableProviderRuntime['models'],
): Model<Api>[] {
  const fromCatalog: Model<Api>[] = catalog.map((model) => {
    const contextWindow = model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    return {
      id: model.id,
      name: model.label?.trim() || model.id,
      api: DEVIN_API,
      provider: DEVIN_PROVIDER_ID,
      baseUrl: DEVIN_HOST,
      reasoning: model.reasoning ?? true,
      input: model.input ? [...model.input] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: model.maxOutputTokens ?? Math.min(contextWindow, DEFAULT_MAX_TOKENS),
    };
  });
  const listed = new Set(fromCatalog.map((model) => model.id));
  return [...fromCatalog, ...DEVIN_FALLBACK_MODELS.filter((model) => !listed.has(model.id))];
}

function buildDevinProviderConfig(currentModels: Model<Api>[]) {
  return {
    name: 'Devin',
    api: DEVIN_API,
    baseUrl: DEVIN_HOST,
    models: currentModels,
    async refreshModels({ credential, allowNetwork, signal }: RefreshModelsContext) {
      if (!allowNetwork || credential?.type !== 'oauth' || !credential.access) {
        return currentModels;
      }
      try {
        const discovered = await discoverDevinModels(credential.access, signal);
        return discovered.length ? discovered : currentModels;
      } catch {
        return currentModels;
      }
    },
    oauth: {
      name: 'Devin OAuth',
      login: (callbacks: OAuthLoginCallbacks) => loginDevin(callbacks),
      refreshToken: (credentials: OAuthCredentials) => refreshDevinCredentials(credentials),
      getApiKey: (credentials: OAuthCredentials) => credentials.access,
    },
    streamSimple: streamDevin,
  };
}
