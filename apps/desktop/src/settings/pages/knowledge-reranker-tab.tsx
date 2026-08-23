/**
 * Knowledge Settings → Reranker Tab Panel.
 */
import type { ReactElement } from 'react';
import {
  PasswordInput,
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
  DEFAULT_RERANKER_API_KEY_ENV,
  DEFAULT_RERANKER_URL,
  type KnowledgeExtrasDraft,
} from '../knowledge-extras-draft.js';
import type { TestStatus } from './knowledge-embedding-tab.js';

export type KnowledgeRerankerTabProps = {
  active: boolean;
  extras: KnowledgeExtrasDraft;
  patchExtras: (partial: Partial<KnowledgeExtrasDraft>) => void;
  onTest: () => void;
  testing: boolean;
  testStatus: TestStatus | null;
  saving: boolean;
  readOnly: boolean;
  isZh: boolean;
};

export function KnowledgeRerankerTab(props: KnowledgeRerankerTabProps): ReactElement {
  const { isZh, extras, patchExtras } = props;
  const hasStoredKey = Boolean(extras.rerankerApiKeyRef);

  return (
    <div
      className={`knowledge-tab-panel ${props.active ? 'is-active' : 'is-hidden'}`}
      id="settings-section-reranker"
      data-testid="settings-knowledge-reranker"
    >
      <div className="knowledge-tab-panel-header">
        <PageTitle
          title={isZh ? '二次重排 (Reranker)' : 'Precision Reranker'}
          description={
            isZh
              ? '可选。配上后检索会先混合召回候选切片，再使用重排模型二次打分。'
              : 'Optional cross-encoder ranking. When enabled, hybrid search retrieves top candidates, then reranks them for optimal precision.'
          }
        />
        {extras.rerankerEnabled ? (
          <button
            type="button"
            className="knowledge-test-btn"
            onClick={props.onTest}
            disabled={props.testing || props.saving || props.readOnly}
            data-testid="knowledge-reranker-test-btn"
            title={isZh ? '测试接口连通性' : 'Test connection'}
          >
            {props.testing ? (
              <>
                <IconRefresh width={13} height={13} className="knowledge-spin" />
                <span>{isZh ? '测试中…' : 'Testing…'}</span>
              </>
            ) : (
              <>
                <IconSpark width={13} height={13} />
                <span>{isZh ? '测试连接' : 'Test connection'}</span>
              </>
            )}
          </button>
        ) : null}
      </div>

      {props.testStatus ? (
        <div
          className={`knowledge-test-result is-${props.testStatus.tone}`}
          data-testid="knowledge-reranker-test-result"
        >
          {props.testStatus.tone === 'ok' ? (
            <IconCheckCircle width={14} height={14} />
          ) : (
            <IconAlertCircle width={14} height={14} />
          )}
          <span>{props.testStatus.message}</span>
        </div>
      ) : null}

      <FieldRow
        label={isZh ? '启用精准重排' : 'Enable reranker'}
        description={
          isZh
            ? '针对召回候选进行交叉编码二次打分增强。'
            : 'Cross-encoder secondary scoring for search candidates.'
        }
        testId="knowledge-reranker-enabled-row"
      >
        <Switch
          checked={extras.rerankerEnabled}
          onCheckedChange={(enabled) => patchExtras({ rerankerEnabled: enabled })}
          aria-label={isZh ? '启用 Reranker' : 'Enable reranker'}
          testId="knowledge-reranker-enabled"
        />
      </FieldRow>

      {extras.rerankerEnabled ? (
        <>
          <FieldRow
            label="Base URL"
            description={
              isZh
                ? '任意 OpenAI 兼容 /rerank 或 /v1/rerank 端点，例如 https://api.openai.com/v1。'
                : 'Any OpenAI-compatible /rerank or /v1/rerank endpoint, for example https://api.openai.com/v1.'
            }
            testId="knowledge-reranker-url-row"
          >
            <TextInput
              testId="knowledge-reranker-base-url"
              value={extras.rerankerBaseUrl}
              onChange={(event) => patchExtras({ rerankerBaseUrl: event.currentTarget.value })}
              placeholder={DEFAULT_RERANKER_URL}
            />
          </FieldRow>
          <FieldRow
            label={isZh ? '模型 ID' : 'Model ID'}
            description={
              isZh
                ? '例如 rerank-english-v3.0 或 BAAI/bge-reranker-v2-m3。'
                : 'For example rerank-english-v3.0 or BAAI/bge-reranker-v2-m3.'
            }
            testId="knowledge-reranker-model-row"
          >
            <TextInput
              testId="knowledge-reranker-model"
              value={extras.rerankerModel}
              onChange={(event) => patchExtras({ rerankerModel: event.currentTarget.value })}
              placeholder="rerank-english-v3.0"
            />
          </FieldRow>
          <FieldRow
            label="API Key"
            description={
              isZh
                ? '密钥保存在 Host 密钥库，点击下方「保存知识配置」时自动同步。留空使用已有密钥。'
                : 'Key is stored in Host secret store and automatically synced on save. Leave blank to keep saved key.'
            }
            testId="knowledge-reranker-api-key-row"
          >
            <PasswordInput
              testId="knowledge-reranker-api-key"
              value={extras.rerankerApiKeyInput ?? ''}
              onChange={(event) => patchExtras({ rerankerApiKeyInput: event.currentTarget.value })}
              placeholder={
                hasStoredKey
                  ? '••••••••'
                  : isZh
                    ? '粘贴 Reranker API Key'
                    : 'Paste Reranker API key'
              }
              autoComplete="off"
              spellCheck={false}
              disabled={props.saving || props.readOnly}
            />
          </FieldRow>
          <details className="knowledge-field-advanced">
            <summary>
              {isZh ? '高级设置：环境变量回退' : 'Advanced: environment variable fallback'}
            </summary>
            <FieldRow
              label={isZh ? '环境变量名' : 'Environment variable'}
              description={
                isZh
                  ? 'Host 密钥库没有密钥时才读取该变量；这里只填变量名。'
                  : 'Used only when the Host secret store has no key. Enter variable name only.'
              }
              testId="knowledge-reranker-env-row"
            >
              <TextInput
                testId="knowledge-reranker-env"
                value={extras.rerankerApiKeyEnv}
                onChange={(event) => patchExtras({ rerankerApiKeyEnv: event.currentTarget.value })}
                placeholder={DEFAULT_RERANKER_API_KEY_ENV}
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
