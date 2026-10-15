/**
 * Connection section of the provider detail pane: name, API key (reveal +
 * test), address, and the advanced fold (chat API, env var, request headers). Edits a
 * draft only; the detail pane owns save / revert.
 */

import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Button, FieldCheckbox, IconButton, SegmentedControl, TextInput } from '@piwin/ui-kit';
import {
  chatApiChoicesForProtocol,
  draftChatApi,
  hasKeychainSecret,
  type ProviderDraft,
} from './provider-draft.js';
import {
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconRefresh,
  IconSpark,
} from './shell-icons.js';
import { HeaderRowsEditor } from './header-rows-editor.js';

export type ProviderConnectionCopy = {
  providerName: string;
  apiKeyLabel: string;
  apiKeyEnvironment: string;
  apiKeyEnvironmentDescription: string;
  apiAddress: string;
  requestHeaders: string;
  requestHeadersHint: string;
  headerName: string;
  headerValue: string;
  addHeader: string;
  advanced: string;
  testConnection: string;
  testing: string;
  connectionHint: string;
};

export type ProviderConnectionFieldsProps = {
  draft: ProviderDraft;
  /** Unfold "advanced" on mount; the detail pane decides what is worth showing. */
  defaultAdvancedOpen: boolean;
  isChinese: boolean;
  saving: boolean;
  testing: boolean;
  copy: ProviderConnectionCopy;
  deleteLabel: string;
  onDraftChange: (draft: ProviderDraft) => void;
  onTestConnection: () => void;
  /** Fill the key input with the secret already saved on the Host. */
  onRevealStoredKey?: () => Promise<void>;
};

function FieldRow(props: {
  label: string;
  /** The control the label names; rows with several controls omit it. */
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="pconn-row">
      {props.htmlFor ? (
        <label className="pconn-label" htmlFor={props.htmlFor}>
          {props.label}
        </label>
      ) : (
        <span className="pconn-label">{props.label}</span>
      )}
      <div className="pconn-control">
        {props.children}
        {props.hint ? <p className="pconn-hint">{props.hint}</p> : null}
      </div>
    </div>
  );
}

/** `{API address}/chat/completions` or `/responses`, verbatim like Pi joins it. */
function chatApiPathHint(draft: ProviderDraft): string {
  const base = draft.baseUrl.trim().replace(/\/+$/, '') || '{API}';
  return draftChatApi(draft) === 'openai-responses' ? `${base}/responses` : `${base}/chat/completions`;
}

