/**
 * Provider connection form, modal, and compact summary strip.
 * The form is exported separately so the BYOK drawer can embed it inline.
 */

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Button, Collapse, IconButton, Modal, TextInput } from '@piwin/ui-kit';
import type { ProviderDraft } from './provider-draft.js';
import { createHeaderRow, hasKeychainSecret } from './provider-draft.js';
import { ProviderIcon } from './provider-icons.js';
import { IconClose } from './shell-icons.js';
import { FieldRow } from './settings/field-row.js';

export type ProviderConnectionStripProps = {
  draft: ProviderDraft;
  copy: {
    connectionEdit: string;
    connectionDefaultEndpoint: string;
  };
  /** Current autosave status label (pending/saving/saved/error or empty). */
  saveStatus: string;
  onEdit: () => void;
};

export function ProviderConnectionStrip({
  draft,
  copy,
  saveStatus,
  onEdit,
}: ProviderConnectionStripProps): ReactElement {
  const hasKey = hasKeychainSecret(draft) || draft.apiKeyInput.trim().length > 0;
  const baseUrlDisplay = draft.baseUrl.trim() || copy.connectionDefaultEndpoint;
  const statusDot = hasKey
    ? 'provider-connection-dot provider-connection-dot--ok'
    : 'provider-connection-dot';

  return (
    <div className="provider-connection-strip" data-testid="provider-connection-strip">
      <div className="provider-connection-strip-main">
        <ProviderIcon id={draft.id} name={draft.name} size={28} />
        <div className="provider-connection-strip-text">
          <div className="provider-connection-strip-title">
            {draft.name}
            <span className={statusDot} />
          </div>
          <div className="provider-connection-strip-meta">
            {draft.protocol}
            <span className="provider-connection-strip-sep">·</span>
            <span className="provider-connection-strip-url" title={draft.baseUrl}>
              {baseUrlDisplay}
            </span>
          </div>
        </div>
      </div>
      <div className="provider-connection-strip-actions">
        {saveStatus && (
          <span
            className="provider-connection-strip-status"
            data-testid="provider-connection-save-status"
          >
            {saveStatus}
          </span>
        )}
        <Button
          size="compact"
          variant="ghost"
          onClick={onEdit}
          data-testid="provider-connection-edit-btn"
        >
          {copy.connectionEdit}
        </Button>
      </div>
    </div>
  );
}

export type ProviderConnectionFieldsProps = {
  draft: ProviderDraft;
  saving: boolean;
  copy: {
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
    apiKeyEnvironment: string;
    apiKeyEnvironmentDescription: string;
  };
  common: { remove: string };
  onDraftChange: (next: ProviderDraft) => void;
  children?: ReactNode;
};

