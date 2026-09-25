import { useRef, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Dot, FullButton, IconButton, TopBar } from '../inkstone-ui.js';
import { useFollowTail } from '../../hooks/use-follow-tail.js';
import { endpointLabel } from './sessions.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { useSessionLiveState } from '../host/use-session-live-state.js';
import { useSessionQueue } from '../host/use-session-queue.js';
import { useSessionPlanTodo } from '../host/use-session-plan-todo.js';
import { useSessionWalkthroughs } from '../host/use-session-walkthroughs.js';
import { TranscriptView } from '../transcript/TranscriptView.js';
import { ChatComposer } from './chat-composer.js';
import { useWideLayout } from '../use-wide-layout.js';

export function ChatPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  const wide = useWideLayout();
  if (hostCtx === null) {
    return <OfflineChat />;
  }
  if (wide && hostCtx.host.activeSessionId === undefined) {
    return <PickSessionPrompt />;
  }
  // Remount per session so scroll-follow and fold state never leak across sessions.
  return <ConnectedChat key={hostCtx.host.activeSessionId ?? 'none'} hostCtx={hostCtx} />;
}

function ConnectedChat({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const wide = useWideLayout();
  const { host } = hostCtx;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const live = useSessionLiveState(host.client, host.activeSessionId);
  const queue = useSessionQueue(host.client, host.activeSessionId);
  const planTodo = useSessionPlanTodo(host.client, host.activeSessionId);
  const walkthroughs = useSessionWalkthroughs(host.client, host.activeSessionId);
  const session = host.sessions.find((item) => item.sessionId === host.activeSessionId);
  const running = host.activeRunId !== undefined;
  const paused = host.pausedCheckpointId !== undefined;
  const waiting = host.permissionRequest !== undefined || live.extensionUi !== undefined;

  useFollowTail({ axisRef: scrollRef, revision: transcriptRevision(host.messages, waiting) });

  return (
    <>
      <TopBar
        title={session?.name?.trim() || '会话'}
        subtitle={
          <>
            <Dot status={waiting ? 'waiting' : running ? 'running' : paused ? 'paused' : 'done'} />{' '}
            {waiting ? '等你决定' : running ? '正在工作' : paused ? '已暂停' : '等待你的下一笔'} ·{' '}
            {endpointLabel(host.endpoint)}
          </>
        }
        {...(wide ? {} : { onBack: () => dispatch({ type: 'navigate', route: 'sessions' }) })}
        right={
          <>
            <IconButton
              name="panelr"
              label="打开工作区"
              onClick={() => dispatch({ type: 'navigate', route: 'workspace' })}
            />
            <IconButton
              name="more"
              label="会话操作"
              onClick={() => dispatch({ type: 'open-sheet', key: 'session-menu' })}
            />
          </>
        }
      />
      <div className="screen-scroll chat-scroll" ref={scrollRef}>
        <TranscriptView
          host={host}
          live={live}
          queue={queue}
          walkthroughs={walkthroughs}
          onToast={(message) => dispatch({ type: 'toast', message })}
          onResolvePermission={(decision, scope) => {
            void host
              .handleResolvePermission(decision, host.permissionRequest?.requestId, scope)
              .then((resolved) => {
                if (resolved) {
                  dispatch({
                    type: 'toast',
                    message: decision === 'allow' ? '已允许 · Host 继续工作' : '已拒绝本次操作',
                  });
                }
              });
          }}
          onOpenPermissionDetail={() => dispatch({ type: 'open-sheet', key: 'permission' })}
          onOpenSession={(sessionId) => {
            void host.handleSelectSession(sessionId);
          }}
          onOpenChanges={() => {
            dispatch({ type: 'workspace-tab', tab: '变更' });
            dispatch({ type: 'navigate', route: 'workspace' });
          }}
        />
      </div>
      <ChatComposer hostCtx={hostCtx} live={live} queue={queue} planTodo={planTodo} />
    </>
  );
}

/** Follow the tail on new rows, streamed characters, tool status and gates. */
function transcriptRevision(
  messages: InkstoneHostContextValue['host']['messages'],
  waiting: boolean,
): string {
  let chars = 0;
  let tools = 0;
  for (const message of messages) {
    chars += message.text.length + (message.thinking?.length ?? 0);
    for (const tool of message.toolCalls ?? []) {
      tools += tool.status === 'running' ? 1 : 2;
    }
  }
  return `${messages.length}:${chars}:${tools}:${waiting ? 1 : 0}`;
}

/** Wide layout, nothing selected yet: the list on the left is the next step. */
function PickSessionPrompt(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <div className="screen-scroll">
      <div className="empty-state">
        <span className="brand-seal">砚</span>
        <h2>从左边挑一段会话。</h2>
        <p>或者开一页新的，Host 会接着干活。</p>
        <FullButton onClick={() => dispatch({ type: 'navigate', route: 'new' })}>新的一页</FullButton>
      </div>
    </div>
  );
}

function OfflineChat(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <TopBar title="会话" onBack={() => dispatch({ type: 'navigate', route: 'sessions' })} />
      <div className="screen-scroll">
        <div className="empty-state">
          <span className="brand-seal">砚</span>
          <h2>还没有连上 Host。</h2>
          <p>会话、模型和工具都在你的 Host 上。连上之后，这里就是那张书案。</p>
          <FullButton onClick={() => dispatch({ type: 'navigate', route: 'connect' })}>连接 Host</FullButton>
        </div>
      </div>
    </>
  );
}
