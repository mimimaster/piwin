/**
 * Provider config drawer — BYOK prototype layout:
 *   head (icon + name + host + close)
 *   enable status bar
 *   API key + test connection
 *   API address
 *   simple model list + add / discover
 *   advanced (request headers) collapsed
 *   foot (delete / cancel / save)
 */

import { useState, type ReactElement } from 'react';
import type {
  DiscoveredModel,
  ModelConfigEntry,
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { Button, IconButton, Switch, TextInput } from '@piwin/ui-kit';
import { AddModelDialog } from './AddModelDialog.js';
import { DiscoverModelsDialog } from './DiscoverModelsDialog.js';
import { ModelEditInline } from './model-edit-inline.js';
import {
  createHeaderRow,
  draftToProvider,
  hasKeychainSecret,
  type ProviderDraft,
} from './provider-draft.js';
import { ProviderIcon } from './provider-icons.js';
import { ProviderStatusPill, type ProviderTestStatus } from './provider-status.js';
import {
  IconCheck,
  IconChevronRight,
  IconClose,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconSpark,
} from './shell-icons.js';
import { applyModelConfigurationDraft, mergeDiscoveredModels } from './model-configuration.js';

function IconEye({ width = 14, height = 14 }: { width?: number; height?: number }): ReactElement {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff({
  width = 14,
  height = 14,
}: {
  width?: number;
  height?: number;
}): ReactElement {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
    </svg>
  );
}

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

export type ProviderDrawerCopy = {
  enableProvider: string;
  providerEnabledHint: string;
  providerDisabledHint: string;
  statusUntested: string;
  statusOff: string;
  testing: string;
  testConnection: string;
  testOk: (count: number, duration: number) => string;
  saveAndAdd: string;
  providerName: string;
  modelsHeading: string;
  modelsWithCount: (count: number) => string;
  connectionHint: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyStoredPlaceholder: string;
  apiAddress: string;
  requestHeaders: string;
  requestHeadersHint: string;
  headerName: string;
  headerValue: string;
  addHeader: string;
  keyManager: string;
  modelsEmpty: string;
  addModel: string;
  discover: string;
  advanced: string;
};

export type ProviderDrawerCommon = {
  cancel: string;
  delete: string;
  save: string;
};

export type ProviderDrawerProps = {
  draft: ProviderDraft;
  isNew: boolean;
  config: PiwinConfig;
  saving: boolean;
  testingId: string | null;
  testStatus: Record<string, ProviderTestStatus>;
  isChinese: boolean;
  copy: ProviderDrawerCopy;
  common: ProviderDrawerCommon;
  searchCatalog?:
    ((query: string) => Promise<import('@piwin/contracts').ModelCatalogEntry[]>) | undefined;
  onClose: () => void;
  onSave: (opts?: {
    keepOpen?: boolean;
    default?: { providerId: string; modelId: string };
  }) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onDraftChange: (draft: ProviderDraft) => void;
  onTestConnection: () => void;
  onSetDefaultModel: (modelId: string) => Promise<void>;
  onModelsChange: (models: ModelConfigEntry[]) => void;
  onOpenKeyManager: () => void;
  /** Load keychain secret so the eye toggle can reveal a stored key. */
  onLoadSecret: (providerId: string) => Promise<string | null>;
  discoverWithDraft: (provider: ModelProviderConfig) => Promise<ModelDiscoveryResult>;
  testModelWithDraft: (
    provider: ModelProviderConfig,
    modelId: string,
  ) => Promise<{ durationMs: number }>;
};

type ModelTestState = {
  tone: 'ok' | 'error' | 'busy';
  message: string;
};

export function ProviderDrawer({
  draft,
  isNew,
  config,
  saving,
  testingId,
  testStatus,
  isChinese,
  copy,
  common,
  searchCatalog,
  onClose,
  onSave,
  onDelete,
  onDraftChange,
  onTestConnection,
  onSetDefaultModel,
  onModelsChange,
  onOpenKeyManager,
  onLoadSecret,
  discoverWithDraft,
  testModelWithDraft,
}: ProviderDrawerProps): ReactElement {
  const [showKey, setShowKey] = useState(false);
  const [revealingKey, setRevealingKey] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverModels, setDiscoverModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [modelTestStatus, setModelTestStatus] = useState<Record<string, ModelTestState>>({});
  const [editingModelId, setEditingModelId] = useState<string | null>(null);

  const status = draft.enabled
    ? (testStatus[draft.id] ?? { tone: 'warn' as const, message: copy.statusUntested })
    : { tone: 'off' as const, message: copy.statusOff };

  const hasStoredKey = hasKeychainSecret(draft);
  const isDefaultProvider = config.defaultProviderId === draft.id;
  const defaultModelId = isDefaultProvider ? (config.defaultModelId ?? null) : null;

  function removeModel(modelId: string): void {
    onModelsChange(draft.models.filter((model) => model.id !== modelId));
  }

  function handleAddHeader(): void {
    onDraftChange({ ...draft, headerRows: [...draft.headerRows, createHeaderRow()] });
    setAdvOpen(true);
  }

  async function handleToggleKeyVisibility(): Promise<void> {
    if (showKey) {
      setShowKey(false);
      return;
    }

    // Field is empty but keychain has a secret — load it so reveal is meaningful.
    // Without this, type=text on an empty input still shows only the •••• placeholder.
    if (!draft.apiKeyInput.trim() && hasStoredKey) {
      setRevealingKey(true);
      try {
        const raw = await onLoadSecret(draft.id);
        const firstLine = (raw ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (firstLine) {
          onDraftChange({ ...draft, apiKeyInput: firstLine });
        }
      } catch {
        // Still flip to text mode; user can open key manager if load failed.
      } finally {
        setRevealingKey(false);
      }
    }

    setShowKey(true);
  }

  async function handleDiscover(): Promise<void> {
    setDiscovering(true);
    try {
      const result = await discoverWithDraft(draftToProvider(draft));
      setDiscoverModels(result.models);
      setDiscoverOpen(true);
    } catch {
      // Parent surfaces errors via onError through discoverWithDraft callers when needed.
    } finally {
      setDiscovering(false);
    }
  }

  async function handleTestModel(modelId: string): Promise<void> {
    setTestingModelId(modelId);
    setModelTestStatus((prev) => ({
      ...prev,
      [modelId]: { tone: 'busy', message: isChinese ? '检测中…' : 'Testing…' },
    }));
    try {
      const result = await testModelWithDraft(draftToProvider(draft), modelId);
      const seconds = (result.durationMs / 1000).toFixed(1);
      setModelTestStatus((prev) => ({
        ...prev,
        [modelId]: {
          tone: 'ok',
          message: isChinese ? `可用 · ${seconds}s` : `OK · ${seconds}s`,
        },
      }));
    } catch {
      setModelTestStatus((prev) => ({
        ...prev,
        [modelId]: { tone: 'error', message: isChinese ? '失败' : 'Fail' },
      }));
    } finally {
      setTestingModelId(null);
    }
  }

  // Nested Mantine Modals portal to document.body, but React still bubbles
  // synthetic events through this tree. Keep them outside the overlay so a
  // click in Discover/Add model inputs cannot hit onClose and dismiss the editor.
  const nestedDialogOpen = discoverOpen || addModelOpen;

  return (
    <>
      <div
        className="provider-editor-overlay"
        onClick={() => {
          if (nestedDialogOpen) return;
          onClose();
        }}
        data-testid="provider-drawer-overlay"
        role="presentation"
      >
        <div
          className="provider-editor-modal"
          onClick={(event) => event.stopPropagation()}
          data-testid="provider-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={draft.name || (isChinese ? '编辑提供商' : 'Edit provider')}
        >
          <div className="provider-drawer-head">
            <ProviderIcon id={draft.id} name={draft.name} size={40} />
            <div className="provider-drawer-meta">
              <b className="provider-drawer-name">
                {draft.name || (isChinese ? '未命名' : 'Untitled')}
              </b>
              <span className="provider-drawer-host" title={draft.baseUrl}>
                {hostOf(draft.baseUrl)}
              </span>
            </div>
            <button
              type="button"
              className="provider-drawer-iconbtn"
              onClick={onClose}
              aria-label={common.cancel}
              data-testid="provider-drawer-close"
            >
              <IconClose width={15} height={15} />
            </button>
          </div>

          <div className="provider-drawer-body">
            <div className="provider-statusbar">
              <div className="provider-statusbar-text">
                <b>{copy.enableProvider}</b>
                <span>{draft.enabled ? copy.providerEnabledHint : copy.providerDisabledHint}</span>
              </div>
              <ProviderStatusPill status={status} />
              <Switch
                checked={draft.enabled}
                onCheckedChange={(checked) => onDraftChange({ ...draft, enabled: checked })}
                testId="provider-enable-switch"
                size="sm"
                disabled={saving}
              />
            </div>

            {(isNew || draft.id.startsWith('custom')) && (
              <>
                <div className="provider-field-label">{copy.providerName}</div>
                <TextInput
                  value={draft.name}
                  onChange={(event) => onDraftChange({ ...draft, name: event.currentTarget.value })}
                  placeholder={isChinese ? '例如：公司内网网关' : 'e.g. Company gateway'}
                  spellCheck={false}
                  testId="provider-name-input"
                  disabled={saving}
                />
              </>
            )}

            <div className="provider-field-label">
              <span>{copy.apiKeyLabel}</span>
              <button
                type="button"
                className="provider-linkbtn"
                onClick={() => void onTestConnection()}
                disabled={saving || testingId === draft.id}
                data-testid="provider-test-connection"
              >
                {testingId === draft.id ? (
                  <>
                    <IconRefresh width={12} height={12} className="provider-spin" />
                    {copy.testing}
                  </>
                ) : (
                  <>
                    <IconSpark width={12} height={12} />
                    {copy.testConnection}
                  </>
                )}
              </button>
            </div>
            <div className="provider-input-wrap">
              <TextInput
                type={showKey ? 'text' : 'password'}
                testId="provider-apikey-env-input"
                value={draft.apiKeyInput}
                onChange={(event) => {
                  onDraftChange({ ...draft, apiKeyInput: event.currentTarget.value });
                }}
                placeholder={
                  hasStoredKey
                    ? '••••••••'
                    : isChinese
                      ? 'sk-…（本地可留空）'
                      : 'sk-… (local may leave empty)'
                }
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
                className="provider-input-mono"
              />
              <div className="provider-input-trail">
                <button
                  type="button"
                  className="provider-mini-btn"
                  onClick={() => void handleToggleKeyVisibility()}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                  title={
                    showKey
                      ? isChinese
                        ? '隐藏密钥'
                        : 'Hide key'
                      : isChinese
                        ? '显示密钥'
                        : 'Show key'
                  }
                  data-testid="provider-toggle-key-visibility"
                  disabled={saving || revealingKey}
                >
                  {showKey ? (
                    <IconEyeOff width={14} height={14} />
                  ) : (
                    <IconEye width={14} height={14} />
                  )}
                </button>
                <button
                  type="button"
                  className="provider-mini-btn"
                  onClick={onOpenKeyManager}
                  aria-label={copy.keyManager}
                  title={copy.keyManager}
                  data-testid="provider-key-manager-btn"
                  disabled={saving}
                >
                  <IconSettings width={13} height={13} />
                </button>
              </div>
            </div>
            <div className="provider-field-hint">
              {hasStoredKey
                ? isChinese
                  ? '密钥已加密存于本机钥匙串，留空则保持不变'
                  : 'Key is encrypted in the local keychain — leave blank to keep'
                : copy.connectionHint}
            </div>

            <div className="provider-field-label">
              <span>{copy.apiAddress}</span>
            </div>
            <TextInput
              testId="provider-baseurl-input"
              value={draft.baseUrl}
              onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })}
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              disabled={saving}
              className="provider-input-mono"
            />
            <div className="provider-field-hint">
              {isChinese
                ? '需兼容 OpenAI / Anthropic / Gemini 对应接口格式'
                : 'Must match the selected protocol endpoint shape'}
            </div>

            <div className="provider-field-label" style={{ marginTop: 8 }}>
              <span>
                {copy.modelsHeading}
                <span className="provider-field-label-count">（{draft.models.length}）</span>
              </span>
              <button
                type="button"
                className="provider-linkbtn"
                onClick={() => void handleDiscover()}
                disabled={saving || discovering}
                data-testid="provider-discover-models"
              >
                {discovering ? copy.testing : copy.discover}
              </button>
            </div>

            <div className="provider-model-list" data-testid="provider-model-list">
              {draft.models.length === 0 && (
                <div className="provider-model-empty">{copy.modelsEmpty}</div>
              )}
              {draft.models.map((model) => {
                const caps = modelCaps(model, isChinese);
                const isDefault = model.id === defaultModelId;
                const mTest = modelTestStatus[model.id];
                const isTesting = testingModelId === model.id;
                const isEditing = editingModelId === model.id;
                return (
                  <div key={model.id} className="provider-model-item">
                    <div
                      className="provider-model-row"
                      data-testid="provider-model-row"
                    >
                      <span className="provider-model-id" title={model.id}>
                        {model.id}
                        {isDefault && (
                          <span className="provider-model-default">
                            {isChinese ? '默认' : 'Default'}
                          </span>
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
                        title={isChinese ? '编辑模型' : 'Edit model'}
                        onClick={() => setEditingModelId(isEditing ? null : model.id)}
                        disabled={saving}
                        data-testid={`provider-model-edit-${model.id}`}
                      >
                        <IconEdit width={12} height={12} />
                      </button>
                      <button
                        type="button"
                        className="provider-mini-btn"
                        title={isChinese ? '测试模型' : 'Test model'}
                        onClick={() => void handleTestModel(model.id)}
                        disabled={saving || isTesting}
                        data-testid={`provider-model-test-${model.id}`}
                      >
                        {isTesting ? (
                          <IconRefresh width={12} height={12} className="provider-spin" />
                        ) : (
                          <IconSpark width={12} height={12} />
                        )}
                      </button>
                      {!isDefault && draft.models.length > 0 && (
                        <button
                          type="button"
                          className="provider-mini-btn"
                          title={isChinese ? '设为默认' : 'Set default'}
                          onClick={() => void onSetDefaultModel(model.id)}
                          disabled={saving}
                          data-testid={`provider-model-default-${model.id}`}
                        >
                          ★
                        </button>
                      )}
                      <button
                        type="button"
                        className="provider-mini-btn"
                        onClick={() => removeModel(model.id)}
                        disabled={saving}
                        aria-label={common.delete}
                        data-testid={`provider-model-remove-${model.id}`}
                      >
                        <IconClose width={12} height={12} />
                      </button>
                    </div>
                    {isEditing && (
                      <ModelEditInline
                        model={model}
                        providerProtocol={draft.protocol}
                        disabled={saving}
                        isChinese={isChinese}
                        {...(searchCatalog ? { searchCatalog } : {})}
                        onSave={(modelDraft) => {
                          const nextModels = applyModelConfigurationDraft(
                            draft.models,
                            model.id,
                            modelDraft,
                          );
                          if (nextModels) onModelsChange(nextModels);
                          setEditingModelId(null);
                        }}
                        onCancel={() => setEditingModelId(null)}
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
              disabled={saving}
              data-testid="provider-add-model"
            >
              <IconPlus width={14} height={14} />
              {copy.addModel}
            </button>

            <button
              type="button"
              className={`provider-adv-head${advOpen ? ' provider-adv-head--open' : ''}`}
              onClick={() => setAdvOpen((v) => !v)}
              data-testid="provider-advanced-toggle"
            >
              <IconChevronRight width={13} height={13} />
              {copy.advanced}
            </button>
            {advOpen && (
              <div className="provider-adv-body" data-testid="provider-headers">
                <div className="provider-field-label">
                  <span>{copy.requestHeaders}</span>
                  <button
                    type="button"
                    className="provider-linkbtn"
                    onClick={handleAddHeader}
                    disabled={saving}
                    data-testid="provider-header-add"
                  >
                    + {copy.addHeader}
                  </button>
                </div>
                {draft.headerRows.length === 0 && (
                  <div className="provider-field-hint">{copy.requestHeadersHint}</div>
                )}
                {draft.headerRows.map((row) => (
                  <div key={row.id} className="provider-header-row">
                    <TextInput
                      value={row.name}
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          headerRows: draft.headerRows.map((item) =>
                            item.id === row.id
                              ? { ...item, name: event.currentTarget.value }
                              : item,
                          ),
                        })
                      }
                      placeholder={copy.headerName}
                      spellCheck={false}
                      testId="provider-header-name"
                      disabled={saving}
                    />
                    <TextInput
                      value={row.value}
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          headerRows: draft.headerRows.map((item) =>
                            item.id === row.id
                              ? { ...item, value: event.currentTarget.value }
                              : item,
                          ),
                        })
                      }
                      placeholder={copy.headerValue}
                      spellCheck={false}
                      testId="provider-header-value"
                      disabled={saving}
                    />
                    <IconButton
                      label={common.delete}
                      onClick={() =>
                        onDraftChange({
                          ...draft,
                          headerRows: draft.headerRows.filter((item) => item.id !== row.id),
                        })
                      }
                      disabled={saving}
                    >
                      <IconClose width={12} height={12} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="provider-drawer-foot">
            {!isNew && (
              <Button
                variant="danger"
                size="compact"
                onClick={() => void onDelete()}
                disabled={saving}
                data-testid="provider-delete-btn"
              >
                {common.delete}
              </Button>
            )}
            <div style={{ flex: 1 }} />
            <Button
              size="compact"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
              data-testid="provider-cancel-btn"
            >
              {common.cancel}
            </Button>
            <Button
              size="compact"
              onClick={() => void onSave()}
              disabled={saving}
              data-testid="provider-save-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <IconCheck width={14} height={14} />
              {isNew ? copy.saveAndAdd : common.save}
            </Button>
          </div>
        </div>
      </div>

      <AddModelDialog
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        existingModelIds={draft.models.map((m) => m.id)}
        onAdd={(model) => {
          onModelsChange([...draft.models, model]);
          setAddModelOpen(false);
        }}
        {...(searchCatalog ? { searchCatalog } : {})}
      />

      <DiscoverModelsDialog
        open={discoverOpen}
        provider={draftToProvider(draft)}
        models={discoverModels}
        onOpenChange={setDiscoverOpen}
        onImport={(selected) => {
          onModelsChange(mergeDiscoveredModels(draft.models, selected));
          setDiscoverOpen(false);
        }}
      />
    </>
  );
}
