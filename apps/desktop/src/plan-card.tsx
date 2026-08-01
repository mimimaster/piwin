/**
 * PlanCard — inline rendering of the agent's execution plan in the chat thread.
 * Ported from docs/proto-shell.css plan-card block. The plan is session-level
 * (not anchored to a message), so ChatThread mounts a single card at the top
 * of the assistant area when `sessionPlan` is present.
 *
 * Approval + execution flow (Antigravity-style):
 *   draft  → [Process] reveals [subagent-driven] [inline]
 *   approved/executing → progress + [Abort] (when running)
 *   done/abandoned → final state, no actions
 */
import { useState, type ReactElement } from 'react';
import type { PlanExecutionMode, PlanStepStatus, SessionPlan } from '@piwin/contracts';
import { Collapse } from '@piwin/ui-kit';

export type PlanStepVisual = 'done' | 'run' | 'pending' | 'skipped';

/** Maps contract step status to the V7 visual state machine (.step.done/.run/.skipped). */
export function planStepVisual(status: PlanStepStatus): PlanStepVisual {
  switch (status) {
    case 'done':
      return 'done';
    case 'active':
      return 'run';
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}

export type PlanCardProps = {
  plan: SessionPlan;
  defaultOpen?: boolean;
  onOpenDocument?: ((doc: { title: string; content?: string }) => void) | undefined;
  /** Called when the user selects an execution mode for a draft/approved plan. */
  onExecute?: (mode: PlanExecutionMode) => void | Promise<void>;
  /** Called when the user aborts a running plan. */
  onAbort?: () => void | Promise<void>;
  /** Disable action buttons (e.g. while a host request is in flight). */
  actionInProgress?: boolean;
};

export function StepIcon({ visual }: { visual: PlanStepVisual }): ReactElement {
  switch (visual) {
    case 'done':
      return (
        <svg className="step-icon step-icon-done" viewBox="0 0 16 16" width="16" height="16" aria-label="Done">
          <circle cx="8" cy="8" r="7" fill="var(--ok, #10b981)" />
          <path
            d="M4.8 8.2l2.2 2.2 4.2-4.4"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      );
    case 'run':
      return (
        <svg className="step-icon step-icon-run" viewBox="0 0 16 16" width="16" height="16" aria-label="Running">
          <circle cx="8" cy="8" r="6.5" stroke="var(--accent)" strokeWidth="1.5" fill="none" />
          <circle cx="8" cy="8" r="3" fill="var(--accent)" className="pulse-dot" />
        </svg>
      );
    case 'skipped':
      return (
        <svg className="step-icon step-icon-skipped" viewBox="0 0 16 16" width="16" height="16" aria-label="Skipped">
          <circle cx="8" cy="8" r="6.5" stroke="var(--faint)" strokeWidth="1.2" fill="none" />
          <path d="M4.5 11.5l7-7" stroke="var(--faint)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg className="step-icon step-icon-pending" viewBox="0 0 16 16" width="16" height="16" aria-label="Pending">
          <circle cx="8" cy="8" r="6.5" stroke="var(--faint)" strokeWidth="1.2" strokeDasharray="2.5 2.5" fill="none" />
        </svg>
      );
  }
}

export function PlanCard({
  plan,
  defaultOpen = true,
  onOpenDocument,
  onExecute,
  onAbort,
  actionInProgress = false,
}: PlanCardProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const [modeRevealed, setModeRevealed] = useState(false);
  const isLong = plan.complexity === 'long';
  const execution = plan.execution;
  const isRunning =
    execution?.status === 'running' ||
    execution?.status === 'queued' ||
    plan.status === 'executing';
  const isTerminal = plan.status === 'done' || plan.status === 'abandoned';
  const canProcess =
    !isTerminal && !isRunning && (plan.status === 'draft' || plan.status === 'approved');

  const totalCount = plan.steps.length;
  const doneCount = plan.steps.filter((s) => s.status === 'done').length;

  function handleOpenDoc(event: React.MouseEvent): void {
    event.stopPropagation();
    if (!onOpenDocument) return;
    const markdownContent = [
      `# Implementation Plan: ${plan.title}`,
      `**Goal**: ${plan.goal || 'Session Plan Execution'}`,
      `**Status**: ${plan.status}`,
      '',
      '## Plan Steps',
      ...plan.steps.map((step, idx) => {
        const isDone = step.status === 'done';
        const tag = isDone ? '[DONE]' : step.status === 'active' ? '[MODIFY]' : '[PENDING]';
        return `### ${tag} Step ${idx + 1}: ${step.title}\n- Status: \`${step.status}\`${step.detail ? `\n- Detail: ${step.detail}` : ''}`;
      }),
    ].join('\n');

    onOpenDocument({
      title: plan.title || 'Implementation Plan',
      content: markdownContent,
    });
  }

  async function handleModeSelect(mode: PlanExecutionMode): Promise<void> {
    if (!onExecute || actionInProgress) return;
    await onExecute(mode);
    setModeRevealed(false);
  }

  async function handleAbort(): Promise<void> {
    if (!onAbort || actionInProgress) return;
    await onAbort();
  }

  return (
    <div className={`plan-card${open ? '' : ' closed'}`} data-testid="plan-card">
      <button
        type="button"
        className="plan-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <svg className="chev ic" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="plan-title">
          {doneCount} / {totalCount} tasks done{plan.title ? ` · ${plan.title}` : ''}
        </span>
        {onOpenDocument ? (
          <span className="plan-doc-link" title="在右侧面板中打开增强文档" onClick={handleOpenDoc}>
            📄 Implementation Plan
          </span>
        ) : null}
      </button>
      <Collapse expanded={open}>
        <div className="plan-steps">
          {plan.steps.map((step) => {
            const visual = planStepVisual(step.status);
            return (
              <div key={step.id} className={`step ${visual === 'pending' ? '' : visual}`}>
                <StepIcon visual={visual} />
                <span className="step-label">{step.title}</span>
              </div>
            );
          })}
        </div>
        {canProcess && onExecute ? (
          <div className="plan-actions" data-testid="plan-actions">
            {!modeRevealed ? (
              <button
                type="button"
                className="plan-btn plan-btn-primary"
                data-testid="plan-process"
                disabled={actionInProgress}
                onClick={() => setModeRevealed(true)}
              >
                Process
              </button>
            ) : (
              <div className="plan-mode-buttons" data-testid="plan-mode-buttons">
                <button
                  type="button"
                  className={`plan-btn${isLong ? ' plan-btn-recommended' : ''}`}
                  data-testid="plan-mode-subagent"
                  disabled={actionInProgress}
                  onClick={() => void handleModeSelect('subagent-driven')}
                >
                  {isLong ? '★ ' : ''}Subagent-driven
                </button>
                <button
                  type="button"
                  className={`plan-btn${!isLong ? ' plan-btn-recommended' : ''}`}
                  data-testid="plan-mode-inline"
                  disabled={actionInProgress}
                  onClick={() => void handleModeSelect('inline')}
                >
                  {isLong ? '' : '★ '}Inline
                </button>
              </div>
            )}
          </div>
        ) : null}
        {isRunning && onAbort ? (
          <div className="plan-actions" data-testid="plan-running-actions">
            <span className="plan-running-label" data-testid="plan-running-label">
              {execution?.status === 'queued' ? 'Queued…' : 'Executing…'}
              {execution?.currentStepId ? ` (step ${execution.currentStepId})` : ''}
              {execution?.mode ? ` · ${execution.mode}` : ''}
            </span>
            <button
              type="button"
              className="plan-btn plan-btn-danger"
              data-testid="plan-abort"
              disabled={actionInProgress}
              onClick={() => void handleAbort()}
            >
              Abort
            </button>
          </div>
        ) : null}
        {isTerminal ? (
          <div className="plan-terminal" data-testid="plan-terminal">
            {plan.status === 'done' ? '✓ Completed' : '✗ Abandoned'}
            {execution?.error ? ` — ${execution.error}` : ''}
          </div>
        ) : null}
      </Collapse>
    </div>
  );
}
