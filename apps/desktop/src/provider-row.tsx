import { useState, type ReactElement } from 'react';
import type {
  DiscoveredModel,
  ModelCatalogEntry,
  ModelConfigEntry,
  ModelDiscoveryResult,
  ModelProviderConfig,
} from '@piwin/contracts';
import { Switch } from '@piwin/ui-kit';
import { AddModelDialog } from './AddModelDialog.js';
import { DiscoverModelsDialog } from './DiscoverModelsDialog.js';
import { applyModelConfigurationDraft, mergeDiscoveredModels } from './model-configuration.js';
import { ModelEditInline } from './model-edit-inline.js';
import { ProviderIcon } from './provider-icons.js';
import { ProviderStatusPill, type ProviderTestStatus } from './provider-status.js';
import {
  IconChevronDown,
  IconClose,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSpark,
  IconStar,
} from './shell-icons.js';

export type ProviderRowProps = {
  provider: ModelProviderConfig;
  status: ProviderTestStatus | null;
  isDefault: boolean;
  /** Product default model id when this provider is the default provider. */
  defaultModelId: string | null;
  isChinese: boolean;
  disabled?: boolean;
  /** Expanded-provider-row model test status, keyed by modelId. */
  modelTestStatus?: Record<string, { tone: 'ok' | 'error' | 'busy'; message: string }>;
  testingModelId?: string | null;
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
  onOpen: () => void;
  onToggle: () => void;
  onUpdateModels: (models: ModelConfigEntry[]) => void;
  onTestModel: (modelId: string) => void;
  onSetDefaultModel: (modelId: string) => void;
  onToggleModel: (modelId: string) => void;
  onDiscoverModels: (provider: ModelProviderConfig) => Promise<ModelDiscoveryResult>;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

function modelCaps(
  model: ModelConfigEntry,
  isChinese: boolean,
): Array<{ key: string; label: string; bg: string; fg: string }> {
  const caps: Array<{ key: string; label: string; bg: string; fg: string }> = [
    {
      key: 'chat',
      label: isChinese ? '对话' : 'Chat',
      bg: '#e3ecfd',
      fg: '#2f5fd0',
    },
  ];
  if (model.input?.includes('image')) {
    caps.push({
      key: 'vision',
      label: isChinese ? '视觉' : 'Vision',
      bg: '#dff3ef',
      fg: '#0f7a6c',
    });
  }
  if (model.reasoning === true) {
    caps.push({
      key: 'reason',
      label: isChinese ? '推理' : 'Reason',
      bg: '#efe6fd',
      fg: '#7444d8',
    });
  }
  if (model.capabilities?.includes('image-generation')) {
    caps.push({
      key: 'image',
      label: isChinese ? '生图' : 'Image',
      bg: '#fdf0dc',
      fg: '#b26a00',
    });
  }
  return caps;
}

export function ProviderRow({
  provider,
  status,
  isDefault,
  defaultModelId,
  isChinese,
  disabled,
  modelTestStatus = {},
  testingModelId = null,
  searchCatalog,
  onOpen,
  onToggle,
  onUpdateModels,
  onTestModel,
  onSetDefaultModel,
  onToggleModel,
  onDiscoverModels,
}: ProviderRowProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverModels, setDiscoverModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);

  function toggleExpand(): void {
    setExpanded((prev) => !prev);
    setExpandedModelId(null);
  }

  function toggleModelExpand(modelId: string): void {
    setExpandedModelId((previous) => (previous === modelId ? null : modelId));
  }

  function handleApplyModelEdit(
    draft: import('./model-configuration.js').ModelConfigurationDraft,
  ): void {
    if (!expandedModelId) return;
    const next = applyModelConfigurationDraft(provider.models, expandedModelId, draft);
    if (next) onUpdateModels(next);
  }

  async function handleDiscover(): Promise<void> {
    setDiscovering(true);
    try {
      const result = await onDiscoverModels(provider);
      setDiscoverModels(result.models);
      setDiscoverOpen(true);
    } catch {
      // Parent surfaces errors via onError through onDiscoverModels callers when needed.
    } finally {
      setDiscovering(false);
    }
  }

  const t = isChinese
    ? {
        models: '模型',
        noModels: '暂无模型',
        test: '测试',
        setDefault: '设为默认',
        default: '默认',
        delete: '删除',
        expand: '展开',
        collapse: '收起',
        editProvider: '编辑提供商',
        discover: '发现',
        discovering: '发现中…',
        addModel: '手动添加模型',
        modelsHeading: '模型服务',
      }
    : {
        models: 'Models',
        noModels: 'No models',
        test: 'Test',
        setDefault: 'Set default',
        default: 'Default',
        delete: 'Delete',
        expand: 'Expand',
        collapse: 'Collapse',
        editProvider: 'Edit provider',
        discover: 'Discover',
        discovering: 'Discovering…',
        addModel: 'Add model manually',
        modelsHeading: 'Models',
      };

  return (
    <>
      <div
        className={`provider-row${expanded ? ' provider-row--expanded' : ''}`}
        data-testid={`provider-row-${provider.id}`}
      >
        <div className="provider-row-main">
          <button
            type="button"
            className="provider-row-expand-btn"
            onClick={toggleExpand}
            aria-label={expanded ? t.collapse : t.expand}
            aria-expanded={expanded}
            data-testid={`provider-row-expand-${provider.id}`}
            disabled={disabled}
          >
            <IconChevronDown
              width={14}
              height={14}
              className={expanded ? 'provider-row-chevron--open' : 'provider-row-chevron'}
            />
          </button>
          <ProviderIcon id={provider.id} name={provider.name} size={38} />
          <div className="provider-row-who">
            <b className="provider-row-name">
              {provider.name}
              {isDefault && (
                <IconStar
                  width={11}
                  height={11}
                  className="provider-row-default-star"
                  style={{ marginLeft: 6, color: 'var(--warn, #f59e0b)' }}
                />
              )}
            </b>
            <span className="provider-row-host" title={provider.baseUrl}>
              {hostOf(provider.baseUrl)}
            </span>
          </div>
          <div className="provider-row-models-count">
            {provider.models.length > 0 ? `${provider.models.length} ${t.models}` : t.noModels}
          </div>
          <div className="provider-row-tail">
            <div
              className="provider-row-controls"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ProviderStatusPill status={status} />
              <Switch
                checked={provider.enabled !== false}
                onCheckedChange={onToggle}
                disabled={disabled}
                testId={`provider-enable-switch-${provider.id}`}
                size="sm"
              />
            </div>
            <button
              type="button"
              className="provider-row-open"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              aria-label={t.editProvider}
              title={t.editProvider}
              data-testid={`provider-row-open-${provider.id}`}
            >
              <IconEdit width={14} height={14} className="provider-row-edit-icon" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="provider-row-expanded" data-testid={`provider-row-models-${provider.id}`}>
            <div className="provider-field-label" style={{ marginTop: 0 }}>
              <span>
                {t.modelsHeading}
                <span className="provider-field-label-count">（{provider.models.length}）</span>
              </span>
              <button
                type="button"
                className="provider-linkbtn"
                onClick={() => void handleDiscover()}
                disabled={disabled || discovering}
                data-testid={`provider-discover-models-${provider.id}`}
              >
                {discovering ? t.discovering : t.discover}
              </button>
            </div>

            <div className="provider-model-list" data-testid="provider-model-list">
              {provider.models.length === 0 && (
                <div className="provider-model-empty">{t.noModels}</div>
              )}
              {provider.models.map((model) => {
                const caps = modelCaps(model, isChinese);
                const isDefaultModel = isDefault && model.id === defaultModelId;
                const mTest = modelTestStatus[model.id];
                const isTesting = testingModelId === model.id;
                const isExpanded = expandedModelId === model.id;
                return (
                  <div
                    key={model.id}
                    className={`provider-model-item${isExpanded ? ' provider-model-item--expanded' : ''}`}
                  >
                    <div
                      className="provider-model-row"
                      data-testid="provider-model-row"
                      onClick={() => toggleModelExpand(model.id)}
                    >
                      <button
                        type="button"
                        className="provider-model-expand-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleModelExpand(model.id);
                        }}
                        aria-label={isExpanded ? t.collapse : t.expand}
                        aria-expanded={isExpanded}
                        data-testid={`provider-model-expand-${model.id}`}
                        disabled={disabled}
                      >
                        <IconChevronDown
                          width={13}
                          height={13}
                          className={
                            isExpanded ? 'provider-model-chevron--open' : 'provider-model-chevron'
                          }
                        />
                      </button>
                      <span className="provider-model-id" title={model.id}>
                        <span className="provider-model-name">
                          {model.label?.trim() || model.id}
                        </span>
                        {model.label?.trim() && model.label.trim() !== model.id ? (
                          <code className="provider-model-id-secondary">{model.id}</code>
                        ) : null}
                        {isDefaultModel && (
                          <span className="provider-model-default">{t.default}</span>
                        )}
                      </span>
                      <div className="provider-model-caps">
                        {caps.map((cap) => (
                          <span
                            key={cap.key}
                            className="provider-capchip"
                            style={{ background: cap.bg, color: cap.fg }}
                          >
                            {cap.label}
                          </span>
                        ))}
                      </div>
                      {mTest && (
                        <span
                          className={`provider-model-test-status provider-model-test-status--${mTest.tone}`}
                          title={mTest.message}
                        >
                          {mTest.message}
                        </span>
                      )}
                      <button
                        type="button"
                        className="provider-mini-btn"
                        title={t.test}
                        aria-label={t.test}
                        onClick={(event) => {
                          event.stopPropagation();
                          onTestModel(model.id);
                        }}
                        disabled={disabled || isTesting}
                        data-testid={`provider-model-test-${model.id}`}
                      >
                        {isTesting ? (
                          <IconRefresh width={16} height={16} className="provider-spin" />
                        ) : (
                          <IconSpark width={16} height={16} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="provider-mini-btn"
                        title={isDefaultModel ? t.default : t.setDefault}
                        aria-label={isDefaultModel ? t.default : t.setDefault}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!isDefaultModel) onSetDefaultModel(model.id);
                        }}
                        disabled={disabled || isDefaultModel}
                        data-testid={`provider-model-default-${model.id}`}
                        style={isDefaultModel ? { color: 'var(--warn, #f59e0b)' } : undefined}
                      >
                        <IconStar
                          width={12}
                          height={12}
                          fill={isDefaultModel ? 'currentColor' : 'none'}
                        />
                      </button>
                      <button
                        type="button"
                        className="provider-mini-btn"
                        title={t.delete}
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateModels(provider.models.filter((entry) => entry.id !== model.id))
                        }}
                        disabled={disabled}
                        aria-label={t.delete}
                        data-testid={`provider-model-remove-${model.id}`}
                      >
                        <IconClose width={16} height={16} />
                      </button>
                      <div
                        className="provider-model-toggle"
                        onClick={(event) => event.stopPropagation()}
                        title={
                          model.enabled === false
                            ? isChinese
                              ? '已停用'
                              : 'Disabled'
                            : isChinese
                              ? '已启用'
                              : 'Enabled'
                        }
                      >
                        <Switch
                          checked={model.enabled !== false}
                          onCheckedChange={() => onToggleModel(model.id)}
                          disabled={disabled}
                          testId={`provider-model-toggle-${model.id}`}
                          size="sm"
                        />
                      </div>
                    </div>
                    {isExpanded && (
                      <ModelEditInline
                        model={model}
                        providerProtocol={provider.protocol}
                        disabled={disabled ?? false}
                        isChinese={isChinese}
                        {...(searchCatalog ? { searchCatalog } : {})}
                        onSave={handleApplyModelEdit}
                        onCancel={() => setExpandedModelId(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="provider-add-model-btn"
              onClick={() => setAddModelOpen(true)}
              disabled={disabled}
              data-testid={`provider-add-model-${provider.id}`}
            >
              <IconPlus width={14} height={14} />
              {t.addModel}
            </button>
          </div>
        )}
      </div>

      <AddModelDialog
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        existingModelIds={provider.models.map((model) => model.id)}
        onAdd={(model) => {
          onUpdateModels([...provider.models, model]);
          setAddModelOpen(false);
        }}
        {...(searchCatalog ? { searchCatalog } : {})}
      />

      <DiscoverModelsDialog
        open={discoverOpen}
        provider={provider}
        models={discoverModels}
        onOpenChange={setDiscoverOpen}
        onImport={(selected) => {
          onUpdateModels(mergeDiscoveredModels(provider.models, selected));
          setDiscoverOpen(false);
        }}
      />
    </>
  );
}
