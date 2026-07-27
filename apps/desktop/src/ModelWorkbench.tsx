import { useState, type ReactElement } from 'react';
import type { DiscoveredModel, ModelConfigEntry, ModelDiscoveryResult, ModelProviderConfig } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { AddModelDialog } from './AddModelDialog';
import { DiscoverModelsDialog } from './DiscoverModelsDialog';
import { useDesktopLocale } from './desktop-locale-context';
import {
  applyModelConfigurationDraft,
  createModelConfigurationDraft,
  mergeDiscoveredModels,
  type ModelConfigurationDraft,
} from './model-configuration';

export type ModelWorkbenchProps = {
  provider: ModelProviderConfig;
  disabled: boolean;
  /** Model id currently set as the product default (when this provider is default). */
  defaultModelId: string | null;
  onModelsChange: (models: ModelConfigEntry[]) => void;
  onSetDefaultModel: (modelId: string) => void;
  onDiscoverModels: (provider: ModelProviderConfig) => Promise<ModelDiscoveryResult>;
  onTestModel: (provider: ModelProviderConfig, modelId: string) => Promise<{ durationMs: number }>;
};

function localizeFetchError(message: string, isChinese: boolean): string {
  const lower = message.toLowerCase();
  if (lower.includes('no api key') || lower.includes('could not be resolved') || lower.includes('没有可用')) {
    return isChinese
      ? '没有可用的 API 密钥。请在上方粘贴密钥后重试；本地无密钥服务请留空密钥。'
      : 'No usable API key. Paste a key above and retry, or leave blank for local no-auth.';
  }
  if (lower.includes('timed out') || lower.includes('超时')) {
    return isChinese ? '获取超时。请检查 API 地址是否可访问。' : 'Timed out. Check that the API address is reachable.';
  }
  if (lower.includes('401')) {
    return isChinese ? '认证失败（401）。请检查密钥。' : 'Auth failed (401). Check the API key.';
  }
  if (lower.includes('404')) {
    return isChinese ? '找不到模型列表接口（404）。请检查 API 地址。' : 'Models endpoint not found (404). Check the API address.';
  }
  return message;
}

