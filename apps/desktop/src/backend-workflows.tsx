import { useEffect, useState, type ReactElement } from 'react';
import type { BackendWorkflowsData, HostCommand, HostResponse } from '@piwin/contracts';
import { BackendWorkflowCard } from './backend-workflow-card.js';
import './styles/backend-workflows.css';

export type BackendWorkflowRequest = (command: Extract<HostCommand, { type: 'agents/workflows' | 'agents/workflow-report' }>) => Promise<HostResponse>;

/** Poll independently of foreground streaming; native workflow lifetimes can span many turns. */
export function BackendWorkflows(props: { sessionId: string; request: BackendWorkflowRequest; locale: 'zh-CN' | 'en' }): ReactElement | null {
  const [data, setData] = useState<BackendWorkflowsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null); setError(null);
    async function refresh(): Promise<void> {
      try {
        const result = await props.request({ type: 'agents/workflows', sessionId: props.sessionId });
        if (!result.success) throw new Error(result.error);
        const value = result.data as BackendWorkflowsData | undefined;
        if (value?.sessionId !== props.sessionId || !Array.isArray(value.workflows)) throw new Error('Invalid workflow response');
        if (!disposed) { setData(value); setError(null); }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      } finally { if (!disposed) timer = setTimeout(() => void refresh(), 3000); }
    }
    void refresh();
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); };
  }, [props.sessionId, props.request]);
  if (!data?.workflows.length && !error) return null;
  return (
    <div
      className="thread turn-tool-sequence backend-workflows-sequence"
      data-testid="backend-workflows-sequence"
      aria-label={props.locale === 'zh-CN' ? '后台工作流' : 'Background workflows'}
    >
      {error ? (
        <p role="alert" className="backend-workflows-error">
          {props.locale === 'zh-CN' ? '后台任务状态读取失败：' : 'Workflow status unavailable: '}
          {error}
        </p>
      ) : null}
      {data?.workflows.map((workflow) => (
        <BackendWorkflowCard
          key={`${props.sessionId}:${workflow.workflowId}`}
          workflow={workflow}
          request={props.request}
          locale={props.locale}
        />
      ))}
    </div>
  );
}
