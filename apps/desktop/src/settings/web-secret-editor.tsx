import { useEffect, useState, type ReactElement } from 'react';
import { Button, Field, IconRefresh, IconSpark, PasswordInput, TextInput } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';

const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type WebSecretEditorProps = {
  secretId: string;
  apiKeyRef: string;
  apiKeyEnv: string;
  defaultApiKeyEnv: string;
  testConnection?: (input?: {
    apiKey?: string;
  }) => Promise<{ durationMs: number; resultCount: number }>;
  disabled: boolean;
  zh: boolean;
  loadSecret: (secretId: string) => Promise<string | null>;
  storeSecret: (secretId: string, secret: string) => Promise<string>;
  onSaved: (apiKeyRef: string, apiKeyEnv: string) => Promise<boolean>;
  testId: string;
};

/** Host-backed Web API key editor with explicit save feedback and collapse. */
export function WebSecretEditor(props: WebSecretEditorProps): ReactElement {
  const legacyPlaintextKey = isLegacyPlaintextKey(props.apiKeyEnv) ? props.apiKeyEnv.trim() : '';
  const initialEnvironmentVariable = legacyPlaintextKey
    ? props.defaultApiKeyEnv
    : props.apiKeyEnv || props.defaultApiKeyEnv;
  const [secret, setSecret] = useState(legacyPlaintextKey);
  const [environmentVariable, setEnvironmentVariable] = useState(initialEnvironmentVariable);
  const [editing, setEditing] = useState(!props.apiKeyRef || Boolean(legacyPlaintextKey));
  const [loading, setLoading] = useState(Boolean(props.apiKeyRef));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testSucceeded, setTestSucceeded] = useState(false);
  const [savedPreview, setSavedPreview] = useState<string | null>(
    legacyPlaintextKey ? null : props.apiKeyRef ? maskSecretPreview('stored-key') : null,
  );

  useEffect(() => {
    if (props.disabled || !props.apiKeyRef) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void props
      .loadSecret(props.secretId)
      .then((storedSecret) => {
        if (cancelled || !storedSecret) {
          return;
        }
        setSecret(storedSecret);
        setSavedPreview(maskSecretPreview(storedSecret));
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(formatError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.apiKeyRef, props.disabled, props.loadSecret, props.secretId]);

  async function testConnection(): Promise<void> {
    if (!props.testConnection) {
      return;
    }
    setTesting(true);
    setTestMessage(null);
    setError(null);
    try {
      const trimmedSecret = secret.trim();
      const result = await props.testConnection(
        trimmedSecret ? { apiKey: trimmedSecret } : undefined,
      );
      setTestSucceeded(true);
      setTestMessage(
        props.zh
          ? `连接成功 · ${result.durationMs}ms · ${result.resultCount} 条结果`
          : `Connected · ${result.durationMs}ms · ${result.resultCount} result(s)`,
      );
    } catch (testError) {
      setTestSucceeded(false);
      setTestMessage(
        props.zh
          ? `连接失败：${formatError(testError)}`
          : `Connection failed: ${formatError(testError)}`,
      );
    } finally {
      setTesting(false);
    }
  }

  async function saveSecret(): Promise<void> {
    const trimmedSecret = secret.trim();
    if (!trimmedSecret) {
      setError(props.zh ? '请输入 API Key 后再保存。' : 'Enter an API key before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const apiKeyRef = await props.storeSecret(props.secretId, trimmedSecret);
      const configSaved = await props.onSaved(
        apiKeyRef,
        environmentVariable.trim() || props.defaultApiKeyEnv,
      );
      if (!configSaved) {
        throw new Error(
          props.zh
            ? '密钥已写入 Host，但 Web 配置保存失败。'
            : 'Key stored on the Host, but Web config save failed.',
        );
      }
      await testConnection();
      setSavedPreview(maskSecretPreview(trimmedSecret));
      setEditing(false);
    } catch (saveError) {
      setError(formatError(saveError));
    } finally {
      setSaving(false);
    }
  }

  if (!editing && props.apiKeyRef) {
    return (
      <div className="web-secret-summary" data-testid={`${props.testId}-summary`}>
        <div>
          <div className="web-secret-status">
            <span className="web-secret-status-dot" aria-hidden />
            {props.zh ? '已安全保存' : 'Saved securely'}
          </div>
          <div className="web-secret-preview">
            {loading ? (props.zh ? '正在读取…' : 'Loading…') : (savedPreview ?? '••••••••')}
          </div>
          {testMessage ? (
            <div
              className={
                testSucceeded
                  ? 'web-secret-test-result is-success'
                  : 'web-secret-test-result is-error'
              }
            >
              {testMessage}
            </div>
          ) : null}
        </div>
        <div className="web-secret-summary-actions">
          {props.testConnection ? (
            <Button
              variant="ghost"
              size="compact"
              disabled={testing || props.disabled}
              onClick={() => void testConnection()}
              data-testid={`${props.testId}-test`}
            >
              {testing
                ? props.zh
                  ? '检测中…'
                  : 'Testing…'
                : props.zh
                  ? '测试连接'
                  : 'Test connection'}
            </Button>
          ) : null}
          <Button variant="ghost" size="compact" onClick={() => setEditing(true)}>
            {props.zh ? '修改' : 'Edit'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="web-secret-editor" data-testid={props.testId}>
      {legacyPlaintextKey ? (
        <div className="web-secret-warning">
          {props.zh
            ? '检测到旧版配置里可能直接写入了密钥。保存后会迁到 Host 密钥库，并从配置中移除明文。'
            : 'A key appears to be stored in the legacy config. Saving migrates it to the Host secret store and removes the plaintext value.'}
        </div>
      ) : null}
      <Field
        label="API Key"
        description={
          props.zh
            ? '密钥保存在 Host，不写入配置文件。'
            : 'Stored on the Host, never in config.'
        }
        className="web-source-field"
      >
        <div className="web-secret-input-row">
          <div className="web-secret-input-field">
            <PasswordInput
              value={secret}
              onChange={(event) => setSecret(event.currentTarget.value)}
              placeholder={props.zh ? '粘贴 API Key' : 'Paste API key'}
              autoComplete="off"
              spellCheck={false}
              disabled={props.disabled || loading || saving}
              testId={`${props.testId}-input`}
            />
          </div>
          {props.testConnection ? (
            <button
              type="button"
              className="web-secret-test-icon"
              onClick={() => void testConnection()}
              disabled={
                props.disabled ||
                loading ||
                saving ||
                testing ||
                (!secret.trim() && !props.apiKeyRef)
              }
              title={
                testing
                  ? props.zh
                    ? '检测中…'
                    : 'Testing…'
                  : props.zh
                    ? '测试连接'
                    : 'Test connection'
              }
              aria-label={props.zh ? '测试连接' : 'Test connection'}
              data-testid={`${props.testId}-test`}
            >
              {testing ? (
                <IconRefresh width={14} height={14} className="web-secret-test-spin" />
              ) : (
                <IconSpark width={14} height={14} />
              )}
            </button>
          ) : null}
        </div>
      </Field>
      <details className="web-secret-advanced">
        <summary>
          {props.zh ? '高级：环境变量回退' : 'Advanced: environment variable fallback'}
        </summary>
        <Field
          label={props.zh ? '环境变量名' : 'Environment variable'}
          description={
            props.zh
              ? 'Host 密钥库没有密钥时才读取该变量；这里只填变量名。'
              : 'Used only when the Host secret store has no key. Enter the variable name, not its value.'
          }
          className="web-source-field"
        >
          <TextInput
            value={environmentVariable}
            onChange={(event) => setEnvironmentVariable(event.currentTarget.value)}
            placeholder={props.defaultApiKeyEnv}
            spellCheck={false}
            disabled={props.disabled || saving}
            testId={`${props.testId}-env`}
          />
        </Field>
      </details>
      {error ? <div className="web-secret-error">{error}</div> : null}
      {testMessage ? (
        <div
          className={
            testSucceeded ? 'web-secret-test-result is-success' : 'web-secret-test-result is-error'
          }
        >
          {testMessage}
        </div>
      ) : null}
      <div className="web-secret-actions">
        {props.apiKeyRef ? (
          <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            {props.zh ? '取消' : 'Cancel'}
          </Button>
        ) : null}
        {props.testConnection ? (
          <Button
            variant="ghost"
            disabled={
              props.disabled ||
              loading ||
              saving ||
              testing ||
              (!secret.trim() && !props.apiKeyRef)
            }
            onClick={() => void testConnection()}
            data-testid={`${props.testId}-test-button`}
          >
            {testing
              ? props.zh
                ? '检测中…'
                : 'Testing…'
              : props.zh
                ? '测试连接'
                : 'Test connection'}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={props.disabled || loading || saving}
          onClick={() => void saveSecret()}
        >
          {saving ? (props.zh ? '保存中…' : 'Saving…') : props.zh ? '保存 API Key' : 'Save API Key'}
        </Button>
      </div>
    </div>
  );
}

function isLegacyPlaintextKey(value: string): boolean {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 && !ENVIRONMENT_VARIABLE_PATTERN.test(trimmedValue);
}

export function maskSecretPreview(secret: string): string {
  const trimmedSecret = secret.trim();
  if (!trimmedSecret) {
    return '••••••••';
  }
  const suffix = trimmedSecret.slice(-4);
  return `••••••••${suffix}`;
}
