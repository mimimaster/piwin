/**
 * PlanCard — inline rendering of the agent's execution plan in the chat thread.
 * Ported from docs/proto-shell.css plan-card block. The plan is session-level
 * (not anchored to a message), so ChatThread mounts a single card at the top
 * of the assistant area when `sessionPlan` is present.
 */
import { useState, type ReactElement } from 'react';
import type { PlanStepStatus, SessionPlan } from '@piwin/contracts';
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

export function PlanCard({
  plan,
  defaultOpen = true,
}: {
  plan: SessionPlan;
  defaultOpen?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`plan-card${open ? '' : ' closed'}`} data-testid="plan-card">
      <button
        type="button"
        className="plan-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="plan-title">
          计划 · {plan.steps.length} 步（{plan.title}）
        </span>
        <svg className="chev ic" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <Collapse expanded={open}>
        <div className="plan-steps">
          {plan.steps.map((step) => {
            const visual = planStepVisual(step.status);
            return (
              <div key={step.id} className={`step ${visual === 'pending' ? '' : visual}`}>
                <span className="box">{visual === 'done' ? '✓' : ''}</span>
                {step.title}
              </div>
            );
          })}
        </div>
      </Collapse>
    </div>
  );
}
