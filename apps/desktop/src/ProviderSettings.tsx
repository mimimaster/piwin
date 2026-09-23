/**
 * Models → providers workspace: rail on the left, the selected provider's
 * connection and models on the right (spec:
 * docs/specs/2026-09-23-provider-settings-master-detail.md).
 *
 * Connection fields are a draft with an explicit save; enable switches and
 * model edits persist immediately.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  formatError,
  isSubscriptionProvider,
  resolveProviderCategory,
  subscriptionUsesThirdPartyExtraUsage,
} from '@piwin/contracts';
import type {
  AuthStatusData,
  ModelCatalogEntry,
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { ProviderAddDialog } from './provider-add-dialog.js';
import { ProviderDetail } from './provider-detail.js';
import {
  isConnectionDirty,
  mergeConnectionDraft,
  pendingApiKey,
  providerToDraft,
  withProviders,
  type ProviderDraft,
} from './provider-draft.js';
import { allocateUniqueProviderId, allocateUniqueProviderName } from './provider-instance-id.js';
import { presetTitle, type ProviderPreset } from './provider-presets.js';
import { ProviderRail, type ProviderRailTone } from './provider-rail.js';
import type { ProviderTestStatus } from './provider-status.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { useConfirmDialog } from './use-confirm-dialog.js';
import { useProviderModelActions } from './use-provider-model-actions.js';
import { useSettings } from './settings/settings-context.js';
import { IconPlus } from './shell-icons.js';

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
  /** Persist secret on the Host; returns apiKeyRef. */
  onStoreSecret: (providerId: string, secret: string) => Promise<string>;
  /** Read the saved secret back from the Host so the key field can reveal it. */
  onLoadSecret?: (providerId: string) => Promise<string | null>;
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
  /**
   * Selected provider, owned by the page when given: the capability tabs
   * unmount this component, and coming back should not lose the selection.
   */
  selectedProviderId?: string | null;
  onSelectProvider?: (providerId: string | null) => void;
};

type ConnectionEdit = { draft: ProviderDraft; isNew: boolean };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

/** Rail order: custom channels first, then OAuth packages, config order within. */
function orderForRail(providers: readonly ModelProviderConfig[]): ModelProviderConfig[] {
  return [
    ...providers.filter((provider) => resolveProviderCategory(provider) === 'custom'),
    ...providers.filter((provider) => resolveProviderCategory(provider) === 'package'),
  ];
}

function matchesQuery(provider: ModelProviderConfig, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [provider.name, provider.id, provider.baseUrl, ...provider.models.map((m) => m.id)];
  return haystack.join(' ').toLowerCase().includes(needle);
}

