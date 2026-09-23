/**
 * Connection panel of the provider detail pane. A configured provider's
 * connection is rarely touched — people come here for models — so it is not a
 * section of its own: the header carries its state (key saved / missing) and
 * a "Connection" button, and this panel opens under the header on demand. A
 * new provider, or one with unsaved edits, shows it open.
 */

import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import {
  ProviderConnectionFields,
  type ProviderConnectionCopy,
} from './provider-connection-fields.js';
import { hasKeychainSecret, type ProviderDraft } from './provider-draft.js';
import { IconCheck } from './shell-icons.js';

/** One-line key state for the detail header. */
export function connectionKeySummary(
  draft: ProviderDraft,
  isChinese: boolean,
): { text: string; missing: boolean } {
  if (hasKeychainSecret(draft)) return { text: isChinese ? '密钥已保存' : 'Key saved', missing: false };
  const env = draft.storedApiKeyEnv.trim();
  if (env) return { text: isChinese ? `环境变量 ${env}` : `Env ${env}`, missing: false };
  return { text: isChinese ? '未设置密钥' : 'No key', missing: true };
}

export type ProviderConnectionPanelProps = {
  draft: ProviderDraft;
  isNew: boolean;
  dirty: boolean;
  isChinese: boolean;
  saving: boolean;
  testing: boolean;
  copy: ProviderConnectionCopy & { saveAndAdd: string };
  common: { cancel: string; delete: string; save: string };
  onDraftChange: (draft: ProviderDraft) => void;
  onSave: () => void;
  onRevert: () => void;
  onClose: () => void;
  onTestConnection: () => void;
  onRevealStoredKey?: () => Promise<void>;
};

export function ProviderConnectionPanel(props: ProviderConnectionPanelProps): ReactElement {
  const { draft, isNew, dirty, isChinese } = props;
  return (
    <section
      className={`pconn-panel${isNew ? ' is-new' : ''}`}
      data-testid="provider-connection-section"
    >
      <header className="pconn-panel-head">
        <div>
          <h3 className="pdetail-section-title">
            {isNew ? (isChinese ? '连接' : 'Connection') : isChinese ? '连接设置' : 'Connection'}
          </h3>
          <p className="pdetail-section-desc">
            {isNew
              ? isChinese
                ? '填写密钥和接口地址，保存后即可拉取模型。'
                : 'Enter the key and endpoint; fetch models after saving.'
              : isChinese
                ? '密钥和接口地址，修改后需要保存。'
                : 'Key and endpoint. Changes here need saving.'}
          </p>
        </div>
        {isNew || dirty ? null : (
          <Button
            size="compact"
            variant="ghost"
            onClick={props.onClose}
            data-testid="provider-connection-close"
          >
            {isChinese ? '收起' : 'Close'}
          </Button>
        )}
      </header>

      <ProviderConnectionFields
        draft={draft}
        // Saved headers or an env-var key are real config worth showing; a
        // new preset's placeholder env name is not.
        defaultAdvancedOpen={
          !isNew && (draft.headerRows.length > 0 || draft.storedApiKeyEnv.trim().length > 0)
        }
        isChinese={isChinese}
        saving={props.saving}
        testing={props.testing}
        copy={props.copy}
        deleteLabel={props.common.delete}
        onDraftChange={props.onDraftChange}
        onTestConnection={props.onTestConnection}
        {...(props.onRevealStoredKey ? { onRevealStoredKey: props.onRevealStoredKey } : {})}
      />

      {isNew || dirty ? (
        <div className="pdetail-savebar" data-testid="provider-savebar">
          <span className="pdetail-savebar-text">
            {isNew
              ? isChinese
                ? '保存后即可拉取和管理模型'
                : 'Save to fetch and manage models'
              : isChinese
                ? '连接设置有未保存的修改'
                : 'Unsaved connection changes'}
          </span>
          <Button
            size="compact"
            variant="ghost"
            onClick={props.onRevert}
            disabled={props.saving}
            data-testid="provider-cancel-btn"
          >
            {isNew ? props.common.cancel : isChinese ? '撤销' : 'Revert'}
          </Button>
          <Button
            size="compact"
            variant="primary"
            onClick={props.onSave}
            disabled={props.saving}
            data-testid="provider-save-btn"
          >
            <IconCheck width={13} height={13} />
            {isNew ? props.copy.saveAndAdd : props.common.save}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
