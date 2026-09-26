import type { CSSProperties, ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot, IconButton } from '../inkstone-ui.js';
import type { InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { findSelectedModel, sendComposerText } from '../host/composer-send.js';
import { contextPercent, type SessionLiveState } from '../host/use-session-live-state.js';
import type { SessionQueueState } from '../host/use-session-queue.js';
import {
  planProgressLabel,
  todoProgressLabel,
  type SessionPlanTodo,
} from '../host/use-session-plan-todo.js';
import type { SessionMode } from '../session-mode.js';
import { ChatQueueStrip } from './chat-queue.js';
import { ChatTodoStrip } from './chat-todo.js';

/** A conversation only earns a context chip once the window is nearly full. */
const CHAT_CONTEXT_WARN_PERCENT = 80;

/** Live Host state for an existing session; a draft has none yet. */
export interface ComposerSessionState {
  live: SessionLiveState;
  queue: SessionQueueState;
  planTodo: SessionPlanTodo;
}

export interface ComposerDraft {
  /**
   * The draft owns its text: the Host hook's composer text is filed per
   * session, and a draft has no session to file it under yet.
   */
  text: string;
  setText: (text: string) => void;
  /** Agent drafts show their project as a chip; undefined for conversations. */
  projectLabel: string | undefined;
  busy: boolean;
  onSend: () => void;
}

/**
 * The inkstone slab. Sending, queueing and pausing are Host operations; the
 * slab only reflects Host run state (`activeRunId`) and relays the draft.
 * Conversations get a plain chat slab; Agent sessions add the work chips.
 */
export function ChatComposer({
  hostCtx,
  mode,
  session,
  draft,
}: {
  hostCtx: InkstoneHostContextValue;
  mode: SessionMode;
  session?: ComposerSessionState;
  draft?: ComposerDraft;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const running = draft === undefined && host.activeRunId !== undefined;
  const value = draft?.text ?? host.composerText;
  const text = value.trim();
  const pauseMode = running && text.length === 0;
  const selectedModel = findSelectedModel(hostCtx);

  const onSend = (): void => {
    if (draft !== undefined) {
      if (text.length === 0) {
        dispatch({ type: 'toast', message: '先写一句话，再发送' });
        return;
      }
      draft.onSend();
      return;
    }
    if (pauseMode) {
      void host.handleAbort();
      return;
    }
    if (!running && text.length === 0 && host.attachments.length === 0) {
      dispatch({ type: 'toast', message: '先写一句话，再发送' });
      return;
    }
    void sendComposerText(hostCtx);
  };

  return (
    <div className="composer-dock">
      <ComposerChips hostCtx={hostCtx} mode={mode} session={session} draft={draft} />
      {session !== undefined && todoProgressLabel(session.planTodo.todos) !== undefined ? (
        <ChatTodoStrip todos={session.planTodo.todos} />
      ) : null}
      {session !== undefined ? <ChatQueueStrip queue={session.queue} activeRunId={host.activeRunId} /> : null}
      {host.attachments.length > 0 ? (
        <div className="attachment-chip">
          <Icon name="file" />
          {host.attachments.length} 个附件
          <button
            onClick={() => host.removeAttachment(host.attachments[0]?.id ?? '')}
            aria-label="移除附件"
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      <div
        className={`composer ${running ? 'running' : ''} ${(session?.queue.queued.length ?? 0) > 0 ? 'queued' : ''}`.trim()}
      >
        <textarea
          aria-label="消息内容"
          placeholder={
            running
              ? '补充一句，会排在这一轮之后…'
              : mode === 'agent'
                ? '让 Agent 做点什么…'
                : '发消息…'
          }
          rows={2}
          autoFocus={draft !== undefined}
          value={value}
          onChange={(event) =>
            draft !== undefined ? draft.setText(event.target.value) : host.setComposerText(event.target.value)
          }
        />
        <div className="composer-actions">
          <IconButton
            name="plus"
            label="添加附件与上下文"
            onClick={() => dispatch({ type: 'open-sheet', key: 'attach' })}
          />
          <button
            className="model-button"
            onClick={() => dispatch({ type: 'open-sheet', key: 'model' })}
            type="button"
          >
            {selectedModel?.label?.trim() || selectedModel?.modelId || '模型'} <Icon name="chevd" />
          </button>
          <IconButton
            name="mic"
            label="语音输入"
            onClick={() => dispatch({ type: 'open-sheet', key: 'dictation' })}
          />
          <button
            className={`icon-button send-button ${pauseMode ? 'pause' : ''}`.trim()}
            onClick={onSend}
            disabled={host.isSending || draft?.busy === true}
            aria-label={pauseMode ? '暂停运行' : running ? '排队发送' : '发送消息'}
            type="button"
          >
            <Icon name={pauseMode ? 'pause' : 'up'} />
          </button>
        </div>
      </div>
      {host.connectionState.kind !== 'ready' || draft?.busy === true ? (
        <div className="composer-foot">
          <span>{host.connectionState.kind !== 'ready' ? '正在连接 Host…' : '正在创建会话…'}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The chip row above the slab: only what this kind of session can use. */
function ComposerChips({
  hostCtx,
  mode,
  session,
  draft,
}: {
  hostCtx: InkstoneHostContextValue;
  mode: SessionMode;
  session: ComposerSessionState | undefined;
  draft: ComposerDraft | undefined;
}): ReactElement | null {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const running = host.activeRunId !== undefined;
  const percent = session === undefined ? undefined : contextPercent(session.live.context);
  const planProgress = session === undefined ? undefined : planProgressLabel(session.planTodo.plan);
  const showWorkChips = mode === 'agent' && session !== undefined;
  const showContext =
    percent !== undefined && (mode === 'agent' || percent >= CHAT_CONTEXT_WARN_PERCENT);
  const showProject = draft !== undefined && mode === 'agent';
  const showHealth = host.includeAppleHealth;
  if (!showWorkChips && !showContext && !showProject && !showHealth) {
    return null;
  }
  return (
    <div className="dock-chips">
      {showProject ? (
        <button
          className="dock-chip"
          onClick={() => dispatch({ type: 'open-sheet', key: 'draft-project' })}
          type="button"
        >
          <Icon name="folder" />
          {draft.projectLabel ?? '无项目 · 按对话开始'}
          <Icon name="chevd" />
        </button>
      ) : null}
      {showHealth ? (
        <button
          className="dock-chip health"
          onClick={() => host.setIncludeAppleHealth(false)}
          aria-label="本轮不附带 Apple Health"
          type="button"
        >
          <Icon name="drop" />
          Apple Health
          <Icon name="close" />
        </button>
      ) : null}
      {showWorkChips ? (
        <>
          <button
            className="dock-chip"
            onClick={() =>
              session.planTodo.plan !== null
                ? dispatch({ type: 'navigate', route: 'plan' })
                : dispatch({ type: 'open-sheet', key: 'plan-menu' })
            }
            type="button"
          >
            <Icon name="list" />
            {planProgress === undefined ? '计划' : `计划 ${planProgress}`}
          </button>
          <button
            className="dock-chip"
            onClick={() => dispatch({ type: 'navigate', route: 'workspace' })}
            type="button"
          >
            <Icon name="folder" />
            工作区
          </button>
          <button
            className="dock-chip"
            onClick={() => dispatch({ type: 'navigate', route: 'tasks' })}
            type="button"
          >
            <Dot status={running ? 'running' : 'waiting'} />
            {running ? '工作中' : '任务'}
          </button>
        </>
      ) : null}
      {showContext ? (
        <button
          className="dock-chip"
          onClick={() => dispatch({ type: 'open-sheet', key: 'context' })}
          type="button"
        >
          <span className="ring" style={{ '--p': percent } as CSSProperties} />
          {`上下文 ${percent}%`}
        </button>
      ) : null}
    </div>
  );
}
