/**
 * Models / providers settings — two-level layout:
 *   provider pills (top) + connection form + model table
 *   Auto-saves draft changes; secrets stay in keychain refs only.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Button, Collapse, DropdownMenu, DropdownMenuItem, IconButton, Modal, TextInput } from '@piwin/ui-kit';
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
  PROVIDER_PRESETS,
  type ProviderPreset,
  type ProviderProtocol,
} from './provider-presets';
import { IconClose, IconSettings, IconStar } from './shell-icons';
import { PageTitle } from './settings/page-title';
import { FieldRow } from './settings/field-row';

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

function providerToDraft(provider: ModelProviderConfig): ProviderDraft {
  return {
    id: provider.id,
    protocol: provider.protocol,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKeyInput: '',
    storedApiKeyEnv: provider.apiKeyEnv ?? '',
    storedApiKeyRef: provider.apiKeyRef ?? '',
    headerRows: headersToRows(provider.headers),
    models: provider.models,
  };
}

function draftToProvider(draft: ProviderDraft): ModelProviderConfig {
  const config: ModelProviderConfig = {
    id: draft.id.trim(),
    protocol: draft.protocol,
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
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

function hasKeychainSecret(draft: ProviderDraft): boolean {
  return !!draft.storedApiKeyRef;
}

function oneShotApiKeyFromDraft(draft: ProviderDraft): string | undefined {
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
  const [addOpen, setAddOpen] = useState(false);
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);

  // 'pending' | 'saving' | 'saved' | 'error'
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('');
  const [autoSaveAttempt, setAutoSaveAttempt] = useState(0);
  const autoSaveInFlightRef = useRef(false);
  const lastSelectedIdRef = useRef<string | null>(null);
  const lastAddedHeaderIdRef = useRef<string | null>(null);

  const selectedProvider = useMemo(
    () => config.providers.find((p) => p.id === selectedId) ?? null,
    [config.providers, selectedId],
  );

  // Sync draft to selection, but not on every config auto-save; that would
  // recreate header rows and lose focus/scroll position.
  useEffect(() => {
    if (selectedProvider && lastSelectedIdRef.current !== selectedId) {
      setDraft(providerToDraft(selectedProvider));
      setDirty(false);
      setAutoSaveStatus('');
    } else if (!selectedProvider) {
      setDraft(null);
    }
    lastSelectedIdRef.current = selectedId;
  }, [selectedId, selectedProvider]);

  const markDraft = useCallback((next: ProviderDraft) => {
    setDraft(next);
    setDirty(true);
    setAutoSaveStatus('pending');
  }, []);

  const saveDraftSnapshot = useCallback(
    async (snapshot: ProviderDraft, revision: number): Promise<boolean> => {
      const provider = draftToProvider(snapshot);

      // If there's a one-shot key, it will be handled by the next save (persistence
      // logic in discover/test). For auto-save, we only update other fields.
      const nextProviders = config.providers.map((p) => (p.id === snapshot.id ? provider : p));
      const next: PiwinConfig = {
        ...config,
        providers: nextProviders,
      };

      const ok = await onSave(next);
      if (ok) {
        // Clear dirty bit only if no newer changes happened during our request.
        setDirty((current) => (autoSaveAttempt === revision ? false : current));
        setAutoSaveStatus((current) => (autoSaveAttempt === revision ? 'saved' : current));
      }
      return ok;
    },
    [config, onSave, autoSaveAttempt],
  );

  // Debounced auto-save.
  useEffect(() => {
    if (!dirty || !draft || autoSaveInFlightRef.current) {
      return;
    }
    const snapshot = draft;
    const snapshotRevision = autoSaveAttempt;

    const timer = window.setTimeout(() => {
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

  function openAddDialog() {
    setAddOpen(true);
  }

  async function handleAddFromPreset(preset: ProviderPreset) {
    const id = preset.id;
    if (config.providers.find((p) => p.id === id)) {
      onError(locale === 'zh-CN' ? '提供商已存在。' : 'Provider already exists.');
      return;
    }
    const nextProviders = [...config.providers, {
      id,
      protocol: preset.protocol,
      name: preset.name,
      baseUrl: preset.baseUrl,
      models: [],
    }];
    const next: PiwinConfig = { ...config, providers: nextProviders };
    if (await onSave(next)) {
      setSelectedId(id);
      setAddOpen(false);
    }
  }

  return (
    <>
      {confirmDialog.dialog}

      <div className="provider-settings" data-testid="provider-settings">
        {/* Provider selection row */}
        <div className="segmented-control" style={{ marginBottom: 32 }}>
          {config.providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="segmented-control-item"
              data-state={selectedId === provider.id ? 'active' : 'inactive'}
              onClick={() => setSelectedId(provider.id)}
            >
              {provider.name}
              {provider.id === config.defaultProviderId && <IconStar width={10} height={10} style={{ marginLeft: 6, opacity: 0.6 }} />}
            </button>
          ))}
          {config.providers.length < 20 && (
            <button
              type="button"
              className="segmented-control-item"
              onClick={openAddDialog}
              title={copy.addProvider}
            >
              +
            </button>
          )}
          {selectedId && (
            <DropdownMenu
              align="end"
              side="bottom"
              label={locale === 'zh-CN' ? '提供商操作' : 'Provider actions'}
              trigger={
                <button
                  type="button"
                  className="segmented-control-item"
                  aria-label={locale === 'zh-CN' ? '提供商操作' : 'Provider actions'}
                >
                  ⋮
                </button>
              }
            >
              <DropdownMenuItem danger onSelect={() => void handleDelete()}>
                {copy.deleteProvider}
              </DropdownMenuItem>
            </DropdownMenu>
          )}
        </div>

        {/* Detail panel */}
        {!draft ? (
          <div className="provider-detail-empty muted" data-testid="provider-detail-empty">
            {copy.selectOrAdd}
          </div>
        ) : (
          <div className="provider-content">
            {/* Connection */}
            <section className="provider-section">
              <PageTitle
                title={locale === 'zh-CN' ? '连接' : 'Connection'}
                trailing={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span
                      className={
                        autoSaveStatus === 'error'
                          ? 'provider-autosave-status provider-autosave-status--error'
                          : 'provider-autosave-status'
                      }
                      style={{ fontSize: '11.5px', color: autoSaveStatus === 'error' ? 'var(--danger)' : 'var(--faint)' }}
                    >
                      {autoSaveStatus === 'pending'
                        ? (locale === 'zh-CN' ? '待保存…' : 'Pending…')
                        : autoSaveStatus === 'saving' || saving
                          ? (locale === 'zh-CN' ? '保存中…' : 'Saving…')
                          : autoSaveStatus === 'saved'
                            ? (locale === 'zh-CN' ? '已保存' : 'Saved')
                            : autoSaveStatus === 'error'
                              ? (locale === 'zh-CN' ? '保存失败' : 'Save failed')
                              : ''}
                    </span>
                  </div>
                }
              />

              <FieldRow
                label={copy.apiKeyLabel}
                description={
                  hasKeychainSecret(draft)
                    ? copy.apiKeyStoredPlaceholder
                    : copy.apiKeyPlaceholder
                }
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <TextInput
                    type="password"
                    data-testid="provider-apikey-env-input"
                    value={draft.apiKeyInput}
                    onChange={(event) => {
                      markDraft({ ...draft, apiKeyInput: event.currentTarget.value });
                    }}
                    placeholder={
                      hasKeychainSecret(draft)
                        ? '••••••••'
                        : '...'
                    }
                    spellCheck={false}
                    autoComplete="off"
                    style={{ width: '220px' }}
                  />
                  <IconButton
                    label={copy.keyManager}
                    title={copy.keyManager}
                    onClick={() => setKeyManagerOpen(true)}
                    data-testid="provider-key-manager-btn"
                  >
                    <IconSettings width={14} height={14} />
                  </IconButton>
                </div>
              </FieldRow>

              <FieldRow
                label={copy.apiAddress}
              >
                <TextInput
                  data-testid="provider-baseurl-input"
                  value={draft.baseUrl}
                  onChange={(event) => markDraft({ ...draft, baseUrl: event.currentTarget.value })}
                  spellCheck={false}
                  placeholder="https://api.example.com/v1"
                  style={{ width: '320px' }}
                />
              </FieldRow>

              <div className="provider-field" data-testid="provider-headers" style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <label className="ui-field-row-label" style={{ marginBottom: 0 }}>{copy.requestHeaders}</label>
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => {
                      const row = createHeaderRow();
                      lastAddedHeaderIdRef.current = row.id;
                      markDraft({
                        ...draft,
                        headerRows: [...draft.headerRows, row],
                      });
                    }}
                    data-testid="provider-header-add"
                  >
                    + {copy.addHeader}
                  </Button>
                </div>
                <Collapse expanded={draft.headerRows.length > 0}>
                  <ul className="provider-header-list" style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {draft.headerRows.map((row) => (
                      <li key={row.id} className="provider-header-row" style={{ display: 'flex', gap: '8px' }}>
                        <TextInput
                          value={row.name}
                          onChange={(event) =>
                            markDraft({
                              ...draft,
                              headerRows: draft.headerRows.map((item) =>
                                item.id === row.id ? { ...item, name: event.currentTarget.value } : item,
                              ),
                            })
                          }
                          placeholder={copy.headerName}
                          spellCheck={false}
                          data-testid="provider-header-name"
                          autoFocus={row.id === lastAddedHeaderIdRef.current}
                          style={{ flex: 1 }}
                        />
                        <TextInput
                          value={row.value}
                          onChange={(event) =>
                            markDraft({
                              ...draft,
                              headerRows: draft.headerRows.map((item) =>
                                item.id === row.id ? { ...item, value: event.currentTarget.value } : item,
                              ),
                            })
                          }
                          placeholder={copy.headerValue}
                          spellCheck={false}
                          data-testid="provider-header-value"
                          style={{ flex: 1 }}
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
                          <IconClose width={12} height={12} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                </Collapse>
                {draft.headerRows.length === 0 && (
                  <p className="muted" style={{ fontSize: '12.5px', marginTop: -4 }}>{copy.requestHeadersHint}</p>
                )}
              </div>
            </section>

            {/* Model workbench */}
            <div className="provider-models-section" style={{ marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--line-soft)' }}>
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

      <Modal
        title={copy.addProviderTitle}
        open={addOpen}
        onOpenChange={setAddOpen}
        testId="provider-add-dialog"
        size="md"
      >
        <ul className="provider-preset-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {PROVIDER_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="provider-preset-item"
                style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                onClick={() => void handleAddFromPreset(preset)}
              >
                <span style={{ fontSize: '20px' }}>{preset.icon || '🤖'}</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <strong style={{ fontSize: '14.5px' }}>{preset.name}</strong>
                  <span className="muted" style={{ fontSize: '12px' }}>{preset.protocol}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <ProviderKeyManagerDialog
        open={keyManagerOpen}
        onOpenChange={setKeyManagerOpen}
        providerId={draft?.id ?? ''}
        providerName={draft?.name ?? ''}
        loadSecret={onLoadSecret}
        saveSecret={onStoreSecret}
        testKey={testManagedKey}
        onSaved={(apiKeyRef) => {
          if (draft) {
            markDraft({ ...draft, storedApiKeyRef: apiKeyRef, apiKeyInput: '' });
          }
        }}
      />
    </>
  );
}
