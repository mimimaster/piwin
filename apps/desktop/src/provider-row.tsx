import { useState, type ReactElement } from 'react';
import type {
  ModelCatalogEntry,
  ModelConfigEntry,
  ModelProviderConfig,
} from '@piwin/contracts';
import { Switch } from '@piwin/ui-kit';
import { ProviderIcon } from './provider-icons.js';
import { ProviderStatusPill, type ProviderTestStatus } from './provider-status.js';
import { ModelEditInline } from './model-edit-inline.js';
import { applyModelConfigurationDraft } from './model-configuration.js';
import {
  IconChevronDown,
  IconClose,
  IconEdit,
  IconRefresh,
  IconSpark,
  IconStar,
} from './shell-icons.js';

export type ProviderRowProps = {
  provider: ModelProviderConfig;
  status: ProviderTestStatus;
  isDefault: boolean;
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
}: ProviderRowProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);

  const defaultModelId = isDefault ? null : null; // determined by parent
  void defaultModelId;

  function toggleExpand(): void {
    setExpanded((prev) => !prev);
    setEditingModelId(null);
  }

  function handleSaveEdit(draft: import('./model-configuration.js').ModelConfigurationDraft): void {
    const next = applyModelConfigurationDraft(provider.models, editingModelId!, draft);
    if (next) onUpdateModels(next);
    setEditingModelId(null);
  }

  const t = isChinese
    ? {
        models: '模型',
        noModels: '暂无模型',
        edit: '编辑',
        test: '测试',
        setDefault: '设为默认',
        default: '默认',
        delete: '删除',
        expand: '展开',
        collapse: '收起',
        editProvider: '编辑提供商',
      }
    : {
        models: 'Models',
        noModels: 'No models',
        edit: 'Edit',
        test: 'Test',
        setDefault: 'Set default',
        default: 'Default',
        delete: 'Delete',
        expand: 'Expand',
        collapse: 'Collapse',
        editProvider: 'Edit provider',
      };

  return (
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
          {provider.models.length > 0
            ? `${provider.models.length} ${t.models}`
            : t.noModels}
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
          {provider.models.length === 0 && (
            <div className="provider-model-empty">{t.noModels}</div>
          )}
          {provider.models.map((model) => {
            const caps = modelCaps(model, isChinese);
            const isDefaultModel = isDefault && false; // parent determines per-model default
            void isDefaultModel;
            const mTest = modelTestStatus[model.id];
            const isTesting = testingModelId === model.id;
            const isEditing = editingModelId === model.id;
            return (
              <div key={model.id} className="provider-model-item">
                <div className="provider-model-row" data-testid="provider-model-row">
                  <span className="provider-model-id" title={model.id}>
                    {model.id}
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
                    title={t.edit}
                    onClick={() => setEditingModelId(isEditing ? null : model.id)}
                    disabled={disabled}
                    data-testid={`provider-model-edit-${model.id}`}
                  >
                    <IconEdit width={12} height={12} />
                  </button>
                  <button
                    type="button"
                    className="provider-mini-btn"
                    title={t.test}
                    onClick={() => onTestModel(model.id)}
                    disabled={disabled || isTesting}
                    data-testid={`provider-model-test-${model.id}`}
                  >
                    {isTesting ? (
                      <IconRefresh width={12} height={12} className="provider-spin" />
                    ) : (
                      <IconSpark width={12} height={12} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="provider-mini-btn"
                    title={t.setDefault}
                    onClick={() => onSetDefaultModel(model.id)}
                    disabled={disabled}
                    data-testid={`provider-model-default-${model.id}`}
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    className="provider-mini-btn"
                    onClick={() =>
                      onUpdateModels(provider.models.filter((m) => m.id !== model.id))
                    }
                    disabled={disabled}
                    aria-label={t.delete}
                    data-testid={`provider-model-remove-${model.id}`}
                  >
                    <IconClose width={12} height={12} />
                  </button>
                </div>
                {isEditing && (
                  <ModelEditInline
                    model={model}
                    providerProtocol={provider.protocol}
                    disabled={disabled ?? false}
                    isChinese={isChinese}
                    {...(searchCatalog ? { searchCatalog } : {})}
                    onSave={handleSaveEdit}
                    onCancel={() => setEditingModelId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
