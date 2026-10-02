import { useState, type ReactElement } from 'react';
import { isBackendWorkflowActive, type BackendWorkflowSnapshot } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { ToolBatchCapsule } from './tool-batch-capsule.js';
import { formatToolDuration } from './tool-call-head.js';
import { InkLineNode } from './ink-line-node.js';
import { CollapsibleContentBlock } from './collapsible-content-block.js';
import { MarkdownView } from './MarkdownView.js';
import type { BackendWorkflowRequest } from './backend-workflows.js';
import type { SessionNodeStatusKind } from './session-node-status.js';

const PHASE_ZH: Record<string, string> = { Plan: '规划', Research: '研究', Verify: '核验', Report: '报告' };

const STATUS_ZH: Record<string, string> = {
  active: '运行中', running: '运行中', pending: '等待中', starting: '启动中', waiting: '等待中',
  resuming: '恢复中', completed: '已完成', failed: '失败', interrupted: '已中断', paused: '已暂停',
  cancelled: '已取消', done: '已完成',
};

function nodeKind(status: string): SessionNodeStatusKind {
  if (status === 'done' || status === 'completed') return 'success';
  if (status === 'failed' || status === 'interrupted' || status === 'cancelled') return 'failed';
  return isBackendWorkflowActive(status) && status !== 'pending' ? 'running' : 'pending';
}

/** Native workflow stages use the existing batch disclosure and ink-line nodes. */
export function BackendWorkflowCard(props: {
  workflow: BackendWorkflowSnapshot; request: BackendWorkflowRequest; locale: 'zh-CN' | 'en';
}): ReactElement {
  const [report, setReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const workflow = props.workflow;
  const chinese = props.locale === 'zh-CN';
  const running = isBackendWorkflowActive(workflow.status);
  const failed = nodeKind(workflow.status) === 'failed';
  const doneCount = workflow.phases.filter((phase) => phase.status === 'done').length;
  const label = (status: string): string => chinese ? STATUS_ZH[status] ?? status : status;
  const phaseLabel = (title: string): string => chinese ? PHASE_ZH[title] ?? title : title;
  const activePhase = workflow.phases.find((phase) => phase.status === 'active');
  const activeAgent = workflow.agents.find((agent) => nodeKind(agent.status) === 'running');
  const activeLabel = [activePhase ? phaseLabel(activePhase.title) : workflow.currentPhase ? phaseLabel(workflow.currentPhase) : undefined, activeAgent?.label].filter(Boolean).join(' · ')
    || workflow.message || workflow.objective;

  async function openReport(): Promise<void> {
    setLoading(true); setReportError(null);
    try {
      const result = await props.request({ type: 'agents/workflow-report', sessionId: workflow.sessionId, workflowId: workflow.workflowId });
      if (!result.success) throw new Error(result.error);
      const data = result.data;
      if (typeof data !== 'object' || data === null || !('text' in data) || typeof data.text !== 'string') throw new Error('Invalid workflow report');
      setReport(data.text);
    } catch (error) { setReportError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  const renderAgent = (agent: BackendWorkflowSnapshot['agents'][number]): ReactElement => (
    <div key={agent.id} className="backend-workflow-agent-row">
      <InkLineNode kind={nodeKind(agent.status)} label={label(agent.status)} size="compact" />
      <span>{agent.label}</span>
      <span className="backend-workflow-row-meta">{label(agent.status)}{agent.tokensUsed === undefined ? '' : ` · ${agent.tokensUsed.toLocaleString()} tokens`}</span>
    </div>
  );

  return (
    <div className={`backend-workflow-chain-item${running ? ' is-running' : ''}`} data-state={workflow.status} data-testid="backend-workflow-card">
      <ToolBatchCapsule
        clusterKind="other" tools={[]} title={workflow.name} activeLabel={activeLabel}
        defaultOpenWhileRunning locale={props.locale}
        summary={{ totalCount: workflow.phases.length, hasRunning: running, hasError: failed, errorCount: failed ? 1 : 0, keyTargets: [] }}
        meta={<span className="backend-workflow-row-meta">{workflow.phases.length > 0 ? `${doneCount}/${workflow.phases.length} · ` : ''}{label(workflow.status)}{workflow.elapsedMs === undefined ? '' : ` · ${formatToolDuration(workflow.elapsedMs)}`}</span>}
      >
        <div className="backend-workflow-steps" data-testid="backend-workflow-details">
          {workflow.phases.map((phase, index) => (
            <div key={`${index}-${phase.title}`} className="backend-workflow-stage" data-phase-state={phase.status}>
              <div className="backend-workflow-stage-row">
                <InkLineNode kind={phase.status === 'active' ? (failed ? 'failed' : running ? 'running' : 'pending') : phase.status === 'done' ? 'success' : 'pending'}
                  label={phase.status === 'active' ? label(workflow.status) : phase.status === 'done' ? label('done') : label('pending')} size="compact" />
                <b>{phaseLabel(phase.title)}</b>
                {phase.detail ? <span className="backend-workflow-row-detail" title={phase.detail}>{phase.detail}</span> : null}
              </div>
              {workflow.agents.filter((agent) => agent.phase === phase.title).map(renderAgent)}
            </div>
          ))}
          {workflow.agents.filter((agent) => !workflow.phases.some((phase) => phase.title === agent.phase)).map(renderAgent)}
          {workflow.message ? <p className={failed ? 'backend-workflow-error' : 'backend-workflow-note'} role="status">{workflow.message}</p> : null}
          {workflow.history.length > 0 ? (
            <details className="backend-workflow-history">
              <summary>{chinese ? '执行记录' : 'Execution history'} · {workflow.history.length}</summary>
              <div className="backend-workflow-history-list">
                {workflow.history.map((event, index) => <div key={index}>
                  {event.at ? <time>{new Date(event.at).toLocaleTimeString()}</time> : null}
                  <span>{event.detail ?? event.event}</span>
                </div>)}
              </div>
            </details>
          ) : null}
          {workflow.reportAvailable ? <Button size="compact" onClick={() => void openReport()} disabled={loading}>
            {loading ? (chinese ? '加载中…' : 'Loading…') : report !== null ? (chinese ? '刷新报告' : 'Refresh report') : (chinese ? '查看报告' : 'View report')}
          </Button> : null}
          {reportError ? <p className="backend-workflow-error" role="alert">{reportError}</p> : null}
          {report !== null ? <CollapsibleContentBlock maxCollapsedHeight={400}><MarkdownView text={report} artifactInlineEnabled={false} /></CollapsibleContentBlock> : null}
        </div>
      </ToolBatchCapsule>
    </div>
  );
}
