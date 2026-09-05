import { Fragment, useEffect, useRef, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import { Dot, IconButton, Pill, TopBar } from '../inkstone-ui.js';
import { useCopyText } from '../use-copy-text.js';

function ComposerDock(): ReactElement {
  const { state, dispatch } = useInkstone();
  const running = state.run === 'running';
  const pauseMode = running && !state.draft;
  return (
    <div className="composer-dock">
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

export function ChatPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const copyText = useCopyText();
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  const running = state.run === 'running';
  const messageCount = state.messages.length;

  useEffect(() => {
    if (messageCount > 0) {
      chatScrollRef.current?.scrollTo(0, 100000);
    }
  }, [messageCount]);

  return (
    <>
      <TopBar
        title={state.currentTitle}
        subtitle={
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
            main
          </Pill>
          <Pill onClick={go('plan')}>
            <Icon name="cards" />
            计划 2/4
          </Pill>
          <Pill onClick={go('review')}>
            <Icon name="git" />
            变更 3
          </Pill>
        </div>
      ) : null}
      <div className="screen-scroll chat-scroll" ref={chatScrollRef}>
        {!state.freshSession ? (
          <>
            <div className="message-head">
              <span className="avatar">予</span>你<time>09:32</time>
            </div>
            <div className="user-message">
              让会话拥有记忆。重新打开项目时，回到上次读到的地方，保留草稿，也记得展开过的工具。
              <br />
              <span className="pill" style={{ marginTop: 9 }}>
                <Icon name="file" />
                session-notes.md
              </span>
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
              Claude Sonnet<time>09:34</time>
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
        ) : (
          <div className="context-note">新的会话 · 以当前项目和模型开始</div>
        )}
        {state.messages.map((message, index) => (
          <Fragment key={index}>
            <div className="message-head">
              <span className="avatar">予</span>你<time>刚刚</time>
            </div>
            <div className="user-message">{message}</div>
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
