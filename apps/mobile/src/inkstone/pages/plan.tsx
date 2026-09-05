import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import {
  IconButton,
  Dot,
  FullButton,
  ListRow,
  Pill,
  ScreenHeading,
  TopBar,
  type DotStatus,
} from '../inkstone-ui.js';

const PLAN_STEPS: [DotStatus, string, string, string][] = [
  ['done', '01', '梳理会话恢复边界', '阅读 Host 会话索引，区分持久状态与设备阅读状态。'],
  ['done', '02', '保留输入中的草稿', '恢复草稿、附件引用与当前模型选择。'],
  ['running', '03', '补全恢复路径测试', '交给测试子代理，覆盖断线、重连与空会话。'],
  ['', '04', '走查并交付', '检查变更，生成与本轮消息绑定的走查报告。'],
];

export function PlanPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="实施计划"
        subtitle="piwin · 会话记忆"
        onBack={go('chat')}
        right={<IconButton name="more" label="计划选项" onClick={openSheet('execute-plan')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading
          title={'让每次回来，\n都有迹可循。'}
          subtitle="4 个步骤 · 单 Agent + 按需子代理"
        />
        <div className="spread">
          <Pill variant="pine">已完成 2 / 4</Pill>
          <span className="muted mono" style={{ fontSize: 11 }}>
            03:42
          </span>
        </div>
        <div className="progress-track">
          <span style={{ width: '50%' }} />
        </div>
        {PLAN_STEPS.map(([status, number, title, text]) => (
          <div className="plan-step" key={number}>
            <Dot status={status} />
            <span className="eyebrow">STEP {number}</span>
            <h3>{title}</h3>
            <p>{text}</p>
            {status === 'running' ? (
              <Pill variant="azure" onClick={openSheet('subagent')}>
                子代理 · test-runner →
              </Pill>
            ) : null}
          </div>
        ))}
        <div className="section-label">编排</div>
        <ListRow
          name="fork"
          title="主 Agent + test-runner"
          subtitle="独立工作树 · 变更经主会话审阅"
          onClick={openSheet('subagent')}
        />
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'toggle-run' })}>
          {state.run === 'paused' ? '继续计划' : '暂停计划'}
        </FullButton>
        <FullButton variant="subtle" onClick={openSheet('intervene')}>
          补充一条要求
        </FullButton>
      </div>
    </>
  );
}
