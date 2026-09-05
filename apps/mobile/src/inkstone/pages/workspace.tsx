import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  Dot,
  FullButton,
  IconButton,
  ListRow,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import { DiffCard } from './review.js';

function FileRows(): ReactElement {
  const { dispatch } = useInkstone();
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <ListRow
        name="folder"
        title="packages"
        subtitle="Host 的项目文件"
        onClick={openSheet('folder')}
      />
      <ListRow
        name="folder"
        title="apps"
        subtitle="desktop · mobile · cli"
        onClick={openSheet('folder')}
      />
      <ListRow
        name="folder"
        title="docs"
        subtitle="设计、计划与架构"
        onClick={openSheet('folder')}
      />
      <ListRow
        name="file"
        title="session-index.ts"
        subtitle="packages/session/src · 已修改"
        onClick={openSheet('file')}
      />
      <ListRow
        name="file"
        title="draft-store.ts"
        subtitle="packages/session/src · 新增"
        onClick={openSheet('file')}
      />
      <ListRow
        name="file"
        title="README.md"
        subtitle="项目说明 · 4.2 KB"
        onClick={() => dispatch({ type: 'open-workspace', tab: '文档' })}
      />
    </>
  );
}

function NoteInspector(): ReactElement {
  const { state, dispatch } = useInkstone();
  const [text, setText] = useState(state.note);
  return (
    <>
      <ScreenHeading title="随手记" subtitle="与当前会话关联" />
      <label className="field">
        移动端的三点想法
        <textarea rows={9} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'save-note', value: text })}>
        保存笔记
      </FullButton>
      <FullButton
        variant="subtle"
        onClick={() => dispatch({ type: 'add-context', value: '移动端的三点想法' })}
      >
        把笔记加入对话
      </FullButton>
    </>
  );
}

const WORKSPACE_TABS = ['文件', '终端', '变更', '浏览器', '画布', '文档', '笔记', '卡片', '侧聊'];

