/**
 * Knowledge Settings → Document Parsers & Dedicated LLMs Tab Panels.
 */
import type { ReactElement } from 'react';
import { PasswordInput, Select, Switch, TextInput } from '@piwin/ui-kit';
import {
  IconAlertCircle,
  IconCheckCircle,
  IconRefresh,
  IconSpark,
} from '../../shell-icons.js';
import { FieldRow } from '../field-row.js';
import { PageTitle } from '../page-title.js';
import {
  DEFAULT_MINERU_API_KEY_ENV,
  DEFAULT_MINERU_URL,
  DEFAULT_UNSTRUCTURED_API_KEY_ENV,
  DEFAULT_UNSTRUCTURED_URL,
  type KnowledgeChatModelOption,
  type KnowledgeExtrasDraft,
} from '../knowledge-extras-draft.js';
import type { TestStatus } from './knowledge-embedding-tab.js';

export function KnowledgeParsersTab(props: {
  active: boolean;
  extras: KnowledgeExtrasDraft;
  patchExtras: (partial: Partial<KnowledgeExtrasDraft>) => void;
  isZh: boolean;
  onTestMineru: () => void;
  onTestUnstructured: () => void;
  testing: 'mineru' | 'unstructured' | null;
  mineruTestStatus: TestStatus | null;
  unstructuredTestStatus: TestStatus | null;
  saving: boolean;
  readOnly: boolean;
}): ReactElement {
  const { isZh, extras, patchExtras } = props;
  const bothEnabled = extras.mineruEnabled && extras.unstructuredEnabled;

  return (
    <div
      className={`knowledge-tab-panel ${props.active ? 'is-active' : 'is-hidden'}`}
      id="settings-section-parsers"
      data-testid="settings-knowledge-parsers"
    >
      <div className="knowledge-tab-panel-header">
        <PageTitle
          title={isZh ? '文档解析器' : 'Document Parsers'}
          description={
            isZh
              ? 'Markdown 与代码源码默认自动解析。PDF / Word / HTML 需要你自己的 MinerU 或 Unstructured HTTP 服务：填 Base URL，本地部署通常不用 Key。'
              : 'Markdown and source code are always scanned. PDF / Word / HTML need your MinerU or Unstructured HTTP service: set a Base URL. Local deployments usually need no API key.'
          }
        />
        {extras.mineruEnabled || extras.unstructuredEnabled ? (
          <div className="knowledge-parser-test-actions">
            {extras.mineruEnabled ? (
              <ParserTestButton
                testId="knowledge-mineru-test-btn"
                label={
                  bothEnabled
                    ? isZh
                      ? '测试 MinerU'
                      : 'Test MinerU'
                    : isZh
                      ? '测试连接'
                      : 'Test connection'
                }
                title={isZh ? '测试 MinerU 接口连通性' : 'Test MinerU connection'}
                testing={props.testing === 'mineru'}
                disabled={props.testing !== null || props.saving || props.readOnly}
                isZh={isZh}
                onClick={props.onTestMineru}
              />
            ) : null}
            {extras.unstructuredEnabled ? (
              <ParserTestButton
                testId="knowledge-unstructured-test-btn"
                label={
                  bothEnabled
                    ? isZh
                      ? '测试 Unstructured'
                      : 'Test Unstructured'
                    : isZh
                      ? '测试连接'
                      : 'Test connection'
                }
                title={isZh ? '测试 Unstructured 接口连通性' : 'Test Unstructured connection'}
                testing={props.testing === 'unstructured'}
                disabled={props.testing !== null || props.saving || props.readOnly}
                isZh={isZh}
                onClick={props.onTestUnstructured}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {props.mineruTestStatus ? (
        <ParserTestResult
          testId="knowledge-mineru-test-result"
          status={props.mineruTestStatus}
        />
      ) : null}
      {props.unstructuredTestStatus ? (
        <ParserTestResult
          testId="knowledge-unstructured-test-result"
          status={props.unstructuredTestStatus}
        />
      ) : null}
      <FieldRow
        label="MinerU (PDF)"
        description={
          isZh
            ? '启用后扫描 .pdf。piwin 不会内置 MinerU，请指向 mineru-api，例如 http://127.0.0.1:8000，索引时 POST /file_parse。'
            : 'When on, scans accept .pdf. piwin does not ship MinerU — point at mineru-api, for example http://127.0.0.1:8000. Indexing POSTs /file_parse.'
        }
        testId="knowledge-mineru-row"
      >
        <Switch
          checked={extras.mineruEnabled}
          onCheckedChange={(enabled) => patchExtras({ mineruEnabled: enabled })}
          aria-label="MinerU"
          testId="knowledge-mineru-enabled"
        />
      </FieldRow>
      {extras.mineruEnabled ? (
        <ParserEndpointFields
          testIdPrefix="knowledge-mineru"
          isZh={isZh}
          baseUrl={extras.mineruBaseUrl}
          apiKeyInput={extras.mineruApiKeyInput ?? ''}
          apiKeyRef={extras.mineruApiKeyRef}
          apiKeyEnv={extras.mineruApiKeyEnv}
          placeholderUrl={DEFAULT_MINERU_URL}
          envPlaceholder={DEFAULT_MINERU_API_KEY_ENV}
          urlDescription={
            isZh
              ? '本地或自建 mineru-api 根地址。官方云批次接口不走这里。'
              : 'Root URL of local or self-hosted mineru-api. The official cloud batch API is not this endpoint.'
          }
          keyPlaceholder={
            isZh ? '粘贴 API Key（本地可留空）' : 'Paste API key (optional locally)'
          }
          saving={props.saving}
          readOnly={props.readOnly}
          onUrl={(value) => patchExtras({ mineruBaseUrl: value })}
          onKey={(value) => patchExtras({ mineruApiKeyInput: value })}
          onEnv={(value) => patchExtras({ mineruApiKeyEnv: value })}
        />
      ) : null}
      <FieldRow
        label="Unstructured (Word / HTML)"
        description={
          isZh
            ? '启用后扫描 .doc / .docx / .html。指向 Unstructured API，例如 http://127.0.0.1:8000，索引时 POST /general/v0/general。'
            : 'When on, scans accept .doc / .docx / .html. Point at an Unstructured API, for example http://127.0.0.1:8000. Indexing POSTs /general/v0/general.'
        }
        testId="knowledge-unstructured-row"
      >
        <Switch
          checked={extras.unstructuredEnabled}
          onCheckedChange={(enabled) => patchExtras({ unstructuredEnabled: enabled })}
          aria-label="Unstructured"
          testId="knowledge-unstructured-enabled"
        />
      </FieldRow>
      {extras.unstructuredEnabled ? (
        <ParserEndpointFields
          testIdPrefix="knowledge-unstructured"
          isZh={isZh}
          baseUrl={extras.unstructuredBaseUrl}
          apiKeyInput={extras.unstructuredApiKeyInput ?? ''}
          apiKeyRef={extras.unstructuredApiKeyRef}
          apiKeyEnv={extras.unstructuredApiKeyEnv}
          placeholderUrl={DEFAULT_UNSTRUCTURED_URL}
          envPlaceholder={DEFAULT_UNSTRUCTURED_API_KEY_ENV}
          urlDescription={
            isZh
              ? 'Unstructured API 根地址，自托管或官方兼容服务均可。'
              : 'Root URL of a self-hosted or official-compatible Unstructured API.'
          }
          keyPlaceholder={
            isZh ? '粘贴 API Key（本地可留空）' : 'Paste API key (optional locally)'
          }
          saving={props.saving}
          readOnly={props.readOnly}
          onUrl={(value) => patchExtras({ unstructuredBaseUrl: value })}
          onKey={(value) => patchExtras({ unstructuredApiKeyInput: value })}
          onEnv={(value) => patchExtras({ unstructuredApiKeyEnv: value })}
        />
      ) : null}
    </div>
  );
}

function ParserTestButton(props: {
  testId: string;
  label: string;
  title: string;
  testing: boolean;
  disabled: boolean;
  isZh: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="knowledge-test-btn"
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testId}
      title={props.title}
    >
      {props.testing ? (
        <>
          <IconRefresh width={13} height={13} className="knowledge-spin" />
          <span>{props.isZh ? '测试中…' : 'Testing…'}</span>
        </>
      ) : (
        <>
          <IconSpark width={13} height={13} />
          <span>{props.label}</span>
        </>
      )}
    </button>
  );
}

function ParserTestResult(props: { testId: string; status: TestStatus }): ReactElement {
  return (
    <div className={`knowledge-test-result is-${props.status.tone}`} data-testid={props.testId}>
      {props.status.tone === 'ok' ? (
        <IconCheckCircle width={14} height={14} />
      ) : (
        <IconAlertCircle width={14} height={14} />
      )}
      <span>{props.status.message}</span>
    </div>
  );
}

function ParserEndpointFields(props: {
  testIdPrefix: string;
  isZh: boolean;
  baseUrl: string;
  apiKeyInput: string;
  apiKeyRef: string;
  apiKeyEnv: string;
  placeholderUrl: string;
  envPlaceholder: string;
  urlDescription: string;
  keyPlaceholder: string;
  saving: boolean;
  readOnly: boolean;
  onUrl: (value: string) => void;
  onKey: (value: string) => void;
  onEnv: (value: string) => void;
}): ReactElement {
  const hasStoredKey = Boolean(props.apiKeyRef);
  return (
    <>
      <FieldRow
        label="Base URL"
        description={props.urlDescription}
        testId={`${props.testIdPrefix}-url-row`}
      >
        <TextInput
          testId={`${props.testIdPrefix}-base-url`}
          value={props.baseUrl}
          onChange={(event) => props.onUrl(event.currentTarget.value)}
          placeholder={props.placeholderUrl}
          spellCheck={false}
          disabled={props.saving || props.readOnly}
        />
      </FieldRow>
      <FieldRow
        label="API Key"
        description={
          props.isZh
            ? '密钥保存在 Host 密钥库，点击下方「保存知识配置」时同步。本地服务可留空。'
            : 'Stored in the Host secret store on save. Leave blank for local services, or to keep a saved key.'
        }
        testId={`${props.testIdPrefix}-api-key-row`}
      >
        <PasswordInput
          testId={`${props.testIdPrefix}-api-key`}
          value={props.apiKeyInput}
          onChange={(event) => props.onKey(event.currentTarget.value)}
          placeholder={hasStoredKey ? '••••••••' : props.keyPlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={props.saving || props.readOnly}
        />
      </FieldRow>
      <details className="knowledge-field-advanced">
        <summary>
          {props.isZh ? '高级设置：环境变量回退' : 'Advanced: environment variable fallback'}
        </summary>
        <FieldRow
          label={props.isZh ? '环境变量名' : 'Environment variable'}
          description={
            props.isZh
              ? 'Host 密钥库没有密钥时才读取该变量；这里只填变量名。'
              : 'Used only when the Host secret store has no key. Enter variable name only.'
          }
          testId={`${props.testIdPrefix}-env-row`}
        >
          <TextInput
            testId={`${props.testIdPrefix}-env`}
            value={props.apiKeyEnv}
            onChange={(event) => props.onEnv(event.currentTarget.value)}
            placeholder={props.envPlaceholder}
            spellCheck={false}
            disabled={props.saving || props.readOnly}
          />
        </FieldRow>
      </details>
    </>
  );
}

export function KnowledgeLlmsTab(props: {
  active: boolean;
  extras: KnowledgeExtrasDraft;
  patchExtras: (partial: Partial<KnowledgeExtrasDraft>) => void;
  chatModels: KnowledgeChatModelOption[];
  isZh: boolean;
}): ReactElement {
  const { isZh, extras, patchExtras, chatModels } = props;

  return (
    <div
      className={`knowledge-tab-panel ${props.active ? 'is-active' : 'is-hidden'}`}
      id="settings-section-llms"
      data-testid="settings-knowledge-llms"
    >
      <PageTitle
        title={isZh ? '专用生成模型' : 'Dedicated Generation Models'}
        description={
          isZh
            ? '抽取知识要点和编写原子闪卡可以分别指定专用模型。留空时默认继承当前会话的主对话模型。'
            : 'Knowledge-point extraction and flashcard writing can use specialized chat models. Both default to the current active chat model if unspecified.'
        }
      />
      <FieldRow
        label={isZh ? '知识点抽取模型' : 'Extraction model'}
        description={
          isZh
            ? '用于提取结构化知识要点的专用模型。'
            : 'Dedicated model for knowledge graph extraction.'
        }
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
        label={isZh ? '闪卡生成模型' : 'Flashcard model'}
        description={
          isZh
            ? '用于编写原子记忆闪卡的专用模型。'
            : 'Dedicated model for flashcard question-answer cards.'
        }
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
  );
}
