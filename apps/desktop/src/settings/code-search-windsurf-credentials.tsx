/**
 * Credentials for the Windsurf code_search backend.
 *
 * Two mutually exclusive sources, chosen explicitly: the Devin account the
 * user already signed into (`oauth:devin`, nothing stored twice), or a token
 * pasted by hand. Showing both at once made it impossible to tell which one a
 * session would actually use.
 */
import { useState, type ReactElement } from 'react';
import type { CodeSearchConfig } from '@piwin/contracts';
import { Button, SegmentedControl } from '@piwin/ui-kit';

import { DevinAccountRow } from './devin-account-row.js';
import { FieldRow } from './field-row.js';
import type { DevinAccountView } from './use-devin-account.js';
import { WebSecretEditor } from './web-secret-editor.js';

export const WINDSURF_SECRET_ID = 'code-search-windsurf';
export const DEFAULT_WINDSURF_KEY_ENV = 'WINDSURF_API_KEY';
export const DEVIN_ACCOUNT_REF = 'oauth:devin';

export type WindsurfCredentialSource = 'devin' | 'token';

/** An empty config also reuses the Devin account: that is the Host's default. */
export function windsurfCredentialSource(draft: CodeSearchConfig): WindsurfCredentialSource {
  const ref = draft.apiKeyRef?.trim();
  if (ref === DEVIN_ACCOUNT_REF) return 'devin';
  return ref || draft.apiKeyEnv?.trim() ? 'token' : 'devin';
}

type TestResult = { durationMs: number; resultCount: number };

export function CodeSearchWindsurfCredentials(props: {
  draft: CodeSearchConfig;
  zh: boolean;
  readOnly: boolean;
  account: DevinAccountView;
  onSelectSource: (source: WindsurfCredentialSource) => void;
  loadSecret: (providerId: string) => Promise<string | null>;
  storeSecret: (providerId: string, secret: string) => Promise<string>;
  testConnection?: (input: { apiKey?: string; apiKeyRef?: string; apiKeyEnv?: string }) => Promise<TestResult>;
  onTokenSaved: (apiKeyRef: string, apiKeyEnv: string) => Promise<boolean>;
}): ReactElement {
  const { draft, zh, account } = props;
  const source = windsurfCredentialSource(draft);

  return (
    <>
      <FieldRow
        label={zh ? '凭据来源' : 'Credentials'}
        description={
          zh
            ? 'Devin 账号直接复用 OAuth 登录的令牌；手动 Token 适合没有登录 Devin 的情况。'
            : 'The Devin account reuses your OAuth sign-in; a manual token is for when Devin is not signed in.'
        }
      >
        <SegmentedControl
          value={source}
          onChange={(value) => props.onSelectSource(value as WindsurfCredentialSource)}
          disabled={props.readOnly}
          data={[
            { value: 'devin', label: zh ? 'Devin 账号' : 'Devin account' },
            { value: 'token', label: zh ? '手动 Token' : 'Manual token' },
          ]}
          aria-label={zh ? '凭据来源' : 'Credentials'}
          testId="code-search-credential-source"
        />
      </FieldRow>

      {source === 'devin' ? (
        <DevinCredential
          zh={zh}
          account={account}
          readOnly={props.readOnly}
          {...(props.testConnection ? { testConnection: props.testConnection } : {})}
        />
      ) : (
        <WebSecretEditor
          secretId={WINDSURF_SECRET_ID}
          apiKeyRef={draft.apiKeyRef === DEVIN_ACCOUNT_REF ? '' : (draft.apiKeyRef ?? '')}
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
              ...(draft.apiKeyRef && draft.apiKeyRef !== DEVIN_ACCOUNT_REF
                ? { apiKeyRef: draft.apiKeyRef }
                : {}),
              ...(draft.apiKeyEnv ? { apiKeyEnv: draft.apiKeyEnv } : {}),
            });
          }}
          onSaved={props.onTokenSaved}
          testId="code-search-windsurf-token"
        />
      )}
    </>
  );
}

function DevinCredential(props: {
  zh: boolean;
  account: DevinAccountView;
  readOnly: boolean;
  testConnection?: (input: { apiKeyRef?: string }) => Promise<TestResult>;
}): ReactElement {
  const { zh, account } = props;
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const testConnection = props.testConnection;

  return (
    <div className="devin-credential" data-testid="code-search-devin-credential">
      <DevinAccountRow
        account={account}
        zh={zh}
        disabled={props.readOnly}
        testId="code-search-devin-account"
      />
      <p className="devin-credential-hint">
        {zh
          ? '令牌只保存在 Host 的 OAuth 登录里，这里不会再存一份；退出 Devin 后 code_search 会自动停用。'
          : 'The token lives only in the Host OAuth sign-in and is not stored again here; signing out of Devin turns code_search off.'}
      </p>
      {account.connected && testConnection ? (
        <div className="devin-credential-actions">
          <Button
            variant="ghost"
            size="compact"
            disabled={testing}
            data-testid="code-search-devin-test"
            onClick={() => {
              setTesting(true);
              setMessage(null);
              void testConnection({ apiKeyRef: DEVIN_ACCOUNT_REF })
                .then((result) =>
                  setMessage(
                    zh
                      ? `连接成功 · ${result.resultCount} 条 · ${result.durationMs}ms`
                      : `Connected · ${result.resultCount} results · ${result.durationMs}ms`,
                  ),
                )
                .catch((error: unknown) =>
                  setMessage(error instanceof Error ? error.message : zh ? '连接测试失败' : 'Test failed'),
                )
                .finally(() => setTesting(false));
            }}
          >
            {testing ? (zh ? '检测中…' : 'Testing…') : zh ? '测试连接' : 'Test connection'}
          </Button>
          {message ? (
            <span className="devin-credential-hint" data-testid="code-search-devin-test-result">
              {message}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
