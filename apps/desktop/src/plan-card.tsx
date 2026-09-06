/**
 * Plan display helpers shared by the composer-adjacent todo tray and inspector.
 * Live progress UI lives in plan-todo-tray.tsx (Claude Code placement).
 */
import type { ReactElement } from 'react';
import type { PlanStepStatus, SessionPlan } from '@piwin/contracts';

export type PlanStepVisual = 'done' | 'run' | 'pending' | 'skipped';

export function formatPlanMarkdown(plan: SessionPlan): string {
  return [
    `# Implementation Plan: ${plan.title}`,
    `**Goal**: ${plan.goal || 'Session Plan Execution'}`,
    `**Status**: ${plan.status}`,
    '',
    '## Plan Steps',
    ...plan.steps.map((step, index) => {
      const tag = step.status === 'done' ? '[DONE]' : step.status === 'active' ? '[MODIFY]' : '[PENDING]';
      return `### ${tag} Step ${index + 1}: ${step.title}\n- Status: \`${step.status}\`${step.detail ? `\n- Detail: ${step.detail}` : ''}`;
    }),
  ].join('\n');
}

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
