/**
 * Models / providers settings — two-level layout:
 *   provider pills (top) + connection form + model table
 *   Auto-saves draft changes; secrets stay in keychain refs only.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Button, Dialog, IconButton } from '@piwin/ui-kit';
import type {
  ModelConfigEntry,
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { ModelWorkbench } from './ModelWorkbench';
import { ProviderKeyManagerDialog } from './ProviderKeyManagerDialog';
import { useDesktopLocale } from './desktop-locale-context';
import { useConfirmDialog } from './use-confirm-dialog';
import {
  getProviderPreset,
  PROVIDER_PRESETS,
  type ProviderPreset,
  type ProviderProtocol,
} from './provider-presets';
import { IconClose, IconSettings, IconStar } from './shell-icons';

export type DiscoverModelsOptions = {
  apiKey?: string;
};

export type ProviderSettingsProps = {
  config: PiwinConfig;
  saving: boolean;
  onSave: (next: PiwinConfig) => Promise<boolean>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  onDiscoverModels: (
    provider: ModelProviderConfig,
    options?: DiscoverModelsOptions,
  ) => Promise<ModelDiscoveryResult>;
  onTestModel: (
    provider: ModelProviderConfig,
    modelId: string,
    options?: DiscoverModelsOptions,
  ) => Promise<{ durationMs: number }>;
  /** Persist secret to host keychain; returns apiKeyRef. */
  onStoreSecret: (providerId: string, secret: string) => Promise<string>;
  /** Load multi-line secret for key manager. */
  onLoadSecret: (providerId: string) => Promise<string | null>;
};

type HeaderDraftRow = {
  id: string;
  name: string;
  value: string;
};

