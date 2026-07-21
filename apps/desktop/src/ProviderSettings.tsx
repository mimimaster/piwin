/**
 * Models / providers settings — Cherry Studio-style layout:
 * left: configured providers list + preset catalog to add
 * right: selected provider form (baseUrl, key env, models)
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import {
  getProviderPreset,
  presetsByGroup,
  PROVIDER_GROUP_LABELS,
  type ProviderPreset,
  type ProviderProtocol,
} from './provider-presets';

export type ProviderSettingsProps = {
  config: PiwinConfig;
  saving: boolean;
  onSave: (next: PiwinConfig) => Promise<boolean>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
};

type ProviderDraft = {
  id: string;
  protocol: ProviderProtocol;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiKeyRef: string;
  /** One model id per line (first = default when set as default provider). */
  modelsText: string;
};

function modelsToText(models: Array<{ id: string; label?: string }>): string {
  return models
    .map((model) => (model.label && model.label !== model.id ? `${model.id} | ${model.label}` : model.id))
    .join('\n');
}

function parseModelsText(raw: string): Array<{ id: string; label?: string }> {
  const models: Array<{ id: string; label?: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const pipe = trimmed.indexOf('|');
    if (pipe >= 0) {
      const id = trimmed.slice(0, pipe).trim();
      const label = trimmed.slice(pipe + 1).trim();
      if (id) {
        models.push(label ? { id, label } : { id });
      }
      continue;
    }
    models.push({ id: trimmed });
  }
  return models;
}

function providerToDraft(provider: ModelProviderConfig): ProviderDraft {
  return {
    id: provider.id,
    protocol: provider.protocol,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKeyEnv: provider.apiKeyEnv ?? '',
    apiKeyRef: provider.apiKeyRef ?? '',
    modelsText: modelsToText(provider.models),
  };
}

function presetToDraft(preset: ProviderPreset): ProviderDraft {
  return {
    id: preset.id,
    protocol: preset.protocol,
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKeyEnv: preset.apiKeyEnv,
    apiKeyRef: '',
    modelsText: modelsToText(preset.models),
  };
}

function looksLikeRawKey(value: string): boolean {
  const trimmed = value.trim();
  return /^(sk-|sk-ant-|sk-proj-|api-)[A-Za-z0-9_\-]{8,}$/i.test(trimmed);
}

function draftToProvider(draft: ProviderDraft): ModelProviderConfig {
  const models = parseModelsText(draft.modelsText);
  const base = {
    id: draft.id.trim(),
    protocol: draft.protocol,
    name: draft.name.trim() || draft.id.trim(),
    baseUrl: draft.baseUrl.trim(),
    models: models.length > 0 ? models : [{ id: 'model-id' }],
  };
  const provider = { ...base } as ModelProviderConfig;
  if (draft.apiKeyEnv.trim()) {
    provider.apiKeyEnv = draft.apiKeyEnv.trim();
  }
  if (draft.apiKeyRef.trim()) {
    provider.apiKeyRef = draft.apiKeyRef.trim();
  }
  return provider;
}