export function ProviderConnectionFields({
  draft,
  defaultAdvancedOpen,
  isChinese,
  saving,
  testing,
  copy,
  deleteLabel,
  onDraftChange,
  onTestConnection,
  onRevealStoredKey,
}: ProviderConnectionFieldsProps): ReactElement {
  const [showKey, setShowKey] = useState(false);
  const [revealingKey, setRevealingKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen);
  const hasStoredKey = hasKeychainSecret(draft);
  const fieldId = useId();

  async function handleToggleKeyVisibility(): Promise<void> {
    const nextShowKey = !showKey;
    setShowKey(nextShowKey);
    // The saved key never ships with the config; fetch it on first reveal.
    if (!nextShowKey || !hasStoredKey || draft.apiKeyInput || !onRevealStoredKey) return;
    setRevealingKey(true);
    try {
      await onRevealStoredKey();
    } finally {
      setRevealingKey(false);
    }
  }


  const isVertex = draft.protocol === 'google-vertex';
  const isBedrock = draft.protocol === 'amazon-bedrock';
  const isCloud = isVertex || isBedrock;

  function cloudField(
    key: 'project' | 'location' | 'credentialsFile' | 'region' | 'profile',
    label: string,
    placeholder: string,
    hint?: string,
  ): ReactElement {
    return (
      <FieldRow label={label} htmlFor={`${fieldId}-${key}`} {...(hint ? { hint } : {})}>
        <TextInput
          id={`${fieldId}-${key}`}
          testId={`provider-${key}-input`}
          value={draft[key] ?? ''}
          onChange={(event) => onDraftChange({ ...draft, [key]: event.currentTarget.value })}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          disabled={saving}
          className="pconn-mono"
        />
      </FieldRow>
    );
  }

  const cloudKeyHint = isVertex
    ? isChinese
      ? '可选。留空使用 gcloud 登录（ADC），令牌自动刷新；填入则用 Vertex API 密钥。'
      : 'Optional. Empty uses gcloud ADC with auto refresh; a key uses Vertex express mode.'
    : isChinese
      ? '可选。留空使用 AWS 凭证链（环境变量、Profile、SSO）；填入则用 Bedrock API 密钥。'
      : 'Optional. Empty uses the AWS credential chain (env, profile, SSO); a key uses a Bedrock API key.';

  const keyHint = isCloud && !hasStoredKey
    ? cloudKeyHint
    : hasStoredKey
    ? isChinese
      ? '密钥保存在 Host 钥匙串，不写入配置文件。留空保持不变，填入新值会覆盖。'
      : 'Stored in the Host keychain, never in config. Leave blank to keep it, or paste a new key to replace it.'
    : copy.connectionHint;

  return (
    <div className="pconn" data-testid="provider-connection">
      <FieldRow label={copy.providerName} htmlFor={`${fieldId}-name`}>
        <TextInput
          id={`${fieldId}-name`}
          value={draft.name}
          onChange={(event) => onDraftChange({ ...draft, name: event.currentTarget.value })}
          placeholder={isChinese ? '例如：公司内网网关' : 'e.g. Company gateway'}
          spellCheck={false}
          testId="provider-name-input"
          disabled={saving}
        />
      </FieldRow>

      <FieldRow label={copy.apiKeyLabel} htmlFor={`${fieldId}-key`} hint={keyHint}>
        <div className="pconn-inline">
          <div className="pconn-key">
            <TextInput
              id={`${fieldId}-key`}
              type={showKey ? 'text' : 'password'}
              testId="provider-apikey-input"
              value={draft.apiKeyInput}
              onChange={(event) =>
                onDraftChange({ ...draft, apiKeyInput: event.currentTarget.value })
              }
              placeholder={
                hasStoredKey
                  ? '••••••••••••'
                  : isCloud
                    ? isChinese
                      ? '可选'
                      : 'Optional'
                    : isChinese
                    ? 'sk-…（本地服务可留空）'
                    : 'sk-… (local servers may leave empty)'
              }
              spellCheck={false}
              autoComplete="off"
              disabled={saving}
              className="pconn-mono"
            />
            <IconButton
              label={
                showKey
                  ? isChinese
                    ? '隐藏密钥'
                    : 'Hide key'
                  : isChinese
                    ? '显示密钥'
                    : 'Show key'
              }
              size={26}
              className="pconn-key-eye"
              onClick={() => void handleToggleKeyVisibility()}
              disabled={saving || revealingKey}
              data-testid="provider-toggle-key-visibility"
            >
              {showKey ? <IconEyeOff width={14} height={14} /> : <IconEye width={14} height={14} />}
            </IconButton>
          </div>
          <Button
            size="compact"
            variant="secondary"
            onClick={onTestConnection}
            disabled={saving || testing}
            data-testid="provider-test-connection"
          >
            {testing ? (
              <IconRefresh width={13} height={13} className="provider-spin" />
            ) : (
              <IconSpark width={13} height={13} />
            )}
            {testing ? copy.testing : copy.testConnection}
          </Button>
        </div>
      </FieldRow>

      {isVertex ? (
        <>
          {cloudField('project', isChinese ? '项目' : 'Project', 'my-gcp-project')}
          {cloudField(
            'location',
            isChinese ? '区域' : 'Location',
            'global',
            isChinese ? '留空为 global；也可填 us-central1 等。' : 'Empty = global, or e.g. us-central1.',
          )}
        </>
      ) : null}
      {isBedrock ? (
        <>
          {cloudField(
            'region',
            isChinese ? '区域' : 'Region',
            'us-east-1',
            isChinese ? '留空用 AWS_REGION，否则 us-east-1。' : 'Empty = AWS_REGION, else us-east-1.',
          )}
          {cloudField(
            'profile',
            'Profile',
            'default',
            isChinese ? '~/.aws/config 中的配置名，支持 SSO；留空用默认凭证链。' : 'Named profile in ~/.aws/config (SSO ok). Empty = default chain.',
          )}
        </>
      ) : null}

      {isCloud ? null : (
        <FieldRow label={copy.apiAddress} htmlFor={`${fieldId}-url`}>
          <TextInput
            id={`${fieldId}-url`}
            testId="provider-baseurl-input"
            value={draft.baseUrl}
            onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })}
            spellCheck={false}
            placeholder="https://api.example.com/v1"
            disabled={saving}
            className="pconn-mono"
          />
        </FieldRow>
      )}

      <div className="pconn-row">
        <span className="pconn-label" />
        <div className="pconn-control">
          <button
            type="button"
            className={`pconn-advanced${advancedOpen ? ' is-open' : ''}`}
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            data-testid="provider-advanced-toggle"
          >
            <IconChevronRight width={12} height={12} />
            {copy.advanced}
          </button>
        </div>
      </div>

      {advancedOpen ? (
        <div className="pconn-advanced-body" data-testid="provider-headers">
          {isVertex
            ? cloudField(
                'credentialsFile',
                isChinese ? '服务账号 JSON' : 'Service account JSON',
                '~/key.json',
                isChinese ? '可选。留空用 gcloud ADC / GOOGLE_APPLICATION_CREDENTIALS。' : 'Optional. Empty = gcloud ADC / GOOGLE_APPLICATION_CREDENTIALS.',
              )
            : null}
          {isCloud ? (
            <FieldRow
              label={copy.apiAddress}
              htmlFor={`${fieldId}-url`}
              hint={isChinese ? '可选，自定义端点（VPC / 代理）。留空用官方端点。' : 'Optional custom endpoint (VPC / proxy). Empty = official.'}
            >
              <TextInput
                id={`${fieldId}-url`}
                testId="provider-baseurl-input"
                value={draft.baseUrl}
                onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })}
                spellCheck={false}
                placeholder={isVertex ? 'https://aiplatform.googleapis.com' : 'https://bedrock-runtime.us-east-1.amazonaws.com'}
                disabled={saving}
                className="pconn-mono"
              />
            </FieldRow>
          ) : null}
          {chatApiChoicesForProtocol(draft.protocol).length > 1 ? (
            <FieldRow
              label={isChinese ? '对话协议' : 'Chat API'}
              hint={
                isChinese
                  ? `对话请求发往 ${chatApiPathHint(draft)}。多数兼容接口用 Chat Completions；只提供 Responses 的服务选 Responses。`
                  : `Chat requests go to ${chatApiPathHint(draft)}. Most compatible endpoints use Chat Completions; pick Responses for providers that only serve it.`
              }
            >
              <SegmentedControl
                testId="provider-chat-api"
                value={draftChatApi(draft)}
                disabled={saving}
                onChange={(value) =>
                  onDraftChange({
                    ...draft,
                    chatApi: value === 'openai-responses' ? 'openai-responses' : 'openai-completions',
                  })
                }
                data={[
                  { value: 'openai-completions', label: 'Chat Completions' },
                  { value: 'openai-responses', label: 'Responses' },
                ]}
              />
            </FieldRow>
          ) : null}
          {draft.protocol === 'openai-compatible' ? (
            <FieldCheckbox
              testId="provider-system-prompt-role"
              label={
                isChinese ? '系统提示使用 system 角色' : 'Send system prompt as the system role'
              }
              description={
                isChinese
                  ? '默认发 developer。接口报「developer is not one of …」时勾选。'
                  : 'Default is developer. Turn on if the provider rejects "developer".'
              }
              checked={draft.systemPromptRole === 'system'}
              disabled={saving}
              onCheckedChange={(checked) => {
                const { systemPromptRole: _previous, ...rest } = draft;
                onDraftChange(checked ? { ...rest, systemPromptRole: 'system' } : rest);
              }}
            />
          ) : null}
          <FieldRow
            label={copy.apiKeyEnvironment}
            htmlFor={`${fieldId}-env`}
            hint={copy.apiKeyEnvironmentDescription}
          >
            <TextInput
              id={`${fieldId}-env`}
              testId="provider-apikey-env-input"
              value={draft.storedApiKeyEnv}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  storedApiKeyEnv: event.currentTarget.value,
                  ...(event.currentTarget.value.trim() ? { storedApiKeyRef: '' } : {}),
                })
              }
              placeholder="OPENAI_API_KEY"
              spellCheck={false}
              autoComplete="off"
              disabled={saving}
              className="pconn-mono"
            />
          </FieldRow>
          <FieldRow
            label={copy.requestHeaders}
            hint={draft.headerRows.length === 0 ? copy.requestHeadersHint : undefined}
          >
            <HeaderRowsEditor
              rows={draft.headerRows}
              disabled={saving}
              copy={{
                headerName: copy.headerName,
                headerValue: copy.headerValue,
                addHeader: copy.addHeader,
                deleteLabel,
              }}
              testIdPrefix="provider"
              onChange={(headerRows) => onDraftChange({ ...draft, headerRows })}
            />
          </FieldRow>
        </div>
      ) : null}
    </div>
  );
}
