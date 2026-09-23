/**
 * Provider draft type and pure helpers shared by ProviderSettings and
 * the provider drawer.
 */

import type {
  ModelCategory,
  ModelConfigEntry,
  ModelProviderConfig,
  ModelSource,
  PiwinConfig,
} from '@piwin/contracts';
import { isModelEnabled } from '@piwin/contracts';
import type { ProviderProtocol } from './provider-presets.js';

export type HeaderDraftRow = {
  id: string;
  name: string;
  value: string;
};

export type ProviderDraft = {
  id: string;
  protocol: ProviderProtocol;
  name: string;
  baseUrl: string;
  /** Active unless explicitly disabled. */
  enabled: boolean;
  category?: ModelCategory;
  source?: ModelSource;
  /** Raw API key entered for this provider. Empty means keep the saved key. */
  apiKeyInput: string;
  /**
   * The saved key read back from the Host for display. While the input still
   * equals it, the draft carries no new key — revealing is not an edit.
   */
  revealedApiKey?: string;
  /** Legacy saved env var name from config (if any). */
  storedApiKeyEnv: string;
  /** Saved keychain ref from config (if any). */
  storedApiKeyRef: string;
  headerRows: HeaderDraftRow[];
  models: ModelConfigEntry[];
};

export function createHeaderRow(name = '', value = ''): HeaderDraftRow {
  return {
    id: `hdr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    value,
  };
}

export function headersToRows(headers: Record<string, string> | undefined): HeaderDraftRow[] {
  if (!headers) {
    return [];
  }
  return Object.entries(headers).map(([name, value]) => createHeaderRow(name, value));
}

export function rowsToHeaders(rows: readonly HeaderDraftRow[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (!name || !value) {
      continue;
    }
    result[name] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function providerToDraft(provider: ModelProviderConfig): ProviderDraft {
  return {
    id: provider.id,
    protocol: provider.protocol,
    name: provider.name,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled !== false,
    ...(provider.category ? { category: provider.category } : {}),
    ...(provider.source ? { source: provider.source } : {}),
    apiKeyInput: '',
    // A provider is single-key. If an older config contains both fields,
    // keep the keychain ref as the authoritative source and drop the stale
    // env-ref from the editable draft.
    storedApiKeyEnv: provider.apiKeyRef?.trim() ? '' : (provider.apiKeyEnv ?? ''),
    storedApiKeyRef: provider.apiKeyRef ?? '',
    headerRows: headersToRows(provider.headers),
    models: provider.models,
  };
}

export function draftToProvider(draft: ProviderDraft): ModelProviderConfig {
  const config: ModelProviderConfig = {
    id: draft.id.trim(),
    protocol: draft.protocol,
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    enabled: draft.enabled,
    models: draft.models,
  };
  if (draft.category) {
    config.category = draft.category;
  }
  if (draft.source) {
    config.source = draft.source;
  }
  const headers = rowsToHeaders(draft.headerRows);
  if (headers) {
    config.headers = headers;
  }
  if (draft.storedApiKeyRef) {
    config.apiKeyRef = draft.storedApiKeyRef;
  } else if (draft.storedApiKeyEnv) {
    // Preserve legacy env-only providers until the user replaces the key.
    config.apiKeyEnv = draft.storedApiKeyEnv;
  }
  return config;
}

export function hasKeychainSecret(draft: ProviderDraft): boolean {
  return !!draft.storedApiKeyRef;
}

/**
 * Recompute the product default provider/model after a provider change.
 * Prefers the previous default if it is still enabled and has the model;
 * otherwise falls back to the first enabled provider with at least one model.
 */
export function resolveDefaultAfterProviderChange(
  providers: readonly ModelProviderConfig[],
  previousDefault?: { providerId?: string | undefined; modelId?: string | undefined },
): { defaultProviderId?: string; defaultModelId?: string } {
  const enabled = providers.filter((provider) => provider.enabled !== false);
  if (enabled.length === 0) {
    return {};
  }

  if (previousDefault?.providerId && previousDefault?.modelId) {
    const provider = enabled.find((p) => p.id === previousDefault.providerId);
    const model = provider?.models.find(
      (m) => m.id === previousDefault.modelId && isModelEnabled(m),
    );
    if (provider && model) {
      return { defaultProviderId: provider.id, defaultModelId: model.id };
    }
  }

  const first = enabled[0];
  if (first) {
    const firstModel = first.models.find((m) => isModelEnabled(m));
    if (firstModel) {
      return { defaultProviderId: first.id, defaultModelId: firstModel.id };
    }
    return { defaultProviderId: first.id };
  }

  return {};
}

/** The key the user actually typed; empty when the input only shows the saved key. */
export function pendingApiKey(draft: ProviderDraft): string {
  const typed = draft.apiKeyInput.trim();
  return typed === draft.revealedApiKey?.trim() ? '' : typed;
}

function connectionSignature(provider: ModelProviderConfig): string {
  const headers = Object.entries(provider.headers ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify([
    provider.name.trim(),
    provider.baseUrl.trim(),
    provider.apiKeyRef ?? '',
    provider.apiKeyEnv ?? '',
    headers,
  ]);
}

/**
 * Whether the connection fields differ from the saved provider. Compares the
 * saved side through the same draft round-trip, so legacy configs (key ref and
 * env both set) do not read as permanently edited.
 */
export function isConnectionDirty(draft: ProviderDraft, saved: ModelProviderConfig): boolean {
  if (pendingApiKey(draft)) return true;
  return (
    connectionSignature(draftToProvider(draft)) !==
    connectionSignature(draftToProvider(providerToDraft(saved)))
  );
}

/**
 * Apply a connection draft on top of the provider as it is saved *now*.
 * Models and the enable switch persist immediately elsewhere on the page, so a
 * draft opened earlier must not roll them back.
 */
export function mergeConnectionDraft(
  draft: ProviderDraft,
  current: ModelProviderConfig | undefined,
): ModelProviderConfig {
  const provider = draftToProvider(draft);
  if (!current) return provider;
  return { ...provider, enabled: current.enabled !== false, models: current.models };
}

/** Replace the provider list and re-resolve the product default against it. */
export function withProviders(
  config: PiwinConfig,
  providers: ModelProviderConfig[],
  previousDefault: { providerId?: string | undefined; modelId?: string | undefined } = {
    providerId: config.defaultProviderId,
    modelId: config.defaultModelId,
  },
): PiwinConfig {
  const next: PiwinConfig = { ...config, providers };
  const resolved = resolveDefaultAfterProviderChange(providers, previousDefault);
  if (resolved.defaultProviderId) {
    next.defaultProviderId = resolved.defaultProviderId;
  } else {
    delete next.defaultProviderId;
  }
  if (resolved.defaultModelId) {
    next.defaultModelId = resolved.defaultModelId;
  } else {
    delete next.defaultModelId;
  }
  if (next.imageGeneration?.defaultModel) {
    const provider = providers.find(
      (p) => p.id === next.imageGeneration?.defaultModel?.providerId,
    );
    const model = provider?.models.find(
      (m) => m.id === next.imageGeneration?.defaultModel?.modelId,
    );
    if (!provider || !model) {
      delete next.imageGeneration.defaultModel;
    }
  }
  if (next.videoGeneration?.defaultModel) {
    const provider = providers.find(
      (p) => p.id === next.videoGeneration?.defaultModel?.providerId,
    );
    const model = provider?.models.find(
      (m) => m.id === next.videoGeneration?.defaultModel?.modelId,
    );
    if (!provider || !model) {
      delete next.videoGeneration.defaultModel;
    }
  }
  if (next.speech?.asr?.defaultModel) {
    const provider = providers.find((p) => p.id === next.speech?.asr?.defaultModel?.providerId);
    const model = provider?.models.find((m) => m.id === next.speech?.asr?.defaultModel?.modelId);
    if (!provider || !model) {
      delete next.speech.asr.defaultModel;
    }
  }
  if (next.speech?.tts?.defaultModel) {
    const provider = providers.find((p) => p.id === next.speech?.tts?.defaultModel?.providerId);
    const model = provider?.models.find((m) => m.id === next.speech?.tts?.defaultModel?.modelId);
    if (!provider || !model) {
      delete next.speech.tts.defaultModel;
    }
  }
  return next;
}