export function ProviderConnectionFields({
  draft,
  saving,
  copy,
  common,
  onDraftChange,
  children,
}: ProviderConnectionFieldsProps): ReactElement {
  const lastAddedHeaderIdRef = useRef<string | null>(null);
  const headerNameInputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  useEffect(() => {
    const newId = lastAddedHeaderIdRef.current;
    if (!newId) return;
    const input = headerNameInputRefs.current.get(newId);
    if (input) {
      input.focus({ preventScroll: true });
    }
    lastAddedHeaderIdRef.current = null;
  }, [draft.headerRows]);

  function handleAddHeader(): void {
    const row = createHeaderRow();
    lastAddedHeaderIdRef.current = row.id;
    onDraftChange({ ...draft, headerRows: [...draft.headerRows, row] });
  }

  function handleUpdateHeaderName(rowId: string, value: string): void {
    onDraftChange({
      ...draft,
      headerRows: draft.headerRows.map((item) =>
        item.id === rowId ? { ...item, name: value } : item,
      ),
    });
  }

  function handleUpdateHeaderValue(rowId: string, value: string): void {
    onDraftChange({
      ...draft,
      headerRows: draft.headerRows.map((item) => (item.id === rowId ? { ...item, value } : item)),
    });
  }

  function handleRemoveHeader(rowId: string): void {
    onDraftChange({
      ...draft,
      headerRows: draft.headerRows.filter((item) => item.id !== rowId),
    });
  }

  return (
    <div className="provider-connection-form" data-testid="provider-connection-form">
      <p className="provider-connection-form-hint muted">{copy.connectionHint}</p>

      <FieldRow
        label={copy.apiKeyLabel}
        description={
          hasKeychainSecret(draft) ? copy.apiKeyStoredPlaceholder : copy.apiKeyPlaceholder
        }
      >
        <div className="provider-connection-key-row">
          <TextInput
            type="password"
            testId="provider-apikey-input"
            value={draft.apiKeyInput}
            onChange={(event) => {
              onDraftChange({ ...draft, apiKeyInput: event.currentTarget.value });
            }}
            placeholder={hasKeychainSecret(draft) ? '••••••••' : '...'}
            spellCheck={false}
            autoComplete="off"
            disabled={saving}
          />
        </div>
      </FieldRow>

      <FieldRow label={copy.apiAddress}>
        <TextInput
          testId="provider-baseurl-input"
          value={draft.baseUrl}
          onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })}
          spellCheck={false}
          placeholder="https://api.example.com/v1"
          disabled={saving}
        />
      </FieldRow>

      <FieldRow
        label={copy.apiKeyEnvironment}
        description={copy.apiKeyEnvironmentDescription}
      >
        <TextInput
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
        />
      </FieldRow>

      <div className="provider-field" data-testid="provider-headers" style={{ marginTop: 8 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <label className="ui-field-row-label" style={{ marginBottom: 0 }}>
            {copy.requestHeaders}
          </label>
          <Button
            size="compact"
            variant="ghost"
            onClick={handleAddHeader}
            data-testid="provider-header-add"
            disabled={saving}
          >
            + {copy.addHeader}
          </Button>
        </div>
        <Collapse expanded={draft.headerRows.length > 0}>
          <ul
            className="provider-header-list"
            style={{
              listStyle: 'none',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {draft.headerRows.map((row) => (
              <li
                key={row.id}
                className="provider-header-row"
                style={{ display: 'flex', gap: '8px' }}
              >
                <TextInput
                  value={row.name}
                  onChange={(event) => handleUpdateHeaderName(row.id, event.currentTarget.value)}
                  placeholder={copy.headerName}
                  spellCheck={false}
                  testId="provider-header-name"
                  ref={(el: HTMLInputElement | null) => {
                    headerNameInputRefs.current.set(row.id, el);
                  }}
                  style={{ flex: 1 }}
                  disabled={saving}
                />
                <TextInput
                  value={row.value}
                  onChange={(event) => handleUpdateHeaderValue(row.id, event.currentTarget.value)}
                  placeholder={copy.headerValue}
                  spellCheck={false}
                  testId="provider-header-value"
                  style={{ flex: 1 }}
                  disabled={saving}
                />
                <IconButton
                  label={common.remove}
                  onClick={() => handleRemoveHeader(row.id)}
                  disabled={saving}
                >
                  <IconClose width={12} height={12} />
                </IconButton>
              </li>
            ))}
          </ul>
        </Collapse>
        {draft.headerRows.length === 0 && (
          <p className="muted" style={{ fontSize: '12.5px', marginTop: -4 }}>
            {copy.requestHeadersHint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export type ProviderConnectionModalProps = ProviderConnectionFieldsProps & {
  open: boolean;
  connectionTitle: string;
  onOpenChange: (open: boolean) => void;
};

export function ProviderConnectionModal({
  open,
  connectionTitle,
  onOpenChange,
  ...fieldsProps
}: ProviderConnectionModalProps): ReactElement {
  return (
    <Modal
      title={connectionTitle}
      open={open}
      onOpenChange={onOpenChange}
      testId="provider-connection-modal"
      size="md"
      closeOnClickOutside={false}
    >
      <ProviderConnectionFields {...fieldsProps} />
    </Modal>
  );
}
