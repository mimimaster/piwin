/**
 * Settings → Knowledge & RAG Capabilities Workspace.
 * Models-page inspired two-column workspace with capability metrics, status beacons, and tab navigation.
 */
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Button, Notice, SegmentedControl, Select, StatusBadge, Switch, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context.js';
import { FieldRow } from '../field-row.js';
import { PageTitle } from '../page-title.js';
import { useSettings } from '../settings-context.js';
import { WebSecretEditor } from '../web-secret-editor.js';
import { WebPage } from './web-page.js';
import {
  DEFAULT_EMBEDDING_API_KEY_ENV,
  DEFAULT_OLLAMA_EMBEDDING_URL,
  DEFAULT_OPENAI_EMBEDDING_URL,
  NOTES_EMBEDDING_SECRET_ID,
  applyKnowledgeEmbedding,
  knowledgeEmbeddingDirty,
  knowledgeEmbeddingFromConfig,
  validateKnowledgeEmbeddingDraft,
  type KnowledgeEmbeddingDraft,
  type KnowledgeEmbeddingProviderKind,
} from '../knowledge-embedding-draft.js';
import {
  DEFAULT_RERANKER_API_KEY_ENV,
  KNOWLEDGE_RERANKER_SECRET_ID,
  applyKnowledgeExtras,
  knowledgeChatModelOptions,
  knowledgeExtrasDirty,
  knowledgeExtrasFromConfig,
  validateKnowledgeExtrasDraft,
  type KnowledgeExtrasDraft,
} from '../knowledge-extras-draft.js';

export type KnowledgeTab = 'embedding' | 'reranker' | 'parsers' | 'llms';

const PROVIDER_OPTIONS: Array<{
  value: KnowledgeEmbeddingProviderKind;
  labelEn: string;
  labelZh: string;
}> = [
  { value: 'openai-compatible', labelEn: 'OpenAI-compatible', labelZh: 'OpenAI 兼容接口' },
  { value: 'ollama', labelEn: 'Ollama', labelZh: 'Ollama' },
];

