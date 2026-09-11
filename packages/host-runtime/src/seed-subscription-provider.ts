/**
 * Seed a Models-page Provider after subscription OAuth login.
 * The row is operable (enable/disable models, defaults, params) but is not a
 * BYOK channel — compile still uses `{ auth: { kind: 'oauth' } }`.
 */
import type {
  ModelCapability,
  ModelConfigEntry,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  isChannelProvider,
  isSubscriptionProvider,
  isThinkingLevel,
  isV1SubscriptionProviderId,
  modelSupportsCapability,
  subscriptionSurfaceExtras,
  V1_SUBSCRIPTION_PROVIDER_META,
  type SubscriptionAccount,
  type V1SubscriptionProviderId,
} from '@piwin/contracts';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';

export type SubscriptionCatalogSeedModel = {
  id: string;
  name: string;
  capabilities?: readonly ModelCapability[];
  reasoning?: boolean;
  thinkingLevels?: readonly string[];
  input?: readonly ('text' | 'image')[];
  contextWindow?: number;
  maxOutputTokens?: number;
  routes?: ModelConfigEntry['routes'];
};

export function subscriptionOauthOrigin(providerId: string): string {
  return `oauth://${providerId}`;
}

export function catalogModelToConfigEntry(model: SubscriptionCatalogSeedModel): ModelConfigEntry {
  const capabilities: ModelCapability[] =
    model.capabilities && model.capabilities.length > 0 ? [...model.capabilities] : ['chat'];
  const entry: ModelConfigEntry = {
    id: model.id,
    label: model.name,
    category: 'package',
    capabilities,
  };
  if (typeof model.reasoning === 'boolean') {
    entry.reasoning = model.reasoning;
  }
  if (Array.isArray(model.thinkingLevels)) {
    const thinkingLevels = model.thinkingLevels.filter(isThinkingLevel);
    if (thinkingLevels.length > 0) {
      entry.thinkingLevels = thinkingLevels;
    }
  }
  if (Array.isArray(model.input) && model.input.length > 0) {
    entry.input = [...model.input];
  }
  if (typeof model.contextWindow === 'number') {
    entry.contextWindow = model.contextWindow;
  }
  if (typeof model.maxOutputTokens === 'number') {
    entry.maxOutputTokens = model.maxOutputTokens;
  }
  if (model.routes) {
    entry.routes = model.routes;
  }
  return entry;
}

export function mergeSubscriptionCatalog(
  chat: readonly SubscriptionCatalogSeedModel[],
  extras: readonly SubscriptionCatalogSeedModel[],
): SubscriptionCatalogSeedModel[] {
  const merged = [...chat];
  const seen = new Set(chat.map((model) => model.id));
  for (const extra of extras) {
    if (seen.has(extra.id)) {
      continue;
    }
    seen.add(extra.id);
    merged.push(extra);
  }
  return merged;
}

export function upsertSubscriptionProvider(
  config: PiwinConfig,
  providerId: V1SubscriptionProviderId,
  catalog: readonly SubscriptionCatalogSeedModel[],
): PiwinConfig {
  const existing = config.providers.find((provider) => provider.id === providerId);
  if (existing && isChannelProvider(existing)) {
    return config;
  }
  const nextProvider = mergeSubscriptionProvider(
    providerId,
    mergeSubscriptionCatalog(catalog, subscriptionSurfaceExtras(providerId)),
    existing,
  );
  if (existing && subscriptionProvidersEqual(existing, nextProvider)) {
    return config;
  }
  const providers = existing
    ? config.providers.map((provider) => (provider.id === providerId ? nextProvider : provider))
    : [...config.providers, nextProvider];
  return { ...config, providers };
}

export function ensureSubscriptionProviders(
  config: PiwinConfig,
  accounts: readonly SubscriptionAccount[],
  catalogFor: (providerId: string) => readonly SubscriptionCatalogSeedModel[],
): PiwinConfig {
  const usable = new Set<string>();
  let next = config;
  for (const account of accounts) {
    if (!isSubscriptionAccountUsable(account) || !isV1SubscriptionProviderId(account.providerId)) {
      continue;
    }
    usable.add(account.providerId);
    next = upsertSubscriptionProvider(next, account.providerId, catalogFor(account.providerId));
  }
  return dropUnusableSubscriptionProviders(next, usable);
}

function dropUnusableSubscriptionProviders(
  config: PiwinConfig,
  usable: ReadonlySet<string>,
): PiwinConfig {
  const providers = config.providers.filter(
    (provider) => !isSubscriptionProvider(provider) || usable.has(provider.id),
  );
  const dropped = providers.length !== config.providers.length;
  const withProviders = dropped ? { ...config, providers } : config;
  return withoutDanglingChatDefault(withProviders);
}

