/**
 * Models / providers settings — BYOK list + drawer layout:
 *   - provider rows with search, filter, status pill, and enable switch
 *   - expanded row for model list / discover / add / edit
 *   - drawer for connection credentials and API address only
 *   - provider add dialog with preset grid
 *
 * Manual save in the drawer; the enable switch in the list persists immediately.
 */

import { useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  ModelConfigEntry,
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { ProviderAddDialog } from './provider-add-dialog.js';
import { ProviderDrawer } from './provider-drawer.js';
import { ProviderKeyManagerDialog } from './ProviderKeyManagerDialog.js';
import { ProviderList, type ModelTestState } from './provider-list.js';
import type { ProviderPreset } from './provider-presets.js';
import type { ProviderTestStatus } from './provider-status.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { useConfirmDialog } from './use-confirm-dialog.js';
import {
  draftToProvider,
  oneShotApiKeyFromDraft,
  providerToDraft,
  resolveDefaultAfterProviderChange,
  type ProviderDraft,
} from './provider-draft.js';

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
  searchCatalog?: (query: string) => Promise<import('@piwin/contracts').ModelCatalogEntry[]>;
};

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
    searchCatalog,
  } = props;
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const isChinese = locale === 'zh-CN';
  const confirmDialog = useConfirmDialog();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [drawer, setDrawer] = useState<{ draft: ProviderDraft; isNew: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<Record<string, ProviderTestStatus>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const testInFlightRef = useRef(false);
  const [listModelTestStatus, setListModelTestStatus] = useState<
    Record<string, ModelTestState>
  >({});
  const [listTestingModelKey, setListTestingModelKey] = useState<string | null>(null);

  const filteredProviders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return config.providers.filter((provider) => {
      if (filter === 'on' && provider.enabled === false) return false;
      if (filter === 'off' && provider.enabled !== false) return false;
      if (!q) return true;
      const hay =
        `${provider.name} ${provider.id} ${provider.baseUrl} ${provider.models.map((m) => m.id).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [config.providers, filter, query]);

  const enabledCount = config.providers.filter((p) => p.enabled !== false).length;
  const modelCount = config.providers.reduce((sum, p) => sum + p.models.length, 0);

  function getProviderStatus(provider: ModelProviderConfig): ProviderTestStatus {
    if (provider.enabled === false) {
      return { tone: 'off', message: copy.statusOff };
    }
    const test = testStatus[provider.id];
    if (test) return test;
    return { tone: 'warn', message: copy.statusUntested };
  }

  function markDraft(next: ProviderDraft): void {
    if (!drawer) return;
    setDrawer({ ...drawer, draft: next });
  }

  async function storeOneShotKeyIfNeeded(draft: ProviderDraft): Promise<ProviderDraft> {
    const oneShot = oneShotApiKeyFromDraft(draft);
    if (!oneShot) return draft;
    const apiKeyRef = await onStoreSecret(draft.id.trim(), oneShot);
    return { ...draft, apiKeyInput: '', storedApiKeyEnv: '', storedApiKeyRef: apiKeyRef };
  }

  async function testManagedKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
    if (!drawer) return { ok: false, message: copy.detectFail };
    try {
      const result = await onDiscoverModels(draftToProvider(drawer.draft), { apiKey });
      return { ok: true, message: copy.detectOk(result.models.length) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `${copy.detectFail}: ${message}` };
    }
  }

  async function handleTestConnection(): Promise<void> {
    if (!drawer || testInFlightRef.current) return;
    const id = drawer.draft.id;
    testInFlightRef.current = true;
    setTestingId(id);
    const start = performance.now();
    try {
      let current = drawer.draft;
      const oneShot = oneShotApiKeyFromDraft(current);
      if (oneShot) {
        current = await storeOneShotKeyIfNeeded(current);
        markDraft(current);
      }
      const result = await onDiscoverModels(
        draftToProvider(current),
        oneShot ? { apiKey: oneShot } : undefined,
      );
      const duration = Math.round(performance.now() - start);
      const nextStatus: ProviderTestStatus = {
        tone: 'ok',
        message: copy.testOk(result.models.length, duration),
        durationMs: duration,
      };
      setTestStatus((prev) => ({ ...prev, [id]: nextStatus }));
      onInfo(copy.testOk(result.models.length, duration));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextStatus: ProviderTestStatus = {
        tone: 'err',
        message: `${copy.statusFail}: ${message}`,
      };
      setTestStatus((prev) => ({ ...prev, [id]: nextStatus }));
      onError(`${copy.statusFail}: ${message}`);
    } finally {
      testInFlightRef.current = false;
      setTestingId(null);
    }
  }

  function applyDefaultToConfig(
    next: PiwinConfig,
    nextDefault: { defaultProviderId?: string; defaultModelId?: string },
  ): void {
    if (nextDefault.defaultProviderId) {
      next.defaultProviderId = nextDefault.defaultProviderId;
    } else {
      delete next.defaultProviderId;
    }
    if (nextDefault.defaultModelId) {
      next.defaultModelId = nextDefault.defaultModelId;
    } else {
      delete next.defaultModelId;
    }
  }

  async function handleSave(opts?: {
    keepOpen?: boolean;
    default?: { providerId: string; modelId: string };
  }): Promise<boolean> {
    if (!drawer) return false;
    const { draft, isNew } = drawer;
    if (!draft.name.trim()) {
      onError(isChinese ? '请填写提供商名称。' : 'Provider name is required.');
      return false;
    }
    if (!draft.baseUrl.trim()) {
      onError(isChinese ? '请填写 API 地址。' : 'API address is required.');
      return false;
    }

    let current = draft;
    const oneShot = oneShotApiKeyFromDraft(draft);
    if (oneShot) {
      current = await storeOneShotKeyIfNeeded(current);
      markDraft(current);
    }

    const provider = draftToProvider(current);
    if (isNew && config.providers.find((p) => p.id === provider.id)) {
      onError(isChinese ? '提供商 ID 已存在。' : 'Provider ID already exists.');
      return false;
    }

    const nextProviders = isNew
      ? [...config.providers, provider]
      : config.providers.map((p) => (p.id === provider.id ? provider : p));

    const next: PiwinConfig = { ...config, providers: nextProviders };
    const defaultSource = opts?.default ?? {
      providerId: config.defaultProviderId,
      modelId: config.defaultModelId,
    };
    const nextDefault = resolveDefaultAfterProviderChange(nextProviders, defaultSource);
    applyDefaultToConfig(next, nextDefault);

    const ok = await onSave(next);
    if (ok) {
      onInfo(isChinese ? '已保存。' : 'Saved.');
      if (opts?.keepOpen) {
        setDrawer({ draft: providerToDraft(provider), isNew: false });
      } else {
        setDrawer(null);
      }
      return true;
    }
    return false;
  }

  async function handleDeleteFromDrawer(): Promise<void> {
    if (!drawer) return;
    const confirmed = await confirmDialog.confirm({
      title: copy.removeProviderTitle,
      description: copy.removeProviderDescription,
      affectedObject: drawer.draft.name,
      confirmLabel: common.delete,
      tone: 'danger',
    });
    if (!confirmed) return;

    const id = drawer.draft.id;
    const nextProviders = config.providers.filter((p) => p.id !== id);
    const next: PiwinConfig = { ...config, providers: nextProviders };
    const nextDefault = resolveDefaultAfterProviderChange(nextProviders, {
      ...(config.defaultProviderId !== undefined ? { providerId: config.defaultProviderId } : {}),
      ...(config.defaultModelId !== undefined ? { modelId: config.defaultModelId } : {}),
    });
    applyDefaultToConfig(next, nextDefault);

    if (await onSave(next)) {
      setDrawer(null);
      onInfo(isChinese ? '已移除提供商。' : 'Provider removed.');
    }
  }

  async function handleToggleFromList(id: string): Promise<void> {
    const provider = config.providers.find((p) => p.id === id);
    if (!provider) return;
    const nextEnabled = provider.enabled === false;
    const nextProvider = { ...provider, enabled: nextEnabled };
    const nextProviders = config.providers.map((p) => (p.id === id ? nextProvider : p));
    const next: PiwinConfig = { ...config, providers: nextProviders };
    const nextDefault = resolveDefaultAfterProviderChange(nextProviders, {
      ...(config.defaultProviderId !== undefined ? { providerId: config.defaultProviderId } : {}),
      ...(config.defaultModelId !== undefined ? { modelId: config.defaultModelId } : {}),
    });
    applyDefaultToConfig(next, nextDefault);

    if (await onSave(next)) {
      onInfo(
        nextEnabled
          ? isChinese
            ? '已启用提供商。'
            : 'Provider enabled.'
          : isChinese
            ? '已停用提供商。'
            : 'Provider disabled.',
      );
      if (drawer?.draft.id === id) {
        setDrawer({ ...drawer, draft: { ...drawer.draft, enabled: nextEnabled } });
      }
    }
  }

  function openAddDialog(): void {
    setAddOpen(true);
  }

  function handleAddFromPreset(preset: ProviderPreset): void {
    const id = preset.id;
    if (config.providers.find((p) => p.id === id)) {
      onError(isChinese ? '提供商已存在。' : 'Provider already exists.');
      return;
    }
    const provider: ModelProviderConfig = {
      id,
      protocol: preset.protocol,
      name: preset.name,
      baseUrl: preset.baseUrl,
      enabled: true,
      models: preset.models.map((model) => ({
        id: model.id,
        ...(model.label ? { label: model.label } : {}),
      })),
    };
    if (preset.apiKeyEnv.trim()) {
      provider.apiKeyEnv = preset.apiKeyEnv.trim();
    }
    setAddOpen(false);
    setDrawer({ draft: providerToDraft(provider), isNew: true });
  }

  function handleOpenDrawer(provider: ModelProviderConfig): void {
    setDrawer({ draft: providerToDraft(provider), isNew: false });
  }

  async function handleUpdateProviderModelsFromList(
    providerId: string,
    models: ModelConfigEntry[],
  ): Promise<void> {
    const nextProviders = config.providers.map((p) =>
      p.id === providerId ? { ...p, models } : p,
    );
    const next: PiwinConfig = { ...config, providers: nextProviders };
    const nextDefault = resolveDefaultAfterProviderChange(nextProviders, {
      ...(config.defaultProviderId !== undefined ? { providerId: config.defaultProviderId } : {}),
      ...(config.defaultModelId !== undefined ? { modelId: config.defaultModelId } : {}),
    });
    applyDefaultToConfig(next, nextDefault);
    await onSave(next);
  }

  async function handleTestProviderModelFromList(
    providerId: string,
    modelId: string,
  ): Promise<void> {
    const key = `${providerId}::${modelId}`;
    setListTestingModelKey(key);
    setListModelTestStatus((prev) => ({
      ...prev,
      [key]: { tone: 'busy', message: isChinese ? '检测中…' : 'Testing…' },
    }));
    try {
      const provider = config.providers.find((p) => p.id === providerId);
      if (!provider) throw new Error('provider not found');
      const result = await onTestModel(provider, modelId);
      const seconds = (result.durationMs / 1000).toFixed(1);
      setListModelTestStatus((prev) => ({
        ...prev,
        [key]: {
          tone: 'ok',
          message: isChinese ? `可用 · ${seconds}s` : `OK · ${seconds}s`,
        },
      }));
    } catch {
      setListModelTestStatus((prev) => ({
        ...prev,
        [key]: { tone: 'error', message: isChinese ? '失败' : 'Fail' },
      }));
    } finally {
      setListTestingModelKey(null);
    }
  }

  async function handleSetDefaultModelFromList(
    providerId: string,
    modelId: string,
  ): Promise<void> {
    const next: PiwinConfig = {
      ...config,
      defaultProviderId: providerId,
      defaultModelId: modelId,
    };
    await onSave(next);
  }

  async function handleDiscoverProviderModelsFromList(
    provider: ModelProviderConfig,
  ): Promise<ModelDiscoveryResult> {
    try {
      return await onDiscoverModels(provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(
        isChinese
          ? `模型发现失败：${message}`
          : `Model discovery failed: ${message}`,
      );
      throw error;
    }
  }

  return (
    <>
      {confirmDialog.dialog}

      <ProviderList
        config={config}
        filteredProviders={filteredProviders}
        providerCount={config.providers.length}
        enabledCount={enabledCount}
        modelCount={modelCount}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        isChinese={isChinese}
        saving={saving}
        copy={copy}
        getProviderStatus={getProviderStatus}
        onOpenProvider={handleOpenDrawer}
        onToggleProvider={(id) => void handleToggleFromList(id)}
        onAddOpen={openAddDialog}
        onUpdateProviderModels={(providerId, models) =>
          void handleUpdateProviderModelsFromList(providerId, models)
        }
        onTestProviderModel={(providerId, modelId) =>
          void handleTestProviderModelFromList(providerId, modelId)
        }
        onSetDefaultModel={(providerId, modelId) =>
          void handleSetDefaultModelFromList(providerId, modelId)
        }
        onDiscoverProviderModels={handleDiscoverProviderModelsFromList}
        modelTestStatus={listModelTestStatus}
        testingModelKey={listTestingModelKey}
        {...(searchCatalog ? { searchCatalog } : {})}
      />

      {drawer && (
        <ProviderDrawer
          draft={drawer.draft}
          isNew={drawer.isNew}
          saving={saving}
          testingId={testingId}
          testStatus={testStatus}
          isChinese={isChinese}
          copy={copy}
          common={common}
          onClose={() => setDrawer(null)}
          onSave={handleSave}
          onDelete={handleDeleteFromDrawer}
          onDraftChange={markDraft}
          onTestConnection={handleTestConnection}
          onOpenKeyManager={() => setKeyManagerOpen(true)}
          onLoadSecret={onLoadSecret}
        />
      )}

      <ProviderAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        isChinese={isChinese}
        copy={{
          addProviderTitle: copy.addProviderTitle,
          addProviderDesc: copy.addProviderDesc,
        }}
        onAdd={handleAddFromPreset}
      />

      <ProviderKeyManagerDialog
        open={keyManagerOpen}
        onOpenChange={setKeyManagerOpen}
        providerId={drawer?.draft.id ?? ''}
        providerName={drawer?.draft.name ?? ''}
        loadSecret={onLoadSecret}
        saveSecret={onStoreSecret}
        testKey={testManagedKey}
        onSaved={(apiKeyRef) => {
          if (drawer) {
            markDraft({ ...drawer.draft, storedApiKeyRef: apiKeyRef, apiKeyInput: '' });
          }
        }}
      />
    </>
  );
}
