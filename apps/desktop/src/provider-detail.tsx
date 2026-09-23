/**
 * Right pane of the provider workspace: identity header (connection state,
 * enable, delete), the connection panel on demand, and the models section.
 */

import { useState, type ReactElement } from 'react';
import { isSubscriptionProvider, type ModelProviderConfig } from '@piwin/contracts';
import {
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
  Switch,
} from '@piwin/ui-kit';
import type { ProviderConnectionCopy } from './provider-connection-fields.js';
import {
  ProviderConnectionPanel,
  connectionKeySummary,
} from './provider-connection-section.js';
import type { ProviderDraft } from './provider-draft.js';
import { ProviderAvatar } from './provider-avatar.js';
import { ProviderModelList, type ProviderModelListProps } from './provider-model-list.js';
import { ProviderStatusPill, type ProviderTestStatus } from './provider-status.js';
import { IconChevronDown, IconMore, IconSliders, IconTrash } from './shell-icons.js';

export type ProviderDetailCopy = ProviderConnectionCopy & {
  saveAndAdd: string;
};

export type ProviderDetailCommon = {
  cancel: string;
  delete: string;
  save: string;
};

/** Model list wiring that the detail pane passes through untouched. */
export type ProviderDetailModels = Omit<
  ProviderModelListProps,
  'provider' | 'isChinese' | 'disabled'
>;

export type ProviderDetailProps = {
  /** Saved provider; null while a new provider is still a draft. */
  provider: ModelProviderConfig | null;
  draft: ProviderDraft;
  dirty: boolean;
  status: ProviderTestStatus | null;
  isChinese: boolean;
  saving: boolean;
  testing: boolean;
  copy: ProviderDetailCopy;
  common: ProviderDetailCommon;
  models: ProviderDetailModels;
  onDraftChange: (draft: ProviderDraft) => void;
  onSave: () => void;
  onRevert: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnection: () => void;
  onRevealStoredKey?: () => Promise<void>;
};

/** The endpoint without its scheme — host and path are what tell relays apart. */
function addressOf(url: string): string {
  return url.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') || '—';
}

function protocolLabel(protocol: ProviderDraft['protocol'], isChinese: boolean): string {
  if (protocol === 'anthropic-compatible') return isChinese ? 'Anthropic 兼容' : 'Anthropic-compatible';
  if (protocol === 'google-gemini') return 'Gemini';
  return isChinese ? 'OpenAI 兼容' : 'OpenAI-compatible';
}

export function ProviderDetail({
  provider,
  draft,
  dirty,
  status,
  isChinese,
  saving,
  testing,
  copy,
  common,
  models,
  onDraftChange,
  onSave,
  onRevert,
  onDelete,
  onToggleEnabled,
  onTestConnection,
  onRevealStoredKey,
}: ProviderDetailProps): ReactElement {
  const isNew = provider === null;
  const subscription = provider !== null && isSubscriptionProvider(provider);
  const title = draft.name.trim() || (isChinese ? '新提供商' : 'New provider');
  const [connectionOpen, setConnectionOpen] = useState(false);
  // New providers must fill it in; unsaved edits must stay in sight.
  const showConnection = !subscription && (isNew || dirty || connectionOpen);
  const keyState = connectionKeySummary(draft, isChinese);

  return (
    <section className="pdetail" data-testid="provider-detail" aria-label={title}>
      <header className="pdetail-head">
        <ProviderAvatar id={draft.id} name={draft.name} size={44} />
        <div className="pdetail-who">
          <h2 className="pdetail-name">{title}</h2>
          <p className="pdetail-meta">
            {subscription ? (
              <span className="pdetail-chip">{isChinese ? 'OAuth 套餐' : 'OAuth plan'}</span>
            ) : (
              <>
                <span className="pdetail-chip">{protocolLabel(draft.protocol, isChinese)}</span>
                <span className="pdetail-host" title={draft.baseUrl}>
                  {addressOf(draft.baseUrl)}
                </span>
                {isNew ? null : (
                  <span
                    className={`pdetail-key${keyState.missing ? ' is-missing' : ''}`}
                    data-testid="provider-key-state"
                  >
                    {keyState.text}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        {provider ? (
          <div className="pdetail-head-actions">
            <ProviderStatusPill status={status} />
            {subscription ? null : (
              <button
                type="button"
                className={`pdetail-conn-btn${showConnection ? ' is-open' : ''}`}
                onClick={() => setConnectionOpen((open) => !open)}
                disabled={dirty}
                aria-expanded={showConnection}
                data-testid="provider-connection-toggle"
              >
                <IconSliders width={13} height={13} />
                {isChinese ? '连接设置' : 'Connection'}
                <IconChevronDown width={12} height={12} className="pdetail-conn-chevron" />
              </button>
            )}
            <span className="pdetail-enable">
              <span className="pdetail-enable-label" aria-hidden>
                {provider.enabled !== false
                  ? isChinese
                    ? '已启用'
                    : 'On'
                  : isChinese
                    ? '已停用'
                    : 'Off'}
              </span>
              <Switch
                checked={provider.enabled !== false}
                onCheckedChange={onToggleEnabled}
                disabled={saving}
                aria-label={isChinese ? '启用此提供商' : 'Enable this provider'}
                testId="provider-enable-switch"
                size="sm"
              />
            </span>
            {subscription ? null : (
              <DropdownMenu
                align="end"
                label={isChinese ? '更多操作' : 'More actions'}
                testId="provider-detail-menu"
                trigger={
                  <IconButton
                    label={isChinese ? '更多操作' : 'More actions'}
                    size={28}
                    data-testid="provider-detail-more"
                    disabled={saving}
                  >
                    <IconMore width={16} height={16} />
                  </IconButton>
                }
              >
                <DropdownMenuItem
                  danger
                  icon={<IconTrash width={13} height={13} />}
                  onSelect={onDelete}
                  testId="provider-delete-btn"
                >
                  {isChinese ? '删除此提供商' : 'Delete provider'}
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
        ) : null}
      </header>

      {showConnection ? (
        <ProviderConnectionPanel
          draft={draft}
          isNew={isNew}
          dirty={dirty}
          isChinese={isChinese}
          saving={saving}
          testing={testing}
          copy={copy}
          common={common}
          onDraftChange={onDraftChange}
          onSave={onSave}
          onRevert={onRevert}
          onClose={() => setConnectionOpen(false)}
          onTestConnection={onTestConnection}
          {...(onRevealStoredKey ? { onRevealStoredKey } : {})}
        />
      ) : null}

      {subscription ? (
        <p className="pdetail-note">
          {isChinese
            ? '套餐通过 OAuth 登录，不需要 API 密钥；登录状态在「OAuth 登录」页管理。这里可以开关模型、调整参数、设置默认模型。'
            : 'Plans sign in with OAuth and need no API key; manage the login on the OAuth page. Here you can toggle models, tune parameters, and pick the default.'}
        </p>
      ) : null}

      {provider ? (
        <ProviderModelList
          provider={provider}
          isChinese={isChinese}
          disabled={saving}
          {...models}
        />
      ) : null}
    </section>
  );
}
