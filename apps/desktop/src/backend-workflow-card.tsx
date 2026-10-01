import { useState, type ReactElement } from 'react';
import { isBackendWorkflowActive, type BackendWorkflowSnapshot } from '@piwin/contracts';
import { Button, BreathMatrix } from '@piwin/ui-kit';
import { IconChevronDown } from './shell-icons.js';
import { CollapsibleContentBlock } from './collapsible-content-block.js';
import { MarkdownView } from './MarkdownView.js';
import type { BackendWorkflowRequest } from './backend-workflows.js';

const STATUS_ZH: Record<string, string> = {
  running: '运行中',
  pending: '等待中',
  starting: '启动中',
  waiting: '等待中',
  resuming: '恢复中',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
  paused: '已暂停',
  cancelled: '已取消',
  done: '已完成',
};

function formatElapsed(ms?: number): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

/**
 * Backend workflow row on the ink-spine tool call chain.
 * Reusable dynamic UI (BreathMatrix) + workflow name + live progress dropdown.
 */
export function BackendWorkflowCard(props: {
  workflow: BackendWorkflowSnapshot;
  request: BackendWorkflowRequest;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const workflow = props.workflow;
  const chinese = props.locale === 'zh-CN';
  const running = isBackendWorkflowActive(workflow.status);
  const isCompleted = workflow.status === 'completed' || workflow.status === 'done';
  const isFailed = workflow.status === 'failed' || workflow.status === 'interrupted' || workflow.status === 'cancelled';
  const nodeClass = running ? 'run' : isCompleted ? 'done' : isFailed ? 'fail' : 'wait';
  const doneCount = workflow.phases.filter((phase) => phase.status === 'done').length;

  async function openReport(): Promise<void> {
    setLoading(true);
    setReportError(null);
    try {
      const result = await props.request({
        type: 'agents/workflow-report',
        sessionId: workflow.sessionId,
        workflowId: workflow.workflowId,
      });
      if (!result.success) throw new Error(result.error);
      const data = result.data;
      if (typeof data !== 'object' || data === null || !('text' in data) || typeof data.text !== 'string') {
        throw new Error('Invalid workflow report');
      }
      setReport(data.text);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`tr backend-workflow-chain-item${expanded ? ' is-expanded' : ' is-collapsed'}${
        running ? ' is-running' : ''
      }`}
      data-state={workflow.status}
      data-testid="backend-workflow-card"
    >
      <span className={`node ${nodeClass}`} aria-hidden="true" />
      <button
        type="button"
        className="backend-workflow-trigger"
        data-testid="backend-workflow-trigger"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="backend-workflow-matrix-wrapper" aria-hidden="true">
          <BreathMatrix size="sm" />
        </span>
        <b className="backend-workflow-name">{workflow.name}</b>
        {workflow.objective ? (
          <span className="backend-workflow-objective" title={workflow.objective}>
            {workflow.objective}
          </span>
        ) : null}
        <div className="backend-workflow-meta meta">
          {running ? (
            <span className="backend-workflow-badge run">
              {chinese
                ? doneCount > 0
                  ? `${doneCount}/${workflow.phases.length} 进度`
                  : '调研中'
                : `${doneCount}/${workflow.phases.length} phases`}
            </span>
          ) : isCompleted ? (
            <span className="backend-workflow-badge done">
              {chinese ? '已完成' : 'Done'}
            </span>
          ) : (
            <span className="backend-workflow-badge error">
              {chinese ? STATUS_ZH[workflow.status] ?? workflow.status : workflow.status}
            </span>
          )}
          {formatElapsed(workflow.elapsedMs) ? (
            <span className="backend-workflow-timing">
              {formatElapsed(workflow.elapsedMs)}
            </span>
          ) : null}
          <IconChevronDown
            className={`backend-workflow-chevron${expanded ? ' is-open' : ''}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded ? (
        <div className="backend-workflow-details" data-testid="backend-workflow-details">
          {workflow.objective ? (
            <p className="backend-workflow-objective-expanded">{workflow.objective}</p>
          ) : null}
          {workflow.message ? (
            <p className="backend-workflow-error" role="status">
              {workflow.message}
            </p>
          ) : null}
          {workflow.phases.length > 0 ? (
            <div className="backend-workflow-phases">
              {workflow.phases.map((phase, index) => (
                <div
                  key={`${index}-${phase.title}`}
                  className={`backend-workflow-phase-row phase-${phase.status}`}
                >
                  <span
                    className={`phase-mark ${
                      phase.status === 'done'
                        ? 'done'
                        : phase.status === 'active'
                          ? 'run'
                          : 'pending'
                    }`}
                    aria-hidden="true"
                  >
                    {phase.status === 'done' ? '✓' : ''}
                  </span>
                  <span className="phase-title">{phase.title}</span>
                  {phase.detail ? (
                    <span className="phase-detail">{phase.detail}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {workflow.agents.length > 0 ? (
            <div className="backend-workflow-agents">
              {workflow.agents.map((agent) => (
                <div key={agent.id} className="backend-workflow-agent-row">
                  <span>
                    {agent.label} · {agent.phase} ·{' '}
                    {chinese ? STATUS_ZH[agent.status] ?? agent.status : agent.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {workflow.history.length > 0 ? (
            <div className="backend-workflow-telemetry">
              <div className="telemetry-header">
                <span>{chinese ? '执行记录' : 'Telemetry'}</span>
                <span className="telemetry-count">{workflow.history.length}</span>
              </div>
              <div className="telemetry-list">
                {workflow.history.map((event, index) => (
                  <div key={index} className="telemetry-item">
                    {event.at ? (
                      <span className="telemetry-time">
                        {new Date(event.at).toLocaleTimeString()}
                      </span>
                    ) : null}
                    <span className="telemetry-text">{event.detail ?? event.event}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {workflow.reportAvailable ? (
            <div className="backend-workflow-report-box">
              <span className="report-box-title">
                {chinese ? '研报已生成' : 'Research report ready'}
              </span>
              <Button
                size="compact"
                onClick={() => void openReport()}
                disabled={loading}
              >
                {loading
                  ? chinese
                    ? '加载中…'
                    : 'Loading…'
                  : report !== null
                    ? chinese
                      ? '刷新报告'
                      : 'Refresh report'
                    : chinese
                      ? '查看完整研报 ↗'
                      : 'View report ↗'}
              </Button>
            </div>
          ) : null}
          {reportError ? (
            <p className="backend-workflow-error" role="alert">
              {reportError}
            </p>
          ) : null}
          {report !== null ? (
            <div className="backend-workflow-report-view">
              <CollapsibleContentBlock maxCollapsedHeight={400}>
                <MarkdownView text={report} artifactInlineEnabled={false} />
              </CollapsibleContentBlock>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