export function ProviderSettings(props: ProviderSettingsProps): ReactElement {
  const { config, saving, onSave, onError, onInfo } = props;
  const [selectedId, setSelectedId] = useState<string | null>(
    config.defaultProviderId ?? config.providers[0]?.id ?? null,
  );
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [search, setSearch] = useState('');

  const selectedProvider = useMemo(
    () => config.providers.find((provider) => provider.id === selectedId) ?? null,
    [config.providers, selectedId],
  );

  useEffect(() => {
    if (selectedProvider) {
      setDraft(providerToDraft(selectedProvider));
      return;
    }
    if (config.providers.length === 0) {
      setDraft(null);
      setSelectedId(null);
      return;
    }
    const fallback = config.defaultProviderId ?? config.providers[0]?.id ?? null;
    setSelectedId(fallback);
  }, [selectedProvider, config.providers, config.defaultProviderId]);

  const groupedPresets = useMemo(() => presetsByGroup(), []);
  const configuredIds = useMemo(
    () => new Set(config.providers.map((provider) => provider.id)),
    [config.providers],
  );

  const filteredProviders = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return config.providers;
    }
    return config.providers.filter((provider) => {
      const hay = `${provider.name} ${provider.id} ${provider.baseUrl}`.toLowerCase();
      return hay.includes(query);
    });
  }, [config.providers, search]);

  async function handleAddPreset(presetId: string): Promise<void> {
    const preset = getProviderPreset(presetId);
    if (!preset) {
      return;
    }
    let nextId = preset.id;
    if (configuredIds.has(nextId)) {
      nextId = `${preset.id}-${Date.now().toString(36).slice(-4)}`;
    }
    const draftFromPreset = presetToDraft({ ...preset, id: nextId });
    const provider = draftToProvider(draftFromPreset);
    const next: PiwinConfig = {
      ...config,
      agentMock: false,
      providers: [...config.providers, provider],
      defaultProviderId: config.defaultProviderId ?? provider.id,
    };
    const defaultModelId = config.defaultModelId ?? provider.models[0]?.id;
    if (defaultModelId) {
      next.defaultModelId = defaultModelId;
    }
    if (await onSave(next)) {
      setSelectedId(provider.id);
      setDraft(providerToDraft(provider));
      onInfo(`Added ${provider.name}`);
    }
  }

  async function handleSaveDraft(): Promise<void> {
    if (!draft) {
      return;
    }
    if (!draft.id.trim()) {
      onError('Provider id is required');
      return;
    }
    if (!draft.baseUrl.trim().startsWith('http')) {
      onError('baseUrl must be an http(s) URL');
      return;
    }
    if (looksLikeRawKey(draft.apiKeyEnv) || looksLikeRawKey(draft.apiKeyRef)) {
      onError(
        'Do not paste raw API keys. Use an env var name (apiKeyEnv) or keychain ref (apiKeyRef).',
      );
      return;
    }
    const models = parseModelsText(draft.modelsText);
    if (models.length === 0) {
      onError('Add at least one model id (one per line)');
      return;
    }
    const previousId = selectedId;
    const provider = draftToProvider(draft);
    const nextProviders = config.providers
      .filter((item) => item.id !== previousId && item.id !== provider.id)
      .concat([provider]);
    const next: PiwinConfig = {
      ...config,
      agentMock: false,
      providers: nextProviders,
      defaultProviderId:
        config.defaultProviderId === previousId || !config.defaultProviderId
          ? provider.id
          : config.defaultProviderId,
    };
    const nextDefaultModel =
      config.defaultProviderId === previousId || !config.defaultModelId
        ? models[0]?.id
        : config.defaultModelId;
    if (nextDefaultModel) {
      next.defaultModelId = nextDefaultModel;
    }
    if (await onSave(next)) {
      setSelectedId(provider.id);
      onInfo('Provider saved');
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedId) {
      return;
    }
    if (!window.confirm(`Remove provider “${selectedId}”?`)) {
      return;
    }
    const nextProviders = config.providers.filter((item) => item.id !== selectedId);
    const nextDefault =
      config.defaultProviderId === selectedId
        ? nextProviders[0]?.id
        : config.defaultProviderId;
    const nextDefaultModel =
      config.defaultProviderId === selectedId
        ? nextProviders[0]?.models[0]?.id
        : config.defaultModelId;
    const next: PiwinConfig = {
      ...config,
      providers: nextProviders,
    };
    if (nextDefault) {
      next.defaultProviderId = nextDefault;
    } else {
      delete next.defaultProviderId;
    }
    if (nextDefaultModel) {
      next.defaultModelId = nextDefaultModel;
    } else {
      delete next.defaultModelId;
    }
    if (await onSave(next)) {
      setSelectedId(nextProviders[0]?.id ?? null);
      onInfo('Provider removed');
    }
  }

  async function handleSetDefault(): Promise<void> {
    if (!selectedProvider) {
      return;
    }
    const modelId = selectedProvider.models[0]?.id;
    const next: PiwinConfig = {
      ...config,
      defaultProviderId: selectedProvider.id,
      ...(modelId ? { defaultModelId: modelId } : {}),
    };
    if (await onSave(next)) {
      onInfo(`Default: ${selectedProvider.name} / ${modelId ?? '—'}`);
    }
  }

  return (
    <div className="provider-settings" data-testid="provider-settings">
      <div className="provider-settings-layout">
        <aside className="provider-sidebar">
          <label className="provider-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search providers"
              aria-label="Search providers"
              data-testid="provider-search"
            />
          </label>

          <div className="provider-sidebar-section">
            <div className="provider-sidebar-label">Configured</div>
            {filteredProviders.length === 0 ? (
              <div className="muted provider-empty">None yet — add a preset below</div>
            ) : (
              <ul className="provider-nav-list" data-testid="provider-list">
                {filteredProviders.map((provider) => {
                  const isDefault = config.defaultProviderId === provider.id;
                  return (
                    <li key={provider.id}>
                      <button
                        type="button"
                        className={
                          selectedId === provider.id
                            ? 'provider-nav-item active'
                            : 'provider-nav-item'
                        }
                        data-testid="provider-list-item"
                        data-provider-id={provider.id}
                        onClick={() => setSelectedId(provider.id)}
                      >
                        <span className="provider-nav-badge" aria-hidden>
                          {provider.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="provider-nav-copy">
                          <span className="provider-nav-name">{provider.name}</span>
                          <span className="muted provider-nav-meta">
                            {provider.protocol === 'anthropic-compatible' ? 'Anthropic' : 'OpenAI'}
                            {' · '}
                            {provider.models.length} model
                            {provider.models.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        {isDefault ? <span className="provider-default-pill">default</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="provider-sidebar-section provider-presets">
            <div className="provider-sidebar-label">Add provider</div>
            {(Object.keys(groupedPresets) as Array<ProviderPreset['group']>).map((group) => (
              <div key={group} className="provider-preset-group">
                <div className="provider-preset-group-label muted">
                  {PROVIDER_GROUP_LABELS[group]}
                </div>
                <div className="provider-preset-grid">
                  {groupedPresets[group].map((preset) => {
                    const already = configuredIds.has(preset.id);
                    return (
                      <button
                        key={preset.presetId}
                        type="button"
                        className="provider-preset-chip"
                        data-testid="provider-preset"
                        data-preset-id={preset.presetId}
                        title={preset.docsHint ?? preset.baseUrl}
                        onClick={() => void handleAddPreset(preset.presetId)}
                      >
                        <span className="provider-preset-badge">{preset.badge}</span>
                        <span className="provider-preset-name">{preset.name}</span>
                        {already ? <span className="muted provider-preset-dup">+</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="provider-detail">
          {!draft ? (
            <div className="provider-detail-empty muted" data-testid="provider-detail-empty">
              Select a configured provider or add one from the catalog.
            </div>
          ) : (
            <>
              <header className="provider-detail-header">
                <div>
                  <h3>{draft.name || 'Provider'}</h3>
                  <p className="muted">
                    Keys stay in env / keychain — never store raw secrets in config.
                  </p>
                </div>
                <div className="provider-detail-actions">
                  <button
                    type="button"
                    className="btn btn-compact"
                    disabled={saving || !selectedProvider}
                    onClick={() => void handleSetDefault()}
                  >
                    Set default
                  </button>
                  <button
                    type="button"
                    className="btn btn-compact"
                    disabled={saving || !selectedId}
                    onClick={() => void handleDelete()}
                  >
                    Remove
                  </button>
                </div>
              </header>

              <label className="field">
                <span>Provider id</span>
                <input
                  data-testid="provider-id-input"
                  value={draft.id}
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Display name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Protocol</span>
                <select
                  value={draft.protocol}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      protocol: event.target.value as ProviderProtocol,
                    })
                  }
                >
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="anthropic-compatible">Anthropic-compatible</option>
                </select>
              </label>
              <label className="field">
                <span>Base URL</span>
                <input
                  data-testid="provider-baseurl-input"
                  value={draft.baseUrl}
                  onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>API key env var</span>
                <input
                  data-testid="provider-apikey-env-input"
                  value={draft.apiKeyEnv}
                  onChange={(event) => setDraft({ ...draft, apiKeyEnv: event.target.value })}
                  placeholder="OPENAI_API_KEY"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>apiKeyRef (optional keychain)</span>
                <input
                  value={draft.apiKeyRef}
                  onChange={(event) => setDraft({ ...draft, apiKeyRef: event.target.value })}
                  placeholder="keychain:piwin-openai"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Models (one per line; optional “id | label”)</span>
                <textarea
                  data-testid="provider-models-input"
                  rows={6}
                  value={draft.modelsText}
                  onChange={(event) => setDraft({ ...draft, modelsText: event.target.value })}
                  spellCheck={false}
                  className="provider-models-textarea"
                />
              </label>
              <button
                type="button"
                className="btn primary"
                data-testid="provider-save-btn"
                disabled={saving}
                onClick={() => void handleSaveDraft()}
              >
                {saving ? 'Saving…' : 'Save provider'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
