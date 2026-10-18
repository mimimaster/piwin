/**
 * Settings → Code search engine choice: three tiles, one decision, and only
 * the selected engine's setup underneath. Each tile carries its own readiness
 * so the user can compare options without opening them.
 */
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { CodeSearchConfig, ModelRef } from '@piwin/contracts';
import { Button, Field, Select } from '@piwin/ui-kit';

import {
  DEFAULT_WINDSURF_KEY_ENV,
  DEVIN_ACCOUNT_REF,
  WINDSURF_SECRET_ID,
  codeSearchEngine,
  hasStoredWindsurfToken,
  type CodeSearchEngine,
} from './code-search-engine.js';
import { DevinAccountRow } from './devin-account-row.js';
import type { DevinAccountView } from './use-devin-account.js';
import { WebSecretEditor } from './web-secret-editor.js';

export type CodeSearchModelOption = {
  ref: ModelRef;
  label: string;
};

type TestResult = { durationMs: number; resultCount: number };
type TestInput = { apiKey?: string; apiKeyRef?: string; apiKeyEnv?: string };
type ReadinessTone = 'ok' | 'idle' | 'busy' | 'warn';

const ENGINE_ORDER: readonly CodeSearchEngine[] = ['devin', 'model', 'token'];

function modelValue(ref: ModelRef): string {
  return `${ref.providerId}/${ref.modelId}`;
}

type EngineCopy = { name: string; tag?: string; description: string };

function engineCopy(engine: CodeSearchEngine, zh: boolean): EngineCopy {
  switch (engine) {
    case 'devin':
      return {
        name: zh ? 'Devin 账号' : 'Devin account',
        tag: zh ? '免费' : 'Free',
        description: zh ? '复用已登录的 Devin，无需额外配置' : 'Reuses your Devin sign-in, nothing else to set up',
      };
    case 'model':
      return {
        name: zh ? '自有模型' : 'Your model',
        description: zh ? '用已配置的聊天模型规划搜索' : 'A configured chat model plans each round',
      };
    case 'token':
    default:
      return {
        name: 'Windsurf Token',
        description: zh ? '手动粘贴令牌，适合未登录 Devin' : 'Paste a token when Devin is not signed in',
      };
  }
}

function engineReadiness(
  engine: CodeSearchEngine,
  props: { draft: CodeSearchConfig; account: DevinAccountView; modelOptions: CodeSearchModelOption[]; zh: boolean },
): { tone: ReadinessTone; label: string } {
  const { zh } = props;
  if (engine === 'devin') {
    if (props.account.connected) return { tone: 'ok', label: zh ? '已连接' : 'Connected' };
    if (props.account.state === 'unknown') return { tone: 'idle', label: zh ? '读取中…' : 'Checking…' };
    if (props.account.state === 'logging-in') return { tone: 'busy', label: zh ? '授权中…' : 'Signing in…' };
    return { tone: 'warn', label: zh ? '未连接' : 'Not connected' };
  }
  if (engine === 'model') {
    if (props.modelOptions.length === 0) return { tone: 'warn', label: zh ? '暂无可用模型' : 'No models yet' };
    const picked = props.draft.model;
    const found = picked
      ? props.modelOptions.find((option) => modelValue(option.ref) === modelValue(picked))
      : undefined;
    return { tone: 'ok', label: found?.label ?? (zh ? '跟随默认聊天模型' : 'Default chat model') };
  }
  return hasStoredWindsurfToken(props.draft)
    ? { tone: 'ok', label: zh ? '已保存' : 'Saved' }
    : { tone: 'idle', label: zh ? '未设置' : 'Not set' };
}

export type CodeSearchEnginePickerProps = {
  draft: CodeSearchConfig;
  zh: boolean;
  readOnly: boolean;
  account: DevinAccountView;
  modelOptions: CodeSearchModelOption[];
  onSelectEngine: (engine: CodeSearchEngine) => void;
  onSelectModel: (model: ModelRef | undefined) => void;
  loadSecret: (providerId: string) => Promise<string | null>;
  storeSecret: (providerId: string, secret: string) => Promise<string>;
  testConnection?: (input: TestInput) => Promise<TestResult>;
  onTokenSaved: (apiKeyRef: string, apiKeyEnv: string) => Promise<boolean>;
};

