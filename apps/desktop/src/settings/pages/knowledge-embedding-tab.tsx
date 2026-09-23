/**
 * Knowledge Settings → Embedding Tab Panel.
 */
import type { ReactElement } from 'react';
import {
  PasswordInput,
  Select,
  Switch,
  TextInput,
} from '@piwin/ui-kit';
import {
  IconAlertCircle,
  IconCheckCircle,
  IconRefresh,
  IconSpark,
} from '../../shell-icons.js';
import { FieldRow } from '../field-row.js';
import { PageTitle } from '../page-title.js';
import {
  DEFAULT_EMBEDDING_API_KEY_ENV,
  DEFAULT_OLLAMA_EMBEDDING_URL,
  DEFAULT_OPENAI_EMBEDDING_URL,
  type KnowledgeEmbeddingDraft,
  type KnowledgeEmbeddingProviderKind,
} from '../knowledge-embedding-draft.js';

export type TestStatus = {
  tone: 'ok' | 'err';
  message: string;
};

const PROVIDER_OPTIONS: Array<{
  value: KnowledgeEmbeddingProviderKind;
  labelEn: string;
  labelZh: string;
}> = [
  { value: 'openai-compatible', labelEn: 'OpenAI-compatible', labelZh: 'OpenAI 兼容接口' },
  { value: 'ollama', labelEn: 'Ollama', labelZh: 'Ollama' },
];

export type KnowledgeEmbeddingTabProps = {
  active: boolean;
  draft: KnowledgeEmbeddingDraft;
  patch: (partial: Partial<KnowledgeEmbeddingDraft>) => void;
  onProviderChange: (value: string) => void;
  onTest: () => void;
  testing: boolean;
  testStatus: TestStatus | null;
  saving: boolean;
  readOnly: boolean;
  isZh: boolean;
};

