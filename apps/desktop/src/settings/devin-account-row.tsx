/**
 * One line that answers "is the Devin account this feature reuses connected?",
 * with the action that fixes it when it is not. Shared by code_search and the
 * Devin web-search source so both read and connect the same way.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

import type { DevinAccountView } from './use-devin-account.js';

type Tone = 'ok' | 'idle' | 'busy' | 'warn';

/** Why connecting is worth it, shown while the account is not usable. */
function freeUseNote(zh: boolean): string {
  return zh
    ? '登录后可免费使用 web_search 和 code_search'
    : 'Sign in to use web_search and code_search for free';
}

function describe(
  state: DevinAccountView['state'],
  zh: boolean,
): { tone: Tone; label: string; action: string | null } {
  switch (state) {
    case 'logged-in':
      return { tone: 'ok', label: zh ? '已连接 Devin 账号' : 'Devin account connected', action: null };
    case 'logging-in':
      return {
        tone: 'busy',
        label: zh ? '等待浏览器完成授权…' : 'Waiting for the browser to finish sign-in…',
        action: null,
      };
    case 'needs-reauth':
    case 'sync-error':
      return {
        tone: 'warn',
        label: zh ? 'Devin 登录已失效' : 'Devin sign-in expired',
        action: zh ? '重新连接' : 'Reconnect',
      };
    case 'unknown':
      return { tone: 'idle', label: zh ? '正在读取 Devin 账号…' : 'Checking the Devin account…', action: null };
    case 'logged-out':
    default:
      return {
        tone: 'idle',
        label: zh ? '未连接 Devin 账号' : 'Devin account not connected',
        action: zh ? '连接 Devin' : 'Connect Devin',
      };
  }
}

export function DevinAccountRow(props: {
  account: DevinAccountView;
  zh: boolean;
  disabled?: boolean;
  testId?: string;
}): ReactElement {
  const { account, zh } = props;
  const view = describe(account.state, zh);
  return (
    <div className="devin-account-row" data-tone={view.tone} data-testid={props.testId}>
      <span className="devin-account-dot" aria-hidden="true" />
      <div className="devin-account-text">
        <span className="devin-account-label">{view.label}</span>
        {view.action ? <span className="devin-account-note">{freeUseNote(zh)}</span> : null}
        {account.error ? (
          <span className="devin-account-error">
            {zh ? `连接失败：${account.error}` : `Sign-in failed: ${account.error}`}
          </span>
        ) : null}
      </div>
      {view.action ? (
        <Button
          variant="primary"
          size="compact"
          disabled={props.disabled === true}
          onClick={() => void account.connect()}
          data-testid={props.testId ? `${props.testId}-connect` : undefined}
        >
          {view.action}
        </Button>
      ) : null}
    </div>
  );
}
