import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  ListRow,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import { getAttentionItems } from './sessions.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { InboxPage } from './inbox.js';

export function ActivityPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();

  // A Host context is authoritative even while connecting or recovering; do
  // not replace a live shell with fabricated activity while the socket is down.
  if (hostCtx !== null) {
    return <InboxPage />;
  }

  const attentionItems = getAttentionItems(state);
  const has = (key: string) => attentionItems.some((item) => item.key === key);

  const scopeOptions = (
    <div className="scope-options" role="group" aria-label="批准范围">
      {(
        [
          ['once', '仅这一次'],
          ['session', '本次会话'],
          ['project', '此项目'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          className={state.scope === value ? 'active' : ''}
          onClick={() => dispatch({ type: 'set-scope', scope: value })}
          aria-pressed={state.scope === value}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );

  const seals = (
    <div className="seals">
      <button
        className="seal-button ghost"
        onClick={() => dispatch({ type: 'permission-decision', decision: 'denied' })}
        aria-label="拒绝本次操作"
        disabled={state.offline}
        type="button"
      >
        否
      </button>
      <button
        className="seal-button"
        id="seal-allow"
        onClick={() => dispatch({ type: 'permission-decision', decision: 'approved' })}
        aria-label="按所选范围允许"
        disabled={state.offline}
        type="button"
      >
        允
      </button>
    </div>
  );

  const permissionCard = (
    <article className="gate">
      <div className="spread">
        <Pill variant="zhu">
          <Dot status="waiting" />
          等待批准
        </Pill>
        <span className="muted mono" style={{ fontSize: 10 }}>
          2 分钟前
        </span>
      </div>
      <h3>修复移动端重连</h3>
      <p>运行客户端测试，验证断线重连后不会重复发送上一条消息。</p>
      <pre className="command">pnpm --filter @piwin/host-client test</pre>
      <dl className="facts">
        <dt>工具</dt>
        <dd>bash · 在 Host 执行</dd>
        <dt>目录</dt>
        <dd className="mono">~/Developer/piwin-reconnect</dd>
        <dt>原因</dt>
        <dd>运行模式为「每次询问」</dd>
      </dl>
      {scopeOptions}
      <div className="gate-footer">
        <button
          className="text-link"
          onClick={() => dispatch({ type: 'open-session', title: '修复移动端重连' })}
          type="button"
        >
          看上下文 <Icon name="chevr" />
        </button>
        <span />
        {seals}
      </div>
    </article>
  );

  const answers: [string, string][] = [
    ['直到发送或手动删除', '推荐'],
    ['保留 24 小时', ''],
    ['保留 7 天', ''],
  ];

  const questionCard = (
    <article className="gate question">
      <div className="spread">
        <Pill variant="azure">
          <Dot status="background" />
          Agent 正等待你的回答
        </Pill>
        <span className="muted mono" style={{ fontSize: 10 }}>
          2 分钟前
        </span>
      </div>
      <p className="hint">修复移动端重连</p>
      <h3>离线时写下的草稿，要保留多久？</h3>
      <div className="option-list">
        {answers.map(([label, tag]) => (
          <button
            key={label}
            onClick={() => dispatch({ type: 'answer-question', value: label })}
            type="button"
          >
            {label}
            {tag ? <small>{tag}</small> : null}
          </button>
        ))}
      </div>
      <p className="hint">也可以回到会话，写一段自己的回答</p>
    </article>
  );

  const candidateCard =
    state.candidate === 'pending' ? (
      <article className="card">
        <div className="spread">
          <Pill>
            <Icon name="fork" />
            doc-writer · 已交付
          </Pill>
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
            查看 <Icon name="chevr" />
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
    );

  const failureCard = (
    <article className="card error">
      <span className="eyebrow">RUN FAILED · 运行失败</span>
      <p className="hint" style={{ marginTop: 4 }}>
        升级 Pi 依赖
      </p>
      <h3 className="card-title">供应商限流（429）</h3>
      <p>已自动重试 3 次仍未成功。已经完成的工具步骤会保留，重试会从失败的这一步继续。</p>
      <dl className="facts">
        <dt>模型</dt>
        <dd>Claude Opus · 高</dd>
        <dt>发生于</dt>
        <dd>昨天 21:14 · 第 3 个工具步骤后</dd>
        <dt>请求</dt>
        <dd className="mono">req_7f3a…c21</dd>
      </dl>
      <div className="button-row">
        <button
          className="full-button"
          onClick={() => dispatch({ type: 'retry-failure' })}
          type="button"
        >
          重试
        </button>
        <button
          className="full-button secondary"
          onClick={() => dispatch({ type: 'open-sheet', key: 'model' })}
          type="button"
        >
          换个模型重试
        </button>
      </div>
      <div className="card-foot">
        <button
          className="text-link"
          onClick={() => dispatch({ type: 'open-session', title: '升级 Pi 依赖' })}
          type="button"
        >
          打开会话 <Icon name="chevr" />
        </button>
        <button
          className="text-link quiet"
          onClick={() => dispatch({ type: 'toast', message: '已复制错误诊断信息' })}
          type="button"
        >
          复制诊断
        </button>
      </div>
    </article>
  );

  const needTab =
    attentionItems.length > 0 ? (
      <>
        {has('permission') ? permissionCard : null}
        {has('question') ? questionCard : null}
        {has('candidate') ? (
          <>
            <div className="section-label" style={{ marginTop: 22 }}>
              <span>让会话拥有记忆</span>
              <button
                onClick={() => dispatch({ type: 'open-session', title: '让会话拥有记忆' })}
                type="button"
              >
                打开
              </button>
            </div>
            {candidateCard}
          </>
        ) : null}
        {has('failure') ? failureCard : null}
      </>
    ) : (
      <div className="empty-state">
        <span className="brand-seal">砚</span>
        <h2>都处理好了。</h2>
        <p>新的批准、提问和交付会先出现在这里。</p>
      </div>
    );

  const runningTab = (
    <>
      <ListRow
        name="bulb"
        title="让会话拥有记忆"
        subtitle="test-runner 正在补全测试 · 3 分 42 秒"
        onClick={() => dispatch({ type: 'open-session', title: '让会话拥有记忆' })}
        trailing={
          <Pill>
            <Dot status="running" />
            工作中
          </Pill>
        }
      />
      <ListRow
        name="bulb"
        title="修复移动端重连"
        subtitle="正在验证重连不重复发送"
        onClick={() => dispatch({ type: 'open-session', title: '修复移动端重连' })}
        trailing={
          <Pill>
            <Dot status="running" />
            工作中
          </Pill>
        }
      />
      <ListRow
        name="refresh"
        title="升级 Pi 依赖"
        subtitle="从失败的步骤重试"
        onClick={() => dispatch({ type: 'open-session', title: '升级 Pi 依赖' })}
        trailing={
          <Pill>
            <Dot status="running" />
            重试中
          </Pill>
        }
      />
      <ListRow
        name="fork"
        title="test-runner"
        subtitle="子代理 · wt/test-runner · 1 分 32 秒"
        onClick={() => dispatch({ type: 'open-subagent', subagent: 'test-runner' })}
      />
      <ListRow
        name="term"
        title="pnpm dev"
        subtitle="后台程序 · 端口 5173 · 已运行 12 分钟"
        onClick={() => dispatch({ type: 'open-tool', tool: '终端' })}
      />
      <ListRow
        name="clock"
        title="每天回看未完成的工作"
        subtitle="自动化 · 下次明天 09:00"
        onClick={() => dispatch({ type: 'navigate', route: 'automations' })}
      />
    </>
  );

  const doneTab = (
    <>
      <ListRow
        name="file"
        title="走查报告 · 纸与墨"
        subtitle="Inkstone · 桌面主题 · 1 小时前"
        onClick={() => dispatch({ type: 'navigate', route: 'walkthrough' })}
        trailing={<Pill variant="pine">就绪</Pill>}
      />
      <ListRow
        name="check"
        title="文档站换肤"
        subtitle="会话已完成 · 点按确认后移出"
        onClick={() => dispatch({ type: 'toast', message: '已移出完成列表' })}
      />
      <ListRow
        name="clock"
        title="每天回看未完成的工作"
        subtitle="今天 09:00 完成 · 汇总 4 件事"
        onClick={() => dispatch({ type: 'navigate', route: 'automations' })}
      />
      <ListRow
        name="chat"
        title="周末读书笔记"
        subtitle="已记下 5 条便签 · 周四"
        onClick={() => dispatch({ type: 'open-session', title: '周末读书笔记' })}
      />
    </>
  );

  return (
    <>
      <TopBar
        title="动态"
        subtitle="跨会话 · 需要你的先来"
        right={
          <IconButton
            name="sliders"
            label="通知偏好"
            onClick={() => dispatch({ type: 'open-sheet', key: 'notifications' })}
          />
        }
      />
      {state.offline ? (
        <div className="banner-offline">
          <span>连接中断 · 显示 09:38 的快照，草稿仍可写</span>
          <button onClick={() => dispatch({ type: 'reconnect' })} type="button">
            重新连接
          </button>
        </div>
      ) : null}
      <div className="screen-scroll">
        <ScreenHeading
          title="等你，一方印。"
          subtitle={`${attentionItems.length} 件需要你 · 4 件进行中`}
        />
        <TabsRow
          items={['需要你', '进行中', '已完成']}
          selected={state.activityTab}
          onSelect={(tab) => dispatch({ type: 'set-activity-tab', tab: tab as '需要你' | '进行中' | '已完成' })}
        />
        {state.activityTab === '需要你'
          ? needTab
          : state.activityTab === '进行中'
            ? runningTab
            : doneTab}
      </div>
      <BottomNav
        selected="activity"
        attentionCount={attentionItems.length}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}
