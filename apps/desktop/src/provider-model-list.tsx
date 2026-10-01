/**
 * Models section of the provider detail pane: fetch / add, one row per model,
 * and the inline parameter editor. Every change here persists immediately.
 */

import { useEffect, useState, type ReactElement } from 'react';
import {
  isModelEnabled,
  isProviderEnabled,
  isSubscriptionProvider,
  nativeSearchProviderBlocker,
} from '@piwin/contracts';
import type {
  DiscoveredModel,
  ModelCatalogEntry,
  ModelConfigEntry,
  ModelDiscoveryResult,
  ModelProviderConfig,
} from '@piwin/contracts';
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Notice,
  Switch,
  ModelFallbackIcon,
  ProviderIcon,
  resolveModelBrandKey,
} from '@piwin/ui-kit';
import { AddModelDialog } from './AddModelDialog.js';
import { DiscoverModelsDialog } from './DiscoverModelsDialog.js';
import { modelCaps } from './model-caps.js';
import {
  applyModelConfigurationDraft,
  mergeDiscoveredModels,
  type ModelConfigurationDraft,
} from './model-configuration.js';
import { ModelEditInline } from './model-edit-inline.js';
import { isCustomChannelId } from './provider-avatar.js';
import {
  IconChevronDown,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconMore,
  IconPlus,
  IconRefresh,
  IconSliders,
  IconSpark,
  IconStar,
  IconTrash,
} from './shell-icons.js';

export type ModelTestState = {
  tone: 'ok' | 'error' | 'busy';
  message: string;
  errorMessage?: string;
};

export type ProviderModelListProps = {
  provider: ModelProviderConfig;
  /** Product default model id when this provider is the default provider. */
  defaultModelId: string | null;
  isChinese: boolean;
  disabled: boolean;
  /** Last model test result, keyed by model id. */
  modelTestStatus: Record<string, ModelTestState>;
  testingModelId: string | null;
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
  onUpdateModels: (models: ModelConfigEntry[]) => void;
  onTestModel: (modelId: string) => void;
  onSetDefaultModel: (modelId: string) => void;
  onToggleModel: (modelId: string) => void;
  onDiscoverModels: (provider: ModelProviderConfig) => Promise<ModelDiscoveryResult>;
};

function modelListCopy(isChinese: boolean) {
  return isChinese
    ? {
        heading: '模型',
        hint: '开关和参数修改即时生效。',
        empty: '还没有模型。拉取接口上的模型，或手动添加一个。',
        emptySubscription: '这个套餐暂时没有可用模型。',
        discover: '拉取模型',
        discovering: '拉取中…',
        add: '添加',
        disableAll: '全部停用',
        enableAll: '全部启用',
        test: '测试可用性',
        setDefault: '设为默认',
        isDefault: '默认',
        editParams: '编辑参数',
        remove: '移除',
        more: '更多操作',
        providerOff: '提供商已停用',
        modelOn: '已启用',
        modelOff: '已停用',
      }
    : {
        heading: 'Models',
        hint: 'Switches and parameter edits apply at once.',
        empty: 'No models yet. Fetch them from the endpoint, or add one by hand.',
        emptySubscription: 'This plan has no models yet.',
        discover: 'Fetch models',
        discovering: 'Fetching…',
        add: 'Add',
        disableAll: 'Disable all',
        enableAll: 'Enable all',
        test: 'Test',
        setDefault: 'Set as default',
        isDefault: 'Default',
        editParams: 'Edit parameters',
        remove: 'Remove',
        more: 'More actions',
        providerOff: 'Provider is disabled',
        modelOn: 'Enabled',
        modelOff: 'Disabled',
      };
}

function catalogUnavailableMessage(isChinese: boolean, httpStatus: number | undefined): string {
  const status =
    httpStatus === undefined ? '' : isChinese ? `（HTTP ${httpStatus}）` : ` (HTTP ${httpStatus})`;
  return isChinese
    ? `此接口不提供模型列表${status}，但不影响对话。需要新模型时手动添加模型 ID，再用「测试连接」确认。`
    : `This endpoint does not expose a model list${status}. Chat is unaffected. Add a model ID by hand, then use Test connection.`;
}

/** Compact token counts for the row, e.g. 128000 → "128K". */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${Math.round(count / 100_000) / 10}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