type ProviderDraft = {
  id: string;
  protocol: ProviderProtocol;
  name: string;
  baseUrl: string;
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

function createHeaderRow(name = '', value = ''): HeaderDraftRow {
  return {
    id: `hdr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    value,
  };
}

function headersToRows(headers: Record<string, string> | undefined): HeaderDraftRow[] {
  if (!headers) {
    return [];
  }
  return Object.entries(headers).map(([name, value]) => createHeaderRow(name, value));
}

function rowsToHeaders(rows: readonly HeaderDraftRow[]): Record<string, string> | undefined {
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

function isEnvVarName(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(value.trim());
}

function isLegacyPlaceholderModel(model: ModelConfigEntry): boolean {
  // Earlier builds inserted this placeholder into saved provider config.
  // It is not a usable model and must never be presented as one.
  return model.id.trim().toLowerCase() === 'model-id';
}

function providerToDraft(provider: ModelProviderConfig): ProviderDraft {
  return {
    id: provider.id,
    protocol: provider.protocol,
    name: provider.name,
    baseUrl: provider.baseUrl,
    // Never surface raw secrets; stored refs stay in hidden fields.
    apiKeyInput: '',
    storedApiKeyEnv: provider.apiKeyEnv ?? '',
    storedApiKeyRef: provider.apiKeyRef ?? '',
    headerRows: headersToRows(provider.headers),
    models: provider.models
      .filter((model) => !isLegacyPlaceholderModel(model))
      .map((model) => ({ ...model })),
  };
}

function presetToDraft(preset: ProviderPreset): ProviderDraft {
  return {
    id: preset.id,
    protocol: preset.protocol,
    name: preset.name,
    baseUrl: preset.baseUrl,
    // Do not pre-fill env names as "configured secrets" — user pastes a real key.
    apiKeyInput: '',
    storedApiKeyEnv: '',
    storedApiKeyRef: '',
    headerRows: [],
    models: preset.models.map((model) => ({ ...model })),
  };
}

function draftToProvider(draft: ProviderDraft): ModelProviderConfig {
  const base = {
    id: draft.id.trim(),
    protocol: draft.protocol,
    name: draft.name.trim() || draft.id.trim(),
    baseUrl: draft.baseUrl.trim(),
    models: draft.models.filter((model) => model.id.trim().length > 0),
  };
  const provider = { ...base } as ModelProviderConfig;
  const headers = rowsToHeaders(draft.headerRows);
  if (headers) {
    provider.headers = headers;
  }
  const typed = draft.apiKeyInput.trim();
  // Raw key in the field is one-shot / keychain material — never treat as env name.
  if (typed && isEnvVarName(typed)) {
    provider.apiKeyEnv = typed;
    return provider;
  }
  if (typed && !isEnvVarName(typed)) {
    // Prefer keychain ref if already stored; raw secret is passed separately as one-shot.
    if (draft.storedApiKeyRef.trim()) {
      provider.apiKeyRef = draft.storedApiKeyRef.trim();
    }
    return provider;
  }
  // Empty input: only real keychain counts as a configured secret for auth.
  // Bare env names are optional hints and must not block local discovery when unset.
  if (draft.storedApiKeyRef.trim()) {
    provider.apiKeyRef = draft.storedApiKeyRef.trim();
  } else if (draft.storedApiKeyEnv.trim()) {
    provider.apiKeyEnv = draft.storedApiKeyEnv.trim();
  }
  return provider;
}

function oneShotApiKeyFromDraft(draft: ProviderDraft): string | undefined {
  const typed = draft.apiKeyInput.trim();
  if (!typed || isEnvVarName(typed)) {
    return undefined;
  }
  return typed;
}

function hasKeychainSecret(draft: ProviderDraft): boolean {
  return Boolean(draft.storedApiKeyRef.trim());
}


/**
 * Two-column models settings.
 * Provider tabs at top → detail panel.
 */
export function ProviderSettings(props: ProviderSettingsProps): ReactElement {
  const {
    config,
    saving,
    onSave,
    onError,
    onInfo,
    onDiscoverModels,
    onTestModel,
    onStoreSecret,
    onLoadSecret,
  } = props;
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const confirmDialog = useConfirmDialog();
  const [selectedId, setSelectedId] = useState<string | null>(
    config.defaultProviderId ?? config.providers[0]?.id ?? null,
  );
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [autoSaveAttempt, setAutoSaveAttempt] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPresetId, setAddPresetId] = useState('custom-openai');
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const draftRef = useRef<ProviderDraft | null>(null);
  const draftRevisionRef = useRef(0);
  const autoSaveInFlightRef = useRef(false);
  draftRef.current = draft;

  const selectedProvider = useMemo(
    () => config.providers.find((provider) => provider.id === selectedId) ?? null,
    [config.providers, selectedId],
  );

  useEffect(() => {
    if (selectedProvider) {
      // An older auto-save may update config after the user typed again.
      // Keep the in-progress draft until its newer debounce cycle completes.
      if (dirty && draftRef.current?.id === selectedProvider.id) {
        return;
      }
      setDraft(providerToDraft(selectedProvider));
      draftRevisionRef.current += 1;
      setDirty(false);
      setAutoSaveStatus('idle');
      return;
    }
    if (config.providers.length === 0) {
      setDraft(null);
      draftRevisionRef.current += 1;
      setSelectedId(null);
      setDirty(false);
      setAutoSaveStatus('idle');
      return;
    }
    const fallback = config.defaultProviderId ?? config.providers[0]?.id ?? null;
    setSelectedId(fallback);
  }, [selectedProvider, config.providers, config.defaultProviderId, dirty]);

  function markDraft(next: ProviderDraft): void {
    draftRevisionRef.current += 1;
    setDraft(next);
    setDirty(true);
    setAutoSaveStatus('pending');
  }

  const configuredIds = useMemo(
    () => new Set(config.providers.map((provider) => provider.id)),
    [config.providers],
  );

  function openAddDialog(): void {
    setAddName('');
    setAddPresetId('custom-openai');
    setAddOpen(true);
  }

  async function handleConfirmAdd(): Promise<void> {
    const preset = getProviderPreset(addPresetId);
    if (!preset) {
      return;
    }
    const displayName = addName.trim() || preset.name;
    let nextId = preset.id;
    if (configuredIds.has(nextId) || config.providers.some((provider) => provider.name === displayName)) {
      nextId = `${preset.id}-${Date.now().toString(36).slice(-4)}`;
    }
    const draftFromPreset = presetToDraft({ ...preset, id: nextId, name: displayName });
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
      setAddOpen(false);
      onInfo(locale === 'zh-CN' ? `已添加 ${provider.name}` : `Added ${provider.name}`);
    }
  }

  const saveDraftSnapshot = useCallback(async (
    snapshot: ProviderDraft,
    snapshotRevision: number,
  ): Promise<boolean> => {
    if (!snapshot.id.trim()) {
      onError(locale === 'zh-CN' ? '请填写提供商 ID。' : 'Provider ID is required.');
      return false;
    }
    if (!snapshot.baseUrl.trim().startsWith('http')) {
      // Incomplete URL while typing — wait for more input.
      return false;
    }
    if (snapshot.models.some((model) => !model.id.trim())) {
      onError(locale === 'zh-CN' ? '模型 ID 不能为空。' : 'Model IDs cannot be empty.');
      return false;
    }

    let nextDraft = { ...snapshot };
    const typedKey = snapshot.apiKeyInput.trim();
    try {
      if (typedKey && !isEnvVarName(typedKey)) {
        const apiKeyRef = await onStoreSecret(snapshot.id.trim(), typedKey);
        nextDraft = {
          ...nextDraft,
          apiKeyInput: '',
          storedApiKeyEnv: '',
          storedApiKeyRef: apiKeyRef,
        };
      } else if (typedKey && isEnvVarName(typedKey)) {
        nextDraft = {
          ...nextDraft,
          apiKeyInput: '',
          storedApiKeyEnv: typedKey,
          storedApiKeyRef: '',
        };
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return false;
    }

    const previousId = selectedId;
    const provider = draftToProvider(nextDraft);
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
        ? snapshot.models[0]?.id
        : config.defaultModelId;
    if (nextDefaultModel) {
      next.defaultModelId = nextDefaultModel;
    } else if (config.defaultProviderId === previousId) {
      delete next.defaultModelId;
    }
    const saved = await onSave(next);
    // Never let an earlier response replace a newer edit in the open form.
    if (saved && draftRevisionRef.current === snapshotRevision) {
      setDraft(providerToDraft(provider));
      setDirty(false);
      setAutoSaveStatus('saved');
    }
    return saved;
  }, [config, locale, onError, onSave, onStoreSecret, selectedId]);

  // Debounced auto-save when the draft is dirty.
  useEffect(() => {
    if (!dirty || !draft) {
      return;
    }
    if (!draft.baseUrl.trim().startsWith('http')) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (autoSaveInFlightRef.current) {
        return;
      }
      const snapshot = draftRef.current;
      if (!snapshot) {
        return;
      }
      const snapshotRevision = draftRevisionRef.current;
      autoSaveInFlightRef.current = true;
      setAutoSaveStatus('saving');
      void saveDraftSnapshot(snapshot, snapshotRevision)
        .then((ok) => {
          if (!ok) {
            setAutoSaveStatus('error');
          }
        })
        .finally(() => {
          autoSaveInFlightRef.current = false;
          // A change made while saving needs a fresh debounce after this request completes.
          setAutoSaveAttempt((currentAttempt) => currentAttempt + 1);
        });
    }, 700);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autoSaveAttempt, dirty, draft, saveDraftSnapshot]);

  async function handleDelete(): Promise<void> {
    if (!selectedId) {
      return;
    }
    const ok = await confirmDialog.confirm({
      title: copy.removeProviderTitle,
      description: copy.removeProviderDescription,
      affectedObject: selectedId,
      confirmLabel: common.remove,
      tone: 'danger',
    });
    if (!ok) {
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
      onInfo(locale === 'zh-CN' ? '已移除提供商。' : 'Provider removed.');
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
      onInfo(
        locale === 'zh-CN'
          ? `默认模型：${selectedProvider.name} / ${modelId ?? '—'}`
          : `Default: ${selectedProvider.name} / ${modelId ?? '—'}`,
      );
    }
  }

  async function handleSetDefaultModel(modelId: string): Promise<void> {
    if (!selectedProvider) {
      return;
    }
    const next: PiwinConfig = {
      ...config,
      defaultProviderId: selectedProvider.id,
      defaultModelId: modelId,
    };
    if (await onSave(next)) {
      onInfo(
        locale === 'zh-CN'
          ? `默认模型：${selectedProvider.name} / ${modelId}`
          : `Default: ${selectedProvider.name} / ${modelId}`,
      );
    }
  }

  async function persistOneShotKeyIfNeeded(oneShot: string | undefined): Promise<ProviderDraft | null> {
    if (!draft || !oneShot) {
      return draft;
    }
    const apiKeyRef = await onStoreSecret(draft.id.trim(), oneShot);
    const nextDraft: ProviderDraft = {
      ...draft,
      apiKeyInput: '',
      storedApiKeyEnv: '',
      storedApiKeyRef: apiKeyRef,
    };
    setDraft(nextDraft);
    // Persist keychain ref into config so reloads keep working.
    const provider = draftToProvider(nextDraft);
    const previousId = selectedId;
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
    if (config.defaultModelId) {
      next.defaultModelId = config.defaultModelId;
    } else if (provider.models[0]?.id) {
      next.defaultModelId = provider.models[0].id;
    }
    await onSave(next);
    return nextDraft;
  }

  async function discoverWithDraft(provider: ModelProviderConfig): Promise<ModelDiscoveryResult> {
    if (!draft) {
      return onDiscoverModels(provider);
    }
    const oneShot = oneShotApiKeyFromDraft(draft);
    const result = await onDiscoverModels(
      draftToProvider(draft),
      oneShot ? { apiKey: oneShot } : undefined,
    );
    if (oneShot) {
      try {
        await persistOneShotKeyIfNeeded(oneShot);
      } catch {
        // Discovery already succeeded; keychain persist failure is non-fatal here.
      }
    }
    return result;
  }

  async function testManagedKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
    if (!draft) {
      return { ok: false, message: copy.detectFail };
    }
    try {
      const result = await onDiscoverModels(draftToProvider(draft), { apiKey });
      return { ok: true, message: copy.detectOk(result.models.length) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `${copy.detectFail}: ${message}` };
    }
  }

  async function testModelWithDraft(
    provider: ModelProviderConfig,
    modelId: string,
  ): Promise<{ durationMs: number }> {
    if (!draft) {
      return onTestModel(provider, modelId);
    }
    const oneShot = oneShotApiKeyFromDraft(draft);
    const result = await onTestModel(
      draftToProvider(draft),
      modelId,
      oneShot ? { apiKey: oneShot } : undefined,
    );
    if (oneShot) {
      try {
        await persistOneShotKeyIfNeeded(oneShot);
      } catch {
        // A successful live probe is still useful if keychain persistence fails.
      }
    }
    return result;
  }

  return (
    <>
      {confirmDialog.dialog}

      <div className="provider-settings" data-testid="provider-settings">
        {/* Provider tabs row */}
        <div className="provider-tabs">
          {config.providers.map((provider) => {
            const isDefault = provider.id === config.defaultProviderId;
            return (
              <button
                key={provider.id}
                type="button"
                className={
                  selectedId === provider.id
                    ? 'provider-tab provider-tab--active'
                    : 'provider-tab'
                }
                data-testid="provider-tab"
                onClick={() => setSelectedId(provider.id)}
              >
                <span className="provider-tab-name">{provider.name}</span>
                {isDefault ? <span className="provider-tab-default">默认</span> : null}
              </button>
            );
          })}
          {config.providers.length < 20 ? (
            <button
              type="button"
              className="provider-add-button"
              onClick={openAddDialog}
              data-testid="provider-add-open"
              aria-label={copy.addProvider}
              title={copy.addProvider}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          ) : null}
        </div>

        {/* Detail panel */}
        {!draft ? (
          <div className="provider-empty muted" data-testid="provider-detail-empty">
            {copy.selectOrAdd}
          </div>
        ) : (
          <div className="provider-content">
            {/* Provider header: name + icon actions + auto-save status */}
            <div className="provider-header">
              <div className="provider-name-row">
                <input
                  className="provider-name-input"
                  value={draft.name}
                  onChange={(event) => markDraft({ ...draft, name: event.target.value })}
                  aria-label={copy.displayName}
                  data-testid="provider-name-input"
                />
                <div className="provider-header-actions">
                  <button
                    type="button"
                    className={
                      config.defaultProviderId === selectedId
                        ? 'provider-icon-btn provider-icon-btn--active'
                        : 'provider-icon-btn'
                    }
                    title={copy.setDefault}
                    aria-label={copy.setDefault}
                    aria-pressed={config.defaultProviderId === selectedId}
                    disabled={saving || !selectedProvider || config.defaultProviderId === selectedId}
                    onClick={() => void handleSetDefault()}
                    data-testid="provider-default-toggle"
                  >
                    <IconStar width={14} height={14} />
                  </button>
                  <button
                    type="button"
                    className="provider-icon-btn provider-icon-btn--danger"
                    title={common.remove}
                    aria-label={common.remove}
                    disabled={saving || !selectedId}
                    onClick={() => void handleDelete()}
                    data-testid="provider-remove-btn"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 4h10M6 4V2.75h4V4M5 6.25v5.5M8 6.25v5.5M11 6.25v5.5M4 4l.5 9h7l.5-9" />
                    </svg>
                  </button>
                  <span
                    className={
                      autoSaveStatus === 'error'
                        ? 'provider-autosave-status provider-autosave-status--error'
                        : 'provider-autosave-status'
                    }
                    data-testid="provider-autosave-status"
                    aria-live="polite"
                  >
                    {autoSaveStatus === 'pending'
                      ? (locale === 'zh-CN' ? '待保存…' : 'Pending…')
                      : autoSaveStatus === 'saving' || saving
                        ? (locale === 'zh-CN' ? '保存中…' : 'Saving…')
                        : autoSaveStatus === 'saved'
                          ? (locale === 'zh-CN' ? '已自动保存' : 'Saved')
                          : autoSaveStatus === 'error'
                            ? (locale === 'zh-CN' ? '保存失败' : 'Save failed')
                            : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Connection */}
            <section className="provider-section">
              <h4 className="provider-section-title">
                {locale === 'zh-CN' ? '连接' : 'Connection'}
              </h4>

              <div className="provider-field">
                <label className="provider-field-label">
                  {copy.apiKeyLabel}
                  <IconButton
                    label={copy.keyManager}
                    title={copy.keyManager}
                    onClick={() => setKeyManagerOpen(true)}
                    data-testid="provider-key-manager-btn"
                  >
                    <IconSettings width={14} height={14} />
                  </IconButton>
                </label>
                <input
                  className="provider-secret-input"
                  type="password"
                  data-testid="provider-apikey-env-input"
                  value={draft.apiKeyInput}
                  onChange={(event) => {
                    markDraft({ ...draft, apiKeyInput: event.target.value });
                  }}
                  placeholder={
                    hasKeychainSecret(draft)
                      ? copy.apiKeyStoredPlaceholder
                      : copy.apiKeyPlaceholder
                  }
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              <div className="provider-field">
                <label className="provider-field-label">{copy.apiAddress}</label>
                <input
                  data-testid="provider-baseurl-input"
                  value={draft.baseUrl}
                  onChange={(event) => markDraft({ ...draft, baseUrl: event.target.value })}
                  spellCheck={false}
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div className="provider-field" data-testid="provider-headers">
                <label className="provider-field-label">
                  <span>{copy.requestHeaders}</span>
                  <Button
                    size="compact"
                    onClick={() =>
                      markDraft({
                        ...draft,
                        headerRows: [...draft.headerRows, createHeaderRow()],
                      })
                    }
                    data-testid="provider-header-add"
                  >
                    + {copy.addHeader}
                  </Button>
                </label>
                {draft.headerRows.length === 0 ? (
                  <p className="muted provider-hint">{copy.requestHeadersHint}</p>
                ) : (
                  <ul className="provider-header-list">
                    {draft.headerRows.map((row) => (
                      <li key={row.id} className="provider-header-row">
                        <input
                          value={row.name}
                          onChange={(event) =>
                            markDraft({
                              ...draft,
                              headerRows: draft.headerRows.map((item) =>
                                item.id === row.id ? { ...item, name: event.target.value } : item,
                              ),
                            })
                          }
                          placeholder={copy.headerName}
                          spellCheck={false}
                          data-testid="provider-header-name"
                        />
                        <input
                          value={row.value}
                          onChange={(event) =>
                            markDraft({
                              ...draft,
                              headerRows: draft.headerRows.map((item) =>
                                item.id === row.id ? { ...item, value: event.target.value } : item,
                              ),
                            })
                          }
                          placeholder={copy.headerValue}
                          spellCheck={false}
                          data-testid="provider-header-value"
                        />
                        <IconButton
                          label={common.remove}
                          onClick={() =>
                            markDraft({
                              ...draft,
                              headerRows: draft.headerRows.filter((item) => item.id !== row.id),
                            })
                          }
                        >
                          −
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Model workbench */}
            <div className="provider-models-section">
              <ModelWorkbench
                provider={draftToProvider(draft)}
                disabled={saving}
                defaultModelId={
                  config.defaultProviderId === selectedId
                    ? config.defaultModelId ?? null
                    : null
                }
                onModelsChange={(models) => markDraft({ ...draft, models })}
                onSetDefaultModel={(modelId) => void handleSetDefaultModel(modelId)}
                onDiscoverModels={discoverWithDraft}
                onTestModel={testModelWithDraft}
              />
            </div>
          </div>
        )}
      </div>

      <Dialog
        label={copy.addProviderTitle}
        open={addOpen}
        onOpenChange={setAddOpen}
        testId="provider-add-dialog"
        closeOnInteractOutside
      >
        <div className="cherry-dialog cherry-dialog--add">
          <header className="cherry-dialog-header">
            <h3>{copy.addProviderTitle}</h3>
            <IconButton label={common.close} onClick={() => setAddOpen(false)}>
              <IconClose width={16} height={16} />
            </IconButton>
          </header>
          <div className="cherry-dialog-body">
            <div className="cherry-add-avatar" aria-hidden>
              {(addName.trim() || 'P').slice(0, 1).toUpperCase()}
            </div>
            <label className="cherry-field">
              <span>{copy.providerNameField}</span>
              <input
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                placeholder={copy.providerNamePlaceholder}
                data-testid="provider-add-name"
                autoFocus
              />
            </label>
            <label className="cherry-field">
              <span>{copy.providerTypeField}</span>
              <select
                value={addPresetId}
                onChange={(event) => setAddPresetId(event.target.value)}
                data-testid="provider-add-type"
              >
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.presetId} value={preset.presetId}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <footer className="cherry-dialog-footer">
            <Button onClick={() => setAddOpen(false)}>
              {common.cancel}
            </Button>
            <Button
              variant="primary"
              data-testid="provider-add-confirm"
              onClick={() => void handleConfirmAdd()}
            >
              {common.confirm}
            </Button>
          </footer>
        </div>
      </Dialog>

      {draft ? (
        <ProviderKeyManagerDialog
          open={keyManagerOpen}
          providerName={draft.name || draft.id}
          providerId={draft.id}
          loadSecret={onLoadSecret}
          saveSecret={onStoreSecret}
          testKey={testManagedKey}
          onOpenChange={setKeyManagerOpen}
          onSaved={(apiKeyRef) => {
            const nextDraft = {
              ...draft,
              apiKeyInput: '',
              storedApiKeyEnv: '',
              storedApiKeyRef: apiKeyRef || '',
            };
            setDraft(nextDraft);
            void (async () => {
              const provider = draftToProvider(nextDraft);
              const previousId = selectedId;
              const nextProviders = config.providers
                .filter((item) => item.id !== previousId && item.id !== provider.id)
                .concat([provider]);
              const next: PiwinConfig = {
                ...config,
                agentMock: false,
                providers: nextProviders,
              };
              if (config.defaultProviderId) {
                next.defaultProviderId = config.defaultProviderId;
              }
              if (config.defaultModelId) {
                next.defaultModelId = config.defaultModelId;
              }
              await onSave(next);
              onInfo(locale === 'zh-CN' ? '密钥已保存。' : 'API keys saved.');
            })();
          }}
        />
      ) : null}
    </>
  );
}
