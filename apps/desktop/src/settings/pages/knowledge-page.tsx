/**
 * Settings → Knowledge & RAG Capabilities Workspace.
 * Models-page inspired two-column workspace with capability metrics, status beacons, and tab navigation.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, StatusBadge, Tabs } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';
import { useDesktopLocale } from '../../desktop-locale-context.js';
import { useSettings } from '../settings-context.js';
import {
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
  KNOWLEDGE_MINERU_SECRET_ID,
  KNOWLEDGE_RERANKER_SECRET_ID,
  KNOWLEDGE_UNSTRUCTURED_SECRET_ID,
  applyKnowledgeExtras,
  knowledgeChatModelOptions,
  knowledgeExtrasDirty,
  knowledgeExtrasFromConfig,
  validateKnowledgeExtrasDraft,
  type KnowledgeExtrasDraft,
} from '../knowledge-extras-draft.js';
import {
  testKnowledgeEmbedding,
  testKnowledgeParser,
  testKnowledgeReranker,
} from '../knowledge-test.js';
import { KnowledgeCapabilityIcon } from './knowledge-capability-icon.js';
import { WorkspaceSummary, WorkspaceTab, WorkspaceTabStrip } from '../settings-workspace-header.js';
import {
  KnowledgeEmbeddingTab,
  type TestStatus,
} from './knowledge-embedding-tab.js';
import { KnowledgeRerankerTab } from './knowledge-reranker-tab.js';
import {
  KnowledgeLlmsTab,
  KnowledgeParsersTab,
} from './knowledge-parsers-tab.js';

export type KnowledgeTab = 'embedding' | 'reranker' | 'parsers' | 'llms';

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
    remoteSettingsReadOnly,
  } = useSettings();

  const [activeTab, setActiveTab] = useState<KnowledgeTab>('embedding');

  const saved = useMemo(() => knowledgeEmbeddingFromConfig(config), [config]);
  const savedExtras = useMemo(() => knowledgeExtrasFromConfig(config), [config]);
  const chatModels = useMemo(() => knowledgeChatModelOptions(config), [config]);

  const [draft, setDraft] = useState<KnowledgeEmbeddingDraft>(saved);
  const [extras, setExtras] = useState<KnowledgeExtrasDraft>(savedExtras);

  const [testingTab, setTestingTab] = useState<
    'embedding' | 'reranker' | 'mineru' | 'unstructured' | null
  >(null);
  const [testStatuses, setTestStatuses] = useState<{
    embedding: TestStatus | null;
    reranker: TestStatus | null;
    mineru: TestStatus | null;
    unstructured: TestStatus | null;
  }>({ embedding: null, reranker: null, mineru: null, unstructured: null });

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
  const isMineruReady = extras.mineruEnabled && extras.mineruBaseUrl.trim().length > 0;
  const isUnstructuredReady =
    extras.unstructuredEnabled && extras.unstructuredBaseUrl.trim().length > 0;
  const isParserReady = isMineruReady || isUnstructuredReady;

  const handleTestEmbedding = async (): Promise<void> => {
    if (testingTab || saving) return;
    const baseUrl = draft.baseUrl.trim() || (draft.provider === 'ollama' ? DEFAULT_OLLAMA_EMBEDDING_URL : DEFAULT_OPENAI_EMBEDDING_URL);
    const model = draft.model.trim();
    if (!model) {
      setError(isZh ? '请先填写 Embedding 模型 ID。' : 'Please enter an embedding model ID first.');
      return;
    }

    setTestingTab('embedding');
    setError(null);
    try {
      let apiKey = draft.apiKeyInput?.trim();
      if (!apiKey && draft.apiKeyRef) {
        const loaded = await loadProviderSecret(NOTES_EMBEDDING_SECRET_ID);
        if (loaded) apiKey = loaded;
      }

      const result = await testKnowledgeEmbedding({
        provider: draft.provider,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });

      const message = isZh
        ? `连接成功 · ${result.durationMs}ms${result.dimension ? ` · 维度: ${result.dimension}` : ''}`
        : `Connected · ${result.durationMs}ms${result.dimension ? ` · dim: ${result.dimension}` : ''}`;

      setTestStatuses((prev) => ({
        ...prev,
        embedding: { tone: 'ok', message },
      }));
      setInfo(message, 'success');
    } catch (err) {
      const message = `${isZh ? '连接失败：' : 'Connection failed: '}${formatError(err)}`;
      setTestStatuses((prev) => ({
        ...prev,
        embedding: { tone: 'err', message },
      }));
      setError(message);
    } finally {
      setTestingTab(null);
    }
  };

  const handleTestReranker = async (): Promise<void> => {
    if (testingTab || saving) return;
    const baseUrl = extras.rerankerBaseUrl.trim();
    const model = extras.rerankerModel.trim();
    if (!baseUrl) {
      setError(isZh ? '请先填写 Reranker Base URL。' : 'Please enter a reranker Base URL first.');
      return;
    }
    if (!model) {
      setError(isZh ? '请先填写 Reranker 模型 ID。' : 'Please enter a reranker model ID first.');
      return;
    }

    setTestingTab('reranker');
    setError(null);
    try {
      let apiKey = extras.rerankerApiKeyInput?.trim();
      if (!apiKey && extras.rerankerApiKeyRef) {
        const loaded = await loadProviderSecret(KNOWLEDGE_RERANKER_SECRET_ID);
        if (loaded) apiKey = loaded;
      }

      const result = await testKnowledgeReranker({
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });

      const message = isZh
        ? `连接成功 · ${result.durationMs}ms`
        : `Connected · ${result.durationMs}ms`;

      setTestStatuses((prev) => ({
        ...prev,
        reranker: { tone: 'ok', message },
      }));
      setInfo(message, 'success');
    } catch (err) {
      const message = `${isZh ? '连接失败：' : 'Connection failed: '}${formatError(err)}`;
      setTestStatuses((prev) => ({
        ...prev,
        reranker: { tone: 'err', message },
      }));
      setError(message);
    } finally {
      setTestingTab(null);
    }
  };

  const handleTestParser = async (kind: 'mineru' | 'unstructured'): Promise<void> => {
    if (testingTab || saving) return;
    const baseUrl =
      kind === 'mineru' ? extras.mineruBaseUrl.trim() : extras.unstructuredBaseUrl.trim();
    const label = kind === 'mineru' ? 'MinerU' : 'Unstructured';
    if (!baseUrl) {
      setError(
        isZh ? `请先填写 ${label} Base URL。` : `Please enter a ${label} Base URL first.`,
      );
      return;
    }

    setTestingTab(kind);
    setError(null);
    try {
      let apiKey =
        kind === 'mineru'
          ? extras.mineruApiKeyInput?.trim()
          : extras.unstructuredApiKeyInput?.trim();
      if (!apiKey) {
        const secretId =
          kind === 'mineru' ? KNOWLEDGE_MINERU_SECRET_ID : KNOWLEDGE_UNSTRUCTURED_SECRET_ID;
        const loaded = await loadProviderSecret(secretId);
        if (loaded) apiKey = loaded;
      }

      const result = await testKnowledgeParser({
        kind,
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
      });
      const message = isZh
        ? `连接成功 · ${result.durationMs}ms`
        : `Connected · ${result.durationMs}ms`;
      setTestStatuses((prev) => ({ ...prev, [kind]: { tone: 'ok', message } }));
      setInfo(message, 'success');
    } catch (err) {
      const message = `${isZh ? '连接失败：' : 'Connection failed: '}${formatError(err)}`;
      setTestStatuses((prev) => ({ ...prev, [kind]: { tone: 'err', message } }));
      setError(message);
    } finally {
      setTestingTab(null);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!config) return;
    if (validation) {
      setError(
        validationMessage ??
          (isZh ? '请完善必填配置。' : 'Please complete the required configuration.'),
      );
      return;
    }

    let finalDraft = draft;
    let finalExtras = extras;

    const enteredEmbeddingKey = (draft.apiKeyInput ?? '').trim();
    if (enteredEmbeddingKey) {
      try {
        const apiKeyRef = await storeProviderSecret(
          NOTES_EMBEDDING_SECRET_ID,
          enteredEmbeddingKey,
        );
        finalDraft = {
          ...draft,
          apiKeyRef,
          apiKeyInput: '',
        };
        setDraft(finalDraft);
      } catch (err) {
        setError(
          isZh
            ? `保存 Embedding 密钥失败：${formatError(err)}`
            : `Failed to save embedding key: ${formatError(err)}`,
        );
        return;
      }
    }

    const enteredRerankerKey = (extras.rerankerApiKeyInput ?? '').trim();
    if (enteredRerankerKey) {
      try {
        const apiKeyRef = await storeProviderSecret(
          KNOWLEDGE_RERANKER_SECRET_ID,
          enteredRerankerKey,
        );
        finalExtras = {
          ...finalExtras,
          rerankerApiKeyRef: apiKeyRef,
          rerankerApiKeyInput: '',
        };
        setExtras(finalExtras);
      } catch (err) {
        setError(
          isZh
            ? `保存 Reranker 密钥失败：${formatError(err)}`
            : `Failed to save reranker key: ${formatError(err)}`,
        );
        return;
      }
    }

    const enteredMineruKey = (finalExtras.mineruApiKeyInput ?? '').trim();
    if (enteredMineruKey) {
      try {
        const apiKeyRef = await storeProviderSecret(KNOWLEDGE_MINERU_SECRET_ID, enteredMineruKey);
        finalExtras = {
          ...finalExtras,
          mineruApiKeyRef: apiKeyRef,
          mineruApiKeyInput: '',
        };
        setExtras(finalExtras);
      } catch (err) {
        setError(
          isZh
            ? `保存 MinerU 密钥失败：${formatError(err)}`
            : `Failed to save MinerU key: ${formatError(err)}`,
        );
        return;
      }
    }

    const enteredUnstructuredKey = (finalExtras.unstructuredApiKeyInput ?? '').trim();
    if (enteredUnstructuredKey) {
      try {
        const apiKeyRef = await storeProviderSecret(
          KNOWLEDGE_UNSTRUCTURED_SECRET_ID,
          enteredUnstructuredKey,
        );
        finalExtras = {
          ...finalExtras,
          unstructuredApiKeyRef: apiKeyRef,
          unstructuredApiKeyInput: '',
        };
        setExtras(finalExtras);
      } catch (err) {
        setError(
          isZh
            ? `保存 Unstructured 密钥失败：${formatError(err)}`
            : `Failed to save Unstructured key: ${formatError(err)}`,
        );
        return;
      }
    }

    const next = applyKnowledgeExtras(
      applyKnowledgeEmbedding(config, finalDraft),
      finalExtras,
    );

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
    <div className="knowledge-workspace-page settings-hub-page settings-workspace-page" data-testid="settings-knowledge">
      <section className="knowledge-management">
        <WorkspaceSummary
          testId="knowledge-capabilities-overview"
          readouts={[
            { value: `${[isEmbeddingReady, isRerankerReady, isParserReady, true].filter(Boolean).length}/4`, label: t('capabilities configured', '项能力已配置') },
            {
              value: isEmbeddingReady ? t('Vector', '向量') : t('Full-text', '全文'),
              label: t('retrieval', '检索'),
            },
          ]}
          actions={
            <StatusBadge
              tone={isEmbeddingReady ? 'success' : 'warning'}
              label={isEmbeddingReady ? t('Vector Ready', '向量检索就绪') : t('FTS Fallback', '全文检索模式')}
              testId="knowledge-workspace-health"
            />
          }
        />

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as KnowledgeTab)}
          className="settings-workspace"
          testId="knowledge-capability-tabs"
        >
          <WorkspaceTabStrip label={t('Knowledge capabilities', '知识引擎能力')}>
            <WorkspaceTab
              value="embedding"
              icon={<KnowledgeCapabilityIcon kind="embedding" />}
              title={t('Vector search', '向量检索')}
              hint={`${t('Semantic similarity & indexing', '语义向量匹配与代码索引')} · ${
                isEmbeddingReady ? draft.model : t('FTS fallback', '未配置（全文降级）')
              }`}
              tone={isEmbeddingReady ? 'ok' : 'warn'}
              testId="capability-card-embedding"
            />
            <WorkspaceTab
              value="reranker"
              icon={<KnowledgeCapabilityIcon kind="reranker" />}
              title={t('Reranker', '精准重排')}
              hint={`${t('Cross-encoder reranking', '交叉编码二次打分增强')} · ${
                isRerankerReady ? extras.rerankerModel : t('Disabled (optional)', '未开启（可选）')
              }`}
              tone={isRerankerReady ? 'ok' : 'off'}
              testId="capability-card-reranker"
            />
            <WorkspaceTab
              value="parsers"
              icon={<KnowledgeCapabilityIcon kind="parsers" />}
              title={t('Document parsers', '文档解析')}
              hint={`${t('PDF, Word & HTML parsing', 'PDF 与复杂版面抽取')} · ${
                isMineruReady
                  ? 'MinerU'
                  : isUnstructuredReady
                    ? 'Unstructured'
                    : t('Plain text only', '基础解析')
              }`}
              tone={isParserReady ? 'ok' : 'off'}
              testId="capability-card-mineru"
            />
            <WorkspaceTab
              value="llms"
              icon={<KnowledgeCapabilityIcon kind="llms" />}
              title={t('Dedicated models', '专用模型')}
              hint={`${t('Extraction & flashcard authoring', '知识抽取与闪卡生成')} · ${
                extras.flashcardModelKey || t('Default chat model', '默认对话模型')
              }`}
              tone="ok"
              testId="capability-card-extraction"
            />
          </WorkspaceTabStrip>

          <div className="knowledge-workspace-content settings-workspace-panel">
            <KnowledgeEmbeddingTab
              active={activeTab === 'embedding'}
              draft={draft}
              patch={patch}
              onProviderChange={handleProviderChange}
              onTest={() => void handleTestEmbedding()}
              testing={testingTab === 'embedding'}
              testStatus={testStatuses.embedding}
              saving={saving}
              readOnly={remoteSettingsReadOnly === true}
              isZh={isZh}
            />

            <KnowledgeRerankerTab
              active={activeTab === 'reranker'}
              extras={extras}
              patchExtras={patchExtras}
              onTest={() => void handleTestReranker()}
              testing={testingTab === 'reranker'}
              testStatus={testStatuses.reranker}
              saving={saving}
              readOnly={remoteSettingsReadOnly === true}
              isZh={isZh}
            />

            <KnowledgeParsersTab
              active={activeTab === 'parsers'}
              extras={extras}
              patchExtras={patchExtras}
              isZh={isZh}
              onTestMineru={() => void handleTestParser('mineru')}
              onTestUnstructured={() => void handleTestParser('unstructured')}
              testing={
                testingTab === 'mineru' || testingTab === 'unstructured' ? testingTab : null
              }
              mineruTestStatus={testStatuses.mineru}
              unstructuredTestStatus={testStatuses.unstructured}
              saving={saving}
              readOnly={remoteSettingsReadOnly === true}
            />

            <KnowledgeLlmsTab
              active={activeTab === 'llms'}
              extras={extras}
              patchExtras={patchExtras}
              chatModels={chatModels}
              isZh={isZh}
            />

            <div className="settings-actions">
              <Button
                variant="primary"
                disabled={!config || saving || !dirty}
                onClick={() => void handleSave()}
                data-testid="knowledge-embedding-save"
              >
                {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存知识配置' : 'Save knowledge'}
              </Button>
            </div>
          </div>
        </Tabs>
      </section>
    </div>
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
  if (code === 'mineruBaseUrl') {
    return isZh
      ? '启用 MinerU 时请填写解析服务的 Base URL。'
      : 'Enter a parser Base URL when MinerU is enabled.';
  }
  if (code === 'unstructuredBaseUrl') {
    return isZh
      ? '启用 Unstructured 时请填写解析服务的 Base URL。'
      : 'Enter a parser Base URL when Unstructured is enabled.';
  }
  return null;
}

export function KnowledgePage(): ReactElement {
  return <KnowledgeBaseWorkspace />;
}
