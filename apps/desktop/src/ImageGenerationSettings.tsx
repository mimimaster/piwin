/**
 * Settings → Image Generation.
 *
 * Mirrors Models page patterns:
 *   - pick a real provider from `config.providers` (same channels as Models)
 *   - ImageModelSuggest smart dropdown (Pi catalog + provider discovery)
 *   - manual add/edit form for route path / timeout / label
 *   - list of image-capable models with set-default / remove
 *
 * Models live on `config.providers[].models` with
 * `capabilities: ['image-generation']` and optional
 * `routes['image-generation']` path/timeout.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Field } from '@piwin/ui-kit';
import type {
  DiscoveredModel,
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRouteConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { ImageModelSuggest } from './image-model-suggest.jsx';
import { useDesktopLocale } from './desktop-locale-context.js';
import { ProviderIcon } from './provider-icons.js';
import { useSettings } from './settings/settings-context.js';
import { PageTitle } from './settings/page-title.js';

/** Image-capable when it declares the capability or has an image-generation route. */
export function isImageGenerationModel(model: ModelConfigEntry): boolean {
  if (model.capabilities?.includes('image-generation')) {
    return true;
  }
  return model.routes?.['image-generation'] !== undefined;
}

/** Protocol-aware default request path (matches host image_gen fallbacks). */
export function defaultImageGenPath(protocol: ModelProviderConfig['protocol']): string {
  if (protocol === 'google-gemini') {
    return '';
  }
  return '/images/generations';
}

/** Normalize a custom request path: require leading `/`, reject absolute URLs. */
export function normalizeRequestPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Parse a timeout field in seconds; returns seconds or undefined when unset/invalid. */
export function parseTimeoutSeconds(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds;
}

type ImageModelRow = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
};

export function collectImageModels(providers: readonly ModelProviderConfig[]): ImageModelRow[] {
  const rows: ImageModelRow[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      if (isImageGenerationModel(model)) {
        rows.push({ provider, model });
      }
    }
  }
  return rows;
}

function buildImageRoute(path: string, timeoutSeconds: string): ModelRouteConfig {
  const normalizedPath = normalizeRequestPath(path);
  const timeout = parseTimeoutSeconds(timeoutSeconds);
  return {
    ...(normalizedPath ? { path: normalizedPath } : {}),
    ...(timeout !== undefined ? { timeoutMs: timeout * 1000 } : {}),
  };
}

export function buildImageModelEntry(input: {
  id: string;
  path: string;
  timeoutSeconds: string;
  label: string;
  description: string;
}): ModelConfigEntry {
  const label = input.label.trim();
  const description = input.description.trim();
  const route = buildImageRoute(input.path, input.timeoutSeconds);
  return {
    id: input.id.trim(),
    capabilities: ['image-generation'],
    ...(label ? { label } : {}),
    ...(description ? { tooltipMarkdown: description } : {}),
    routes: { 'image-generation': route },
  };
}

/**
 * Import discovered models as image-generation entries, preserving existing
 * chat models on the same provider. Existing image models keep their routes.
 */
