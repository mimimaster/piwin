import type { ModelDiscoveryResult, PiwinConfig } from '@piwin/contracts';
import { isExtensionProvider } from '@piwin/contracts';
import { LIVE_CATALOG_REFRESH_TIMEOUT_MS, type SubscriptionAuthPort } from '@piwin/agent-host';
import { catalogModelToConfigEntry } from './seed-subscription-provider.js';
import type { SubscriptionExtensionProvider } from './subscription-extension-providers.js';

class ExtensionModelProviderUnavailableError extends Error {
  override readonly name = 'ExtensionModelProviderUnavailableError';
  constructor() { super('The extension model provider is unavailable'); }
}

export async function refreshExtensionModelCatalog(providerId: string, options: {
  port: SubscriptionAuthPort;
  claims: readonly SubscriptionExtensionProvider[];
  config: PiwinConfig;
  project: () => Promise<PiwinConfig>;
}): Promise<ModelDiscoveryResult> {
  const owner = options.claims.find((claim) => claim.kind === 'model' && claim.providerId === providerId);
  const configured = options.config.providers.find((provider) => provider.id === providerId);
  if (!owner || (configured && !isExtensionProvider(configured))) {
    throw new ExtensionModelProviderUnavailableError();
  }
  try {
    await options.port.refreshLiveCatalog({
      providers: [providerId], signal: AbortSignal.timeout(LIVE_CATALOG_REFRESH_TIMEOUT_MS),
    });
  } finally {
    // Extensions may explicitly publish [] on failure. Persist removals before replying.
    await options.project();
  }
  return {
    providerId, protocol: 'openai-compatible',
    models: options.port.getChatCatalog(providerId).map(catalogModelToConfigEntry),
  };
}
