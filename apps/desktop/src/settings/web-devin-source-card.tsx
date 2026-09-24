/**
 * Devin web-search source body. The token stays in the Host OAuth sign-in
 * (`oauth:devin`); this card shows whether that account is connected, lets the
 * user connect it in place, and tests the source once both are in order.
 */
import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

import { DevinAccountRow } from './devin-account-row.js';
import { useDevinAccount } from './use-devin-account.js';

export function WebDevinSourceCard(props: {
  zh: boolean;
  /** The source exists in the draft; before that the test has nothing to query. */
  enabled: boolean;
  disabled: boolean;
  onTest: () => Promise<{ durationMs: number; resultCount: number }>;
}): ReactElement {
  const { zh, enabled, disabled, onTest } = props;
  const account = useDevinAccount();
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const canTest = enabled && account.connected && !disabled;

  return (
    <div
      className="web-source-card-body devin-credential"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      data-testid="web-search-devin-subscription"
    >
      <DevinAccountRow account={account} zh={zh} disabled={disabled} testId="web-search-devin-account" />
      <p className="devin-credential-hint">
        {zh
          ? '搜索直接复用 Devin 登录的令牌，不会再存一份。'
          : 'Search reuses the Devin sign-in token; nothing is stored twice.'}
        {enabled ? null : zh ? ' 打开右侧开关后可测试连接。' : ' Turn the switch on to test the connection.'}
      </p>
      <div className="devin-credential-actions">
        <Button
          variant="ghost"
          size="compact"
          disabled={!canTest || testing}
          data-testid="web-search-devin-test"
          onClick={() => {
            setTesting(true);
            setMessage(null);
            void onTest()
              .then((result) => {
                setMessage(
                  zh
                    ? `连接成功 · ${result.resultCount} 条 · ${result.durationMs}ms`
                    : `Connected · ${result.resultCount} results · ${result.durationMs}ms`,
                );
              })
              .catch((error: unknown) => {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : zh
                      ? 'Devin 搜索连接测试失败'
                      : 'Devin search connection test failed',
                );
              })
              .finally(() => {
                setTesting(false);
              });
          }}
        >
          {testing ? (zh ? '检测中…' : 'Testing…') : zh ? '测试连接' : 'Test connection'}
        </Button>
        {message ? (
          <span className="devin-credential-hint" data-testid="web-search-devin-test-result">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