export function KnowledgeEmbeddingTab(props: KnowledgeEmbeddingTabProps): ReactElement {
  const { isZh, draft, patch } = props;
  const hasStoredKey = Boolean(draft.apiKeyRef);

  return (
    <div
      className={`knowledge-tab-panel ${props.active ? 'is-active' : 'is-hidden'}`}
      id="settings-section-embedding"
      data-testid="settings-knowledge-embedding"
    >
      <div className="knowledge-tab-panel-header">
        <PageTitle
          title={isZh ? '向量检索 (Embedding)' : 'Vector Embedding'}
          description={
            isZh
              ? '将 Markdown 文档与源码片段转化为向量进行语义检索。未启用时，笔记与知识库将无缝降级为 FTS5 关键词全文检索。'
              : 'Vectorize markdown documents and code snippets for semantic retrieval. If disabled, notes and knowledge bases will seamlessly use FTS5 keyword full-text search.'
          }
        />

        {draft.enabled ? (
          <div className="knowledge-tab-panel-header-actions">
            <button
              type="button"
              className="knowledge-test-btn"
              onClick={props.onTest}
              disabled={props.testing || props.saving || props.readOnly}
              data-testid="knowledge-embedding-test-btn"
            >
              {props.testing ? (
                <>
                  <IconRefresh className="spin" size={13} />
                  <span>{isZh ? '测试中…' : 'Testing…'}</span>
                </>
              ) : (
                <>
                  <IconSpark size={13} />
                  <span>{isZh ? '测试连接' : 'Test connection'}</span>
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {props.testStatus ? (
        <div
          className={`knowledge-test-result is-${props.testStatus.tone}`}
          data-testid="knowledge-embedding-test-result"
        >
          {props.testStatus.tone === 'ok' ? (
            <IconCheckCircle size={14} />
          ) : (
            <IconAlertCircle size={14} />
          )}
          <span>{props.testStatus.message}</span>
        </div>
      ) : null}

      <FieldRow
        label={isZh ? '启用向量检索' : 'Enable embedding'}
        description={
          isZh
            ? '关闭后笔记和知识库都只做全文检索，不调用向量模型。'
            : 'Off keeps notes and Doc Cards on full-text search only.'
        }
        testId="knowledge-embedding-enabled-row"
      >
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
          aria-label={isZh ? '启用 Embedding' : 'Enable embedding'}
          disabled={props.saving || props.readOnly}
          testId="knowledge-embedding-enabled"
        />
      </FieldRow>

      {draft.enabled ? (
        <>
          <FieldRow
            label={isZh ? '接口类型' : 'Provider Kind'}
            description={
              isZh
                ? '任意 OpenAI 兼容 /embeddings 端点，或本机 Ollama。'
                : 'Any OpenAI-compatible /embeddings endpoint, or local Ollama.'
            }
            testId="knowledge-embedding-provider-row"
          >
            <Select
              data={PROVIDER_OPTIONS.map((option) => ({
                value: option.value,
                label: isZh ? option.labelZh : option.labelEn,
              }))}
              value={draft.provider}
              onChange={(event) => props.onProviderChange(event.currentTarget.value)}
              disabled={props.saving || props.readOnly}
              testId="knowledge-embedding-provider"
            />
          </FieldRow>

          <FieldRow
            label="Base URL"
            description={
              isZh
                ? '例如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1。'
                : 'For example https://api.openai.com/v1 or http://127.0.0.1:11434/v1.'
            }
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
              disabled={props.saving || props.readOnly}
            />
          </FieldRow>

          <FieldRow
            label={isZh ? '模型 ID' : 'Model ID'}
            description={
              isZh
                ? '接口上的 embedding 模型名，例如 text-embedding-3-small 或 nomic-embed-text。'
                : 'The embedding model name on that endpoint, for example text-embedding-3-small or nomic-embed-text.'
            }
            testId="knowledge-embedding-model-row"
          >
            <TextInput
              testId="knowledge-embedding-model"
              value={draft.model}
              onChange={(event) => patch({ model: event.currentTarget.value })}
              placeholder={
                draft.provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'
              }
              disabled={props.saving || props.readOnly}
            />
          </FieldRow>

          <FieldRow
            label={isZh ? '向量维度（可选）' : 'Dimensions (optional)'}
            description={
              isZh
                ? '模型固定维度可留空。填了必须是正整数。'
                : 'Leave blank when the model has a fixed size. Must be a positive integer if set.'
            }
            testId="knowledge-embedding-dimension-row"
          >
            <TextInput
              testId="knowledge-embedding-dimension"
              type="number"
              min={1}
              value={draft.dimension}
              onChange={(event) => patch({ dimension: event.currentTarget.value })}
              placeholder={isZh ? '自动' : 'Auto'}
              disabled={props.saving || props.readOnly}
            />
          </FieldRow>

          <FieldRow
            label="API Key"
            description={
              hasStoredKey
                ? isZh
                  ? '已安全保存在 Host 密钥库。点击下方「保存知识配置」可更新。留空使用已有密钥。'
                  : 'Saved securely in Host secret store. Click "Save knowledge" to update. Leave blank to keep existing key.'
                : isZh
                  ? '密钥保存在 Host 密钥库，点击下方「保存知识配置」时自动同步。留空使用已有密钥。'
                  : 'Saved in Host secret store on "Save knowledge". Leave blank to keep existing key.'
            }
            testId="knowledge-embedding-secret-row"
          >
            <PasswordInput
              testId="knowledge-embedding-api-key"
              value={draft.apiKeyInput ?? ''}
              onChange={(event) => patch({ apiKeyInput: event.currentTarget.value })}
              placeholder={
                hasStoredKey
                  ? isZh
                    ? '留空使用已有密钥，输入新 Key 覆盖'
                    : 'Leave blank to keep existing key, or enter new key'
                  : isZh
                    ? '粘贴 API Key（本地 Ollama 可留空）'
                    : 'Paste API Key (optional for local Ollama)'
              }
              spellCheck={false}
              disabled={props.saving || props.readOnly}
            />
          </FieldRow>

          <details className="knowledge-advanced-disclosure">
            <summary className="knowledge-advanced-toggle">
              <span>{isZh ? '高级设置：环境变量回退' : 'Advanced: environment variable fallback'}</span>
            </summary>
            <FieldRow
              label={isZh ? 'API Key 环境变量名' : 'API Key env var'}
              description={
                isZh
                  ? 'Host 密钥库没有密钥时才读取该变量；这里只填变量名。'
                  : 'Used only when the Host secret store has no key. Enter variable name only.'
              }
              testId="knowledge-embedding-env-row"
            >
              <TextInput
                testId="knowledge-embedding-env"
                value={draft.apiKeyEnv}
                onChange={(event) => patch({ apiKeyEnv: event.currentTarget.value })}
                placeholder={DEFAULT_EMBEDDING_API_KEY_ENV}
                spellCheck={false}
                disabled={props.saving || props.readOnly}
              />
            </FieldRow>
          </details>
        </>
      ) : null}
    </div>
  );
}
