/**
 * Plan display helpers shared by the transcript execution gate, the
 * composer-adjacent todo tray, and the inspector.
 * Live progress UI lives in plan-todo-tray.tsx (Claude Code placement).
 */
import type { ReactElement } from 'react';
import type { PlanStepStatus, SessionPlan } from '@piwin/contracts';
import type { DocumentOpenInput } from './tool-call-card.js';
import { isSessionPlanDisplayPath, sessionPlanDisplayPath } from './plan-document-path.js';

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

/** Build the virtual document target shared by plan surfaces and the inspector. */
export function planDocumentOpenInput(
  plan: SessionPlan,
  displayPath?: string,
): DocumentOpenInput {
  return {
    title: plan.title || 'Implementation Plan',
    path: displayPath ?? sessionPlanDisplayPath(plan.sessionId),
    content: formatPlanMarkdown(plan),
  };
}

/**
 * Path chips and the document rail both open `plans/<sessionId>.md`.
 * That path is not a workspace file. Only this session's live plan may
 * fill the virtual document; an explicit body is left untouched.
 */
export function resolveSessionPlanDocument(
  doc: DocumentOpenInput,
  sessionId: string | null | undefined,
  sessionPlan: SessionPlan | null | undefined,
): DocumentOpenInput {
  if (doc.content !== undefined || !sessionId || !sessionPlan) {
    return doc;
  }
  if (sessionPlan.sessionId !== sessionId) {
    return doc;
  }
  const path = doc.path ?? '';
  if (!isSessionPlanDisplayPath(path, sessionId)) {
    return doc;
  }
  return planDocumentOpenInput(sessionPlan, path);
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
