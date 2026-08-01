/**
 * Settings → Image Generation.
 *
 * Lists image-generation-capable providers from `config.providers` (same data
 * store as the chat model settings), then per selected provider shows a
 * read-only connection summary (base URL, API key status) and an editable list
 * of image models. Model route overrides (request path, timeout) live in
 * `provider.models[].routes['image-generation']`; label/description live on the
 * model entry itself. Edits auto-save (debounced), matching ProviderSettings.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Button, Field, Spinner } from '@piwin/ui-kit';
import type {
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRouteConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { useSettings } from './settings/settings-context';
import { PageTitle } from './settings/page-title';

/** A model is treated as image-capable when it declares the capability or omits the field (backward compat). */
function isImageGenerationModel(model: ModelConfigEntry): boolean {
  return !model.capabilities || model.capabilities.includes('image-generation');
}

/** Providers that expose at least one image-generation model. */
function imageGenerationProviders(
  providers: readonly ModelProviderConfig[],
): ModelProviderConfig[] {
  return providers.filter((provider) => provider.models.some(isImageGenerationModel));
}

/** Normalize a custom request path: require leading `/`, reject absolute URLs. */
function normalizeRequestPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Parse a timeout field in seconds; returns ms-scale seconds or undefined when unset/invalid. */
function parseTimeoutSeconds(value: string): number | undefined {
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

/** Editable fields of the expanded model row. */
type ModelEditDraft = {
  path: string;
  timeoutSeconds: string;
  label: string;
  description: string;
};

function modelToDraft(model: ModelConfigEntry): ModelEditDraft {
  const route = model.routes?.['image-generation'];
  return {
    path: route?.path ?? '',
    timeoutSeconds: route?.timeoutMs !== undefined ? String(route.timeoutMs / 1000) : '',
    label: model.label ?? '',
    description: model.tooltipMarkdown ?? '',
  };
}

/** Apply an edited draft back onto a model's image-generation route + identity fields. */
function applyEditToModel(model: ModelConfigEntry, draft: ModelEditDraft): ModelConfigEntry {
  const route: ModelRouteConfig = { ...model.routes?.['image-generation'] };
  const path = normalizeRequestPath(draft.path);
  if (path) {
    route.path = path;
  } else {
    delete route.path;
  }
  const timeout = parseTimeoutSeconds(draft.timeoutSeconds);
  if (timeout !== undefined) {
    route.timeoutMs = timeout * 1000;
  } else {
    delete route.timeoutMs;
  }
  const next: ModelConfigEntry = {
    ...model,
    routes: { ...model.routes, 'image-generation': route },
  };
  const label = draft.label.trim();
  if (label) {
    next.label = label;
  } else {
    delete next.label;
  }
  const description = draft.description.trim();
  if (description) {
    next.tooltipMarkdown = description;
  } else {
    delete next.tooltipMarkdown;
  }
  return next;
}

export function ImageGenerationSettings(): ReactElement {
  const { config, saveConfig, discoverProviderModels, setError } = useSettings();
  const { translator } = useDesktopLocale();
  const copy = translator.settings.imageGeneration;

  const providerList = useMemo(
    () => (config ? imageGenerationProviders(config.providers) : []),
    [config],
  );
  // Fall back to all providers when none have an image-generation model yet.
  const dropdownProviders = useMemo(
    () => (config ? (providerList.length > 0 ? providerList : config.providers) : []),
    [config, providerList],
  );

  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    const preferred = config?.defaultProviderId;
    if (preferred && dropdownProviders.some((p) => p.id === preferred)) {
      return preferred;
    }
    return dropdownProviders[0]?.id ?? '';
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<ModelEditDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [addModelId, setAddModelId] = useState('');
  const [addModelPath, setAddModelPath] = useState('');
  const [addModelTimeout, setAddModelTimeout] = useState('');
  const [addModelLabel, setAddModelLabel] = useState('');
  const [addModelDescription, setAddModelDescription] = useState('');
  const [discovering, setDiscovering] = useState(false);

  const saveInFlightRef = useRef(false);
  const [saveAttempt, setSaveAttempt] = useState(0);

  const selectedProvider = useMemo(
    () =>
      dropdownProviders.find((p) => p.id === selectedProviderId) ?? dropdownProviders[0] ?? null,
    [dropdownProviders, selectedProviderId],
  );

  const imageModels = useMemo(
    () => (selectedProvider ? selectedProvider.models.filter(isImageGenerationModel) : []),
    [selectedProvider],
  );

  const saveEdit = useCallback(
    async (modelId: string, snapshot: ModelEditDraft, revision: number): Promise<boolean> => {
      if (!config || !selectedProvider) {
        return false;
      }
      const nextProviders = config.providers.map((provider) =>
        provider.id === selectedProvider.id
          ? {
              ...provider,
              models: provider.models.map((model) =>
                model.id === modelId ? applyEditToModel(model, snapshot) : model,
              ),
            }
          : provider,
      );
      const ok = await saveConfig({ ...config, providers: nextProviders });
      if (ok) {
        setDirty((current) => (saveAttempt === revision ? false : current));
      }
      return ok;
    },
    [config, saveConfig, saveAttempt, selectedProvider],
  );

  // Debounced auto-save for expanded-model edits (mirrors ProviderSettings).
  useEffect(() => {
    if (!dirty || !edit || !expandedId || saveInFlightRef.current) {
      return;
    }
    const snapshot = edit;
    const snapshotId = expandedId;
    const revision = saveAttempt;

    const timer = window.setTimeout(() => {
      saveInFlightRef.current = true;
      void saveEdit(snapshotId, snapshot, revision).finally(() => {
        saveInFlightRef.current = false;
        setSaveAttempt((current) => current + 1);
      });
    }, 700);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dirty, edit, expandedId, saveAttempt, saveEdit]);

  function handleProviderChange(nextId: string): void {
    setSelectedProviderId(nextId);
    setExpandedId(null);
    setEdit(null);
    setDirty(false);
  }

  function toggleExpand(modelId: string): void {
    if (expandedId === modelId) {
      setExpandedId(null);
      setEdit(null);
      setDirty(false);
      return;
    }
    const model = imageModels.find((m) => m.id === modelId);
    if (!model) {
      return;
    }
    setExpandedId(modelId);
    setEdit(modelToDraft(model));
    setDirty(false);
  }

  function patchEdit(patch: Partial<ModelEditDraft>): void {
    setEdit((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  function handleSetDefault(modelId: string): void {
    if (!config || !selectedProvider) {
      return;
    }
    const next: PiwinConfig = {
      ...config,
      imageGeneration: {
        ...config.imageGeneration,
        defaultModel: {
          protocol: selectedProvider.protocol,
          providerId: selectedProvider.id,
          modelId,
        },
      },
    };
    void saveConfig(next);
  }

  function handleRemoveModel(modelId: string): void {
    if (!config || !selectedProvider) {
      return;
    }
    const nextProviders = config.providers.map((provider) =>
      provider.id === selectedProvider.id
        ? { ...provider, models: provider.models.filter((model) => model.id !== modelId) }
        : provider,
    );
    void saveConfig({ ...config, providers: nextProviders });
    if (expandedId === modelId) {
      setExpandedId(null);
      setEdit(null);
      setDirty(false);
    }
  }

  async function handleAddModel(): Promise<void> {
    if (!config || !selectedProvider) {
      return;
    }
    const id = addModelId.trim();
    if (!id) {
      return;
    }
    const path = normalizeRequestPath(addModelPath);
    const timeout = parseTimeoutSeconds(addModelTimeout);
    const label = addModelLabel.trim();
    const description = addModelDescription.trim();
    const model: ModelConfigEntry = {
      id,
      capabilities: ['image-generation'],
      ...(label ? { label } : {}),
      ...(description ? { tooltipMarkdown: description } : {}),
      routes: {
        'image-generation': {
          ...(path ? { path } : {}),
          ...(timeout !== undefined ? { timeoutMs: timeout * 1000 } : {}),
        },
      },
    };
    const nextProviders = config.providers.map((provider) =>
      provider.id === selectedProvider.id
        ? { ...provider, models: [...provider.models, model] }
        : provider,
    );
    // Clear the form synchronously (values already captured above) so repeated
    // adds start fresh; the submitted snapshot drives the save below.
    setAddModelId('');
    setAddModelPath('');
    setAddModelTimeout('');
    setAddModelLabel('');
    setAddModelDescription('');
    await saveConfig({ ...config, providers: nextProviders });
  }

  async function handleDiscoverModels(): Promise<void> {
    if (!selectedProvider) {
      return;
    }
    setDiscovering(true);
    try {
      const result = await discoverProviderModels(selectedProvider);
      const discovered = result.models[0]?.id;
      if (discovered) {
        setAddModelId((current) => (current.trim() ? current : discovered));
      }
    } catch {
      setError(copy.discoveryError);
    } finally {
      setDiscovering(false);
    }
  }

  if (!config) {
    return (
      <p className="muted" data-testid="image-gen-loading">
        {translator.common.loading}
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
      <PageTitle title={copy.pageTitle} description={copy.pageDescription} />

      {dropdownProviders.length === 0 ? (
        <p className="muted">{copy.noModels}</p>
      ) : (
        <>
          {/* Provider + connection summary */}
          <section className="provider-section">
            <Field label={copy.provider}>
              <div data-testid="image-gen-provider-select">
                <select
                  className="mcp-raw-editor"
                  style={{ height: 'auto', padding: '8px 12px' }}
                  value={selectedProviderId}
                  onChange={(event) => handleProviderChange(event.target.value)}
                >
                  {dropdownProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            {selectedProvider ? (
              <div className="mcp-form-grid">
                <div>
                  <div className="ui-field-label">{copy.apiEndpoint}</div>
                  <div
                    className="muted"
                    data-testid="image-gen-baseurl"
                    style={{ fontFamily: 'var(--mono)', fontSize: '13px', marginTop: 4 }}
                  >
                    {selectedProvider.baseUrl}
                  </div>
                </div>
                <div>
                  <div className="ui-field-label">{copy.apiKey}</div>
                  <div
                    className="muted"
                    data-testid="image-gen-apikey-status"
                    style={{ marginTop: 4 }}
                  >
                    {apiKeyStatus}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {/* Model list */}
          <section className="provider-section">
            <PageTitle title={copy.modelsHeading} />
            <div className="ext-list" style={{ marginTop: 12 }}>
              {imageModels.length === 0 ? (
                <li className="muted" style={{ textAlign: 'center', padding: '32px' }}>
                  {copy.noModels}
                </li>
              ) : (
                imageModels.map((model) => {
                  const isExpanded = expandedId === model.id;
                  const route = model.routes?.['image-generation'];
                  return (
                    <div
                      key={model.id}
                      className={isExpanded ? 'ext-list-item active' : 'ext-list-item'}
                      style={{ flexDirection: 'column', alignItems: 'stretch', padding: '4px' }}
                    >
                      <div
                        data-testid="image-model-row"
                        onClick={() => toggleExpand(model.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '10px 12px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ fontFamily: 'var(--mono)', fontSize: '13.5px' }}>
                            {model.id}
                          </strong>
                          <div className="muted" style={{ fontSize: '11.5px', marginTop: 2 }}>
                            {route?.path ?? '—'}
                            {route?.timeoutMs !== undefined
                              ? ` · ${route.timeoutMs / 1000}${copy.timeoutUnitSeconds}`
                              : ''}
                          </div>
                        </div>
                        <div className="muted" style={{ fontSize: '12px', opacity: 0.5 }}>
                          {isExpanded ? '↑' : '↓'}
                        </div>
                      </div>

                      {isExpanded && edit ? (
                        <div
                          style={{
                            padding: '20px 12px 12px',
                            borderTop: '1px solid var(--line-soft)',
                            background: 'var(--surface-inset)',
                            borderRadius: '0 0 8px 8px',
                          }}
                        >
                          <div className="mcp-form-grid">
                            <Field label={copy.requestPath}>
                              <input
                                className="mcp-raw-editor"
                                style={{ height: 'auto', padding: '8px 12px' }}
                                data-testid="image-model-path"
                                value={edit.path}
                                onChange={(event) => patchEdit({ path: event.target.value })}
                                spellCheck={false}
                              />
                            </Field>
                            <Field label={`${copy.timeout} (${copy.timeoutUnitSeconds})`}>
                              <input
                                className="mcp-raw-editor"
                                style={{ height: 'auto', padding: '8px 12px' }}
                                data-testid="image-model-timeout"
                                value={edit.timeoutSeconds}
                                onChange={(event) =>
                                  patchEdit({ timeoutSeconds: event.target.value })
                                }
                                inputMode="numeric"
                              />
                            </Field>
                          </div>
                          <div className="mcp-form-grid" style={{ marginTop: 16 }}>
                            <Field label={copy.modelLabel}>
                              <input
                                className="mcp-raw-editor"
                                style={{ height: 'auto', padding: '8px 12px' }}
                                data-testid="image-model-label"
                                value={edit.label}
                                onChange={(event) => patchEdit({ label: event.target.value })}
                                spellCheck={false}
                              />
                            </Field>
                            <Field label={copy.modelDescription}>
                              <input
                                className="mcp-raw-editor"
                                style={{ height: 'auto', padding: '8px 12px' }}
                                data-testid="image-model-description"
                                value={edit.description}
                                onChange={(event) => patchEdit({ description: event.target.value })}
                                spellCheck={false}
                              />
                            </Field>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: '8px',
                              marginTop: 16,
                            }}
                          >
                            <Button
                              size="compact"
                              variant="ghost"
                              data-testid="image-model-set-default"
                              onClick={() => handleSetDefault(model.id)}
                            >
                              {copy.setDefault}
                            </Button>
                            <Button
                              size="compact"
                              variant="ghost"
                              data-testid="image-model-remove"
                              onClick={() => handleRemoveModel(model.id)}
                              style={{ color: 'var(--danger)' }}
                            >
                              {copy.removeModel}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Add image model */}
          <section className="provider-section">
            <PageTitle title={copy.addModel} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Field label={copy.modelId}>
                  <input
                    className="mcp-raw-editor"
                    style={{ height: 'auto', padding: '8px 12px' }}
                    data-testid="image-add-model-id"
                    value={addModelId}
                    onChange={(event) => setAddModelId(event.target.value)}
                    spellCheck={false}
                  />
                </Field>
              </div>
              <Button
                size="compact"
                variant="ghost"
                disabled={discovering}
                onClick={() => void handleDiscoverModels()}
              >
                {discovering ? <Spinner /> : copy.discoverModels}
              </Button>
            </div>
            <div className="mcp-form-grid" style={{ marginTop: 16 }}>
              <Field label={copy.requestPath}>
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
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="mcp-form-grid" style={{ marginTop: 16 }}>
              <Field label={copy.modelLabel}>
                <input
                  className="mcp-raw-editor"
                  style={{ height: 'auto', padding: '8px 12px' }}
                  data-testid="image-add-model-label"
                  value={addModelLabel}
                  onChange={(event) => setAddModelLabel(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <Field label={copy.modelDescription}>
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
            <div style={{ marginTop: 16 }}>
              <Button
                size="compact"
                data-testid="image-add-model-submit"
                onClick={() => void handleAddModel()}
              >
                {copy.addModel}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