export function mergeDiscoveredImageModels(
  configuredModels: readonly ModelConfigEntry[],
  selectedModels: readonly DiscoveredModel[],
  routeDefaults: { path: string; timeoutSeconds: string },
): ModelConfigEntry[] {
  const modelsById = new Map(configuredModels.map((model) => [model.id, model]));
  const route = buildImageRoute(routeDefaults.path, routeDefaults.timeoutSeconds);

  for (const discovered of selectedModels) {
    const modelId = discovered.id.trim();
    if (!modelId) continue;

    const existing = modelsById.get(modelId);
    if (existing) {
      // Upgrade an existing entry to image-capable without dropping other fields.
      const capabilities = new Set(existing.capabilities ?? []);
      capabilities.add('image-generation');
      modelsById.set(modelId, {
        ...existing,
        capabilities: [...capabilities],
        routes: {
          ...existing.routes,
          'image-generation': existing.routes?.['image-generation'] ?? route,
        },
      });
      continue;
    }

    const model: ModelConfigEntry = {
      id: modelId,
      capabilities: ['image-generation'],
      routes: { 'image-generation': route },
    };
    if (discovered.label?.trim() && discovered.label !== modelId) {
      model.label = discovered.label.trim();
    }
    if (discovered.input) {
      model.input = discovered.input;
    }
    if (discovered.reasoning !== undefined) {
      model.reasoning = discovered.reasoning;
    }
    if (discovered.contextWindow !== undefined) {
      model.contextWindow = discovered.contextWindow;
    }
    if (discovered.maxOutputTokens !== undefined) {
      model.maxOutputTokens = discovered.maxOutputTokens;
    }
    modelsById.set(modelId, model);
  }

  return [...modelsById.values()];
}

