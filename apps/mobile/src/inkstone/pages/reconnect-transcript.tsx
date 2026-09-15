import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot, Pill } from '../inkstone-ui.js';

export const SCOPE_ITEMS = [
  ['once', '仅这一次'],
  ['session', '本次会话'],
  ['project', '此项目'],
] as const;

export function ScopeOptionsSelector({
  scope,
  onSelect,
}: {
  scope: string;
  onSelect: (scope: 'once' | 'session' | 'project') => void;
}): ReactElement {
  return (
    <div className="scope-options" role="group" aria-label="批准范围">
      {SCOPE_ITEMS.map(([value, label]) => (
        <button
          key={value}
          className={scope === value ? 'active' : ''}
          onClick={() => onSelect(value)}
          aria-pressed={scope === value}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ReconnectTranscript(): ReactElement {
  const { state, dispatch } = useInkstone();
  const scopeOptions = (
    <ScopeOptionsSelector scope={state.scope} onSelect={(scope) => dispatch({ type: 'set-scope', scope })} />
  );

  return (
    <>
      <div className="day-rule" style={{ textAlign: 'center', margin: '14px 0 10px', fontSize: 11, color: 'var(--t3)' }}>
        今天 09:10 · 在手机发起
      </div>
      <div className="user-message">
        <div className="user-message-body">
          移动端断线重连后，经常把上一条消息重复发一次。帮我查一下并修好。
        </div>
        <time className="user-time">09:10</time>
      </div>
      <div className="message-head">
        <span className="avatar">π</span>
        GPT-5 Codex · 高
        <time>09:11</time>
      </div>
      <details className="work-disclosure" open>
        <summary>
          <Dot status={state.permission === 'pending' ? 'waiting' : 'done'} />
          <span>等待你批准 · 写入 <code>send-queue.ts</code></span>
          <Icon name="chevd" />
        </summary>
        <div style={{ margin: '8px 0', padding: '6px 10px', fontSize: 12, color: 'var(--t2)', background: 'var(--s1)', borderRadius: 6 }}>
          重连时客户端会把“未确认”的发送重新推入队列，但 Host 其实已经收到过。需要写入幂等键过滤逻辑。
        </div>
        <div className="tool-thread">
          <div className="tool-step">
            <Dot status="done" />
            read <code>packages/session/src/reconnect-policy.ts</code>
            <span>120 行 · 20ms</span>
          </div>
          <div className="tool-step">
            <Dot status="waiting" />
            write_file <code>packages/session/src/send-queue.ts</code>
            <span className="mono"><span className="green">+36</span> <span className="red">−9</span></span>
          </div>
          <div className="tool-step">
            <Dot status="background" />
            bash <code>pnpm test send-queue</code>
            <span>待批准</span>
          </div>
        </div>
      </details>

      {state.permission === 'pending' ? (
        <article className="gate" style={{ margin: '12px 0' }}>
          <div className="spread">
            <Pill variant="zhu">
              <Dot status="waiting" />
              需要你的批准
            </Pill>
            <span className="muted mono" style={{ fontSize: 10 }}>
              还有 1 条待决
            </span>
          </div>
          <h3>运行客户端测试</h3>
          <p>验证断线重连后，不会再重复发送上一条消息。</p>
          <pre className="command">pnpm --filter @piwin/host-client test</pre>
          <div style={{ fontSize: 11, color: 'var(--t3)', margin: '8px 0' }}>
            bash · ~/Developer/piwin-reconnect · 每次询问
          </div>
          {scopeOptions}
          <div className="gate-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <button
              className="text-link"
              onClick={() => dispatch({ type: 'open-sheet', key: 'permission' })}
              type="button"
            >
              展开详情
            </button>
            <div className="seals" style={{ display: 'flex', gap: 8 }}>
              <button
                className="seal-button ghost"
                onClick={() => {
                  dispatch({ type: 'permission-decision', decision: 'denied' });
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
                  dispatch({ type: 'permission-decision', decision: 'approved' });
                }}
                aria-label="允许"
                type="button"
              >
                允
              </button>
            </div>
          </div>
        </article>
      ) : (
        <div className="sealed" style={{ margin: '12px 0' }}>
          <span className={`seal-mini ${state.permission === 'approved' ? 'pine' : 'ghost'}`}>
            {state.permission === 'approved' ? '允' : '否'}
          </span>
          <span className="grow">
            {state.permission === 'approved'
              ? `已允许 · ${{ once: '仅这一次', session: '本次会话', project: '此项目' }[state.scope] ?? '仅这一次'}`
              : '已拒绝运行测试 · Agent 改用静态检查'}
            <small>send-queue.ts</small>
          </span>
        </div>
      )}

      {state.question === 'pending' ? (
        <article className="gate question" style={{ margin: '12px 0' }}>
          <div className="spread">
            <Pill variant="azure">
              <Dot status="background" />
              Agent 等待你的回答
            </Pill>
          </div>
          <h3>离线时写下的草稿，要保留多久？</h3>
          <div className="option-list">
            <button
              className="recommended"
              onClick={() => dispatch({ type: 'answer-question', value: '直到发送或手动删除' })}
              type="button"
            >
              直到发送或手动删除 <small>推荐</small>
            </button>
            <button
              onClick={() => dispatch({ type: 'answer-question', value: '保留 24 小时' })}
              type="button"
            >
              保留 24 小时
            </button>
          </div>
        </article>
      ) : (
        <div className="sealed" style={{ margin: '8px 0' }}>
          <span className="seal-mini pine">答</span>
          <span className="grow">
            已回答：直到发送或手动删除
            <small>保留本地草稿</small>
          </span>
        </div>
      )}

      <button
        className="files-bar"
        onClick={() => dispatch({ type: 'navigate', route: 'review' })}
        type="button"
        style={{ margin: '12px 0', width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--s1)', borderRadius: 8 }}
      >
        <Icon name="git" />
        <span className="grow" style={{ textAlign: 'left', fontSize: 12 }}>1 个文件待写入</span>
        <span className="mono" style={{ fontSize: 11 }}><span className="green">+36</span> <span className="red">−9</span></span>
        <span className="chip" style={{ marginLeft: 6, fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--s2)', border: '1px solid var(--l2)' }}>查看差异</span>
      </button>
    </>
  );
}
