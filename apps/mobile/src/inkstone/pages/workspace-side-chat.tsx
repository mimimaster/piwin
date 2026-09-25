import { useState, type ReactElement } from 'react';
import type { SessionSummary } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { FullButton, ListRow, ScreenHeading } from '../inkstone-ui.js';
import { isObject, useHostQuery } from '../host/use-host-query.js';

/**
 * Workspace › 侧聊: a side chat is an ordinary Host session that inherits a
 * bounded snapshot of this one (`side-chat/open`). The phone lists them and
 * opens them in the normal chat surface; context capture stays on the Host.
 */
export function WorkspaceSideChat({
  client,
  sessionId,
  onOpenSession,
  onToast,
}: {
  client: HostClient | undefined;
  sessionId: string | undefined;
  onOpenSession: (sessionId: string) => void;
  onToast: (message: string) => void;
}): ReactElement {
  const [opening, setOpening] = useState(false);
  const { state } = useHostQuery(
    client,
    { type: 'side-chat/list', sourceSessionId: sessionId ?? '' },
    readSideChats,
  );

  if (sessionId === undefined) {
    return <ScreenHeading title="侧聊" subtitle="先打开一个会话" />;
  }

  const open = (): void => {
    if (client === undefined) return;
    setOpening(true);
    client
      .request({ type: 'side-chat/open', sourceSessionId: sessionId })
      .then((response) => {
        const id = response.success && isObject(response.data) ? response.data.sideChatSessionId : undefined;
        if (typeof id === 'string') onOpenSession(id);
        else onToast(response.success ? 'Host 没有返回侧聊会话。' : response.error);
      })
      .catch((reason: unknown) => onToast(reason instanceof Error ? reason.message : '打开侧聊失败'))
      .finally(() => setOpening(false));
  };

  return (
    <>
      <ScreenHeading title="侧聊" subtitle="带着这段对话的上下文，另开一页问别的" />
      {state.kind === 'ready' ? (
        state.data.length === 0 ? (
          <p className="muted">还没有侧聊。</p>
        ) : (
          state.data.map((session) => (
            <ListRow
              key={session.id}
              name="chat"
              title={session.name?.trim() || '侧聊'}
              subtitle={`${session.messageCount} 条消息 · ${session.updatedAt.slice(5, 16).replace('T', ' ')}`}
              onClick={() => onOpenSession(session.id)}
            />
          ))
        )
      ) : (
        <p className={state.kind === 'error' ? 'error-text' : 'muted'}>
          {state.kind === 'error' ? state.message : state.kind === 'unsupported' ? '当前 Host 未开放侧聊。' : '正在读取侧聊…'}
        </p>
      )}
      <FullButton onClick={open} disabled={opening || state.kind === 'unsupported'}>
        {opening ? '正在打开…' : '开一个侧聊'}
      </FullButton>
    </>
  );
}

function readSideChats(data: unknown): SessionSummary[] | undefined {
  if (!isObject(data) || !Array.isArray(data.sessions)) return undefined;
  return data.sessions.filter(
    (session): session is SessionSummary => isObject(session) && typeof session.id === 'string',
  );
}