export function ImageGenerationSettings(): ReactElement {
  const { config, saveConfig, discoverProviderModels, searchImageModelCatalog, setError } = useSettings();
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.imageGeneration;
  const common = translator.common;

  const allProviders = useMemo(() => config?.providers ?? [], [config]);
  const imageRows = useMemo(() => (config ? collectImageModels(config.providers) : []), [config]);

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addModelId, setAddModelId] = useState('');
  const [addModelPath, setAddModelPath] = useState('/images/generations');
  const [addModelTimeout, setAddModelTimeout] = useState('180');
  const [addModelLabel, setAddModelLabel] = useState('');
  const [addModelDescription, setAddModelDescription] = useState('');

  // Prefer default chat provider, else first configured provider.
  useEffect(() => {
    if (selectedProviderId && allProviders.some((p) => p.id === selectedProviderId)) {
      return;
    }
    const preferred = config?.defaultProviderId;
    if (preferred && allProviders.some((p) => p.id === preferred)) {
      setSelectedProviderId(preferred);
      return;
    }
    setSelectedProviderId(allProviders[0]?.id ?? '');
  }, [allProviders, config?.defaultProviderId, selectedProviderId]);

  // When editing, pin the form to the model's original provider.
  const effectiveProviderId = useMemo(() => {
    const editingProviderId = editingKey?.split(':')[0];
    if (editingProviderId && allProviders.some((p) => p.id === editingProviderId)) {
      return editingProviderId;
    }
    return selectedProviderId;
  }, [allProviders, editingKey, selectedProviderId]);

  const selectedProvider = useMemo(
    () => allProviders.find((p) => p.id === effectiveProviderId) ?? null,
    [allProviders, effectiveProviderId],
  );

  const resetAddForm = useCallback(() => {
    setEditingKey(null);
    setAddModelId('');
    setAddModelPath(
      selectedProvider ? defaultImageGenPath(selectedProvider.protocol) : '/images/generations',
    );
    setAddModelTimeout('180');
    setAddModelLabel('');
    setAddModelDescription('');
  }, [selectedProvider]);

  function handleProviderChange(providerId: string): void {
    setSelectedProviderId(providerId);
    if (editingKey) return;
    const provider = allProviders.find((p) => p.id === providerId);
    if (provider) {
      setAddModelPath(defaultImageGenPath(provider.protocol));
    }
  }

  function handleStartEdit(provider: ModelProviderConfig, model: ModelConfigEntry): void {
    setEditingKey(`${provider.id}:${model.id}`);
    setSelectedProviderId(provider.id);
    const route = model.routes?.['image-generation'];
    setAddModelId(model.id);
    setAddModelPath(route?.path ?? defaultImageGenPath(provider.protocol));
    setAddModelTimeout(route?.timeoutMs !== undefined ? String(route.timeoutMs / 1000) : '180');
    setAddModelLabel(model.label ?? '');
    setAddModelDescription(model.tooltipMarkdown ?? '');
  }

  async function handleAddModel(): Promise<void> {
    if (!config || !selectedProvider) {
      return;
    }
    const id = addModelId.trim();
    if (!id) {
      return;
    }

    const updatedModel = buildImageModelEntry({
      id,
      path: addModelPath,
      timeoutSeconds: addModelTimeout,
      label: addModelLabel,
      description: addModelDescription,
    });

    let nextProviders: ModelProviderConfig[];

    if (editingKey) {
      const [origProviderId, origModelId] = editingKey.split(':');
      nextProviders = config.providers.map((p) => {
        let models = p.models;
        if (p.id === origProviderId) {
          models = models.filter((m) => m.id !== origModelId);
        }
        if (p.id === selectedProvider.id) {
          models = [...models.filter((m) => m.id !== id), updatedModel];
        }
        return { ...p, models };
      });
    } else {
      if (selectedProvider.models.some((model) => model.id === id)) {
        // If the model already exists, upgrade it to image-capable in place.
        nextProviders = config.providers.map((provider) => {
          if (provider.id !== selectedProvider.id) return provider;
          return {
            ...provider,
            models: provider.models.map((model): ModelConfigEntry => {
              if (model.id !== id) return model;
              const capabilities = new Set(model.capabilities ?? []);
              capabilities.add('image-generation');
              // Start from existing chat model, overlay image route/label fields.
              // exactOptionalPropertyTypes: only set optional keys when defined.
              const merged: ModelConfigEntry = {
                ...model,
                id: updatedModel.id,
                capabilities: [...capabilities],
                routes: {
                  ...model.routes,
                  ...updatedModel.routes,
                },
              };
              if (updatedModel.label) merged.label = updatedModel.label;
              if (updatedModel.tooltipMarkdown) {
                merged.tooltipMarkdown = updatedModel.tooltipMarkdown;
              }
              return merged;
            }),
          };
        });
      } else {
        nextProviders = config.providers.map((provider) =>
          provider.id === selectedProvider.id
            ? { ...provider, models: [...provider.models, updatedModel] }
            : provider,
        );
      }
    }

    resetAddForm();
    await saveConfig({ ...config, providers: nextProviders });
  }

  function handleSetDefault(provider: ModelProviderConfig, modelId: string): void {
    if (!config) {
      return;
    }
    const next: PiwinConfig = {
      ...config,
      imageGeneration: {
        ...config.imageGeneration,
        defaultModel: {
          protocol: provider.protocol,
          providerId: provider.id,
          modelId,
        },
      },
    };
    void saveConfig(next);
  }

  function handleRemoveModel(providerId: string, modelId: string): void {
    if (!config) {
      return;
    }
    // Drop the model entry entirely (same as Models page remove).
    const nextProviders = config.providers.map((provider) =>
      provider.id === providerId
        ? { ...provider, models: provider.models.filter((model) => model.id !== modelId) }
        : provider,
    );
    void saveConfig({ ...config, providers: nextProviders });
  }

  if (!config) {
    return (
      <p className="muted" data-testid="image-gen-loading">
        {common.loading}
      </p>
    );
  }

  const apiKeyStatus = selectedProvider?.apiKeyRef
    ? copy.apiKeyStoredKeychain
    : selectedProvider?.apiKeyEnv
      ? copy.apiKeyStoredEnv(selectedProvider.apiKeyEnv)
      : copy.apiKeyUnset;

  return (
    <div className="image-generation-settings" data-testid="image-generation-settings">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={
            editingKey
              ? locale === 'zh-CN'
                ? '编辑图片模型'
                : 'Edit image model'
              : locale === 'zh-CN'
                ? '添加图片模型'
                : 'Add image model'
          }
        />
        {allProviders.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {locale === 'zh-CN'
              ? '请先在「文本模型」中添加接口通道。'
              : 'Add a provider under Text models first.'}
          </p>
        ) : (
          <div className="image-gen-form" style={{ marginTop: 16 }}>
            <div className="image-gen-section-group">
              <div
                className="ui-field-label"
                style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginBottom: 12 }}
              >
                {locale === 'zh-CN' ? '接口通道与模型 ID' : 'Channel & Model ID'}
              </div>

              {/* Real provider channel (same list as Models page) */}
              <div
                className="image-gen-form-row image-gen-form-row--full"
                data-testid="image-gen-provider-select"
              >
                <Field label={locale === 'zh-CN' ? '* 接口通道' : '* Provider channel'}>
                  <select
                    className="mcp-raw-editor"
                    style={{
                      height: 'auto',
                      padding: '9px 12px',
                      width: '100%',
                      borderRadius: 8,
                      fontSize: 13.5,
                    }}
                    data-testid="image-gen-provider-select-control"
                    value={effectiveProviderId}
                    disabled={Boolean(editingKey)}
                    onChange={(event) => handleProviderChange(event.target.value)}
                  >
                    {allProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name || provider.id}
                        {provider.enabled === false
                          ? locale === 'zh-CN'
                            ? '（已关闭）'
                            : ' (off)'
                          : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <div
                  className="image-gen-provider-meta muted"
                  style={{ marginTop: 6, fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}
                >
                  <span data-testid="image-gen-baseurl">{selectedProvider?.baseUrl ?? '—'}</span>
                  <span data-testid="image-gen-apikey-status">{apiKeyStatus}</span>
                </div>
              </div>

              {/* Model ID with smart image-model suggestion dropdown */}
              <div
                className="image-gen-form-row image-gen-form-row--full"
                style={{ marginTop: 12 }}
              >
                <div className="ui-field">
                  <label className="ui-field-label">
                    <span style={{ color: 'var(--danger, #ef4444)', marginRight: 4 }}>*</span>
                    {copy.modelId}
                  </label>
                  <div className="ui-field-control">
                    <ImageModelSuggest
                      value={addModelId}
                      onChange={setAddModelId}
                      provider={selectedProvider}
                      disabled={Boolean(editingKey)}
                      searchImageModelCatalog={searchImageModelCatalog}
                      discoverProviderModels={discoverProviderModels}
                      onDiscoverError={(message) => setError(message)}
                    />
                  </div>
                </div>
              </div>

              <div className="image-gen-form-row" style={{ marginTop: 12 }}>
                <Field
                  label={locale === 'zh-CN' ? '自定义请求路径' : copy.requestPath}
                  description={
                    locale === 'zh-CN'
                      ? '不同模型服务商的接口路径可能不同。这里仅填写请求路径，不填写完整域名。留空时系统使用当前通道默认路径。'
                      : copy.requestPathHint
                  }
                >
                  <input
                    className="mcp-raw-editor"
                    style={{ height: 'auto', padding: '8px 12px' }}
                    data-testid="image-add-model-path"
                    value={addModelPath}
                    onChange={(event) => setAddModelPath(event.target.value)}
                    placeholder="/images/generations"
                    spellCheck={false}
                  />
                </Field>
                <Field label={`${copy.timeout} (${copy.timeoutUnitSeconds})`}>
                  <input
                    className="mcp-raw-editor"
                    style={{ height: 'auto', padding: '8px 12px' }}
                    data-testid="image-add-model-timeout"
                    value={addModelTimeout}
                    onChange={(event) => setAddModelTimeout(event.target.value)}
                    placeholder="300"
                    inputMode="numeric"
                  />
                </Field>
              </div>

              <div className="image-gen-form-row" style={{ marginTop: 12 }}>
                <Field label={locale === 'zh-CN' ? '模型备注' : copy.modelLabel}>
                  <input
                    className="mcp-raw-editor"
                    style={{ height: 'auto', padding: '8px 12px' }}
                    data-testid="image-add-model-label"
                    value={addModelLabel}
                    onChange={(event) => setAddModelLabel(event.target.value)}
                    placeholder="SiliconFlow FLUX"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label={locale === 'zh-CN' ? '模型介绍' : copy.modelDescription}
                  {...(locale === 'zh-CN'
                    ? { description: '填写后会同步到前台对应模型的输入框默认提示' }
                    : {})}
                >
                  <input
                    className="mcp-raw-editor"
                    style={{ height: 'auto', padding: '8px 12px' }}
                    data-testid="image-add-model-description"
                    value={addModelDescription}
                    onChange={(event) => setAddModelDescription(event.target.value)}
                    spellCheck={false}
                  />
                </Field>
              </div>

              {addModelId.trim() && !editingKey ? (
                <p className="muted" style={{ marginTop: 12, fontSize: 12 }} data-testid="image-add-model-hint">
                  {copy.saveHint}
                </p>
              ) : null}

              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {editingKey ? (
                  <Button size="compact" variant="ghost" onClick={resetAddForm}>
                    {locale === 'zh-CN' ? '取消编辑' : 'Cancel'}
                  </Button>
                ) : null}
                <Button
                  size="compact"
                  variant="primary"
                  data-testid="image-add-model-submit"
                  disabled={!addModelId.trim() || !selectedProvider}
                  onClick={() => void handleAddModel()}
                >
                  {editingKey
                    ? locale === 'zh-CN'
                      ? '保存模型修改'
                      : 'Update Model'
                    : copy.addModel}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section settings-section-card" style={{ marginTop: 16 }}>
        <PageTitle title={copy.modelsHeading} />
        {imageRows.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }} data-testid="image-gen-empty">
            {copy.noModels}
          </p>
        ) : (
          <ul className="image-gen-model-list" style={{ marginTop: 12 }}>
            {imageRows.map(({ provider, model }) => {
              const route = model.routes?.['image-generation'];
              const isDefault =
                config.imageGeneration?.defaultModel?.modelId === model.id &&
                config.imageGeneration?.defaultModel?.providerId === provider.id;
              const isEditing = editingKey === `${provider.id}:${model.id}`;
              return (
                <li
                  key={`${provider.id}:${model.id}`}
                  className={`image-gen-model-item ${isEditing ? 'is-editing' : ''}`}
                  data-testid="image-model-row"
                >
                  <ProviderIcon id={provider.id} size={28} />
                  <div className="image-gen-model-item-body">
                    <div className="image-gen-model-item-title">
                      <span className="image-gen-model-item-id">{model.id}</span>
                      {model.label ? (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {model.label}
                        </span>
                      ) : null}
                      {isDefault ? (
                        <span className="image-gen-default-badge">
                          {locale === 'zh-CN' ? '默认' : 'Default'}
                        </span>
                      ) : null}
                    </div>
                    <div className="image-gen-model-item-meta">
                      <strong style={{ color: 'var(--text)' }}>{provider.name}</strong>
                      {' · '}
                      {route?.path ?? '—'}
                      {route?.timeoutMs !== undefined
                        ? ` · ${route.timeoutMs / 1000}${copy.timeoutUnitSeconds}`
                        : ''}
                    </div>
                  </div>
                  <div className="image-gen-model-item-actions">
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => handleStartEdit(provider, model)}
                    >
                      {locale === 'zh-CN' ? '编辑' : 'Edit'}
                    </Button>
                    {!isDefault ? (
                      <Button
                        size="compact"
                        variant="ghost"
                        data-testid="image-model-set-default"
                        onClick={() => handleSetDefault(provider, model.id)}
                      >
                        {copy.setDefault}
                      </Button>
                    ) : null}
                    <Button
                      size="compact"
                      variant="ghost"
                      data-testid="image-model-remove"
                      onClick={() => handleRemoveModel(provider.id, model.id)}
                      style={{ color: 'var(--danger)' }}
                    >
                      {copy.removeModel}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>


    </div>
  );
}
