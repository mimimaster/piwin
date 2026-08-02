/**
 * Provider draft type and pure helpers shared between ProviderSettings
 * and provider-connection components.
 */

import type { ModelConfigEntry, ModelProviderConfig } from '@piwin/contracts';
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
  /**
   * Field the user edits. Empty means "keep stored secret / none".
   * May be a raw secret or an ENV_VAR_NAME (ALL_CAPS).
   */
  apiKeyInput: string;
  /** Saved env var name from config (if any). */
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
    apiKeyInput: '',
    storedApiKeyEnv: provider.apiKeyEnv ?? '',
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
  const headers = rowsToHeaders(draft.headerRows);
  if (headers) {
    config.headers = headers;
  }
  if (draft.storedApiKeyEnv) {
    config.apiKeyEnv = draft.storedApiKeyEnv;
  }
  if (draft.storedApiKeyRef) {
    config.apiKeyRef = draft.storedApiKeyRef;
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
    const model = provider?.models.find((m) => m.id === previousDefault.modelId);
    if (provider && model) {
      return { defaultProviderId: provider.id, defaultModelId: model.id };
    }
  }

  const first = enabled[0];
  if (first) {
    const firstModel = first.models[0];
    if (firstModel) {
      return { defaultProviderId: first.id, defaultModelId: firstModel.id };
    }
    return { defaultProviderId: first.id };
  }

  return {};
}

export function oneShotApiKeyFromDraft(draft: ProviderDraft): string | undefined {
  const input = draft.apiKeyInput.trim();
  if (!input) {
    return undefined;
  }
  // If it's an ENV_VAR_NAME, it's not a one-shot secret to be persisted.
  if (/^[A-Z0-9_]+$/.test(input)) {
    return undefined;
  }
  return input;
}