/** Configured parameters worth surfacing on the collapsed row. */
function modelParamFacts(model: ModelConfigEntry): string[] {
  const facts: string[] = [];
  if (model.contextWindow) facts.push(`ctx ${formatTokens(model.contextWindow)}`);
  if (model.maxOutputTokens) facts.push(`out ${formatTokens(model.maxOutputTokens)}`);
  return facts;
}

export function ProviderModelList({
  provider,
  defaultModelId,
  isChinese,
  disabled,
  modelTestStatus,
  testingModelId,
  searchCatalog,
  onUpdateModels,
  onTestModel,
  onSetDefaultModel,
  onToggleModel,
  onDiscoverModels,
}: ProviderModelListProps): ReactElement {
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [optimisticModels, setOptimisticModels] = useState<ModelConfigEntry[] | null>(null);
  const [catalogNotice, setCatalogNotice] = useState<{
    providerId: string;
    httpStatus?: number;
  } | null>(null);

  useEffect(() => {
    if (!optimisticModels) return;
    if (optimisticModelsCaughtUp(provider.models, optimisticModels)) {
      setOptimisticModels(null);
    }
  }, [provider.models, optimisticModels]);

  const t = modelListCopy(isChinese);
  const subscription = isSubscriptionProvider(provider);
  const nativeSearchBlocker = nativeSearchProviderBlocker(provider);
  const providerLive = isProviderEnabled(provider);
  const models = overlayOptimisticCapabilities(provider.models, optimisticModels);
  const anyEnabled = models.some(isModelEnabled);
  // Display only: enabled models stay ahead of disabled ones. Config order is
  // unchanged within each group, and persistence still uses provider.models.
  const displayedModels = [...models].sort(
    (left, right) => Number(isModelEnabled(right)) - Number(isModelEnabled(left)),
  );

  function handleToggleAll(): void {
    const targetState = !anyEnabled;
    const next = provider.models.map((model) => ({
      ...model,
      enabled: targetState,
    }));
    onUpdateModels(next);
  }

  async function handleDiscover(): Promise<void> {
    setDiscovering(true);
    setCatalogNotice(null);
    try {
      const result = await onDiscoverModels(provider);
      if (result.catalogUnavailable) {
        setCatalogNotice({
          providerId: provider.id,
          ...(result.catalogUnavailable.httpStatus === undefined
            ? {}
            : { httpStatus: result.catalogUnavailable.httpStatus }),
        });
        return;
      }
      setDiscovered(result.models);
      setDiscoverOpen(true);
    } catch {
      // The settings owner already reported the failure through onError.
    } finally {
      setDiscovering(false);
    }
  }

  function handleApplyEdit(draft: ModelConfigurationDraft): void {
    if (!editingModelId) return;
    const next = applyModelConfigurationDraft(models, editingModelId, draft);
    if (!next) return;
    setOptimisticModels(next);
    onUpdateModels(next);
  }

  function toggleEditor(modelId: string): void {
    setEditingModelId((current) => (current === modelId ? null : modelId));
  }

  return (
    <section className="pdetail-section" data-testid={`provider-models-${provider.id}`}>
      <header className="pdetail-section-head">
        <div>
          <h3 className="pdetail-section-title">
            {t.heading}
            <span className="pdetail-section-count">{provider.models.length}</span>
          </h3>
          <p className="pdetail-section-desc">{t.hint}</p>
        </div>
        <div className="pdetail-section-actions">
          {provider.models.length > 0 ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={handleToggleAll}
              disabled={disabled}
              data-testid={`provider-toggle-all-models-${provider.id}`}
            >
              {anyEnabled ? (
                <IconEyeOff width={13} height={13} />
              ) : (
                <IconEye width={13} height={13} />
              )}
              {anyEnabled ? t.disableAll : t.enableAll}
            </Button>
          ) : null}
          {subscription ? null : (
            <Button
              size="compact"
              variant="ghost"
              onClick={() => void handleDiscover()}
              disabled={disabled || discovering}
              data-testid={`provider-discover-models-${provider.id}`}
            >
              {discovering ? (
                <IconRefresh width={13} height={13} className="provider-spin" />
              ) : (
                <IconDownload width={13} height={13} />
              )}
              {discovering ? t.discovering : t.discover}
            </Button>
          )}
          <Button
            size="compact"
            variant="ghost"
            onClick={() => setAddOpen(true)}
            disabled={disabled}
            data-testid={`provider-add-model-${provider.id}`}
          >
            <IconPlus width={13} height={13} />
            {t.add}
          </Button>
        </div>
      </header>

      {catalogNotice && catalogNotice.providerId === provider.id ? (
        <div className="pmodel-catalog-notice">
          <Notice tone="warning" testId={`provider-catalog-unavailable-${provider.id}`}>
            {catalogUnavailableMessage(isChinese, catalogNotice.httpStatus)}
          </Notice>
        </div>
      ) : null}

      <div className="pmodel-list" data-testid="provider-model-list">
        {provider.models.length === 0 ? (
          <p className="pmodel-empty">{subscription ? t.emptySubscription : t.empty}</p>
        ) : null}
        {displayedModels.map((model) => {
          const isDefaultModel = model.id === defaultModelId;
          const test = modelTestStatus[model.id];
          const isTesting = testingModelId === model.id;
          const editing = editingModelId === model.id;
          const modelLive = providerLive && isModelEnabled(model);
          const label = model.label?.trim() || model.id;
          const modelBrand = resolveModelBrandKey(model.id);
          const toggleLabel = !providerLive
            ? t.providerOff
            : isModelEnabled(model)
              ? t.modelOn
              : t.modelOff;
          return (
            <div
              key={model.id}
              className={`pmodel-item${editing ? ' is-editing' : ''}${modelLive ? '' : ' is-off'}`}
            >
              <div
                className="pmodel-row"
                data-testid="provider-model-row"
                role="button"
                tabIndex={0}
                aria-expanded={editing}
                aria-label={`${label} · ${t.editParams}`}
                onClick={() => toggleEditor(model.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleEditor(model.id);
                  }
                }}
              >
                <span className="pmodel-glyph" aria-hidden="true">
                  {/* The model's own vendor (from its id) — the same brand chip the
                      image and video lists use; else a branded provider's mark; else
                      the neutral model mark (never the channel's letter seal, which
                      would read as the model's logo). Custom channels skip the
                      provider step: their id resolves to the protocol vendor. */}
                  {modelBrand ? (
                    <ProviderIcon id={modelBrand} name={label} size={30} />
                  ) : isCustomChannelId(provider.id) ? (
                    <ModelFallbackIcon providerId={provider.id} size={30} />
                  ) : (
                    <ProviderIcon id={provider.id} name={provider.name} size={30} fallback="model" />
                  )}
                </span>
                <div className="pmodel-who">
                  <span className="pmodel-name" title={model.id}>
                    {label}
                    {isDefaultModel ? (
                      <span className="pmodel-default" data-testid={`provider-model-is-default-${model.id}`}>
                        <IconStar width={10} height={10} fill="currentColor" />
                        {t.isDefault}
                      </span>
                    ) : null}
                  </span>
                  <span className="pmodel-meta">
                    {label !== model.id ? <code className="pmodel-id">{model.id}</code> : null}
                    {modelParamFacts(model).map((fact) => (
                      <span key={fact} className="pmodel-param">
                        {fact}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="pmodel-caps">
                  {modelCaps(model, isChinese, { nativeSearchBlocked: nativeSearchBlocker !== undefined }).map((cap) => (
                    <span key={cap.key} className={`pmodel-cap pmodel-cap--${cap.key}`}>
                      {cap.label}
                    </span>
                  ))}
                </div>
                <span
                  className={`pmodel-test${test ? ` pmodel-test--${test.tone}` : ''}`}
                  title={test?.errorMessage ?? test?.message}
                  data-testid={`provider-model-test-status-${model.id}`}
                >
                  {isTesting ? (
                    <IconRefresh width={12} height={12} className="provider-spin" />
                  ) : test ? (
                    test.message
                  ) : null}
                </span>
                <div
                  className="pmodel-controls"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Switch
                    checked={modelLive}
                    onCheckedChange={() => onToggleModel(model.id)}
                    disabled={disabled || !providerLive}
                    aria-label={toggleLabel}
                    testId={`provider-model-toggle-${model.id}`}
                    size="sm"
                  />
                  <DropdownMenu
                    align="end"
                    label={t.more}
                    testId={`provider-model-menu-${model.id}`}
                    trigger={
                      <IconButton
                        label={t.more}
                        size={26}
                        className="pmodel-more"
                        data-testid={`provider-model-more-${model.id}`}
                        disabled={disabled}
                      >
                        <IconMore width={15} height={15} />
                      </IconButton>
                    }
                  >
                    {subscription ? null : (
                      <DropdownMenuItem
                        icon={<IconSpark width={13} height={13} />}
                        onSelect={() => onTestModel(model.id)}
                        disabled={isTesting}
                        testId={`provider-model-test-${model.id}`}
                      >
                        {t.test}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      icon={<IconStar width={13} height={13} />}
                      onSelect={() => onSetDefaultModel(model.id)}
                      disabled={isDefaultModel || !modelLive}
                      testId={`provider-model-default-${model.id}`}
                    >
                      {t.setDefault}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<IconSliders width={13} height={13} />}
                      onSelect={() => setEditingModelId(model.id)}
                      testId={`provider-model-edit-${model.id}`}
                    >
                      {t.editParams}
                    </DropdownMenuItem>
                    {subscription ? null : (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          danger
                          icon={<IconTrash width={13} height={13} />}
                          onSelect={() =>
                            onUpdateModels(provider.models.filter((entry) => entry.id !== model.id))
                          }
                          testId={`provider-model-remove-${model.id}`}
                        >
                          {t.remove}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenu>
                </div>
                {/* The round disclosure button is the cue that a row opens its editor. */}
                <span className="pmodel-chevron" aria-hidden="true">
                  <IconChevronDown width={14} height={14} />
                </span>
              </div>
              {editing ? (
                <ModelEditInline
                  model={model}
                  providerProtocol={provider.protocol}
                  {...(provider.chatApi ? { providerChatApi: provider.chatApi } : {})}
                  {...(provider.baseUrl ? { providerBaseUrl: provider.baseUrl } : {})}
                  providerIsSubscription={isSubscriptionProvider(provider)}
                  {...(provider.protocol === 'openai-compatible' && provider.systemPromptRole
                    ? { providerSystemPromptRole: provider.systemPromptRole }
                    : {})}
                  {...(nativeSearchBlocker ? { nativeSearchBlocker } : {})}
                  disabled={disabled}
                  isChinese={isChinese}
                  {...(searchCatalog ? { searchCatalog } : {})}
                  onSave={handleApplyEdit}
                  onCancel={() => setEditingModelId(null)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <AddModelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingModelIds={provider.models.map((model) => model.id)}
        protocol={provider.protocol}
        {...(provider.chatApi ? { chatApi: provider.chatApi } : {})}
        {...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {})}
        isSubscription={isSubscriptionProvider(provider)}
        {...(nativeSearchBlocker ? { nativeSearchBlocker } : {})}
        onAdd={(model) => {
          onUpdateModels([...provider.models, model]);
          setAddOpen(false);
        }}
        {...(searchCatalog ? { searchCatalog } : {})}
      />

      <DiscoverModelsDialog
        open={discoverOpen}
        provider={provider}
        models={discovered}
        onOpenChange={setDiscoverOpen}
        onImport={(selected) => {
          onUpdateModels(mergeDiscoveredModels(provider.models, selected, provider.protocol));
          setDiscoverOpen(false);
        }}
      />
    </section>
  );
}

function capabilitySignature(model: ModelConfigEntry): string {
  return (model.capabilities ?? []).join(',');
}

function overlayOptimisticCapabilities(
  persisted: readonly ModelConfigEntry[],
  optimistic: readonly ModelConfigEntry[] | null,
): ModelConfigEntry[] {
  if (!optimistic) return [...persisted];
  const pendingById = new Map(optimistic.map((model) => [model.id, model]));
  return persisted.map((model) => {
    const pending = pendingById.get(model.id);
    if (!pending) return model;
    if (capabilitySignature(pending) === capabilitySignature(model)) return model;
    const next: ModelConfigEntry = { ...model };
    if (pending.capabilities && pending.capabilities.length > 0) {
      next.capabilities = pending.capabilities;
    } else {
      delete next.capabilities;
    }
    if (pending.routes && Object.keys(pending.routes).length > 0) {
      next.routes = pending.routes;
    } else {
      delete next.routes;
    }
    return next;
  });
}

function optimisticModelsCaughtUp(
  persisted: readonly ModelConfigEntry[],
  optimistic: readonly ModelConfigEntry[],
): boolean {
  return optimistic.every((pending) => {
    const saved = persisted.find((model) => model.id === pending.id);
    return saved !== undefined && capabilitySignature(saved) === capabilitySignature(pending);
  });
}