export function CodeSearchEnginePicker(props: CodeSearchEnginePickerProps): ReactElement {
  const { draft, zh } = props;
  const engine = codeSearchEngine(draft);
  const tileRefs = useRef(new Map<CodeSearchEngine, HTMLButtonElement>());

  /** Arrow keys move the selection like a native radio group. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || props.readOnly) return;
    event.preventDefault();
    const index = ENGINE_ORDER.indexOf(engine);
    const next = ENGINE_ORDER[(index + step + ENGINE_ORDER.length) % ENGINE_ORDER.length];
    if (!next) return;
    props.onSelectEngine(next);
    tileRefs.current.get(next)?.focus();
  }

  return (
    <div className="code-search-engine-picker">
      <div
        className="code-search-engines"
        role="radiogroup"
        aria-label={zh ? '搜索引擎' : 'Search engine'}
        data-testid="code-search-engines"
        onKeyDown={handleKeyDown}
      >
        {ENGINE_ORDER.map((option) => {
          const copy = engineCopy(option, zh);
          const readiness = engineReadiness(option, props);
          const selected = option === engine;
          return (
            <button
              key={option}
              ref={(node) => {
                if (node) tileRefs.current.set(option, node);
                else tileRefs.current.delete(option);
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={props.readOnly}
              className={selected ? 'code-search-engine is-selected' : 'code-search-engine'}
              data-testid={`code-search-engine-${option}`}
              onClick={() => {
                if (!selected) props.onSelectEngine(option);
              }}
            >
              <span className="code-search-engine-head">
                <span className="code-search-engine-name">{copy.name}</span>
                {copy.tag ? <span className="code-search-engine-tag">{copy.tag}</span> : null}
                <span className="code-search-engine-check" aria-hidden="true" />
              </span>
              <span className="code-search-engine-desc">{copy.description}</span>
              <span className="code-search-engine-state" data-tone={readiness.tone}>
                <i aria-hidden="true" />
                <span>{readiness.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="code-search-engine-detail" data-engine={engine}>
        {engine === 'devin' ? (
          <DevinEngineSetup
            zh={zh}
            account={props.account}
            readOnly={props.readOnly}
            {...(props.testConnection ? { testConnection: props.testConnection } : {})}
          />
        ) : engine === 'model' ? (
          <Field
            label={zh ? '搜索模型' : 'Search model'}
            description={
              zh
                ? '每轮只做规划，延迟低、吞吐快的模型体验最好。'
                : 'It only plans each round, so a low-latency, high-throughput model feels best.'
            }
            className="code-search-model-field"
          >
            <Select
              value={draft.model ? modelValue(draft.model) : ''}
              onChange={(event) => {
                const found = props.modelOptions.find(
                  (option) => modelValue(option.ref) === event.currentTarget.value,
                );
                props.onSelectModel(found?.ref);
              }}
              data={[
                { value: '', label: zh ? '跟随默认聊天模型' : 'Default chat model' },
                ...props.modelOptions.map((option) => ({ value: modelValue(option.ref), label: option.label })),
              ]}
              disabled={props.readOnly}
              aria-label={zh ? '搜索模型' : 'Search model'}
              testId="code-search-model"
            />
          </Field>
        ) : (
          <WebSecretEditor
            secretId={WINDSURF_SECRET_ID}
            apiKeyRef={hasStoredWindsurfToken(draft) ? (draft.apiKeyRef ?? '') : ''}
            apiKeyEnv={draft.apiKeyEnv ?? ''}
            defaultApiKeyEnv={DEFAULT_WINDSURF_KEY_ENV}
            disabled={props.readOnly}
            zh={zh}
            loadSecret={props.loadSecret}
            storeSecret={props.storeSecret}
            testConnection={async (input) => {
              if (!props.testConnection) {
                throw new Error(
                  zh
                    ? '当前客户端不支持 code_search 连通测试，请更新 Desktop。'
                    : 'This client cannot test code_search connectivity. Update Desktop.',
                );
              }
              return props.testConnection({
                ...(input?.apiKey ? { apiKey: input.apiKey } : {}),
                ...(hasStoredWindsurfToken(draft) && draft.apiKeyRef ? { apiKeyRef: draft.apiKeyRef } : {}),
                ...(draft.apiKeyEnv ? { apiKeyEnv: draft.apiKeyEnv } : {}),
              });
            }}
            onSaved={props.onTokenSaved}
            testId="code-search-windsurf-token"
          />
        )}
      </div>
    </div>
  );
}

function DevinEngineSetup(props: {
  zh: boolean;
  account: DevinAccountView;
  readOnly: boolean;
  testConnection?: (input: { apiKeyRef?: string }) => Promise<TestResult>;
}): ReactElement {
  const { zh, account } = props;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const testConnection = props.testConnection;

  return (
    <div className="devin-credential" data-testid="code-search-devin-credential">
      <DevinAccountRow account={account} zh={zh} disabled={props.readOnly} testId="code-search-devin-account" />
      <div className="devin-credential-actions">
        <p className="devin-credential-hint">
          {zh
            ? '令牌只存在 Host 的 OAuth 登录里；退出 Devin 后 code_search 自动停用。'
            : 'The token stays in the Host OAuth sign-in; signing out of Devin turns code_search off.'}
        </p>
        {account.connected && testConnection ? (
          <Button
            variant="ghost"
            size="compact"
            disabled={testing}
            data-testid="code-search-devin-test"
            onClick={() => {
              setTesting(true);
              setResult(null);
              void testConnection({ apiKeyRef: DEVIN_ACCOUNT_REF })
                .then((outcome) =>
                  setResult({
                    ok: true,
                    message: zh
                      ? `连接正常 · ${outcome.resultCount} 条 · ${outcome.durationMs}ms`
                      : `Working · ${outcome.resultCount} results · ${outcome.durationMs}ms`,
                  }),
                )
                .catch((error: unknown) =>
                  setResult({
                    ok: false,
                    message: error instanceof Error ? error.message : zh ? '连接测试失败' : 'Test failed',
                  }),
                )
                .finally(() => setTesting(false));
            }}
          >
            {testing ? (zh ? '检测中…' : 'Testing…') : zh ? '测试连接' : 'Test connection'}
          </Button>
        ) : null}
      </div>
      {result ? (
        <span
          className={result.ok ? 'web-secret-test-result is-success' : 'web-secret-test-result is-error'}
          data-testid="code-search-devin-test-result"
        >
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
