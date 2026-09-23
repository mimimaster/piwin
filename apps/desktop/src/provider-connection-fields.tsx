/**
 * Connection section of the provider detail pane: name, API key (reveal +
 * test), address, and the advanced fold (env var, request headers). Edits a
 * draft only; the detail pane owns save / revert.
 */

import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Button, IconButton, TextInput } from '@piwin/ui-kit';
import { createHeaderRow, hasKeychainSecret, type ProviderDraft } from './provider-draft.js';
import {
  IconChevronRight,
  IconClose,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconRefresh,
  IconSpark,
} from './shell-icons.js';

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

  function updateHeader(id: string, patch: { name?: string; value?: string }): void {
    onDraftChange({
      ...draft,
      headerRows: draft.headerRows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  }

  const keyHint = hasStoredKey
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
            {draft.headerRows.map((row) => (
              <div key={row.id} className="pconn-header-row">
                <TextInput
                  value={row.name}
                  onChange={(event) => updateHeader(row.id, { name: event.currentTarget.value })}
                  placeholder={copy.headerName}
                  aria-label={copy.headerName}
                  spellCheck={false}
                  testId="provider-header-name"
                  disabled={saving}
                  className="pconn-mono"
                />
                <TextInput
                  value={row.value}
                  onChange={(event) => updateHeader(row.id, { value: event.currentTarget.value })}
                  placeholder={copy.headerValue}
                  aria-label={copy.headerValue}
                  spellCheck={false}
                  testId="provider-header-value"
                  disabled={saving}
                  className="pconn-mono"
                />
                <IconButton
                  label={deleteLabel}
                  size={26}
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
            <button
              type="button"
              className="pconn-add-header"
              onClick={() =>
                onDraftChange({ ...draft, headerRows: [...draft.headerRows, createHeaderRow()] })
              }
              disabled={saving}
              data-testid="provider-header-add"
            >
              <IconPlus width={12} height={12} />
              {copy.addHeader}
            </button>
          </FieldRow>
        </div>
      ) : null}
    </div>
  );
}