function formatTokenCount(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

type ModelTestState = {
  tone: 'ok' | 'error' | 'busy';
  message: string;
};

/**
 * Full-width model directory: one row per model (mono name, status pill,
 * ctx/out summary), click to expand inline. Expanded area exposes identity +
 * Runtime Limits (context window / max output) editing plus row actions
 * (send test message, set default, remove).
 */
export function ModelWorkbench({
  provider,
  disabled,
  defaultModelId,
  onModelsChange,
  onSetDefaultModel,
  onDiscoverModels,
  onTestModel,
}: ModelWorkbenchProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const isChinese = locale === 'zh-CN';

  const [isAddOpen, setAddOpen] = useState(false);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [pickerModels, setPickerModels] = useState<DiscoveredModel[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, ModelTestState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function importDiscoveredModels(discoveredModels: DiscoveredModel[]): void {
    onModelsChange(mergeDiscoveredModels(provider.models, discoveredModels));
    setFetchInfo(
      isChinese
        ? `已导入 ${discoveredModels.filter((model) => !provider.models.some((current) => current.id === model.id)).length} 个模型`
        : `Imported ${discoveredModels.filter((model) => !provider.models.some((current) => current.id === model.id)).length} models`,
    );
  }

  function addManualModel(model: ModelConfigEntry): void {
    onModelsChange([...provider.models, model]);
  }

  function removeModel(modelId: string): void {
    if (provider.models.length <= 1) {
      return;
    }
    onModelsChange(provider.models.filter((model) => model.id !== modelId));
    if (expandedId === modelId) {
      setExpandedId(null);
    }
  }

  async function handleFetchModels(): Promise<void> {
    setFetching(true);
    setFetchError(null);
    setFetchInfo(null);
    try {
      const result = await onDiscoverModels(provider);
      if (result.models.length === 0) {
        setFetchError(isChinese ? '接口没有返回任何模型。' : 'The endpoint returned no models.');
        return;
      }
      const configuredIds = new Set(provider.models.map((model) => model.id));
      const newCount = result.models.filter((model) => !configuredIds.has(model.id)).length;
      if (newCount === 0) {
        setFetchInfo(
          isChinese
            ? `已获取 ${result.models.length} 个模型，均已在列表中。`
            : `Fetched ${result.models.length} models; all already listed.`,
        );
        return;
      }
      setPickerModels(result.models);
      setPickerOpen(true);
    } catch (error) {
      setFetchError(
        localizeFetchError(error instanceof Error ? error.message : String(error), isChinese),
      );
    } finally {
      setFetching(false);
    }
  }

  async function handleTestModel(modelId: string): Promise<void> {
    setTestingModelId(modelId);
    setTestStatus((current) => ({
      ...current,
      [modelId]: { tone: 'busy', message: isChinese ? '检测中…' : 'Testing…' },
    }));
    try {
      const result = await onTestModel(provider, modelId);
      const seconds = (result.durationMs / 1000).toFixed(result.durationMs >= 1000 ? 1 : 2);
      setTestStatus((current) => ({
        ...current,
        [modelId]: {
          tone: 'ok',
          message: isChinese ? `可用 · ${seconds}s` : `Available · ${seconds}s`,
        },
      }));
    } catch (error) {
      const message = localizeFetchError(
        error instanceof Error ? error.message : String(error),
        isChinese,
      );
      setTestStatus((current) => ({
        ...current,
        [modelId]: {
          tone: 'error',
          message: isChinese ? `失败 · ${message}` : `Failed · ${message}`,
        },
      }));
    } finally {
      setTestingModelId(null);
    }
  }

  function handleSaveExpandedModel(originalId: string, draft: ModelConfigurationDraft): void {
    const nextModels = applyModelConfigurationDraft(provider.models, originalId, draft);
    if (!nextModels) {
      return;
    }
    onModelsChange(nextModels);
    setExpandedId(null);
  }

  return (
    <div className="model-workbench" data-testid="model-workbench">
      {/* Header */}
      <div className="model-dir-header">
        <h4 className="model-dir-title">
          {isChinese ? '模型目录' : 'Model directory'}
          <span className="model-dir-count">{provider.models.length}</span>
        </h4>
      </div>

      {/* Banners */}
      {fetchError ? (
        <p className="model-dir-banner model-dir-banner--error" data-testid="discover-models-error">
          {fetchError}
        </p>
      ) : null}
      {fetchInfo ? (
        <p className="model-dir-banner model-dir-banner--info">{fetchInfo}</p>
      ) : null}

      {/* Directory */}
      <div className="model-dir" role="list">
        {provider.models.length === 0 ? (
          <p className="model-dir-empty muted">{copy.modelsEmpty}</p>
        ) : (
          provider.models.map((model) => {
            const isExpanded = expandedId === model.id;
            const isDefault = model.id === defaultModelId;
            const status = testStatus[model.id];

            return (
              <div
                key={model.id}
                className={isExpanded ? 'model-dir-row model-dir-row--expanded' : 'model-dir-row'}
                role="listitem"
              >
                <button
                  type="button"
                  className="model-dir-row-main"
                  onClick={() => setExpandedId(isExpanded ? null : model.id)}
                  aria-expanded={isExpanded}
                  data-testid="model-dir-row"
                >
                  <span className="model-dir-name">
                    <code className="model-dir-id">{model.id}</code>
                    {model.label && model.label !== model.id ? (
                      <span className="model-dir-label">{model.label}</span>
                    ) : null}
                  </span>
                  {isDefault ? (
                    <span className="model-dir-pill model-dir-pill--default">
                      {isChinese ? '默认' : 'Default'}
                    </span>
                  ) : null}
                  {status ? (
                    <span
                      className={`model-dir-pill model-dir-pill--${status.tone}`}
                      data-testid="model-test-status"
                    >
                      {status.message}
                    </span>
                  ) : null}
                  <span className="model-dir-summary">
                    {formatTokenCount(model.contextWindow)} ctx · {formatTokenCount(model.maxOutputTokens)} out
                  </span>
                </button>

                {isExpanded ? (
                  <ModelInlineEditor
                    key={model.id}
                    model={model}
                    disabled={disabled}
                    isChinese={isChinese}
                    isDefault={isDefault}
                    testing={testingModelId === model.id}
                    canRemove={provider.models.length > 1}
                    onSave={(updated) => handleSaveExpandedModel(model.id, updated)}
                    onCancel={() => setExpandedId(null)}
                    onTest={() => void handleTestModel(model.id)}
                    onSetDefault={() => onSetDefaultModel(model.id)}
                    onRemove={() => removeModel(model.id)}
                    removeLabel={common.remove}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Directory actions */}
      <div className="model-dir-actions">
        <Button
          size="compact"
          disabled={disabled}
          onClick={() => setAddOpen(true)}
          aria-label={copy.addModel}
          data-testid="add-model-btn"
        >
          {isChinese ? '＋ 手动添加模型' : `+ ${copy.addModel}`}
        </Button>
        <Button
          size="compact"
          disabled={disabled || fetching}
          onClick={() => void handleFetchModels()}
          data-testid="discover-models-btn"
        >
          {fetching
            ? (isChinese ? '获取中…' : 'Fetching…')
            : isChinese
              ? '从 API 发现模型'
              : copy.fetchModelList}
        </Button>
      </div>

      <DiscoverModelsDialog
        open={isPickerOpen}
        provider={provider}
        models={pickerModels}
        onOpenChange={setPickerOpen}
        onImport={importDiscoveredModels}
      />
      <AddModelDialog
        open={isAddOpen}
        onOpenChange={setAddOpen}
        existingModelIds={provider.models.map((model) => model.id)}
        onAdd={addManualModel}
      />
    </div>
  );
}

type InlineEditorProps = {
  model: ModelConfigEntry;
  disabled: boolean;
  isChinese: boolean;
  isDefault: boolean;
  testing: boolean;
  canRemove: boolean;
  removeLabel: string;
  onSave: (draft: ModelConfigurationDraft) => void;
  onCancel: () => void;
  onTest: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
};

function ModelInlineEditor({
  model,
  disabled,
  isChinese,
  isDefault,
  testing,
  canRemove,
  removeLabel,
  onSave,
  onCancel,
  onTest,
  onSetDefault,
  onRemove,
}: InlineEditorProps): ReactElement {
  const [local, setLocal] = useState<ModelConfigurationDraft>(() =>
    createModelConfigurationDraft(model),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="model-dir-editor" data-testid="model-dir-editor">
      <div className="model-dir-editor-grid">
        {/* Identity */}
        <div className="model-dir-editor-column">
          <h5 className="model-dir-editor-heading">{isChinese ? '基本' : 'Basic'}</h5>
          <div className="model-dir-editor-field">
            <label className="model-dir-editor-label">
              {isChinese ? 'API 模型' : 'API model'}
            </label>
            <input
              className="model-dir-editor-input model-dir-editor-input--code"
              value={local.id}
              onChange={(event) => setLocal({ ...local, id: event.target.value })}
              spellCheck={false}
              data-testid="model-edit-id"
            />
          </div>
          <div className="model-dir-editor-field">
            <label className="model-dir-editor-label">
              {isChinese ? '显示名称' : 'Display name'}
            </label>
            <input
              className="model-dir-editor-input"
              value={local.label}
              onChange={(event) => setLocal({ ...local, label: event.target.value })}
              spellCheck={false}
              data-testid="model-edit-label"
            />
          </div>
        </div>

        {/* Runtime limits */}
        <div className="model-dir-editor-column">
          <h5 className="model-dir-editor-heading">{isChinese ? '运行时限制' : 'Runtime limits'}</h5>
          <div className="model-dir-editor-field">
            <label className="model-dir-editor-label">
              {isChinese ? '上下文窗口' : 'Context window'}
              <span className="model-dir-editor-unit">tokens</span>
            </label>
            <input
              className="model-dir-editor-input model-dir-editor-input--code"
              value={local.contextWindow}
              onChange={(event) => setLocal({ ...local, contextWindow: event.target.value })}
              placeholder="128000"
              inputMode="numeric"
              spellCheck={false}
              data-testid="model-edit-context"
            />
          </div>
          <div className="model-dir-editor-field">
            <label className="model-dir-editor-label">
              {isChinese ? '最大输出' : 'Max output'}
              <span className="model-dir-editor-unit">tokens</span>
            </label>
            <input
              className="model-dir-editor-input model-dir-editor-input--code"
              value={local.maxOutputTokens}
              onChange={(event) => setLocal({ ...local, maxOutputTokens: event.target.value })}
              placeholder="16384"
              inputMode="numeric"
              spellCheck={false}
              data-testid="model-edit-output"
            />
          </div>
          <p className="model-dir-editor-hint">
            {isChinese
              ? '留空回退到 provider 默认值'
              : 'Leave blank to fall back to the provider default'}
          </p>
        </div>
      </div>

      {/* Advanced: tooltip markdown */}
      <Button
        variant="ghost"
        className="model-dir-editor-advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced
          ? (isChinese ? '收起高级' : 'Hide advanced')
          : (isChinese ? '高级' : 'Advanced')}
      </Button>
      {showAdvanced ? (
        <div className="model-dir-editor-field">
          <label className="model-dir-editor-label">
            {isChinese ? '悬停说明' : 'Tooltip (Markdown)'}
          </label>
          <textarea
            className="model-dir-editor-textarea"
            value={local.tooltipMarkdown}
            onChange={(event) => setLocal({ ...local, tooltipMarkdown: event.target.value })}
            rows={3}
            spellCheck={false}
            data-testid="model-edit-tooltip"
          />
        </div>
      ) : null}

      {/* Row actions */}
      <div className="model-dir-editor-actions">
        <div className="model-dir-editor-actions-left">
          <Button
            size="compact"
            disabled={disabled || testing}
            onClick={onTest}
            data-testid="model-test-btn"
          >
            {testing
              ? (isChinese ? '检测中…' : 'Testing…')
              : isChinese
                ? '发送测试消息'
                : 'Send test message'}
          </Button>
          <Button
            size="compact"
            disabled={disabled || isDefault}
            onClick={onSetDefault}
            data-testid="model-set-default-btn"
          >
            {isDefault
              ? (isChinese ? '当前默认' : 'Current default')
              : isChinese
                ? '设为默认'
                : 'Set default'}
          </Button>
          <Button
            size="compact"
            className="model-dir-editor-remove"
            disabled={disabled || !canRemove}
            onClick={onRemove}
            data-testid="model-remove-btn"
          >
            {removeLabel}
          </Button>
        </div>
        <div className="model-dir-editor-actions-right">
          <Button variant="ghost" onClick={onCancel}>
            {isChinese ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            disabled={disabled}
            onClick={() => onSave(local)}
            data-testid="model-edit-save"
          >
            {isChinese ? '保存' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
