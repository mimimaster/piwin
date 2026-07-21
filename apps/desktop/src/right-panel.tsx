/**
 * Right inspector — tools / changes / git / agents.
 * Plan is a composer mode (Cursor-style), not a tab here.
 */

import type { ReactElement, ReactNode } from 'react';
import type { ContextUsageSnapshot, SessionPlan } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import type { ToolCallDensity } from './ui-preferences';
import { ToolCallCard } from './tool-call-card';
import {
  IconClose,
  IconFolder,
  IconGit,
  IconSpark,
  IconUsers,
} from './shell-icons';

export type RightPanelTab = 'execution' | 'changes' | 'git' | 'agents';

export type RightPanelProps = {
  open: boolean;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onClose: () => void;
  agentsContent: ReactNode;
  changesContent: ReactNode;
  gitContent: ReactNode;
  tools: ToolCardUi[];
  plan: SessionPlan | null;
  changesCount?: number;
  toolCallDensity?: ToolCallDensity;
  usageSnapshot?: ContextUsageSnapshot | null;
};

const TAB_ITEMS: { id: RightPanelTab; label: string; icon: ReactElement }[] = [
  { id: 'execution', label: 'Execution', icon: <IconSpark /> },
  { id: 'changes', label: 'Changes', icon: <IconFolder /> },
  { id: 'git', label: 'Git', icon: <IconGit /> },
  { id: 'agents', label: 'Agents', icon: <IconUsers /> },
];

export function RightPanel(props: RightPanelProps): ReactElement | null {
  if (!props.open) {
    return null;
  }

  const runningCount = props.tools.filter((tool) => tool.status === 'running').length;
  const errorCount = props.tools.filter((tool) => tool.status === 'error').length;
  const changesCount = props.changesCount ?? 0;
  const recentTools = [...props.tools].reverse();
  const completedTools = props.tools.filter((tool) => tool.status === 'done').length;
  const planSteps = props.plan?.steps ?? [];
  const completedSteps = planSteps.filter((step) => step.status === 'done').length;

  return (
    <aside className="right-panel" data-testid="right-panel" aria-label="Inspector">
      <header className="right-panel-header">
        <div className="right-panel-tabs" role="tablist" aria-label="Inspector tabs">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={props.activeTab === tab.id}
              className={
                props.activeTab === tab.id
                  ? 'right-panel-tab active'
                  : 'right-panel-tab'
              }
              onClick={() => props.onTabChange(tab.id)}
              title={tab.label}
              aria-label={tab.label}
            >
              {tab.icon}
              <span className="sr-only">{tab.label}</span>
              {tab.id === 'execution' && props.tools.length > 0 ? (
                <span className="right-panel-tab-count">{props.tools.length}</span>
              ) : null}
              {tab.id === 'changes' && changesCount > 0 ? (
                <span className="right-panel-tab-count">{changesCount}</span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn right-panel-close"
          onClick={props.onClose}
          title="Close panel"
          aria-label="Close inspector"
        >
          <IconClose />
        </button>
      </header>

      <div className="right-panel-body" role="tabpanel">
        {props.activeTab === 'execution' ? (
          <div className="right-panel-section execution-inspector">
            <div className="execution-heading">
              <div>
                <span className="inspector-kicker">Current session</span>
                <strong>Execution</strong>
              </div>
              <span className={runningCount > 0 ? 'execution-status running' : 'execution-status'}>
                <i aria-hidden />
                {runningCount > 0 ? 'Working' : 'Idle'}
              </span>
            </div>

            {props.plan ? (
              <section className="execution-section">
                <div className="execution-section-heading">
                  <span>Plan</span>
                  <span>{completedSteps} / {planSteps.length || 1}</span>
                </div>
                <div className="execution-progress" aria-label="Plan progress">
                  <i style={{ width: `${planSteps.length > 0 ? (completedSteps / planSteps.length) * 100 : 0}%` }} />
                </div>
                <div className="execution-plan-list">
                  {planSteps.slice(0, 4).map((step) => (
                    <div key={step.id} className={`execution-plan-step status-${step.status}`}>
                      <i aria-hidden>{step.status === 'done' ? '✓' : ''}</i>
                      <span>{step.title}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="execution-section" data-testid="execution-usage">
              <div className="execution-section-heading">
                <span>Last turn tokens</span>
              </div>
              <div className="muted execution-usage-body">
                {props.usageSnapshot
                  ? formatExecutionUsage(props.usageSnapshot)
                  : 'No usage yet · unknown until first assistant turn'}
              </div>
            </section>

            <section className="execution-section">
              <div className="execution-section-heading">
                <span>Activity</span>
                <span>{props.tools.length > 0 ? `${completedTools} complete` : 'Waiting'}</span>
              </div>
              {recentTools.length === 0 ? (
                <div className="execution-empty muted">
                  Tool activity and changed files will appear here while the agent works.
                </div>
              ) : (
                <div className="execution-timeline">
                  {recentTools.slice(0, 8).map((tool) => (
                    <div key={tool.toolCallId} className={`execution-event status-${tool.status}`}>
                      <i aria-hidden />
                      <span className="execution-event-name">{tool.toolName}</span>
                      <span className="execution-event-state">
                        {tool.status === 'running' ? 'running' : tool.status === 'error' ? 'failed' : 'done'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {errorCount > 0 ? (
              <div className="execution-error-note">{errorCount} tool call{errorCount === 1 ? '' : 's'} failed</div>
            ) : null}

            {recentTools.length > 0 ? (
              <details className="execution-tool-details">
                <summary>Inspect tool output</summary>
                <div className="tools-inspector-list">
                  {recentTools.map((tool) => (
                    <ToolCallCard key={tool.toolCallId} tool={tool} density={props.toolCallDensity ?? 'compact'} />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {props.activeTab === 'changes' ? (
          <div className="right-panel-section">{props.changesContent}</div>
        ) : null}

        {props.activeTab === 'git' ? (
          <div className="right-panel-section">{props.gitContent}</div>
        ) : null}

        {props.activeTab === 'agents' ? (
          <div className="right-panel-section">{props.agentsContent}</div>
        ) : null}
      </div>
    </aside>
  );
}


function formatExecutionUsage(usage: ContextUsageSnapshot): string {
  const parts: string[] = [];
  if (typeof usage.promptTokens === 'number') {
    parts.push(`prompt ${usage.promptTokens.toLocaleString()}`);
  }
  if (typeof usage.completionTokens === 'number') {
    parts.push(`completion ${usage.completionTokens.toLocaleString()}`);
  }
  if (typeof usage.totalTokens === 'number') {
    parts.push(`total ${usage.totalTokens.toLocaleString()}`);
  } else if (typeof usage.tokensUsed === 'number') {
    parts.push(`used ${usage.tokensUsed.toLocaleString()}`);
  }
  if (typeof usage.tokensLimit === 'number') {
    parts.push(`limit ${usage.tokensLimit.toLocaleString()}`);
  }
  if (parts.length === 0) {
    return 'usage · unknown';
  }
  return parts.join(' · ');
}