function KnowledgeBaseWorkspace(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const {
    config,
    saving,
    saveConfig,
    setError,
    setInfo,
    storeProviderSecret,
    loadProviderSecret,
  } = useSettings();

  const [activeTab, setActiveTab] = useState<KnowledgeTab>('embedding');

  const saved = useMemo(() => knowledgeEmbeddingFromConfig(config), [config]);
  const savedExtras = useMemo(() => knowledgeExtrasFromConfig(config), [config]);
  const chatModels = useMemo(() => knowledgeChatModelOptions(config), [config]);
  const [draft, setDraft] = useState<KnowledgeEmbeddingDraft>(saved);
  const [extras, setExtras] = useState<KnowledgeExtrasDraft>(savedExtras);

  useEffect(() => {
    setDraft(saved);
    setExtras(savedExtras);
  }, [saved, savedExtras]);

  const dirty = knowledgeEmbeddingDirty(draft, saved) || knowledgeExtrasDirty(extras, savedExtras);
  const validation = validateKnowledgeEmbeddingDraft(draft) ?? validateKnowledgeExtrasDraft(extras);
  const validationMessage = validationMessageFor(validation, isZh);

  const patch = (partial: Partial<KnowledgeEmbeddingDraft>): void => {
    setDraft((current) => ({ ...current, ...partial }));
  };
  const patchExtras = (partial: Partial<KnowledgeExtrasDraft>): void => {
    setExtras((current) => ({ ...current, ...partial }));
  };

  const handleProviderChange = (value: string): void => {
    const provider: KnowledgeEmbeddingProviderKind =
      value === 'ollama' ? 'ollama' : 'openai-compatible';
    const next: Partial<KnowledgeEmbeddingDraft> = { provider };
    if (provider === 'ollama' && draft.baseUrl.trim().length === 0) {
      next.baseUrl = DEFAULT_OLLAMA_EMBEDDING_URL;
    }
    if (provider === 'openai-compatible' && draft.baseUrl === DEFAULT_OLLAMA_EMBEDDING_URL) {
      next.baseUrl = DEFAULT_OPENAI_EMBEDDING_URL;
    }
    patch(next);
  };

  const isEmbeddingReady = draft.enabled && draft.model.trim().length > 0;
  const isRerankerReady = extras.rerankerEnabled && extras.rerankerModel.trim().length > 0;

  const handleSave = async (): Promise<void> => {
    if (!config) return;
    if (validation) {
      setError(validationMessage);
      return;
    }
    const next = applyKnowledgeExtras(applyKnowledgeEmbedding(config, draft), extras);
    if (await saveConfig(next)) {
      setError(null);
      setInfo(
        isZh
          ? '已保存知识库配置。向量检索、解析器和 Reranker 会在下次索引与检索时生效。'
          : 'Knowledge settings saved. Embedding, parsers, and reranker apply on the next index or retrieve.',
        'success',
      );
    }
  };

  return (
    <div className="knowledge-workspace-page" data-testid="settings-knowledge">
      <section className="knowledge-management">
        {/* Intro Row */}
        <div className="knowledge-workspace-intro">
          <p>
            {t(
              'Configure vector embedding, reranker, document parsers, and dedicated models. All capabilities share the same knowledge index. Falls back to full-text search when unconfigured.',
              '配置向量嵌入 (Embedding)、精准重排 (Reranker)、文档解析器与专用模型。所有能力共用同一套知识索引体系。未配置向量时无缝降级为全文检索。',
            )}
          </p>
          <StatusBadge
            tone={isEmbeddingReady ? 'success' : 'warning'}
            label={isEmbeddingReady ? t('Vector Ready', '向量检索就绪') : t('FTS Fallback', '全文检索降级')}
            testId="knowledge-workspace-health"
          />
        </div>

        {/* Overview Metrics Cards */}
        <div className="knowledge-workspace-overview" data-testid="knowledge-capabilities-overview">
          <KnowledgeMetric
            label={t('Embedding Search', '向量模型')}
            value={isEmbeddingReady ? draft.model : t('Unconfigured', '未配置')}
            detail={
              draft.enabled
                ? draft.provider === 'ollama'
                  ? 'Ollama'
                  : 'OpenAI-compatible'
                : t('FTS5 Full-text fallback', 'FTS5 全文检索降级')
            }
            statusTone={isEmbeddingReady ? 'green' : 'amber'}
            onClick={() => setActiveTab('embedding')}
            compact
          />
          <KnowledgeMetric
            label={t('Reranker Model', '重排模型')}
            value={isRerankerReady ? extras.rerankerModel : t('Disabled', '未开启')}
            detail={extras.rerankerEnabled ? 'Cross-Encoder' : t('Optional booster', '可选增强')}
            statusTone={isRerankerReady ? 'green' : 'gray'}
            onClick={() => setActiveTab('reranker')}
            compact
          />
          <KnowledgeMetric
            label={t('Document Parsers', '文档解析')}
            value={extras.mineruEnabled ? 'MinerU' : t('Plain Text', '基础解析')}
            detail={extras.mineruEnabled ? t('PDF deep extraction', 'PDF 高精解析') : t('Code & Markdown', 'Markdown / 源码')}
            statusTone={extras.mineruEnabled ? 'green' : 'gray'}
            onClick={() => setActiveTab('parsers')}
            compact
          />
          <KnowledgeMetric
            label={t('Dedicated LLMs', '专用模型')}
            value={extras.flashcardModelKey || t('Default Model', '默认对话模型')}
            detail={t('Extraction & Flashcards', '知识抽取 + 闪卡制作')}
            statusTone="green"
            onClick={() => setActiveTab('llms')}
            compact
          />
        </div>

        {/* Two-Column Tabs Layout */}
        <div className="knowledge-workspace-tabs">
          {/* Left Column: Capability Nav List */}
          <div className="knowledge-workspace-nav" role="tablist" aria-label={t('Knowledge capabilities', '知识引擎能力')}>
            <KnowledgeNavItem
              active={activeTab === 'embedding'}
              kind="embedding"
              title={t('Vector Embedding', '向量检索 (Embedding)')}
              description={t('Semantic similarity & indexing', '语义向量匹配与代码索引')}
              defaultLabel={isEmbeddingReady ? draft.model : t('FTS fallback', '未配置 (全文降级)')}
              statusTone={isEmbeddingReady ? 'green' : 'amber'}
              onClick={() => setActiveTab('embedding')}
              testId="capability-card-embedding"
            />
            <KnowledgeNavItem
              active={activeTab === 'reranker'}
              kind="reranker"
              title={t('Precision Reranker', '精准重排 (Reranker)')}
              description={t('Cross-encoder reranking', '交叉编码二次打分增强')}
              defaultLabel={isRerankerReady ? extras.rerankerModel : t('Disabled (Optional)', '未开启 (可选)')}
              statusTone={isRerankerReady ? 'green' : 'gray'}
              onClick={() => setActiveTab('reranker')}
              testId="capability-card-reranker"
            />
            <KnowledgeNavItem
              active={activeTab === 'parsers'}
              kind="parsers"
              title={t('Document Parsers', '文档解析 (Parsers)')}
              description={t('PDF, Word & HTML parsing', 'PDF 与复杂版面抽取')}
              defaultLabel={extras.mineruEnabled ? 'MinerU (PDF)' : t('Disabled (Optional)', '未开启 (可选)')}
              statusTone={extras.mineruEnabled ? 'green' : 'gray'}
              onClick={() => setActiveTab('parsers')}
              testId="capability-card-mineru"
            />
            <KnowledgeNavItem
              active={activeTab === 'llms'}
              kind="llms"
              title={t('Dedicated Models', '专用模型 (LLMs)')}
              description={t('Extraction & flashcard authoring', '知识抽取与闪卡生成')}
              defaultLabel={extras.flashcardModelKey || t('Default chat model', '默认对话模型')}
              statusTone="green"
              onClick={() => setActiveTab('llms')}
              testId="capability-card-extraction"
            />
          </div>

          {/* Right Column: Active Tab Content Panel */}
          <div className="knowledge-workspace-content">
            {/* ── Tab 1: Embedding ─────────────────────────────────────────── */}
            <div
              className={`knowledge-tab-panel ${activeTab === 'embedding' ? 'is-active' : 'is-hidden'}`}
              id="settings-section-embedding"
              data-testid="settings-knowledge-embedding"
            >
              <PageTitle
                title={t('Vector Embedding', '向量检索 (Embedding)')}
                description={t(
                  'Vectorize markdown documents and code snippets for semantic retrieval. If disabled, notes and knowledge bases will seamlessly use FTS5 keyword full-text search.',
                  '将 Markdown 文档与源码片段转化为向量进行语义检索。未启用时，笔记与知识库将无缝降级为 FTS5 关键词全文检索。',
                )}
              />

              <FieldRow
                label={t('Enable embedding', '启用向量检索')}
                description={t(
                  'Off keeps notes and Doc Cards on full-text search only.',
                  '关闭后笔记和知识库都只做全文检索，不调用向量模型。',
                )}
                testId="knowledge-embedding-enabled-row"
              >
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => patch({ enabled })}
                  aria-label={isZh ? '启用 Embedding' : 'Enable embedding'}
                  testId="knowledge-embedding-enabled"
                />
              </FieldRow>

              <FieldRow
                label={t('Provider Kind', '接口类型')}
                description={t(
                  'Any OpenAI-compatible /embeddings endpoint, or local Ollama.',
                  '任意 OpenAI 兼容 /embeddings 端点，或本机 Ollama。',
                )}
                testId="knowledge-embedding-provider-row"
              >
                <Select
                  data={PROVIDER_OPTIONS.map((option) => ({
                    value: option.value,
                    label: isZh ? option.labelZh : option.labelEn,
                  }))}
                  value={draft.provider}
                  onChange={(event) => handleProviderChange(event.currentTarget.value)}
                  disabled={!draft.enabled}
                  testId="knowledge-embedding-provider"
                />
              </FieldRow>

              <FieldRow
                label="Base URL"
                description={t(
                  'For example https://api.openai.com/v1 or http://127.0.0.1:11434/v1.',
                  '例如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1。',
                )}
                testId="knowledge-embedding-url-row"
              >
                <TextInput
                  testId="knowledge-embedding-base-url"
                  value={draft.baseUrl}
                  onChange={(event) => patch({ baseUrl: event.currentTarget.value })}
                  placeholder={
                    draft.provider === 'ollama'
                      ? DEFAULT_OLLAMA_EMBEDDING_URL
                      : DEFAULT_OPENAI_EMBEDDING_URL
                  }
                  disabled={!draft.enabled}
                />
              </FieldRow>

              <FieldRow
                label={t('Model ID', '模型 ID')}
                description={t(
                  'The embedding model name on that endpoint, for example text-embedding-3-small or nomic-embed-text.',
                  '接口上的 embedding 模型名，例如 text-embedding-3-small 或 nomic-embed-text。',
                )}
                testId="knowledge-embedding-model-row"
              >
                <TextInput
                  testId="knowledge-embedding-model"
                  value={draft.model}
                  onChange={(event) => patch({ model: event.currentTarget.value })}
                  placeholder={
                    draft.provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'
                  }
                  disabled={!draft.enabled}
                />
              </FieldRow>

              <FieldRow
                label={t('Dimensions (optional)', '向量维度（可选）')}
                description={t(
                  'Leave blank when the model has a fixed size. Must be a positive integer if set.',
                  '模型固定维度可留空。填了必须是正整数。',
                )}
                testId="knowledge-embedding-dimension-row"
              >
                <TextInput
                  testId="knowledge-embedding-dimension"
                  type="number"
                  min={1}
                  value={draft.dimension}
                  onChange={(event) => patch({ dimension: event.currentTarget.value })}
                  placeholder={isZh ? '自动' : 'Auto'}
                  disabled={!draft.enabled}
                />
              </FieldRow>

              {draft.enabled ? (
                <div data-testid="knowledge-embedding-secret">
                  <WebSecretEditor
                    secretId={NOTES_EMBEDDING_SECRET_ID}
                    apiKeyRef={draft.apiKeyRef}
                    apiKeyEnv={draft.apiKeyEnv}
                    defaultApiKeyEnv={DEFAULT_EMBEDDING_API_KEY_ENV}
                    disabled={saving}
                    zh={isZh}
                    loadSecret={loadProviderSecret}
                    storeSecret={storeProviderSecret}
                    onSaved={async (apiKeyRef, apiKeyEnv) => {
                      if (!config) return false;
                      const nextDraft = { ...draft, apiKeyRef, apiKeyEnv };
                      setDraft(nextDraft);
                      return saveConfig(
                        applyKnowledgeExtras(applyKnowledgeEmbedding(config, nextDraft), extras),
                      );
                    }}
                    testId="knowledge-embedding-api-key"
                  />
                </div>
              ) : (
                <p className="muted" data-testid="knowledge-embedding-secret-idle">
                  {t(
                    'Local Ollama usually needs no key. Turn embedding on to store a remote API key.',
                    '本地 Ollama 通常不需要密钥。启用后再填远程接口的 API Key。',
                  )}
                </p>
              )}

              {validationMessage &&
              (validation === 'baseUrl' ||
                validation === 'model' ||
                validation === 'dimension' ||
                validation === 'apiKeyEnv') ? (
                <Notice tone="warning" testId="knowledge-embedding-validation">
                  {validationMessage}
                </Notice>
              ) : null}
            </div>

            {/* ── Tab 2: Reranker ─────────────────────────────────────────── */}
            <div
              className={`knowledge-tab-panel ${activeTab === 'reranker' ? 'is-active' : 'is-hidden'}`}
              id="settings-section-reranker"
              data-testid="settings-knowledge-reranker"
            >
              <PageTitle
                title={t('Precision Reranker', '二次重排 (Reranker)')}
                description={t(
                  'Optional cross-encoder ranking. When enabled, hybrid search retrieves top candidates, then reranks them for optimal precision.',
                  '可选。配上后检索会先混合召回候选切片，再使用重排模型二次打分。',
                )}
              />
              <FieldRow
                label={t('Enable reranker', '启用精准重排')}
                testId="knowledge-reranker-enabled-row"
              >
                <Switch
                  checked={extras.rerankerEnabled}
                  onCheckedChange={(enabled) => patchExtras({ rerankerEnabled: enabled })}
                  aria-label={isZh ? '启用 Reranker' : 'Enable reranker'}
                  testId="knowledge-reranker-enabled"
                />
              </FieldRow>
              <FieldRow label="Base URL" testId="knowledge-reranker-url-row">
                <TextInput
                  testId="knowledge-reranker-base-url"
                  value={extras.rerankerBaseUrl}
                  onChange={(event) => patchExtras({ rerankerBaseUrl: event.currentTarget.value })}
                  placeholder="https://router.tumuer.me/v1"
                  disabled={!extras.rerankerEnabled}
                />
              </FieldRow>
              <FieldRow
                label={t('Model ID', '模型 ID')}
                description={t(
                  'For example rerank-english-v3.0 or BAAI/bge-reranker-v2-m3.',
                  '例如 rerank-english-v3.0 或 BAAI/bge-reranker-v2-m3。',
                )}
                testId="knowledge-reranker-model-row"
              >
                <TextInput
                  testId="knowledge-reranker-model"
                  value={extras.rerankerModel}
                  onChange={(event) => patchExtras({ rerankerModel: event.currentTarget.value })}
                  placeholder="rerank-english-v3.0"
                  disabled={!extras.rerankerEnabled}
                />
              </FieldRow>
              {extras.rerankerEnabled ? (
                <WebSecretEditor
                  secretId={KNOWLEDGE_RERANKER_SECRET_ID}
                  apiKeyRef={extras.rerankerApiKeyRef}
                  apiKeyEnv={extras.rerankerApiKeyEnv}
                  defaultApiKeyEnv={DEFAULT_RERANKER_API_KEY_ENV}
                  disabled={saving}
                  zh={isZh}
                  loadSecret={loadProviderSecret}
                  storeSecret={storeProviderSecret}
                  onSaved={async (apiKeyRef, apiKeyEnv) => {
                    if (!config) return false;
                    const nextExtras = { ...extras, rerankerApiKeyRef: apiKeyRef, rerankerApiKeyEnv: apiKeyEnv };
                    setExtras(nextExtras);
                    return saveConfig(
                      applyKnowledgeExtras(applyKnowledgeEmbedding(config, draft), nextExtras),
                    );
                  }}
                  testId="knowledge-reranker-api-key"
                />
              ) : null}
            </div>

            {/* ── Tab 3: Document Parsers ─────────────────────────────────── */}
            <div
              className={`knowledge-tab-panel ${activeTab === 'parsers' ? 'is-active' : 'is-hidden'}`}
              id="settings-section-parsers"
              data-testid="settings-knowledge-parsers"
            >
              <PageTitle
                title={t('Document Parsers', '文档解析器')}
                description={t(
                  'Markdown and core source code are always scanned. Enable these to support structured PDF, Word, and HTML indexing.',
                  'Markdown 与代码源码默认自动解析。打开开关后，扫描目录会支持 PDF、Word 与 HTML 高精度抽取。',
                )}
              />
              <FieldRow
                label="MinerU (PDF)"
                description={t('When on, scans accept .pdf files.', '启用后扫描将接受 .pdf 文件并进行版面与公式解析。')}
                testId="knowledge-mineru-row"
              >
                <Switch
                  checked={extras.mineruEnabled}
                  onCheckedChange={(enabled) => patchExtras({ mineruEnabled: enabled })}
                  aria-label="MinerU"
                  testId="knowledge-mineru-enabled"
                />
              </FieldRow>
              <FieldRow
                label="Unstructured (Word / HTML)"
                description={t(
                  'When on, scans accept .doc, .docx, and .html.',
                  '启用后扫描将接受 .doc / .docx / .html。',
                )}
                testId="knowledge-unstructured-row"
              >
                <Switch
                  checked={extras.unstructuredEnabled}
                  onCheckedChange={(enabled) => patchExtras({ unstructuredEnabled: enabled })}
                  aria-label="Unstructured"
                  testId="knowledge-unstructured-enabled"
                />
              </FieldRow>
            </div>

            {/* ── Tab 4: Dedicated LLMs ───────────────────────────────────── */}
            <div
              className={`knowledge-tab-panel ${activeTab === 'llms' ? 'is-active' : 'is-hidden'}`}
              id="settings-section-llms"
              data-testid="settings-knowledge-llms"
            >
              <PageTitle
                title={t('Dedicated Generation Models', '专用生成模型')}
                description={t(
                  'Knowledge-point extraction and flashcard writing can use specialized chat models. Both default to the current active chat model if unspecified.',
                  '抽取知识要点和编写原子闪卡可以分别指定专用模型。留空时默认继承当前会话的主对话模型。',
                )}
              />
              <FieldRow
                label={t('Extraction model', '知识点抽取模型')}
                testId="knowledge-extraction-model-row"
              >
                <Select
                  data={[
                    { value: '', label: isZh ? '使用默认对话模型' : 'Use default chat model' },
                    ...chatModels.map((option) => ({ value: option.key, label: option.label })),
                  ]}
                  value={extras.extractionModelKey}
                  onChange={(event) => patchExtras({ extractionModelKey: event.currentTarget.value })}
                  testId="knowledge-extraction-model"
                />
              </FieldRow>
              <FieldRow
                label={t('Flashcard model', '闪卡生成模型')}
                testId="knowledge-flashcard-model-row"
              >
                <Select
                  data={[
                    { value: '', label: isZh ? '使用默认对话模型' : 'Use default chat model' },
                    ...chatModels.map((option) => ({ value: option.key, label: option.label })),
                  ]}
                  value={extras.flashcardModelKey}
                  onChange={(event) => patchExtras({ flashcardModelKey: event.currentTarget.value })}
                  testId="knowledge-flashcard-model"
                />
              </FieldRow>
            </div>

            {validationMessage ? (
              <Notice tone="warning" testId="knowledge-settings-validation">
                {validationMessage}
              </Notice>
            ) : null}

            <div className="settings-actions">
              <Button
                variant="primary"
                disabled={!config || saving || !dirty || validation !== null}
                onClick={() => void handleSave()}
                data-testid="knowledge-embedding-save"
              >
                {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存知识配置' : 'Save knowledge'}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function KnowledgeMetric(props: {
  label: string;
  value: string;
  detail: string;
  statusTone: 'green' | 'amber' | 'gray';
  onClick: () => void;
  compact?: boolean;
}): ReactElement {
  return (
    <div className="knowledge-workspace-metric" onClick={props.onClick} role="button" tabIndex={0}>
      <div className="knowledge-metric-top">
        <span className="knowledge-workspace-metric-label">{props.label}</span>
        <span className={`status-dot ${props.statusTone}`} />
      </div>
      <strong className={props.compact ? 'is-compact' : undefined} title={props.value}>
        {props.value}
      </strong>
      <small>{props.detail}</small>
    </div>
  );
}

