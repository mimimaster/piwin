/**
 * Claude Code-style live plan list: composer-adjacent, mutates in place.
 * Shown only while a plan is in flight — draft/approved wait on
 * PlanExecutionGate (proto-01 #13), which stays on the creating turn only.
 * Tool rows for piwin_plan_* stay out of the call chain (see TurnToolGroup).
 */
import { useState, type MouseEvent, type ReactElement } from 'react';
import type { SessionPlan } from '@piwin/contracts';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { compactPlanSteps } from './plan-todo-model.js';
import { planDocumentOpenInput, planStepVisual, StepIcon } from './plan-card.js';
import type { DocumentOpenInput } from './tool-call-card.js';

export type PlanTodoTrayProps = {
  plan: SessionPlan;
  onOpenDocument?: ((doc: DocumentOpenInput) => void) | undefined;
  onAbort?: () => void | Promise<void>;
  actionInProgress?: boolean;
};

export function PlanTodoTray({
  plan,
  onOpenDocument,
  onAbort,
  actionInProgress = false,
}: PlanTodoTrayProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [expanded, setExpanded] = useState(false);
  const execution = plan.execution;
  const isRunning =
    execution?.status === 'running' ||
    execution?.status === 'queued' ||
    plan.status === 'executing';
  const totalCount = plan.steps.length;
  const doneCount = plan.steps.filter((step) => step.status === 'done').length;
  const compact = compactPlanSteps(plan.steps, expanded);

  function handleOpenDoc(event: MouseEvent): void {
    event.stopPropagation();
    if (!onOpenDocument) return;
    onOpenDocument(planDocumentOpenInput(plan));
  }

  async function handleAbort(): Promise<void> {
    if (!onAbort || actionInProgress) return;
    await onAbort();
  }

  const heading = isZh ? '计划' : 'Todo';
  const moreLabel =
    compact.hiddenCount > 0
      ? isZh
        ? `还有 ${compact.hiddenCount} 项`
        : `and ${compact.hiddenCount} more`
      : null;

  return (
    <div
      className={`plan-todo-tray${expanded ? ' is-expanded' : ''}`}
      data-testid="plan-todo-tray"
      data-activity-id="plan"
      data-activity-animation={getBehaviorActivitySpec('plan').animation}
      data-tool-status={isRunning ? 'running' : 'idle'}
    >
      <div className="plan-todo-tray-bar">
        <button
          type="button"
          className="plan-todo-tray-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          data-testid="plan-todo-tray-toggle"
        >
          <span className="plan-todo-tray-label">{heading}</span>
          <span className="plan-todo-tray-count">
            {doneCount} / {totalCount}
          </span>
          {plan.title ? <span className="plan-todo-tray-title">{plan.title}</span> : null}
        </button>
        {onOpenDocument ? (
          <button
            type="button"
            className="plan-todo-tray-doc"
            title={isZh ? '作为文档查看' : 'Open as document'}
            onClick={handleOpenDoc}
            data-testid="plan-todo-tray-doc"
          >
            {isZh ? '文档' : 'Plan'}
          </button>
        ) : null}
        {isRunning && onAbort ? (
          <button
            type="button"
            className="plan-todo-tray-abort"
            data-testid="plan-abort"
            disabled={actionInProgress}
            onClick={() => void handleAbort()}
          >
            {isZh ? '中止' : 'Abort'}
          </button>
        ) : null}
      </div>
      <ol className="plan-todo-tray-steps">
        {compact.visible.map((step) => {
          const visual = planStepVisual(step.status);
          return (
            <li key={step.id} className={`plan-todo-step ${visual === 'pending' ? '' : visual}`}>
              <StepIcon visual={visual} />
              <span className="plan-todo-step-label">{step.title}</span>
            </li>
          );
        })}
      </ol>
      {moreLabel ? (
        <button
          type="button"
          className="plan-todo-tray-more"
          onClick={() => setExpanded(true)}
          data-testid="plan-todo-tray-more"
        >
          … {moreLabel}
        </button>
      ) : null}
    </div>
  );
}
