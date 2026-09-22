/**
 * Claude Code-style live plan list: composer-adjacent, mutates in place.
 * Shown only while a plan is in flight — draft/approved wait on
 * PlanExecutionGate (proto-01 #13), which stays under that turn's final reply.
 * Tool rows for piwin_plan_* stay out of the call chain (see TurnToolGroup).
 */
import { useState, type MouseEvent, type ReactElement } from 'react';
import type { SessionPlan } from '@piwin/contracts';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { compactPlanSteps } from './plan-todo-model.js';
import { planDocumentOpenInput, planStepVisual, StepIcon } from './plan-card.js';
import type { DocumentOpenInput } from './tool-call-card.js';

export function PlanTrayStatusIcon({
  visual,
}: {
  visual: 'run' | 'done' | 'pending';
}): ReactElement {
  switch (visual) {
    case 'done':
      return (
        <svg
          className="plan-tray-icon plan-tray-icon-done"
          viewBox="0 0 16 16"
          width="15"
          height="15"
          fill="none"
          stroke="var(--ok, #10b981)"
          strokeWidth="1.5"
          aria-label="Done"
        >
          <path
            d="M2.5 5.5l1.8 1.8 3.2-3.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M9.5 5h4M2.5 11h11" strokeLinecap="round" />
        </svg>
      );
    case 'run':
      return (
        <svg
          className="plan-tray-icon plan-tray-icon-run"
          viewBox="0 0 16 16"
          width="15"
          height="15"
          fill="none"
          stroke="var(--accent, #6366f1)"
          strokeWidth="1.5"
          aria-label="Running"
        >
          <circle
            cx="4.5"
            cy="5"
            r="2"
            fill="var(--accent, #6366f1)"
            className="plan-tray-icon-pulse"
          />
          <path d="M9 5h4.5M3 11h10.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg
          className="plan-tray-icon plan-tray-icon-pending"
          viewBox="0 0 16 16"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-label="Pending"
          opacity="0.45"
        >
          <circle cx="4.5" cy="5" r="1.5" />
          <path d="M9 5h4.5M3 11h10.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export type PlanTodoTrayProps = {
  plan: SessionPlan;
  onOpenDocument?: ((doc: DocumentOpenInput) => void) | undefined;
  onAbort?: () => void | Promise<void>;
  actionInProgress?: boolean;
  defaultExpanded?: boolean;
};

export function PlanTodoTray({
  plan,
  onOpenDocument,
  onAbort,
  actionInProgress = false,
  defaultExpanded = false,
}: PlanTodoTrayProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const execution = plan.execution;
  const isRunning =
    execution?.status === 'running' ||
    execution?.status === 'queued' ||
    plan.status === 'executing';
  const totalCount = plan.steps.length;
  const doneCount = plan.steps.filter((step) => step.status === 'done').length;
  const compact = compactPlanSteps(plan.steps, showAllSteps);

  const activeStep =
    plan.steps.find((step) => step.status === 'active') ??
    plan.steps.find((step) => step.status === 'pending');

  function handleOpenDoc(event: MouseEvent): void {
    event.stopPropagation();
    if (!onOpenDocument) return;
    onOpenDocument(planDocumentOpenInput(plan));
  }

  async function handleAbort(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (!onAbort || actionInProgress) return;
    await onAbort();
  }

  const heading = isZh ? '待办' : 'Todo';
  const moreLabel =
    compact.hiddenCount > 0
      ? isZh
        ? `还有 ${compact.hiddenCount} 项`
        : `and ${compact.hiddenCount} more`
      : null;

  const headerStatusVisual = isRunning
    ? 'run'
    : doneCount === totalCount && totalCount > 0
      ? 'done'
      : 'pending';

  return (
    <div
      className={`plan-todo-tray${expanded ? ' is-expanded' : ' is-collapsed'}`}
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
          title={
            isZh
              ? expanded
                ? '点击收起步骤'
                : '点击展开步骤'
              : expanded
                ? 'Click to collapse steps'
                : 'Click to expand steps'
          }
        >
          <span className="plan-todo-tray-status-icon">
            <PlanTrayStatusIcon visual={headerStatusVisual} />
          </span>
          <span className="plan-todo-tray-badge">
            <span className="plan-todo-tray-label">{heading}</span>
            <span className="plan-todo-tray-count">
              {doneCount} / {totalCount}
            </span>
          </span>
          <span className="plan-todo-tray-dot" aria-hidden="true">
            ·
          </span>
          {!expanded && activeStep ? (
            <span className="plan-todo-tray-active-label" title={activeStep.title}>
              <span className="plan-todo-tray-active-prefix">
                {isZh ? '当前：' : 'Current: '}
              </span>
              {activeStep.title}
            </span>
          ) : !expanded && doneCount === totalCount && totalCount > 0 ? (
            <span className="plan-todo-tray-active-label">
              {isZh ? '全部步骤已完成' : 'All steps completed'}
            </span>
          ) : plan.title ? (
            <span className="plan-todo-tray-title" title={plan.title}>
              {plan.title}
            </span>
          ) : null}
          <span
            className={`plan-todo-tray-chevron${expanded ? ' is-expanded' : ''}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3.22 5.47a.75.75 0 0 1 1.06 0L8 9.19l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.53a.75.75 0 0 1 0-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </button>
        <div className="plan-todo-tray-actions">
          {onOpenDocument ? (
            <button
              type="button"
              className="plan-todo-tray-doc"
              title={isZh ? '作为文档查看' : 'Open as document'}
              onClick={handleOpenDoc}
              data-testid="plan-todo-tray-doc"
            >
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1.5 1.5 0 0 1 1.06.44l3.914 3.914a1.5 1.5 0 0 1 .44 1.06V13.5A1.5 1.5 0 0 1 13.5 15h-9A1.5 1.5 0 0 1 3 13.5v-11z" />
                <path d="M9.5 1v4a1 1 0 0 0 1 1h4" />
              </svg>
              <span>{isZh ? '文档' : 'Plan'}</span>
            </button>
          ) : null}
          {isRunning && onAbort ? (
            <button
              type="button"
              className="plan-todo-tray-abort"
              data-testid="plan-abort"
              disabled={actionInProgress}
              onClick={(e) => void handleAbort(e)}
              title={isZh ? '中止计划执行' : 'Abort plan'}
            >
              <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
              <span>{isZh ? '中止' : 'Abort'}</span>
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <>
          <div className="plan-todo-tray-divider" />
          <ol className="plan-todo-tray-steps">
            {compact.visible.map((step) => {
              const visual = planStepVisual(step.status);
              const isActive = step.id === activeStep?.id;
              return (
                <li
                  key={step.id}
                  className={`plan-todo-step ${visual === 'pending' ? '' : visual}${
                    isActive ? ' is-active' : ''
                  }`}
                >
                  <StepIcon visual={visual} />
                  <span className="plan-todo-step-label">{step.title}</span>
                  {isActive && isRunning ? (
                    <span className="plan-todo-step-active-tag">
                      {isZh ? '执行中' : 'Running'}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {moreLabel ? (
            <button
              type="button"
              className="plan-todo-tray-more"
              onClick={() => setShowAllSteps(true)}
              data-testid="plan-todo-tray-more"
            >
              … {moreLabel}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