function KnowledgeNavItem(props: {
  active: boolean;
  kind: KnowledgeTab;
  title: string;
  description: string;
  defaultLabel: string;
  statusTone: 'green' | 'amber' | 'gray';
  onClick: () => void;
  testId: string;
}): ReactElement {
  return (
    <button
      type="button"
      className={`knowledge-workspace-nav-item ${props.active ? 'is-active' : ''}`}
      onClick={props.onClick}
      data-testid={props.testId}
      role="tab"
      aria-selected={props.active}
    >
      <KnowledgeCapabilityIcon kind={props.kind} />
      <span className="knowledge-workspace-nav-copy">
        <span className="knowledge-workspace-nav-title">
          <strong>{props.title}</strong>
          <span className={`status-dot ${props.statusTone}`} />
        </span>
        <small>{props.description}</small>
        <em title={props.defaultLabel}>{props.defaultLabel}</em>
      </span>
    </button>
  );
}

function KnowledgeCapabilityIcon(props: { kind: KnowledgeTab }): ReactElement {
  const paths: Record<KnowledgeTab, ReactNode> = {
    embedding: (
      <>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </>
    ),
    reranker: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    parsers: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </>
    ),
    llms: (
      <>
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
      </>
    ),
  };
  return (
    <span className={`knowledge-workspace-nav-icon is-${props.kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65">
        {paths[props.kind]}
      </svg>
    </span>
  );
}

function validationMessageFor(code: string | null, isZh: boolean): string | null {
  if (code === 'baseUrl') {
    return isZh ? '请填写 Embedding 接口的 Base URL。' : 'Enter the embedding endpoint Base URL.';
  }
  if (code === 'model') {
    return isZh ? '请填写 Embedding 模型 ID。' : 'Enter the embedding model id.';
  }
  if (code === 'dimension') {
    return isZh ? '向量维度必须是正整数，或留空。' : 'Dimensions must be a positive integer, or blank.';
  }
  if (code === 'apiKeyEnv') {
    return isZh
      ? '环境变量名只能包含字母、数字和下划线。'
      : 'The environment variable name may only contain letters, digits, and underscores.';
  }
  if (code === 'rerankerBaseUrl') {
    return isZh ? '启用 Reranker 时请填写 Base URL。' : 'Enter a Base URL when the reranker is enabled.';
  }
  if (code === 'rerankerModel') {
    return isZh ? '启用 Reranker 时请填写模型 ID。' : 'Enter a model id when the reranker is enabled.';
  }
  return null;
}

export function KnowledgePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [hubTab, setHubTab] = useState<'knowledge' | 'search'>('knowledge');

  return (
    <div className="settings-card knowledge-hub-page" data-testid="settings-knowledge-hub">
      <div style={{ marginBottom: 16 }}>
        <SegmentedControl
          value={hubTab}
          onChange={(val) => setHubTab(val as 'knowledge' | 'search')}
          data={[
            { value: 'knowledge', label: isChinese ? '知识库与向量 (Knowledge & Embeddings)' : 'Knowledge & Embeddings' },
            { value: 'search', label: isChinese ? '网络搜索与抓取 (Web Search & Fetch)' : 'Web Search & Fetch' },
          ]}
          testId="knowledge-subtabs-control"
        />
      </div>

      {hubTab === 'knowledge' && <KnowledgeBaseWorkspace />}
      {hubTab === 'search' && <WebPage />}
    </div>
  );
}

