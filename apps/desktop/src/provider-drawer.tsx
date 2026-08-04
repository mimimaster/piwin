/**
 * Provider config drawer — connection-only layout:
 *   head (icon + name + host + close)
 *   enable status bar
 *   API key + test connection
 *   API address
 *   advanced (request headers) collapsed
 *   foot (delete / cancel / save)
 *
 * Model list / discover / add live on the models page expanded provider row.
 */

import { useState, type ReactElement } from 'react';
import { Button, IconButton, Switch, TextInput } from '@piwin/ui-kit';
import { createHeaderRow, hasKeychainSecret, type ProviderDraft } from './provider-draft.js';
import { ProviderIcon } from './provider-icons.js';
import { ProviderStatusPill, type ProviderTestStatus } from './provider-status.js';
import {
  IconCheck,
  IconChevronRight,
  IconClose,
  IconRefresh,
  IconSettings,
  IconSpark,
} from './shell-icons.js';

function IconEye({ width = 14, height = 14 }: { width?: number; height?: number }): ReactElement {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff({
  width = 14,
  height = 14,
}: {
  width?: number;
  height?: number;
}): ReactElement {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
    </svg>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

export type ProviderDrawerCopy = {
  enableProvider: string;
  providerEnabledHint: string;
  providerDisabledHint: string;
  statusOff: string;
  testing: string;
  testConnection: string;
  testOk: (count: number, duration: number) => string;
  saveAndAdd: string;
  providerName: string;
  connectionHint: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyStoredPlaceholder: string;
  apiAddress: string;
  requestHeaders: string;
  requestHeadersHint: string;
  headerName: string;
  headerValue: string;
  addHeader: string;
  keyManager: string;
  advanced: string;
};

export type ProviderDrawerCommon = {
  cancel: string;
  delete: string;
  save: string;
};

export type ProviderDrawerProps = {
  draft: ProviderDraft;
  isNew: boolean;
  saving: boolean;
  testingId: string | null;
  testStatus: Record<string, ProviderTestStatus>;
  isChinese: boolean;
  copy: ProviderDrawerCopy;
  common: ProviderDrawerCommon;
  onClose: () => void;
  onSave: (opts?: {
    keepOpen?: boolean;
    default?: { providerId: string; modelId: string };
  }) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onDraftChange: (draft: ProviderDraft) => void;
  onTestConnection: () => void;
  onOpenKeyManager: () => void;
  /** Load keychain secret so the eye toggle can reveal a stored key. */
  onLoadSecret: (providerId: string) => Promise<string | null>;
};

export function ProviderDrawer({
  draft,
  isNew,
  saving,
  testingId,
  testStatus,
  isChinese,
  copy,
  common,
  onClose,
  onSave,
  onDelete,
  onDraftChange,
  onTestConnection,
  onOpenKeyManager,
  onLoadSecret,
}: ProviderDrawerProps): ReactElement {
  const [showKey, setShowKey] = useState(false);
  const [revealingKey, setRevealingKey] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);

  const status = draft.enabled
    ? (testStatus[draft.id] ?? null)
    : { tone: 'off' as const, message: copy.statusOff };

  const hasStoredKey = hasKeychainSecret(draft);

  function handleAddHeader(): void {
    onDraftChange({ ...draft, headerRows: [...draft.headerRows, createHeaderRow()] });
    setAdvOpen(true);
  }

  async function handleToggleKeyVisibility(): Promise<void> {
    if (showKey) {
      setShowKey(false);
      return;
    }

    // Field is empty but keychain has a secret — load it so reveal is meaningful.
    // Without this, type=text on an empty input still shows only the •••• placeholder.
    if (!draft.apiKeyInput.trim() && hasStoredKey) {
      setRevealingKey(true);
      try {
        const raw = await onLoadSecret(draft.id);
        const firstLine = (raw ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (firstLine) {
          onDraftChange({ ...draft, apiKeyInput: firstLine });
        }
      } catch {
        // Still flip to text mode; user can open key manager if load failed.
      } finally {
        setRevealingKey(false);
      }
    }

    setShowKey(true);
  }

  return (
    <div
      className="provider-editor-overlay"
      onClick={onClose}
      data-testid="provider-drawer-overlay"
      role="presentation"
    >
      <div
        className="provider-editor-modal"
        onClick={(event) => event.stopPropagation()}
        data-testid="provider-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={draft.name || (isChinese ? '编辑提供商' : 'Edit provider')}
      >
        <div className="provider-drawer-head">
          <ProviderIcon id={draft.id} name={draft.name} size={40} />
          <div className="provider-drawer-meta">
            <b className="provider-drawer-name">
              {draft.name || (isChinese ? '未命名' : 'Untitled')}
            </b>
            <span className="provider-drawer-host" title={draft.baseUrl}>
              {hostOf(draft.baseUrl)}
            </span>
          </div>
          <button
            type="button"
            className="provider-drawer-iconbtn"
            onClick={onClose}
            aria-label={common.cancel}
            data-testid="provider-drawer-close"
          >
            <IconClose width={15} height={15} />
          </button>
        </div>

        <div className="provider-drawer-body">
          <div className="provider-statusbar">
            <div className="provider-statusbar-text">
              <b>{copy.enableProvider}</b>
              <span>{draft.enabled ? copy.providerEnabledHint : copy.providerDisabledHint}</span>
            </div>
            <ProviderStatusPill status={status} />
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) => onDraftChange({ ...draft, enabled: checked })}
              testId="provider-enable-switch"
              size="sm"
              disabled={saving}
            />
          </div>

          {(isNew || draft.id.startsWith('custom')) && (
            <>
              <div className="provider-field-label">{copy.providerName}</div>
              <TextInput
                value={draft.name}
                onChange={(event) => onDraftChange({ ...draft, name: event.currentTarget.value })}
                placeholder={isChinese ? '例如：公司内网网关' : 'e.g. Company gateway'}
                spellCheck={false}
                testId="provider-name-input"
                disabled={saving}
              />
            </>
          )}

          <div className="provider-field-label">
            <span>{copy.apiKeyLabel}</span>
            <button
              type="button"
              className="provider-linkbtn"
              onClick={() => void onTestConnection()}
              disabled={saving || testingId === draft.id}
              data-testid="provider-test-connection"
            >
              {testingId === draft.id ? (
                <>
                  <IconRefresh width={12} height={12} className="provider-spin" />
                  {copy.testing}
                </>
              ) : (
                <>
                  <IconSpark width={12} height={12} />
                  {copy.testConnection}
                </>
              )}
            </button>
          </div>
          <div className="provider-input-wrap">
            <TextInput
              type={showKey ? 'text' : 'password'}
              testId="provider-apikey-env-input"
              value={draft.apiKeyInput}
              onChange={(event) => {
                onDraftChange({ ...draft, apiKeyInput: event.currentTarget.value });
              }}
              placeholder={
                hasStoredKey
                  ? '••••••••'
                  : isChinese
                    ? 'sk-…（本地可留空）'
                    : 'sk-… (local may leave empty)'
              }
              spellCheck={false}
              autoComplete="off"
              disabled={saving}
              className="provider-input-mono"
            />
            <div className="provider-input-trail">
              <button
                type="button"
                className="provider-mini-btn"
                onClick={() => void handleToggleKeyVisibility()}
                aria-label={showKey ? 'Hide key' : 'Show key'}
                title={
                  showKey
                    ? isChinese
                      ? '隐藏密钥'
                      : 'Hide key'
                    : isChinese
                      ? '显示密钥'
                      : 'Show key'
                }
                data-testid="provider-toggle-key-visibility"
                disabled={saving || revealingKey}
              >
                {showKey ? (
                  <IconEyeOff width={14} height={14} />
                ) : (
                  <IconEye width={14} height={14} />
                )}
              </button>
              <button
                type="button"
                className="provider-mini-btn"
                onClick={onOpenKeyManager}
                aria-label={copy.keyManager}
                title={copy.keyManager}
                data-testid="provider-key-manager-btn"
                disabled={saving}
              >
                <IconSettings width={13} height={13} />
              </button>
            </div>
          </div>
          <div className="provider-field-hint">
            {hasStoredKey
              ? isChinese
                ? '密钥已加密存于本机钥匙串，留空则保持不变'
                : 'Key is encrypted in the local keychain — leave blank to keep'
              : copy.connectionHint}
          </div>

          <div className="provider-field-label">
            <span>{copy.apiAddress}</span>
          </div>
          <TextInput
            testId="provider-baseurl-input"
            value={draft.baseUrl}
            onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })}
            spellCheck={false}
            placeholder="https://api.example.com/v1"
            disabled={saving}
            className="provider-input-mono"
          />

          <button
            type="button"
            className={`provider-adv-head${advOpen ? ' provider-adv-head--open' : ''}`}
            onClick={() => setAdvOpen((v) => !v)}
            data-testid="provider-advanced-toggle"
          >
            <IconChevronRight width={13} height={13} />
            {copy.advanced}
          </button>
          {advOpen && (
            <div className="provider-adv-body" data-testid="provider-headers">
              <div className="provider-field-label">
                <span>{copy.requestHeaders}</span>
                <button
                  type="button"
                  className="provider-linkbtn"
                  onClick={handleAddHeader}
                  disabled={saving}
                  data-testid="provider-header-add"
                >
                  + {copy.addHeader}
                </button>
              </div>
              {draft.headerRows.length === 0 && (
                <div className="provider-field-hint">{copy.requestHeadersHint}</div>
              )}
              {draft.headerRows.map((row) => (
                <div key={row.id} className="provider-header-row">
                  <TextInput
                    value={row.name}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        headerRows: draft.headerRows.map((item) =>
                          item.id === row.id ? { ...item, name: event.currentTarget.value } : item,
                        ),
                      })
                    }
                    placeholder={copy.headerName}
                    spellCheck={false}
                    testId="provider-header-name"
                    disabled={saving}
                  />
                  <TextInput
                    value={row.value}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        headerRows: draft.headerRows.map((item) =>
                          item.id === row.id ? { ...item, value: event.currentTarget.value } : item,
                        ),
                      })
                    }
                    placeholder={copy.headerValue}
                    spellCheck={false}
                    testId="provider-header-value"
                    disabled={saving}
                  />
                  <IconButton
                    label={common.delete}
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
            </div>
          )}
        </div>

        <div className="provider-drawer-foot">
          {!isNew && (
            <Button
              variant="danger"
              size="compact"
              onClick={() => void onDelete()}
              disabled={saving}
              data-testid="provider-delete-btn"
            >
              {common.delete}
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Button
            size="compact"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            data-testid="provider-cancel-btn"
          >
            {common.cancel}
          </Button>
          <Button
            size="compact"
            onClick={() => void onSave()}
            disabled={saving}
            data-testid="provider-save-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <IconCheck width={14} height={14} />
            {isNew ? copy.saveAndAdd : common.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
