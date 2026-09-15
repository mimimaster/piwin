import { Fragment, useEffect, useRef, type ReactElement } from 'react';
import { toModelRef } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import { Dot, IconButton, Pill, TopBar } from '../inkstone-ui.js';
import { useCopyText } from '../use-copy-text.js';
import { MobileMarkdown } from '../../components/chat/MobileMarkdown.js';
import { MobileThinkingBlock } from '../../components/chat/MobileThinkingBlock.js';
import { endpointLabel } from './sessions.js';
import { formatModelLabel, mapPermissionGate, mapTranscriptRows } from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { ReconnectTranscript, ScopeOptionsSelector } from './reconnect-transcript.js';

function ComposerDock(): ReactElement {
  const { state, dispatch } = useInkstone();
  const running = state.run === 'running';
  const pauseMode = running && !state.draft;
  return (
    <div className="composer-dock">
      <div className="dock-chips">
        <button
          className="dock-chip"
          onClick={() => dispatch({ type: 'open-sheet', key: 'plan-menu' })}
          type="button"
        >
          <Icon name="list" />
          计划 2/4
        </button>
        <button
          className="dock-chip"
          onClick={() => dispatch({ type: 'navigate', route: 'tasks' })}
          type="button"
        >
          <Dot status={running ? 'running' : 'waiting'} />
          {state.scheme} · 后台 2
        </button>
        <button
          className="dock-chip"
          onClick={() => dispatch({ type: 'open-sheet', key: 'mounts' })}
          type="button"
        >
          <Icon name="book" />
          {state.mounts.length > 0 ? state.mounts[0] : '挂载知识库'}
        </button>
        <button
          className="dock-chip"
          onClick={() => dispatch({ type: 'open-sheet', key: 'context' })}
          type="button"
        >
          <span className="ring" style={{ '--p': 37 } as React.CSSProperties} />
          上下文 37%
        </button>
      </div>
      {state.queue !== '' ? (
        <div className="queue-strip">
          <Pill>排队 1</Pill>
          <span>{state.queue}</span>
          <button onClick={() => dispatch({ type: 'edit-queue' })} type="button">
            编辑
          </button>
          <button
            onClick={() => dispatch({ type: 'cancel-queue' })}
            aria-label="取消排队"
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      <div className={`composer ${running ? 'running' : ''}`.trim()}>
        {state.attachment !== '' ? (
          <div className="attachment-chip">
            <Icon name="file" />
            {state.attachment}
            <button
              onClick={() => dispatch({ type: 'remove-attachment' })}
              aria-label="移除附件"
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}
        <textarea
          aria-label="消息内容"
          placeholder={state.offline ? '先记下来，连接后再发送…' : '写下你的想法，或捎来一句话…'}
          rows={2}
          value={state.draft}
          onChange={(event) => dispatch({ type: 'set-draft', value: event.target.value })}
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
            {state.model} <Icon name="chevd" />
          </button>
          <IconButton
            name="mic"
            label="语音输入"
            onClick={() => dispatch({ type: 'open-sheet', key: 'dictation' })}
          />
          <button
            className={`icon-button send-button ${pauseMode ? 'pause' : ''}`.trim()}
            onClick={() => dispatch({ type: 'send' })}
            aria-label={pauseMode ? '暂停运行' : running ? '排队发送' : '发送消息'}
            type="button"
          >
            <Icon name={pauseMode ? 'pause' : 'up'} />
          </button>
        </div>
      </div>
      <div className="composer-foot">
        <button onClick={() => dispatch({ type: 'open-sheet', key: 'mode' })} type="button">
          {state.mode} · {state.scheme}
        </button>
        <span>
          上下文 <span className="mono">37%</span>
        </span>
        <button onClick={() => dispatch({ type: 'open-sheet', key: 'context' })} type="button">
          {state.offline ? '草稿保留在当前预览' : '已同步'}
        </button>
      </div>
    </div>
  );
}

function RealMessageRows({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const copyText = useCopyText();
  const host = hostCtx.host;
  const running = host.activeRunId !== undefined;
  const rows = mapTranscriptRows(host.messages);
  const lastAssistantIndex = rows.reduce(
    (found, row, index) => (row.kind === 'assistant' ? index : found),
    -1,
  );
  const lastRow = rows[rows.length - 1];
  const lastRowIsUser = lastRow?.kind === 'user';
  const hasStreamingAssistantRow = rows.some((row) => row.kind === 'assistant' && row.streaming);
  const selectedModel = host.configuredModels.find(
    (model) =>
      model.providerId === hostCtx.modelSelection.providerId &&
      model.modelId === hostCtx.modelSelection.modelId,
  );

  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === 'user') {
          return (
            <div className="user-message" key={row.id}>
              {row.text}
              {row.time !== '' ? <time className="user-time">{row.time}</time> : null}
              {row.attachments.map((name) => (
                <span
                  key={name}
                  className="pill"
                  style={{ marginTop: 9, display: 'inline-flex' }}
                >
                  <Icon name="file" />
                  {name}
                </span>
              ))}
            </div>
          );
        }
        if (row.kind === 'tools') {
          const runningTool = row.steps.some((step) => step.status === 'running');
          return (
            <details className="work-disclosure" open key={row.id}>
              <summary>
                <Dot status={runningTool ? 'running' : 'done'} />
                <span>
                  {row.label} · {row.steps.length} 次工具调用
                </span>
                <Icon name="chevd" />
              </summary>
              <div className="tool-thread">
                {row.steps.map((step, stepIndex) => (
                  <div className="tool-step" key={`${row.id}:${stepIndex}`}>
                    <Dot
                      status={
                        step.status === 'error'
                          ? 'waiting'
                          : step.status === 'running'
                            ? 'running'
                            : 'done'
                      }
                    />
                    {step.label}
                    {step.meta !== '' ? <span>{step.meta}</span> : null}
                  </div>
                ))}
              </div>
            </details>
          );
        }
        return (
          <Fragment key={row.id}>
            <div className="message-head">
              <span className="avatar">π</span>
              {row.model}
              {row.streaming ? (
                <span className="modern-streaming-indicator" style={{ marginLeft: 8 }}>
                  <span className="modern-pulse-dot" />
                  {row.text.length === 0 ? '正在思考…' : '正在输出…'}
                </span>
              ) : null}
              {row.time !== '' ? <time>{row.time}</time> : null}
            </div>
            {row.thinking ? (
              <MobileThinkingBlock
                thinking={row.thinking}
                isStreaming={row.streaming && row.text.length === 0}
              />
            ) : null}
            <div className="assistant-prose">
              {row.text.length > 0 ? (
                <MobileMarkdown content={row.text} isStreaming={row.streaming} />
              ) : row.streaming && !row.thinking ? (
                <div className="modern-streaming-placeholder">
                  <span className="modern-streaming-cursor" />
                </div>
              ) : null}
            </div>
            {index === lastAssistantIndex && !row.streaming && row.text.length > 0 ? (
              <div className="message-actions">
                <IconButton
                  name="copy"
                  label="复制回复"
                  onClick={() => {
                    void copyText(row.text);
                  }}
                />
                <small>点按复制正文</small>
              </div>
            ) : null}
          </Fragment>
        );
      })}
      {rows.length === 0 ? (
        <div className="context-note">新的会话 · 以当前项目和模型开始</div>
      ) : null}
      {running && lastRowIsUser && !hasStreamingAssistantRow ? (
        <div className="assistant-pending-state" style={{ marginTop: 8 }}>
          <div className="message-head">
            <span className="avatar">π</span>
            {formatModelLabel(selectedModel?.modelId)}
            <span className="modern-streaming-indicator" style={{ marginLeft: 8 }}>
              <span className="modern-pulse-dot" />
              Agent 正在思考…
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ConnectedChat({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host, modelSelection } = hostCtx;
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const session = host.sessions.find((item) => item.sessionId === host.activeSessionId);
  const running = host.activeRunId !== undefined;
  const paused = host.pausedCheckpointId !== undefined;
  const gate = mapPermissionGate(host.permissionRequest);
  const selectedModel = host.configuredModels.find(
    (model) =>
      model.providerId === modelSelection.providerId && model.modelId === modelSelection.modelId,
  );
  const rowCount = host.messages.length;
  const messageCountTotal = host.messages.reduce((sum, message) => sum + message.text.length, 0);

  useEffect(() => {
    chatScrollRef.current?.scrollTo(0, 100000);
  }, [rowCount, messageCountTotal]);

  const onSend = (): void => {
    const draft = host.composerText.trim();
    const hasAttachments = host.attachments.length > 0;
    if (running && draft.length === 0) {
      void host.handleAbort();
      return;
    }
    if (!running && draft.length === 0 && !hasAttachments) {
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
                ...(selectedModel.protocol !== undefined
                  ? { protocol: selectedModel.protocol }
                  : {}),
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

  const pauseMode = running && host.composerText.trim().length === 0;
  return (
    <>
      <TopBar
        title={session?.name?.trim() || '会话'}
        subtitle={
          <>
            <Dot status={running ? 'running' : paused ? 'waiting' : 'done'} />{' '}
            {running ? '正在工作' : paused ? '已暂停' : '等待你的下一笔'} ·{' '}
            {endpointLabel(host.endpoint)}
          </>
        }
        onBack={() => {
          dispatch({ type: 'navigate', route: 'sessions' });
        }}
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
      {gate !== undefined && host.permissionRequest !== undefined ? (
        <div style={{ padding: '0 16px 12px' }}>
          <article className="gate">
            <div className="spread">
              <Pill variant="zhu">
                <Dot status="waiting" />
                需要你的批准
              </Pill>
              <span className="muted mono" style={{ fontSize: 10 }}>
                {gate.destructive ? '破坏性操作' : 'Host 请求'}
              </span>
            </div>
            <h3>{gate.title}</h3>
            <p>{gate.detail}</p>
            {gate.command !== undefined ? <pre className="command">{gate.command}</pre> : null}
            <dl className="facts">
              {gate.cwd !== undefined ? (
                <>
                  <dt>工作目录</dt>
                  <dd className="mono">{gate.cwd}</dd>
                </>
              ) : null}
              <dt>作用范围</dt>
              <dd>按所选范围允许 · Host 执行</dd>
            </dl>
            <ScopeOptionsSelector scope={state.scope} onSelect={(scope) => dispatch({ type: 'set-scope', scope })} />
            <div className="gate-footer">
              <button
                className="text-link"
                onClick={() => dispatch({ type: 'open-sheet', key: 'permission' })}
                type="button"
              >
                展开详情
              </button>
              <div className="seals">
                <button
                  className="seal-button ghost"
                  onClick={() => {
                    void host
                      .handleResolvePermission(
                        'deny',
                        host.permissionRequest?.requestId,
                        state.scope,
                      )
                      .then((resolved) => {
                        if (resolved) dispatch({ type: 'toast', message: '已拒绝本次操作' });
                      });
                  }}
                  aria-label="拒绝"
                  type="button"
                >
                  否
                </button>
                <button
                  className="seal-button"
                  id="seal-allow"
                  onClick={() => {
                    void host
                      .handleResolvePermission(
                        'allow',
                        host.permissionRequest?.requestId,
                        state.scope,
                      )
                      .then((resolved) => {
                        if (resolved) {
                          dispatch({ type: 'toast', message: '已允许本次操作 · Host 继续工作' });
                        }
                      });
                  }}
                  aria-label="允许"
                  type="button"
                >
                  允
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}
      <div className="screen-scroll chat-scroll" ref={chatScrollRef}>
        <RealMessageRows hostCtx={hostCtx} />
      </div>
      <div className="composer-dock">
        <div className="dock-chips">
          <button
            className="dock-chip"
            onClick={() => dispatch({ type: 'open-sheet', key: 'plan-menu' })}
            type="button"
          >
            <Icon name="list" />
            计划
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
            <span className="ring" style={{ '--p': 37 } as React.CSSProperties} />
            上下文
          </button>
        </div>
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
        <div className={`composer ${running ? 'running' : ''}`.trim()}>
          <textarea
            aria-label="消息内容"
            placeholder="写下你的想法，或捎来一句话…"
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
              {selectedModel?.label?.trim() || selectedModel?.modelId || '模型'}{' '}
              <Icon name="chevd" />
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
          <span>{state.offline ? '' : '已同步'}</span>
        </div>
      </div>
    </>
  );
}



export function ChatPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedChat hostCtx={hostCtx} />;
  }
  const copyText = useCopyText();
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  const isReconnect = state.currentTitle === '修复移动端重连';
  const running = state.run === 'running' && !isReconnect;
  const messageCount = state.messages.length;

  useEffect(() => {
    const scrollToBottom = () => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    };
    scrollToBottom();
    const raf = requestAnimationFrame(scrollToBottom);
    const timer = setTimeout(scrollToBottom, 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [messageCount, state.currentTitle]);

  return (
    <>
      <TopBar
        title={state.currentTitle}
        subtitle={
          isReconnect ? (
            <>
              <Dot status={state.permission === 'pending' ? 'waiting' : 'done'} />{' '}
              {state.permission === 'pending' ? '等待批准' : '已就绪'} · piwin / feat/mobile-reconnect
            </>
          ) : (
            <>
              <Dot status={running ? 'running' : 'done'} />{' '}
              {running
                ? state.offline
                  ? '上次状态：工作中'
                  : '正在工作'
                : state.run === 'paused'
                  ? '已暂停'
                  : '等待你的下一笔'}{' '}
              · piwin
            </>
          )
        }
        onBack={go('sessions')}
        right={
          <>
            <IconButton name="panelr" label="打开工作区" onClick={go('workspace')} />
            <IconButton name="more" label="会话操作" onClick={openSheet('session-menu')} />
          </>
        }
      />
      {state.offline ? (
        <div className="banner-offline">
          <span>连接中断 · 上次同步 09:38</span>
          <button onClick={() => dispatch({ type: 'reconnect' })} type="button">
            重新连接
          </button>
        </div>
      ) : null}
      {!state.freshSession ? (
        <div className="chat-context">
          <Pill onClick={openSheet('branches')}>
            <Icon name="branch" />
            {isReconnect ? 'feat/mobile-reconnect' : 'main'}
          </Pill>
          <Pill onClick={go(isReconnect ? 'review' : 'plan')}>
            <Icon name={isReconnect ? 'git' : 'cards'} />
            {isReconnect ? '待写入 1' : '计划 2/4'}
          </Pill>
          {!isReconnect ? (
            <Pill onClick={go('review')}>
              <Icon name="git" />
              变更 3
            </Pill>
          ) : null}
        </div>
      ) : null}
      <div className="screen-scroll chat-scroll" ref={chatScrollRef}>
        {!state.freshSession ? (
          isReconnect ? (
            <ReconnectTranscript />
          ) : (
            <>
              <div className="user-message">
                <div className="user-message-body">
                  让会话拥有记忆。重新打开项目时，回到上次读到的地方，保留草稿，也记得展开过的工具。
                  <br />
                  <span className="pill" style={{ marginTop: 9 }}>
                    <Icon name="file" />
                    session-notes.md
                  </span>
                </div>
                <time className="user-time">09:32</time>
              </div>
            <div className="context-note">
              <Dot status="done" />
              <button onClick={openSheet('context')} type="button">
                已装配上下文 · 3 个文件 · 12.8k tokens
              </button>
            </div>
            <details className="work-disclosure" open>
              <summary>
                <Dot status={running ? 'running' : 'done'} />
                <span>{running ? '正在整理恢复逻辑' : '已完成本轮梳理'} · 3 次工具调用</span>
                <Icon name="chevd" />
              </summary>
              <div className="tool-thread">
                <div className="tool-step">
                  <Dot status="done" />
                  读取 <code>session-index.ts</code>
                  <span>0.2s</span>
                </div>
                <div className="tool-step">
                  <Dot status="done" />
                  检索 <code>restoreSession</code>
                  <span>0.6s</span>
                </div>
                <div className="tool-step">
                  <Dot status={running ? 'running' : 'done'} />
                  检查 <code>draft-store.ts</code>
                  <span>进行中</span>
                </div>
              </div>
            </details>
            <div className="message-head">
              <span className="avatar">π</span>
              Claude Sonnet
              <time>09:34</time>
            </div>
            <div className="assistant-prose">
              <p>记忆应该安静地发生。</p>
              <p>
                我把恢复分成两层：Host
                记住会话本身，设备记住你阅读的位置。再次打开时，先还原上次的纸面，再接上新的内容。
              </p>
            </div>
            <button className="inline-preview" onClick={go('plan')} type="button">
              <Icon name="cards" />
              <span className="grow">
                <strong>会话恢复 · 实施计划</strong>
                <small>2 / 4 步已完成 · 1 个子代理工作中</small>
              </span>
              <Icon name="chevr" />
            </button>
            <button className="inline-preview" onClick={go('review')} type="button">
              <Icon name="git" />
              <span className="grow">
                <strong>3 个文件已变更</strong>
                <small>
                  <span className="green">+48</span> <span className="red">−12</span> · 点开审阅
                </small>
              </span>
              <Icon name="chevr" />
            </button>
            {state.candidate === 'pending' ? (
              <article className="card">
                <div className="spread">
                  <span className="pill">
                    <Icon name="fork" />
                    doc-writer · 已交付
                  </span>
                  <span className="muted mono" style={{ fontSize: 10 }}>
                    {state.scheme}
                  </span>
                </div>
                <h3 className="card-title">候选变更：同步恢复说明</h3>
                <ul className="check-list">
                  <li className="ok">
                    <b>✓</b>文档与实现的函数名一致
                  </li>
                  <li className="ok">
                    <b>✓</b>未改动公共接口
                  </li>
                  <li className="warn">
                    <b>!</b>README 里的示例路径需要确认
                  </li>
                </ul>
                <div className="card-foot">
                  <span>
                    2 个文件 · <span className="green">+31</span> <span className="red">−4</span> · 独立工作树
                  </span>
                  <button
                    className="text-link"
                    onClick={() => dispatch({ type: 'open-subagent', subagent: 'doc-writer' })}
                    type="button"
                  >
                    看差异 <Icon name="chevr" />
                  </button>
                </div>
                <div className="button-row">
                  <button
                    className="full-button"
                    onClick={() => dispatch({ type: 'candidate-decision', decision: 'merged' })}
                    type="button"
                  >
                    合入
                  </button>
                  <button
                    className="full-button secondary"
                    onClick={() => dispatch({ type: 'candidate-decision', decision: 'rejected' })}
                    type="button"
                  >
                    让主代理处理
                  </button>
                </div>
              </article>
            ) : (
              <div className="sealed">
                <span className={`seal-mini ${state.candidate === 'merged' ? 'pine' : 'ghost'}`}>
                  {state.candidate === 'merged' ? '合' : '交'}
                </span>
                <span className="grow">
                  {state.candidate === 'merged'
                    ? '已合入 doc-writer 的 2 个文件'
                    : '已交还主代理，确认 README 示例路径'}
                  <small>审阅交付 · 刚刚</small>
                </span>
              </div>
            )}
            {state.handover ? (
              <div className="handover">
                <span className="eyebrow">LIVE · 交接卡</span>
                <p>“把刚才的恢复方案整理一下，先列计划，不要开始修改。”</p>
                <div className="button-row">
                  <button
                    className="full-button"
                    onClick={() => dispatch({ type: 'handover-draft' })}
                    type="button"
                  >
                    放入砚台
                  </button>
                  <button
                    className="full-button secondary"
                    onClick={() => dispatch({ type: 'handover-send' })}
                    type="button"
                  >
                    直接发送
                  </button>
                </div>
              </div>
            ) : null}
            {state.permission === 'approved' ? (
              <p className="context-note green">允 · 已允许本次操作，Host 继续工作。</p>
            ) : null}
            {state.comment !== '' ? (
              <div className="quote-note">审阅意见：{state.comment}</div>
            ) : null}
            <div className="message-actions">
              <IconButton
                name="copy"
                label="复制回复"
                onClick={() => {
                  void copyText('记忆应该安静地发生。Host 记住会话本身，设备记住你阅读的位置。');
                }}
              />
              <IconButton name="fork" label="从这里分叉" onClick={openSheet('branches')} />
              <IconButton
                name="refresh"
                label="重新生成"
                onClick={() => dispatch({ type: 'regenerate' })}
              />
              <small>2.4k tokens · 12s</small>
            </div>
          </>
          )
        ) : (
          <div className="context-note">新的会话 · 以当前项目和模型开始</div>
        )}
        {state.messages.map((message, index) => (
          <Fragment key={index}>
            <div className="user-message">
              <div className="user-message-body">{message}</div>
              <time className="user-time">刚刚</time>
            </div>
            <p className="context-note">
              <Dot status="running" />
              已进入本轮演示，等待 Agent 继续
            </p>
          </Fragment>
        ))}
      </div>
      <ComposerDock />
    </>
  );
}
