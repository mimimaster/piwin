import { useEffect, useRef, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Dot, FullButton, IconButton, TopBar } from '../inkstone-ui.js';
import { Icon } from '../icons.js';
import { useFollowTail } from '../../hooks/use-follow-tail.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { useSessionLiveState } from '../host/use-session-live-state.js';
import { useSessionQueue } from '../host/use-session-queue.js';
import { useSessionPlanTodo } from '../host/use-session-plan-todo.js';
import { useSessionWalkthroughs } from '../host/use-session-walkthroughs.js';
import { TranscriptView } from '../transcript/TranscriptView.js';
import { ChatComposer } from './chat-composer.js';
import { DraftChat } from './chat-draft.js';
import { composerTurnOptions } from '../host/composer-send.js';
import { pickDefaultAgentProjectId, sessionModeOf } from '../session-mode.js';
import { useWideLayout } from '../use-wide-layout.js';

export function ChatPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  const wide = useWideLayout();
  const { state } = useInkstone();
  if (hostCtx === null) {
    return <OfflineChat />;
  }
  if (state.draft !== null) {
    return <DraftChat hostCtx={hostCtx} draft={state.draft} />;
  }
  if (hostCtx.host.activeSessionId === undefined) {
    if (wide) {
      return <PickSessionPrompt />;
    }
    // Nothing selected on a phone: the page is a blank conversation, not a dead end.
    const { host } = hostCtx;
    return (
      <DraftChat
        hostCtx={hostCtx}
        draft={{
          mode: state.sessionMode,
          projectId:
            state.sessionMode === 'agent'
              ? pickDefaultAgentProjectId(host.sessions, host.projects)
              : undefined,
        }}
      />
    );
  }
  // Remount per session so scroll-follow and fold state never leak across sessions.
  return <ConnectedChat key={hostCtx.host.activeSessionId ?? 'none'} hostCtx={hostCtx} />;
}

function ConnectedChat({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
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
  const mode = sessionModeOf(session);
  useFirstSendFromDraft(hostCtx, state.pendingFirstSend, () => dispatch({ type: 'first-send-done' }));

  const tail = useFollowTail({ axisRef: scrollRef, revision: transcriptRevision(host.messages, waiting) });

  return (
    <>
      <TopBar
        title={session?.name?.trim() || '会话'}
        {...chatSubtitle({
          status: waiting ? 'waiting' : running ? 'running' : paused ? 'paused' : 'idle',
          projectName:
            mode === 'agent'
              ? host.projects.find((project) => project.projectId === session?.projectId)?.displayName
              : undefined,
        })}
        {...(wide ? {} : { onBack: () => dispatch({ type: 'navigate', route: 'sessions' }) })}
        right={
          <>
            {mode === 'agent' ? (
              <IconButton
                name="panelr"
                label="打开工作区"
                onClick={() => dispatch({ type: 'navigate', route: 'workspace' })}
              />
            ) : null}
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
          // Walkthrough reports review code changes; a conversation has none to review.
          walkthroughs={mode === 'agent' ? walkthroughs : { ...walkthroughs, canGenerate: false }}
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
      {!tail.atTail ? (
        <div className="jump-anchor">
          <button className="jump-latest" type="button" aria-label="回到最新" onClick={tail.jumpToTail}>
            <Icon name="chevd" />
          </button>
        </div>
      ) : null}
      <ChatComposer hostCtx={hostCtx} mode={mode} session={{ live, queue, planTodo }} />
    </>
  );
}

const STATUS_LABELS = { waiting: '等你决定', running: '正在工作', paused: '已暂停' } as const;

/**
 * The header only speaks when something is happening. Idle, an Agent session
 * names its project and a conversation shows its title alone; the Host
 * address belongs on the connection screen, not on every page.
 */
function chatSubtitle({
  status,
  projectName,
}: {
  status: keyof typeof STATUS_LABELS | 'idle';
  projectName: string | undefined;
}): { subtitle?: ReactElement } {
  if (status !== 'idle') {
    return {
      subtitle: (
        <>
          <Dot status={status} /> {STATUS_LABELS[status]}
        </>
      ),
    };
  }
  return projectName === undefined ? {} : { subtitle: <>{projectName}</> };
}

/**
 * A session created from a draft still owes its first message. Send it once
 * this page shows that session and the Host has reconciled its foreground run,
 * so the send uses the new session's state rather than the one left behind.
 */
function useFirstSendFromDraft(
  hostCtx: InkstoneHostContextValue,
  pending: { sessionId: string; text: string } | null,
  onDone: () => void,
): void {
  const { host } = hostCtx;
  const ready =
    pending !== null &&
    pending.sessionId === host.activeSessionId &&
    host.mutationsEnabled &&
    !host.isSending;
  useEffect(() => {
    if (!ready || pending === null) return;
    onDone();
    // A failed send puts the text back in the slab (see handleSend).
    void host.handleSend({ text: pending.text, ...composerTurnOptions(hostCtx) });
    // Only readiness triggers this; the callbacks are re-created each render.
  }, [ready]);
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
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const defaultProjectId =
    hostCtx !== null && state.sessionMode === 'agent'
      ? pickDefaultAgentProjectId(hostCtx.host.sessions, hostCtx.host.projects)
      : undefined;
  return (
    <div className="screen-scroll">
      <div className="empty-state">
        <span className="brand-seal">砚</span>
        <h2>从左边挑一段会话。</h2>
        <p>或者开一页新的，Host 会接着干活。</p>
        <FullButton
          onClick={() =>
            dispatch({ type: 'start-draft', draft: { mode: state.sessionMode, projectId: defaultProjectId } })
          }
        >
          新对话
        </FullButton>
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
