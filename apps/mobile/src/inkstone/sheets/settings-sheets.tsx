import { useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, ListRow } from '../inkstone-ui.js';
import { Icon } from '../icons.js';
import { SETTINGS_GROUPS } from '../pages/settings.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';

export function SettingsSearchSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [query, setQuery] = useState('');
  const matches = SETTINGS_GROUPS.flatMap(([, items]) => items).filter((title) =>
    title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <label className="search-field">
        <Icon name="search" />
        <input
          aria-label="搜索设置"
          placeholder="模型、权限、冷存储…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div>
        {matches.length > 0 ? (
          matches.map((title) => (
            <ListRow
              key={title}
              name="sliders"
              title={title}
              onClick={() => dispatch({ type: 'settings-section', section: title })}
            />
          ))
        ) : (
          <div className="empty-state">
            <p>没有找到这项设置。</p>
          </div>
        )}
      </div>
    </>
  );
}

/** Ask the Host to compact the active session's context; the Host decides how. */
function CompactContextSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedCompactSheet hostCtx={hostCtx} />;
}

function ConnectedCompactSheet({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const compact = true;
  const { dispatch } = useInkstone();
  const client = hostCtx.host.client;
  const sessionId = hostCtx.host.activeSessionId;
  const [message, setMessage] = useState<string | undefined>();
  const runCompact = async (): Promise<void> => {
    if (client === undefined || sessionId === undefined || !client.supportsCommand('session/compact')) return;
    const response = await client.request({ type: 'session/compact', sessionId });
    setMessage(response.success ? 'Host 已接受上下文压缩请求。' : response.error);
  };
  return (
    <>
      {client === undefined ? <p className="muted">正在连接 Host…</p> : null}
      {compact ? (
        <>
          <p>请求 Host 整理并压缩当前会话上下文，结果以 Host 返回为准。</p>
          <FullButton onClick={() => void runCompact()} disabled={client === undefined || sessionId === undefined || !client.supportsCommand('session/compact')}>请求 Host 压缩</FullButton>
        </>
      ) : <p>当前页面只展示 Host 实时数据；移动端不会显示或保存固定示例内容。</p>}
      {message !== undefined ? <p className="quote-note">{message}</p> : null}
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
    </>
  );
}

export const SETTINGS_SHEETS: Record<string, { title: string; render: () => ReactElement }> = {
  'compact-context': {
    title: '压缩上下文',
    render: () => (
      <CompactContextSheet />
    ),
  },};