export function ProviderSettings(props: ProviderSettingsProps): ReactElement {
  const { config, saving, onSave, onError, onInfo, onDiscoverModels, onStoreSecret, onLoadSecret } =
    props;
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const isChinese = locale === 'zh-CN';
  const confirmDialog = useConfirmDialog();
  const { hostClient } = useSettings();

  const [reservedSubscriptionIds, setReservedSubscriptionIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [ownSelectedId, setOwnSelectedId] = useState<string | null>(null);
  const selectedId =
    props.selectedProviderId !== undefined ? props.selectedProviderId : ownSelectedId;
  const setSelectedId = props.onSelectProvider ?? setOwnSelectedId;
  const [edit, setEdit] = useState<ConnectionEdit | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<Record<string, ProviderTestStatus>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const testInFlightRef = useRef(false);

  useEffect(() => {
    if (!hostClient?.request) return;
    void hostClient.request({ type: 'auth/status' }).then((response) => {
      if (!response.success || !response.data || typeof response.data !== 'object') return;
      const data = response.data as AuthStatusData;
      setReservedSubscriptionIds(
        data.accounts
          .filter(
            (account) =>
              account.state === 'logged-in' ||
              account.state === 'logging-in' ||
              account.state === 'sync-error' ||
              account.state === 'needs-reauth',
          )
          .map((account) => account.providerId),
      );
    });
  }, [hostClient]);

  const ordered = useMemo(() => orderForRail(config.providers), [config.providers]);
  const visible = ordered.filter((provider) => matchesQuery(provider, query));
  // No (or a removed) selection falls back to the default provider, then to
  // the first one in the rail.
  const selected =
    ordered.find((provider) => provider.id === selectedId) ??
    ordered.find((provider) => provider.id === config.defaultProviderId) ??
    ordered[0] ??
    null;
  const baselineDraft = useMemo(() => (selected ? providerToDraft(selected) : null), [selected]);
  const draft = edit?.draft ?? baselineDraft;
  const isNew = edit?.isNew === true;
  const dirty = edit !== null && !isNew && selected !== null && isConnectionDirty(edit.draft, selected);
  const detailProvider = isNew ? null : selected;

  const modelPropsFor = useProviderModelActions({
    config,
    isChinese,
    onSave,
    onError,
    onTestModel: props.onTestModel,
    onDiscoverModels,
    searchCatalog: props.searchCatalog,
  });

  async function confirmDiscard(): Promise<boolean> {
    if (!isNew && !dirty) return true;
    return confirmDialog.confirm({
      title: isChinese ? '放弃未保存的修改？' : 'Discard unsaved changes?',
      description: isChinese
        ? '连接设置的修改还没有保存，离开后会丢失。'
        : 'Your connection changes have not been saved and will be lost.',
      confirmLabel: isChinese ? '放弃修改' : 'Discard',
      cancelLabel: common.cancel,
      tone: 'danger',
    });
  }

  async function handleSelect(providerId: string): Promise<void> {
    if (providerId === selected?.id && !isNew) return;
    if (!(await confirmDiscard())) return;
    setEdit(null);
    setSelectedId(providerId);
  }

  function handleDraftChange(next: ProviderDraft): void {
    setEdit((current) => ({ draft: next, isNew: current?.isNew ?? false }));
  }

  async function handleRevealStoredKey(): Promise<void> {
    if (!draft || !onLoadSecret) return;
    const base = draft;
    try {
      const secret = (await onLoadSecret(base.id))?.trim() ?? '';
      if (!secret) {
        onError(isChinese ? '没有读到已保存的密钥。' : 'No saved key was found on the Host.');
        return;
      }
      // A single-line input would silently join a multi-key secret on save.
      if (/[\r\n]/.test(secret)) {
        onError(
          isChinese
            ? '该提供商保存了多个密钥，无法在此显示。'
            : 'This provider stores several keys and cannot show them here.',
        );
        return;
      }
      // The Host read is async: keep whatever the user typed meanwhile, and
      // never paste into a different provider's form.
      setEdit((current) => {
        const latest = current?.draft ?? base;
        if (latest.id !== base.id || latest.apiKeyInput) return current;
        return {
          draft: { ...latest, apiKeyInput: secret, revealedApiKey: secret },
          isNew: current?.isNew ?? false,
        };
      });
    } catch (error) {
      onError(formatError(error));
    }
  }

  async function handleTestConnection(): Promise<void> {
    if (!draft || testInFlightRef.current) return;
    const id = draft.id;
    testInFlightRef.current = true;
    setTestingId(id);
    const start = performance.now();
    try {
      const apiKey = draft.apiKeyInput.trim();
      const result = await onDiscoverModels(
        mergeConnectionDraft(draft, detailProvider ?? undefined),
        apiKey ? { apiKey } : undefined,
      );
      const duration = Math.round(performance.now() - start);
      const message = copy.testOk(result.models.length, duration);
      setTestStatus((previous) => ({
        ...previous,
        [id]: { tone: 'ok', message, durationMs: duration },
      }));
      onInfo(message);
    } catch (error) {
      const message = `${copy.statusFail}: ${formatError(error)}`;
      setTestStatus((previous) => ({ ...previous, [id]: { tone: 'err', message } }));
      onError(message);
    } finally {
      testInFlightRef.current = false;
      setTestingId(null);
    }
  }

  async function handleSave(): Promise<void> {
    if (!draft) return;
    if (!draft.name.trim()) {
      onError(isChinese ? '请填写提供商名称。' : 'Provider name is required.');
      return;
    }
    if (!draft.baseUrl.trim()) {
      onError(isChinese ? '请填写 API 地址。' : 'API address is required.');
      return;
    }
    let current = draft;
    const typedKey = pendingApiKey(draft);
    if (typedKey) {
      const apiKeyRef = await onStoreSecret(draft.id.trim(), typedKey);
      current = { ...draft, storedApiKeyEnv: '', storedApiKeyRef: apiKeyRef };
    }
    const provider = mergeConnectionDraft(current, detailProvider ?? undefined);
    if (isNew && config.providers.some((entry) => entry.id === provider.id)) {
      onError(isChinese ? '提供商 ID 已存在。' : 'Provider ID already exists.');
      return;
    }
    const providers = isNew
      ? [...config.providers, provider]
      : config.providers.map((entry) => (entry.id === provider.id ? provider : entry));
    if (await onSave(withProviders(config, providers))) {
      onInfo(isChinese ? '已保存。' : 'Saved.');
      setEdit(null);
      setSelectedId(provider.id);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!detailProvider) return;
    const confirmed = await confirmDialog.confirm({
      title: copy.removeProviderTitle,
      description: copy.removeProviderDescription,
      affectedObject: detailProvider.name,
      confirmLabel: common.delete,
      cancelLabel: common.cancel,
      tone: 'danger',
    });
    if (!confirmed) return;
    const providers = config.providers.filter((entry) => entry.id !== detailProvider.id);
    if (await onSave(withProviders(config, providers))) {
      setEdit(null);
      setSelectedId(null);
      onInfo(isChinese ? '已移除提供商。' : 'Provider removed.');
    }
  }

  async function handleToggleEnabled(provider: ModelProviderConfig): Promise<void> {
    const enabled = provider.enabled === false;
    const providers = config.providers.map((entry) =>
      entry.id === provider.id ? { ...entry, enabled } : entry,
    );
    if (await onSave(withProviders(config, providers))) {
      onInfo(
        enabled
          ? isChinese
            ? '已启用提供商。'
            : 'Provider enabled.'
          : isChinese
            ? '已停用提供商。'
            : 'Provider disabled.',
      );
    }
  }

  async function handleAddFromPreset(preset: ProviderPreset): Promise<void> {
    setAddOpen(false);
    if (!(await confirmDiscard())) return;
    // One vendor may back many channels (own baseUrl + key each), so a preset
    // that is already configured still yields a new unique provider entry.
    const provider: ModelProviderConfig = {
      id: allocateUniqueProviderId(preset.id, [
        ...config.providers.map((entry) => entry.id),
        ...reservedSubscriptionIds,
      ]),
      protocol: preset.protocol,
      name: allocateUniqueProviderName(
        presetTitle(preset, isChinese),
        config.providers.map((entry) => entry.name),
      ),
      baseUrl: preset.baseUrl,
      enabled: true,
      models: preset.models.map((model) => ({
        id: model.id,
        ...(model.label ? { label: model.label } : {}),
      })),
    };
    if (preset.apiKeyEnv.trim()) provider.apiKeyEnv = preset.apiKeyEnv.trim();
    setEdit({ draft: providerToDraft(provider), isNew: true });
  }

  function subtitleOf(provider: ModelProviderConfig): string {
    if (!isSubscriptionProvider(provider)) return hostOf(provider.baseUrl);
    if (subscriptionUsesThirdPartyExtraUsage(provider.id)) {
      return isChinese ? 'OAuth · extra 计费' : 'OAuth · extra usage';
    }
    return isChinese ? 'OAuth 套餐' : 'OAuth plan';
  }

  function toneOf(provider: ModelProviderConfig): ProviderRailTone {
    if (provider.enabled === false) return 'off';
    const tone = testStatus[provider.id]?.tone;
    if (tone === 'err') return 'err';
    if (tone === 'ok') return 'ok';
    return 'on';
  }

  return (
    <>
      {confirmDialog.dialog}
      <div className="pws" data-testid="provider-settings">
        <ProviderRail
          providers={visible}
          selectedId={isNew ? null : (selected?.id ?? null)}
          pending={isNew && draft ? { id: draft.id, name: draft.name } : null}
          defaultProviderId={config.defaultProviderId}
          query={query}
          isChinese={isChinese}
          copy={copy}
          subtitleOf={subtitleOf}
          toneOf={toneOf}
          onQueryChange={setQuery}
          onSelect={(providerId) => void handleSelect(providerId)}
          onAdd={() => setAddOpen(true)}
        />

        {draft ? (
          <ProviderDetail
            key={isNew ? `new:${draft.id}` : draft.id}
            provider={detailProvider}
            draft={draft}
            dirty={dirty}
            status={
              detailProvider?.enabled === false
                ? { tone: 'off', message: copy.statusOff }
                : (testStatus[draft.id] ?? null)
            }
            isChinese={isChinese}
            saving={saving}
            testing={testingId === draft.id}
            copy={copy}
            common={common}
            models={modelPropsFor(detailProvider ?? mergeConnectionDraft(draft, undefined))}
            onDraftChange={handleDraftChange}
            onSave={() => void handleSave()}
            onRevert={() => setEdit(null)}
            onDelete={() => void handleDelete()}
            onToggleEnabled={() => {
              if (detailProvider) void handleToggleEnabled(detailProvider);
            }}
            onTestConnection={() => void handleTestConnection()}
            {...(onLoadSecret ? { onRevealStoredKey: handleRevealStoredKey } : {})}
          />
        ) : (
          <div className="pws-empty" data-testid="provider-workspace-empty">
            <h3>{isChinese ? '还没有接入模型提供商' : 'No model providers yet'}</h3>
            <p>
              {isChinese
                ? '接入 OpenAI、Anthropic 等厂商，或任意 OpenAI / Anthropic 兼容接口。'
                : 'Connect OpenAI, Anthropic and others, or any OpenAI- / Anthropic-compatible endpoint.'}
            </p>
            <Button variant="primary" onClick={() => setAddOpen(true)} data-testid="provider-add-empty">
              <IconPlus width={14} height={14} />
              {copy.addProvider}
            </Button>
          </div>
        )}
      </div>

      <ProviderAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        isChinese={isChinese}
        copy={{ addProviderTitle: copy.addProviderTitle, addProviderDesc: copy.addProviderDesc }}
        onAdd={(preset) => void handleAddFromPreset(preset)}
      />
    </>
  );
}
