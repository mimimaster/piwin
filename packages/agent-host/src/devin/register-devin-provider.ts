import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { loginDevin } from './oauth.js';
import { DEVIN_FALLBACK_MODELS, discoverDevinModels } from './discovery.js';
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

export function registerDevinOauthProvider(runtime: DevinModelRuntime): void {
  runtime.registerProvider(DEVIN_PROVIDER_ID, buildDevinProviderConfig(DEVIN_FALLBACK_MODELS));
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
      refreshToken: async (credentials: OAuthCredentials) => credentials,
      getApiKey: (credentials: OAuthCredentials) => credentials.access,
    },
    streamSimple: streamDevin,
  };
}
