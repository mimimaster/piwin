/**
 * Devin web-search source body. The token stays in the subscription
 * auth file (`oauth:devin`); this card only explains that and runs a test.
 */
import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

export function WebDevinSourceCard(props: {
  zh: boolean;
  disabled: boolean;
  onTest: () => Promise<{ durationMs: number; resultCount: number }>;
}): ReactElement {
  const { zh, disabled, onTest } = props;
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  return (
    <div
      className="web-source-card-body"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      data-testid="web-search-devin-subscription"
    >
      <p className="muted">
        {zh
          ? '使用订阅页的 Devin 登录（oauth:devin），不会再存一份 token。'
          : 'Uses the Devin login from Subscriptions (oauth:devin). No second token is stored.'}
      </p>
      <Button
        variant="ghost"
        size="compact"
        disabled={disabled || testing}
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
        <p className="muted" data-testid="web-search-devin-test-result">
          {message}
        </p>
      ) : null}
    </div>
  );
}
