import { useEffect, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import type { SessionPlan } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { readSessionPlan } from '../../mobile-host-readers.js';
import {
  IconButton,
  Dot,
  FullButton,
  Pill,
  ScreenHeading,
  TopBar,
  type DotStatus,
} from '../inkstone-ui.js';

export function PlanPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedPlanPage hostCtx={hostCtx} />;
}

function planDotStatus(status: SessionPlan['steps'][number]['status']): DotStatus {
  if (status === 'done') return 'done';
  if (status === 'active') return 'running';
  if (status === 'skipped') return 'failed';
  return '';
}

function planStatusLabel(status: SessionPlan['status']): string {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'approved':
      return '已批准';
    case 'executing':
      return '执行中';
    case 'done':
      return '已完成';
    case 'abandoned':
      return '已放弃';
  }
}

function planExecutionLabel(status: NonNullable<SessionPlan['execution']>['status']): string {
  switch (status) {
    case 'idle':
      return '尚未执行';
    case 'queued':
      return '排队中';
    case 'running':
      return '执行中';
    case 'completed':
      return '执行完成';
    case 'failed':
      return '执行失败';
    case 'aborted':
      return '已中止';
  }
}

function ConnectedPlanPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const sessionId = host.activeSessionId;
  const [plan, setPlan] = useState<SessionPlan | null | undefined>(undefined);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlan(undefined);
    setError(undefined);
    if (client === undefined || sessionId === undefined) {
      return () => {
        cancelled = true;
      };
    }
    if (!client.supportsCommand('plan/get')) {
      setPlan(null);
      setError('当前 Host 未开放计划读取。');
      return () => {
        cancelled = true;
      };
    }
    void client.request({ type: 'plan/get', sessionId }).then((response) => {
      if (cancelled) return;
      if (!response.success) {
        setPlan(null);
        setError(response.error);
        return;
      }
      setPlan(readSessionPlan(response));
    });
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  const reload = async (): Promise<void> => {
    if (client === undefined || sessionId === undefined || !client.supportsCommand('plan/get')) {
      return;
    }
    const response = await client.request({ type: 'plan/get', sessionId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setPlan(readSessionPlan(response));
  };

  const abort = async (): Promise<void> => {
    if (
      client === undefined ||
      sessionId === undefined ||
      plan?.execution === undefined ||
      !client.supportsCommand('plan/abort')
    ) {
      return;
    }
    setBusy(true);
    try {
      const response = await client.request({
        type: 'plan/abort',
        sessionId,
        planId: plan.id,
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      dispatch({ type: 'toast', message: '已请求中止计划。' });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const goChat = () => dispatch({ type: 'navigate', route: 'chat' });
  const openExecute = () => dispatch({ type: 'open-sheet', key: 'execute-plan' });

  return (
    <>
      <TopBar
        title="实施计划"
        subtitle={sessionId === undefined ? 'Host · 未选择会话' : 'Host · 当前会话'}
        onBack={goChat}
        right={
          plan !== undefined && plan !== null ? (
            <IconButton name="more" label="计划选项" onClick={openExecute} />
          ) : undefined
        }
      />
      <div className="screen-scroll">
        {client === undefined ? (
          <>
            <ScreenHeading title="正在连接 Host" subtitle="计划数据会在连接后自动读取" />
            <p className="muted">当前没有本地演示计划。</p>
          </>
        ) : sessionId === undefined ? (
          <>
            <ScreenHeading title="还没有选中会话" subtitle="先从会话列表打开一个 Host 会话" />
            <FullButton variant="secondary" onClick={() => dispatch({ type: 'navigate', route: 'sessions' })}>
              返回会话
            </FullButton>
          </>
        ) : plan === undefined ? (
          <>
            <ScreenHeading title="正在读取计划" subtitle="请求 Host plan/get" />
            <p className="muted">正在同步当前会话的最新版本。</p>
          </>
        ) : plan === null ? (
          <>
            <ScreenHeading title="当前会话没有计划" subtitle="Host 未返回可展示的 SessionPlan" />
            {error !== undefined ? <p className="error-text">{error}</p> : null}
            <FullButton variant="secondary" onClick={goChat}>
              回到对话
            </FullButton>
          </>
        ) : (
          <>
            <ScreenHeading title={plan.title || '实施计划'} subtitle={plan.goal || 'Host 计划'} />
            <div className="spread">
              <Pill variant={plan.status === 'done' ? 'pine' : 'azure'}>
                {planStatusLabel(plan.status)} · {plan.steps.filter((step) => step.status === 'done').length}/
                {plan.steps.length} 步
              </Pill>
              <span className="muted mono" style={{ fontSize: 11 }}>
                rev {plan.revision}
              </span>
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: `${plan.steps.length === 0 ? 0 : (plan.steps.filter((step) => step.status === 'done').length / plan.steps.length) * 100}%`,
                }}
              />
            </div>
            {error !== undefined ? <p className="error-text">{error}</p> : null}
            {plan.steps.length === 0 ? <p className="muted">Host 计划暂时没有步骤。</p> : null}
            {plan.steps.map((step, index) => (
              <div className="plan-step" key={step.id}>
                <Dot status={planDotStatus(step.status)} />
                <span className="eyebrow">STEP {String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                {step.detail !== undefined ? <p>{step.detail}</p> : null}
                <Pill>{step.status}</Pill>
              </div>
            ))}
            {plan.execution !== undefined ? (
              <div className="quote-note">
                执行状态：{planExecutionLabel(plan.execution.status)}
                {plan.execution.error ? ` · ${plan.execution.error}` : ''}
              </div>
            ) : null}
            <div className="section-label">Host 操作</div>
            {plan.status === 'draft' || plan.status === 'approved' ? (
              <FullButton variant="secondary" onClick={openExecute} disabled={busy}>
                选择执行方式
              </FullButton>
            ) : null}
            {plan.execution?.status === 'queued' || plan.execution?.status === 'running' ? (
              <FullButton variant="subtle" onClick={() => void abort()} disabled={busy}>
                请求中止计划
              </FullButton>
            ) : null}
            <FullButton variant="subtle" onClick={goChat}>
              继续对话
            </FullButton>
          </>
        )}
      </div>
    </>
  );
}