export function WorkspacePage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [state.workspaceTab]);

  return (
    <>
      <TopBar
        title="工作区"
        subtitle="piwin · 与当前会话关联"
        onBack={go('chat')}
        right={<IconButton name="plus" label="工作区入口" onClick={openSheet('workspace-menu')} />}
      />
      <TabsRow
        items={WORKSPACE_TABS}
        selected={state.workspaceTab}
        onSelect={(tab) => dispatch({ type: 'workspace-tab', tab })}
        extra="workspace-tabs"
      />
      <div className="screen-scroll" ref={scrollRef}>
        {state.workspaceTab === '文件' ? (
          <>
            <ScreenHeading title="项目文件" subtitle="piwin / main" />
            <FileRows />
          </>
        ) : state.workspaceTab === '终端' ? (
          <>
            <ScreenHeading title="终端输出" subtitle="Host · zsh · 只读快照" />
            <Pill>
              <Dot status="done" />
              退出码 0
            </Pill>
            <pre className="terminal">
              <span className="muted">~/Developer/piwin</span>
              {'\n'}$ pnpm --filter @piwin/session test
              {'\n\n'}
              RUN v3.0.5
              {'\n\n'}
              <span className="green"> ✓ session-index.test.ts (8)</span>
              {'\n'}
              <span className="green"> ✓ draft-store.test.ts (6)</span>
              {'\n\n'}
              {' Test Files  2 passed (2)\n      Tests  14 passed (14)\n   Duration  1.42s\n\n'}
              <span className="muted">输出快照 · 09:38:12</span>
            </pre>
            <FullButton variant="secondary" onClick={openSheet('terminal-command')}>
              请 Agent 执行下一条命令
            </FullButton>
            <div className="quote-note">
              手机查看 Host 上的输出。命令先回到会话，由 Agent 执行。
            </div>
          </>
        ) : state.workspaceTab === '变更' ? (
          <>
            <ScreenHeading title="本轮变更" subtitle="3 个文件 · +48 −12" />
            <DiffCard />
            <FullButton variant="secondary" onClick={go('review')}>
              打开完整审阅
            </FullButton>
          </>
        ) : state.workspaceTab === '浏览器' ? (
          <>
            <ScreenHeading title="Host 浏览器" subtitle="当前标签页 · 预览快照" />
            <div className="search-field">
              <Icon name="globe" />
              <span className="mono" style={{ fontSize: 11 }}>
                localhost:5173
              </span>
            </div>
            <div className="note-paper">
              <span className="eyebrow">PIWIN / INKSTONE</span>
              <h3 style={{ marginTop: 20 }}>一张纸，一块砚。</h3>
              <p>让思路有安放的地方。</p>
              <hr />
              <p>会话 · 项目 · 案头</p>
              <Pill variant="pine" style={{ marginTop: 20 }}>
                示例页面快照
              </Pill>
            </div>
            <FullButton
              variant="secondary"
              onClick={() => dispatch({ type: 'add-context', value: '浏览器页面快照' })}
            >
              把页面加入对话
            </FullButton>
            <ListRow
              name="term"
              title="控制台"
              subtitle="0 条错误 · 查看示例输出"
              onClick={openSheet('console')}
            />
          </>
        ) : state.workspaceTab === '画布' ? (
          <>
            <ScreenHeading title="Artifact 画布" subtitle="阅读预览 · 按需查看源码" />
            <div className="note-paper">
              <span className="eyebrow">SESSION MEMORY / 01</span>
              <h3 style={{ marginTop: 20 }}>一份安静的记忆</h3>
              <p>
                会话内容交给 Host，
                <br />
                阅读位置留在设备，
                <br />
                每次回来，都从这里开始。
              </p>
              <hr />
              <div className="spread">
                <Pill>Host · 会话</Pill>→<Pill>设备 · 视图</Pill>
              </div>
            </div>
            <FullButton variant="secondary" onClick={openSheet('artifact-source')}>
              查看源码
            </FullButton>
            <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
              原型为静态画布。产品中的 Artifact 使用隔离预览。
            </p>
          </>
        ) : state.workspaceTab === '文档' ? (
          <>
            <ScreenHeading title="会话记忆设计" subtitle="session-memory.md · 阅读模式" />
            <article className="note-paper">
              <span className="eyebrow">设计笔记 / 2026.09</span>
              <h3 style={{ marginTop: 18 }}>
                恢复的是思路，
                <br />
                也是上下文。
              </h3>
              <p>
                同一个会话可以在不同的设备继续。手机带走的是观察和输入的能力，执行仍然留在 Host。
              </p>
              <hr />
              <p>
                一、先恢复历史与草稿。
                <br />
                二、再接上最新的活动。
                <br />
                三、不重复发送旧的命令。
              </p>
            </article>
            <FullButton
              variant="secondary"
              onClick={() =>
                dispatch({ type: 'add-context', value: 'session-memory.md · 恢复设计' })
              }
            >
              引用这段到会话
            </FullButton>
          </>
        ) : state.workspaceTab === '笔记' ? (
          <NoteInspector />
        ) : state.workspaceTab === '卡片' ? (
          <>
            <ScreenHeading title="本次对话的卡片" subtitle="3 张 · 架构与设计" />
            <ListRow
              name="cards"
              title="Host 为什么是唯一权威？"
              subtitle="翻面、浏览或加入计划复习"
              onClick={go('cards')}
            />
            <ListRow
              name="cards"
              title="阅读状态由谁记录？"
              subtitle="来自本轮会话"
              onClick={go('cards')}
            />
            <FullButton variant="secondary" onClick={go('cards')}>
              打开知识卡片
            </FullButton>
          </>
        ) : (
          <>
            <ScreenHeading title="另起一页，问个细节。" subtitle="关联当前会话 · 不干扰主任务" />
            <div className="quote-note">“Host 记住会话本身，设备记住你阅读的位置。”</div>
            <div className="user-message">为什么阅读位置不也放在 Host？</div>
            <div className="assistant-prose" style={{ marginTop: 20 }}>
              <p>因为两台设备可能正在读不同的地方。正文共享，视图独立，就不会相互打断。</p>
            </div>
            <FullButton
              variant="secondary"
              onClick={() =>
                dispatch({ type: 'add-context', value: '侧聊结论：正文共享，视图独立。' })
              }
            >
              把这段结论带回主会话
            </FullButton>
          </>
        )}
      </div>
    </>
  );
}
