import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Dot, Facts, FullButton, ListRow, Pill } from '../inkstone-ui.js';

export function PermissionSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [scope, setScope] = useState('once');
  return (
    <>
      <Pill variant="zhu">Host 正在等待你</Pill>
      <div className="command">pnpm --filter @piwin/host-client test</div>
      <Facts
        items={[
          ['项目', 'piwin · 已信任'],
          ['目录', <span className="mono">~/Developer/piwin</span>],
          ['触发原因', 'Ask 模式要求手动确认命令'],
          ['授权对象', '本次 bash 工具请求'],
        ]}
      />
      <label className="field">
        批准的范围
        <select value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="once">仅本次操作（默认）</option>
          <option value="session">本会话中的同类操作</option>
          <option value="project">本项目中的同类操作</option>
        </select>
      </label>
      <p>原型只模拟决定，不会执行命令或修改真实权限。</p>
      <FullButton onClick={() => dispatch({ type: 'permission', choice: 'approved', scope })}>
        允 · 按所选范围批准
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'permission', choice: 'denied', scope })}
      >
        否 · 拒绝这次操作
      </FullButton>
    </>
  );
}

export function ExecutePlanSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <p>会话记忆 · 4 个步骤。先审阅计划，再选择执行方式。</p>
      <ListRow
        name="cards"
        title="查看完整计划"
        subtitle="步骤、依赖与预期交付"
        onClick={() => dispatch({ type: 'navigate', route: 'plan' })}
      />
      <FullButton onClick={() => dispatch({ type: 'execute-plan', mode: 'single' })}>
        普通执行
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'execute-plan', mode: 'agents' })}
      >
        子代理驱动
      </FullButton>
      <FullButton variant="subtle" onClick={() => dispatch({ type: 'close-sheet' })}>
        暂时不执行
      </FullButton>
    </>
  );
}

export function SubagentSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <Pill variant="azure">
        <Dot status="background" />
        子代理 · 工作中
      </Pill>
      <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, margin: '18px 0' }}>
        补全恢复路径测试
      </h3>
      <p>正在检查断线后草稿、历史与工具展开状态的恢复。工作位于独立工作树。</p>
      <Facts
        items={[
          ['模型', 'Claude Sonnet'],
          ['已完成', '覆盖空会话与已归档会话'],
          ['当前', '检查重连后重复发送的防护'],
        ]}
      />
      <FullButton onClick={() => dispatch({ type: 'open-sheet', key: 'intervene' })}>
        追加一条要求
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'open-sheet', key: 'subagent-output' })}
      >
        查看子代理输出
      </FullButton>
    </>
  );
}

export function SubagentOutputSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <div className="tool-thread">
        <div className="tool-step">
          <Dot status="done" />
          读取 reconnect-policy.ts
        </div>
        <div className="tool-step">
          <Dot status="done" />
          补全断线恢复测试
        </div>
        <div className="tool-step">
          <Dot status="running" />
          运行 session-index.test.ts
        </div>
      </div>
      <div className="quote-note">当前没有需要人工处理的失败。完成后将提交变更给主会话审阅。</div>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'navigate', route: 'review' })}
      >
        查看变更
      </FullButton>
    </>
  );
}

export function InterveneSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [text, setText] = useState('');
  return (
    <>
      <p>这条消息会进入当前工作的介入流程，不会另开一个任务。</p>
      <label className="field">
        追加要求
        <textarea
          placeholder="例如，也覆盖手机在后台时的恢复场景。"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <FullButton onClick={() => dispatch({ type: 'intervene', value: text.trim() })}>
        排队追加
      </FullButton>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'toggle-run' })}>
        先暂停工作
      </FullButton>
    </>
  );
}

export function GoalSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [goal, setGoal] = useState('让会话恢复逻辑通过完整走查');
  return (
    <>
      <label className="field">
        目标
        <input value={goal} onChange={(event) => setGoal(event.target.value)} autoComplete="off" />
      </label>
      <div className="quote-note">Goal 追踪持续目标。计划步骤和交付报告仍各有自己的页面。</div>
      <FullButton
        onClick={() =>
          dispatch({
            type: 'save-demo',
            values: { 'goal-title': goal },
            message: '目标已显示在当前演示中',
          })
        }
      >
        设置演示目标
      </FullButton>
    </>
  );
}

export function CommentSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const [text, setText] = useState(state.comment);
  return (
    <>
      <Pill mono>session-index.ts · L42</Pill>
      <div className="command">+ const saved = await store.get(id);</div>
      <label className="field">
        审阅意见
        <textarea
          placeholder="例如，这里也考虑一下旧格式的会话数据。"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <FullButton onClick={() => dispatch({ type: 'save-comment', value: text.trim() })}>
        保存批注
      </FullButton>
    </>
  );
}

export function ReviewOptionsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <ListRow
        name="file"
        title="统一差异"
        subtitle="手机默认视图"
        onClick={() => dispatch({ type: 'close-sheet' })}
      />
      <ListRow
        name="copy"
        title="把审阅结论带回对话"
        onClick={() => dispatch({ type: 'navigate', route: 'chat' })}
      />
      <ListRow
        name="refresh"
        title="重新查看这组变更"
        onClick={() => dispatch({ type: 'reset-review' })}
      />
    </>
  );
}
