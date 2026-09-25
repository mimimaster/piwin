import type { CSSProperties, ReactElement } from 'react';
import { toModelRef } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot, IconButton } from '../inkstone-ui.js';
import type { InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { contextPercent, type SessionLiveState } from '../host/use-session-live-state.js';
import type { SessionQueueState } from '../host/use-session-queue.js';
import {
  planProgressLabel,
  todoProgressLabel,
  type SessionPlanTodo,
} from '../host/use-session-plan-todo.js';
import { ChatQueueStrip } from './chat-queue.js';
import { ChatTodoStrip } from './chat-todo.js';

/**
 * The inkstone slab. Sending, queueing and pausing are Host operations; the
 * slab only reflects Host run state (`activeRunId`) and relays the draft.
 */
export function ChatComposer({
  hostCtx,
  live,
  queue,
  planTodo,
}: {
  hostCtx: InkstoneHostContextValue;
  live: SessionLiveState;
  queue: SessionQueueState;
  planTodo: SessionPlanTodo;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host, modelSelection } = hostCtx;
  const running = host.activeRunId !== undefined;
  const draft = host.composerText.trim();
  const pauseMode = running && draft.length === 0;
  const percent = contextPercent(live.context);
  const planProgress = planProgressLabel(planTodo.plan);
  const selectedModel = host.configuredModels.find(
    (model) =>
      model.providerId === modelSelection.providerId && model.modelId === modelSelection.modelId,
  );

  const onSend = (): void => {
    if (running && draft.length === 0) {
      void host.handleAbort();
      return;
    }
    if (!running && draft.length === 0 && host.attachments.length === 0) {
      dispatch({ type: 'toast', message: '先写一句话，再发送' });
      return;
    }
    const level = modelSelection.thinkingLevel;
    void host.handleSend(
      {
        text: host.composerText,
        ...(selectedModel !== undefined
          ? {
              model: toModelRef({
                providerId: selectedModel.providerId,
                modelId: selectedModel.modelId,
                ...(selectedModel.protocol !== undefined ? { protocol: selectedModel.protocol } : {}),
                ...(selectedModel.source !== undefined ? { source: selectedModel.source } : {}),
              }),
            }
          : {}),
        ...(level !== undefined ? { thinkingLevel: level } : {}),
      },
      undefined,
      running ? host.activeRunId : undefined,
    );
  };

  return (
    <div className="composer-dock">
      <div className="dock-chips">
        <button
          className="dock-chip"
          onClick={() =>
            planTodo.plan !== null
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
        <button
          className="dock-chip"
          onClick={() => dispatch({ type: 'open-sheet', key: 'context' })}
          type="button"
        >
          <span className="ring" style={{ '--p': percent ?? 0 } as CSSProperties} />
          {percent === undefined ? '上下文' : `上下文 ${percent}%`}
        </button>
      </div>
      {todoProgressLabel(planTodo.todos) !== undefined ? <ChatTodoStrip todos={planTodo.todos} /> : null}
      <ChatQueueStrip queue={queue} activeRunId={host.activeRunId} />
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
        className={`composer ${running ? 'running' : ''} ${queue.queued.length > 0 ? 'queued' : ''}`.trim()}
      >
        <textarea
          aria-label="消息内容"
          placeholder={running ? '补充一句，会排在这一轮之后…' : '写下你的想法，或捎来一句话…'}
          rows={2}
          value={host.composerText}
          onChange={(event) => host.setComposerText(event.target.value)}
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
            disabled={host.isSending}
            aria-label={pauseMode ? '暂停运行' : running ? '排队发送' : '发送消息'}
            type="button"
          >
            <Icon name={pauseMode ? 'pause' : 'up'} />
          </button>
        </div>
      </div>
      <div className="composer-foot">
        <span>{host.connectionState.kind === 'ready' ? '已同步' : '正在连接 Host…'}</span>
      </div>
    </div>
  );
}
