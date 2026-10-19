import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import { extensionModelProviderOrigin, isExtensionProvider } from '@piwin/contracts';
import { catalogModelToConfigEntry, mergeSubscriptionCatalogModel, type SubscriptionCatalogSeedModel } from './seed-subscription-provider.js';
import type { SubscriptionExtensionProvider } from './subscription-extension-providers.js';

/** Reject a colliding claim, not the user's channel or the whole catalog. */
export function usablePublicModelProviders(
  claims: readonly SubscriptionExtensionProvider[],
  config: Pick<PiwinConfig, 'providers'>,
): SubscriptionExtensionProvider[] {
  return claims.filter((claim) => {
    if (claim.kind !== 'model') return false;
    const existing = config.providers.find((provider) => provider.id === claim.providerId);
    return !existing || (isExtensionProvider(existing) && existing.enabled !== false);
  });
}

export function projectPublicModelProviders(
  config: PiwinConfig,
  claims: readonly SubscriptionExtensionProvider[],
  catalogFor: (providerId: string) => readonly SubscriptionCatalogSeedModel[],
): PiwinConfig {
  const publicClaims = claims.filter((claim) => claim.kind === 'model');
  const live = new Set(publicClaims.map((claim) => claim.providerId));
  const providers = config.providers.filter((provider) => !isExtensionProvider(provider) || live.has(provider.id));
  for (const claim of publicClaims) {
    const existing = providers.find((provider) => provider.id === claim.providerId);
    if (existing && !isExtensionProvider(existing)) {
      console.warn(`[piwin-host] extension model provider ${claim.providerId} conflicts with an existing provider; ignored`);
      continue;
    }
    const previous = new Map(existing?.models.map((model) => [model.id, model]));
    const next: ModelProviderConfig = {
      id: claim.providerId,
      name: claim.displayName || existing?.name || claim.providerId,
      source: 'extension', category: 'package', protocol: 'openai-compatible',
      extension: {
        ...(claim.bundled ? { bundled: true } : {}),
        ...(claim.notice ? { notice: claim.notice } : {}),
      },
      baseUrl: extensionModelProviderOrigin(claim.providerId),
      ...(existing?.enabled !== undefined ? { enabled: existing.enabled } : {}),
      models: catalogFor(claim.providerId).map((model) => {
        const fresh = catalogModelToConfigEntry(model);
        const saved = previous.get(model.id);
        return saved ? mergeSubscriptionCatalogModel(fresh, saved) : fresh;
      }),
    };
    const index = providers.findIndex((provider) => provider.id === claim.providerId);
    if (index < 0) providers.push(next);
    else providers[index] = next;
  }
  return JSON.stringify(providers) === JSON.stringify(config.providers) ? config : { ...config, providers };
}