function withoutDanglingChatDefault(config: PiwinConfig): PiwinConfig {
  const providerId = config.defaultProviderId;
  if (providerId === undefined) {
    return config;
  }
  if (config.providers.some((provider) => provider.id === providerId)) {
    return config;
  }
  const { defaultProviderId: _provider, defaultModelId: _model, ...rest } = config;
  return rest;
}

function mergeSubscriptionProvider(
  providerId: V1SubscriptionProviderId,
  catalog: readonly SubscriptionCatalogSeedModel[],
  existing: ModelProviderConfig | undefined,
): ModelProviderConfig {
  const previousById = new Map((existing?.models ?? []).map((model) => [model.id, model]));
  const models: ModelConfigEntry[] = [];
  for (const catalogModel of catalog) {
    const fresh = catalogModelToConfigEntry(catalogModel);
    const previous = previousById.get(catalogModel.id);
    models.push(previous ? mergeSubscriptionCatalogModel(fresh, previous) : fresh);
    previousById.delete(catalogModel.id);
  }
  for (const leftover of previousById.values()) {
    models.push(leftover);
  }
  const meta = V1_SUBSCRIPTION_PROVIDER_META[providerId];
  const provider: ModelProviderConfig = {
    id: providerId,
    name: existing?.name?.trim() || meta.name,
    protocol: 'openai-compatible',
    baseUrl: subscriptionOauthOrigin(providerId),
    source: 'subscription',
    category: 'package',
    models,
  };
  if (existing?.enabled !== undefined) {
    provider.enabled = existing.enabled;
  }
  return provider;
}

/**
 * Keep user enable/label/selected thinking default. Take the catalog context
 * window when the saved value is missing or still the product 128K default.
 * Supported `thinkingLevels` refresh from the Pi catalog on merge.
 */
export function mergeSubscriptionCatalogModel(
  catalog: ModelConfigEntry,
  previous: ModelConfigEntry,
): ModelConfigEntry {
  const merged: ModelConfigEntry = { ...catalog, ...previous, id: catalog.id };
  if (previous.input === undefined && catalog.input !== undefined) {
    merged.input = catalog.input;
  } else if (
    catalog.input === undefined &&
    !modelSupportsCapability(catalog, 'chat') &&
    (catalog.capabilities?.includes('image-generation') === true ||
      catalog.capabilities?.includes('video-generation') === true)
  ) {
    delete merged.input;
  }
  if (previous.capabilities === undefined && catalog.capabilities !== undefined) {
    merged.capabilities = catalog.capabilities;
  }
  if (previous.reasoning === undefined && catalog.reasoning !== undefined) {
    merged.reasoning = catalog.reasoning;
  }
  // Supported levels are Pi catalog capability, not a user default. Refresh
  // them so a stale full-key dump cannot stick after the map projection fix.
  if (catalog.thinkingLevels !== undefined) {
    merged.thinkingLevels = catalog.thinkingLevels;
  }
  if (previous.routes === undefined && catalog.routes !== undefined) {
    merged.routes = catalog.routes;
  }
  overlayCatalogLimits(merged, catalog);
  return merged;
}

export function overlayCatalogLimits(
  target: { contextWindow?: unknown; maxOutputTokens?: unknown },
  catalog: { contextWindow?: number; maxOutputTokens?: number },
): void {
  const contextWindow = resolveCatalogBackedLimit(
    readPositiveInteger(target.contextWindow),
    catalog.contextWindow,
    DEFAULT_MODEL_CONTEXT_WINDOW,
  );
  if (contextWindow !== undefined) {
    target.contextWindow = contextWindow;
  }
  const maxOutputTokens = resolveCatalogBackedLimit(
    readPositiveInteger(target.maxOutputTokens),
    catalog.maxOutputTokens,
    DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  );
  if (maxOutputTokens !== undefined) {
    target.maxOutputTokens = maxOutputTokens;
  }
}

function resolveCatalogBackedLimit(
  configured: number | undefined,
  catalog: number | undefined,
  defaultLimit: number,
): number | undefined {
  const catalogLimit = readPositiveInteger(catalog);
  const configuredLimit = readPositiveInteger(configured);
  if (catalogLimit !== undefined && (configuredLimit === undefined || configuredLimit === defaultLimit)) {
    return catalogLimit;
  }
  return configuredLimit;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function subscriptionProvidersEqual(
  left: ModelProviderConfig,
  right: ModelProviderConfig,
): boolean {
  return (
    isSubscriptionProvider(left) &&
    left.name === right.name &&
    left.enabled === right.enabled &&
    left.baseUrl === right.baseUrl &&
    JSON.stringify(left.models) === JSON.stringify(right.models)
  );
}
