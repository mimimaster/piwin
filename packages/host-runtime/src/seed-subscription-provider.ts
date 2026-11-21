/**
 * Seed a Models-page Provider after subscription OAuth login.
 * Login creates an empty `models: []` subscription row and preserves user-added
 * models without auto-seeding catalog models — compile still uses `{ auth: { kind: 'oauth' } }`.
 */
import type {
  DiscoveredModel,
  ModelCapability,
  ModelConfigEntry,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  isChannelProvider,
  isExtensionProvider,
  isModelEnabled,
  isProviderEnabled,
  isSubscriptionProvider,
  isThinkingLevel,
  isClaudeCodeOauthProviderId,
  isSubscriptionOauthProviderId,
  isV1SubscriptionProviderId,
  modelSupportsCapability,
  subscriptionSurfaceExtras,
  CLAUDE_CODE_OAUTH_PROVIDER_META,
  SUBSCRIPTION_OAUTH_PROVIDER_META,
  V1_SUBSCRIPTION_PROVIDER_META,
  type SubscriptionAccount,
  type V1SubscriptionProviderId,
  subscriptionChatBaseUrl,
  suggestDiscoveredNativeSearch,
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

/**
 * `displayName` names extension-owned providers; built-in ids use contract meta.
 */
export function upsertSubscriptionProvider(
  config: PiwinConfig,
  providerId: string,
  catalog: readonly SubscriptionCatalogSeedModel[],
  displayName?: string,
): PiwinConfig {
  const existing = config.providers.find((provider) => provider.id === providerId);
  if (existing && (isChannelProvider(existing) || isExtensionProvider(existing))) {
    return config;
  }
  const nextProvider = mergeSubscriptionProvider(
    providerId,
    mergeSubscriptionCatalog(
      catalog,
      isV1SubscriptionProviderId(providerId) ? subscriptionSurfaceExtras(providerId) : [],
    ),
    existing,
    displayName,
  );
  if (existing && subscriptionProvidersEqual(existing, nextProvider)) {
    return config;
  }
  const providers = existing
    ? config.providers.map((provider) => (provider.id === providerId ? nextProvider : provider))
    : [...config.providers, nextProvider];
  return { ...config, providers };
}

/**
 * When a provider is disabled or all of its existing models are disabled, newly
 * synced catalog models must inherit `enabled: false` instead of silently turning on.
 */
export function shouldSeedNewCatalogModelsDisabled(
  existing: ModelProviderConfig | undefined,
): boolean {
  if (existing === undefined) {
    return false;
  }
  if (!isProviderEnabled(existing)) {
    return true;
  }
  return existing.models.length > 0 && existing.models.every((model) => !isModelEnabled(model));
}

export function ensureSubscriptionProviders(
  config: PiwinConfig,
  accounts: readonly SubscriptionAccount[],
  catalogFor: (providerId: string) => readonly SubscriptionCatalogSeedModel[],
): PiwinConfig {
  const retained = new Set<string>();
  let next = config;
  for (const account of accounts) {
    // Accounts are already limited to built-in ids plus enabled extension claims.
    // Keep persisted settings (disabled models, removedModelIds) during transient
    // `needs-reauth` / `logging-in` states; only drop when logged out or colliding.
    if (
      account.surface === 'v1' &&
      account.collidingChannelId === undefined &&
      account.state !== 'logged-out'
    ) {
      retained.add(account.providerId);
    }
    if (!isSubscriptionAccountUsable(account)) {
      continue;
    }
    next = upsertSubscriptionProvider(
      next,
      account.providerId,
      catalogFor(account.providerId),
      account.extension?.displayName,
    );
  }
  return dropUnusableSubscriptionProviders(next, retained);
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
  providerId: string,
  catalog: readonly SubscriptionCatalogSeedModel[],
  existing: ModelProviderConfig | undefined,
  displayName: string | undefined,
): ModelProviderConfig {
  const catalogById = new Map(catalog.map((model) => [model.id, model]));
  const models: ModelConfigEntry[] = [];
  for (const previous of existing?.models ?? []) {
    const catalogModel = catalogById.get(previous.id);
    if (catalogModel) {
      models.push(mergeSubscriptionCatalogModel(catalogModelToConfigEntry(catalogModel), previous));
    } else {
      models.push(previous);
    }
  }
  const modelIds = new Set(models.map((model) => model.id));
  const removed = [...new Set(existing?.removedModelIds ?? [])]
    .filter((id) => !modelIds.has(id))
    .sort();
  const builtinName = isSubscriptionOauthProviderId(providerId)
    ? SUBSCRIPTION_OAUTH_PROVIDER_META[providerId].name
    : undefined;
  const claudeCode = isClaudeCodeOauthProviderId(providerId);
  const provider: ModelProviderConfig = {
    id: providerId,
    name: existing?.name?.trim() || builtinName || displayName?.trim() || providerId,
    // Claude Code path talks Anthropic Messages + OAuth shaping; plain Claude stays oauth://.
    protocol: claudeCode ? 'anthropic-compatible' : 'openai-compatible',
    baseUrl: claudeCode ? 'https://api.anthropic.com' : subscriptionOauthOrigin(providerId),
    source: 'subscription',
    category: 'package',
    models,
  };
  if (existing?.enabled !== undefined) {
    provider.enabled = existing.enabled;
  }
  if (removed.length > 0) {
    provider.removedModelIds = removed;
  }
  return provider;
}

/**
 * Build the picker list for `models/discover` on a subscription provider without
 * writing models into config automatically.
 */
export function buildDiscoverableSubscriptionModels(
  providerId: string,
  chatCatalog: readonly SubscriptionCatalogSeedModel[],
): DiscoveredModel[] {
  const catalog = mergeSubscriptionCatalog(
    chatCatalog,
    isV1SubscriptionProviderId(providerId) ? subscriptionSurfaceExtras(providerId) : [],
  );
  const searchSurface = subscriptionChatBaseUrl(providerId);
  return catalog.map((model) => {
    const entry = withDiscoveredNativeSearch(catalogModelToConfigEntry(model), searchSurface);
    const discovered: DiscoveredModel = { id: entry.id };
    if (entry.label !== undefined) {
      discovered.label = entry.label;
    }
    if (entry.input !== undefined) {
      discovered.input = entry.input;
    }
    if (entry.reasoning !== undefined) {
      discovered.reasoning = entry.reasoning;
    }
    if (entry.thinkingLevels !== undefined) {
      discovered.thinkingLevels = entry.thinkingLevels;
    }
    if (entry.contextWindow !== undefined) {
      discovered.contextWindow = entry.contextWindow;
    }
    if (entry.maxOutputTokens !== undefined) {
      discovered.maxOutputTokens = entry.maxOutputTokens;
    }
    if (entry.capabilities !== undefined) {
      discovered.capabilities = [...entry.capabilities];
    }
    if (entry.nativeSearchAdapter !== undefined) {
      discovered.nativeSearchAdapter = entry.nativeSearchAdapter;
    }
    if (entry.routes !== undefined) {
      discovered.routes = entry.routes;
    }
    return discovered;
  });
}

/**
 * Pull-time native-search tagging for a newly seen subscription model, the
 * same rule as provider model discovery. Only subscriptions with a
 * Host-reachable HTTPS surface qualify; an existing entry keeps the user's
 * own capability choice.
 */
function withDiscoveredNativeSearch(
  model: ModelConfigEntry,
  searchSurface: string | undefined,
): ModelConfigEntry {
  if (searchSurface === undefined) {
    return model;
  }
  const suggestion = suggestDiscoveredNativeSearch({
    protocol: 'openai-compatible',
    baseUrl: searchSurface,
    modelId: model.id,
    capabilities: model.capabilities,
  });
  return suggestion
    ? { ...model, capabilities: suggestion.capabilities, nativeSearchAdapter: suggestion.adapter }
    : model;
}

/**
 * Keep user enable/label/selected thinking default. Take the catalog context
 * window when the saved value is missing or still the product 128K default.
 * Catalog `thinkingLevels` are the capability ceiling: keep a saved subset,
 * drop levels the catalog no longer supports, and fall back to the catalog
 * when nothing valid remains (including a stale full-key dump).
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
  if (catalog.thinkingLevels !== undefined) {
    const thinkingLevels = narrowCatalogThinkingLevels(
      catalog.thinkingLevels,
      previous.thinkingLevels,
    );
    if (thinkingLevels) {
      merged.thinkingLevels = thinkingLevels;
      if (merged.thinkingLevel !== undefined && !thinkingLevels.includes(merged.thinkingLevel)) {
        delete merged.thinkingLevel;
      }
    }
  }
  if (previous.routes === undefined && catalog.routes !== undefined) {
    merged.routes = catalog.routes;
  }
  overlayCatalogLimits(merged, catalog);
  return merged;
}

/**
 * Catalog thinking levels are the capability ceiling. Keep the user's saved
 * subset when it still intersects that ceiling, so unchecking a level in
 * Settings survives the next live-catalog refresh. Fall back to the catalog
 * when nothing was saved, or when a stale full-key dump no longer overlaps.
 */
export function narrowCatalogThinkingLevels(
  catalogLevels: readonly unknown[] | undefined,
  configuredLevels: unknown,
): ModelConfigEntry['thinkingLevels'] {
  if (!Array.isArray(catalogLevels) || catalogLevels.length === 0) {
    return undefined;
  }
  const catalog = catalogLevels.filter(isThinkingLevel);
  if (catalog.length === 0) {
    return undefined;
  }
  if (!Array.isArray(configuredLevels) || configuredLevels.length === 0) {
    return catalog;
  }
  const allowed = new Set<string>(catalog);
  const narrowed = configuredLevels.filter(isThinkingLevel).filter((level) => allowed.has(level));
  return narrowed.length > 0 ? narrowed : catalog;
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
    JSON.stringify(left.removedModelIds) === JSON.stringify(right.removedModelIds) &&
    JSON.stringify(left.models) === JSON.stringify(right.models)
  );
}
