import { useState, type ReactElement } from 'react';
import type { DiscoveredModel, ModelConfigEntry, ModelDiscoveryResult, ModelProviderConfig } from '@piwin/contracts';
import { Button, Field, Notice, Spinner } from '@piwin/ui-kit';
import { AddModelDialog } from './AddModelDialog';
import { DiscoverModelsDialog } from './DiscoverModelsDialog';
import { useDesktopLocale } from './desktop-locale-context';
import {
  applyModelConfigurationDraft,
  createModelConfigurationDraft,
  mergeDiscoveredModels,
  type ModelConfigurationDraft,
} from './model-configuration';
import { PageTitle } from './settings/page-title';

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
      ? '没有可用的 API 密钥。'
      : 'No usable API key.';
  }
  if (lower.includes('timed out') || lower.includes('超时')) {
    return isChinese ? '获取超时。' : 'Timed out.';
  }
  return message;
}

function formatTokenCount(value: string | number | undefined): string {
  if (value === undefined || value === '') return '—';
  const num = typeof value === 'string' ? parseInt(value, 10) : value;
  if (isNaN(num)) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return String(num);
}

type ModelTestState = {
  tone: 'ok' | 'error' | 'busy';
  message: string;
};

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
    if (provider.models.length <= 1) return;
    onModelsChange(provider.models.filter((model) => model.id !== modelId));
    if (expandedId === modelId) setExpandedId(null);
  }

  async function handleFetchModels(): Promise<void> {
    setFetching(true);
    setFetchError(null);
    setFetchInfo(null);
    try {
      const result = await onDiscoverModels(provider);
      if (result.models.length === 0) {
        setFetchError(isChinese ? '接口未返回模型。' : 'No models returned.');
        return;
      }
      setPickerModels(result.models);
      setPickerOpen(true);
    } catch (error) {
      setFetchError(localizeFetchError(error instanceof Error ? error.message : String(error), isChinese));
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
      const seconds = (result.durationMs / 1000).toFixed(1);
      setTestStatus((current) => ({
        ...current,
        [modelId]: { tone: 'ok', message: isChinese ? `可用 · ${seconds}s` : `Available · ${seconds}s` },
      }));
    } catch (error) {
      setTestStatus((current) => ({
        ...current,
        [modelId]: { tone: 'error', message: isChinese ? '失败' : 'Failed' },
      }));
    } finally {
      setTestingModelId(null);
    }
  }

  function handleSaveExpandedModel(originalId: string, draft: ModelConfigurationDraft): void {
    const nextModels = applyModelConfigurationDraft(provider.models, originalId, draft);
    if (nextModels) {
      onModelsChange(nextModels);
      setExpandedId(null);
    }
  }

  return (
    <div className="model-workbench" data-testid="model-workbench">
      <PageTitle
        title={isChinese ? '模型目录' : 'Model Directory'}
        description={isChinese ? '管理此提供商下的模型及其运行时限制。' : 'Manage models and their runtime limits.'}
        trailing={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="compact" variant="ghost" disabled={disabled || fetching} onClick={handleFetchModels}>
              {fetching ? <Spinner /> : (isChinese ? '自动发现' : 'Discover')}
            </Button>
            <Button size="compact" disabled={disabled} onClick={() => setAddOpen(true)}>
              + {isChinese ? '添加' : 'Add'}
            </Button>
          </div>
        }
      />

      {fetchError && <Notice tone="error">{fetchError}</Notice>}
      {fetchInfo && <Notice tone="info">{fetchInfo}</Notice>}

      <div className="ext-list" style={{ marginTop: 12 }}>
        {provider.models.length === 0 ? (
          <li className="muted" style={{ textAlign: 'center', padding: '32px' }}>{copy.modelsEmpty}</li>
        ) : (
          provider.models.map((model) => {
            const isExpanded = expandedId === model.id;
            const isDefault = model.id === defaultModelId;
            const status = testStatus[model.id];

            return (
              <div
                key={model.id}
                className={isExpanded ? 'ext-list-item active' : 'ext-list-item'}
                style={{ flexDirection: 'column', alignItems: 'stretch', padding: '4px' }}
              >
                <div
                  data-testid="model-dir-row"
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : model.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontFamily: 'var(--mono)', fontSize: '13.5px' }}>{model.id}</strong>
                      {isDefault && <span className="pill">默认</span>}
                    </div>
                    <div className="muted" style={{ fontSize: '11.5px', marginTop: 2 }}>
                      {formatTokenCount(model.contextWindow)} ctx · {formatTokenCount(model.maxOutputTokens)} out
                    </div>
                  </div>
                  {status && (
                    <span className={`mcp-status ${status.tone === 'ok' ? 'running' : status.tone === 'error' ? 'error' : 'starting'}`} style={{ fontSize: '11.5px' }}>
                      {status.message}
                    </span>
                  )}
                  <div className="muted" style={{ fontSize: '12px', opacity: 0.5 }}>
                    {isExpanded ? '↑' : '↓'}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '20px 12px 12px', borderTop: '1px solid var(--line-soft)', background: 'var(--surface-inset)', borderRadius: '0 0 8px 8px' }}>
                    <ModelInlineEditor
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
                  </div>
                )}
              </div>
            );
          })
        )}
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
        existingModelIds={provider.models.map((m) => m.id)}
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="mcp-form-grid">
        <Field label={isChinese ? '模型 ID' : 'Model ID'}>
          <input
            className="mcp-raw-editor"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={local.id}
            onChange={(e) => setLocal({ ...local, id: e.target.value })}
            spellCheck={false}
          />
        </Field>
        <Field label={isChinese ? '显示名称' : 'Display Name'}>
          <input
            className="mcp-raw-editor"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={local.label}
            onChange={(e) => setLocal({ ...local, label: e.target.value })}
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="mcp-form-grid">
        <Field label={isChinese ? '上下文窗口 (Tokens)' : 'Context Window'}>
          <input
            className="mcp-raw-editor"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={local.contextWindow}
            onChange={(e) => setLocal({ ...local, contextWindow: e.target.value })}
            inputMode="numeric"
            data-testid="model-edit-context"
          />
        </Field>
        <Field label={isChinese ? '最大输出 (Tokens)' : 'Max Output'}>
          <input
            className="mcp-raw-editor"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={local.maxOutputTokens}
            onChange={(e) => setLocal({ ...local, maxOutputTokens: e.target.value })}
            inputMode="numeric"
            data-testid="model-edit-output"
          />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="primary" size="compact" disabled={disabled} onClick={() => onSave(local)}>保存</Button>
          <Button variant="ghost" size="compact" onClick={onCancel}>取消</Button>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button size="compact" variant="ghost" disabled={testing || disabled} onClick={onTest}>
            {testing ? '检测中...' : '测试模型'}
          </Button>
          {!isDefault && (
            <Button size="compact" variant="ghost" disabled={disabled} onClick={onSetDefault}>
              设为默认
            </Button>
          )}
          {canRemove && (
            <Button size="compact" variant="ghost" disabled={disabled} onClick={onRemove} style={{ color: 'var(--danger)' }}>
              {removeLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
