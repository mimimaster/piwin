/**
 * Composer-adjacent plan execution picker.
 *
 * Draft/approved SessionPlans wait here — not in chat prose, and not behind
 * PlanCard's old Process click. PermissionBar keeps the interruption slot
 * when a safety prompt is active; Conversation (general scope) never shows
 * this gate.
 */
import type { ReactElement } from 'react';
import type { PlanExecutionMode, SessionPlan } from '@piwin/contracts';
import { AgentInterruptionFrame } from './agent-interruption-frame';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { useDesktopLocale } from './desktop-locale-context';

export type PlanExecutionGateVisibility = {
  plan: SessionPlan | null | undefined;
  isConversationSession: boolean;
  streaming?: boolean;
  paused?: boolean;
  hasPermissionPrompt?: boolean;
};

export function canShowPlanExecutionGate(input: PlanExecutionGateVisibility): boolean {
  if (input.isConversationSession) return false;
  if (input.streaming === true) return false;
  if (input.paused === true) return false;
  if (input.hasPermissionPrompt === true) return false;
  const plan = input.plan;
  if (!plan) return false;
  const executionStatus = plan.execution?.status;
  if (executionStatus === 'running' || executionStatus === 'queued') return false;
  const retryableStuck =
    plan.status === 'executing' &&
    (executionStatus === 'failed' || executionStatus === 'aborted');
  if (plan.status !== 'draft' && plan.status !== 'approved' && !retryableStuck) return false;
  return true;
}

function countIndependentSteps(plan: Pick<SessionPlan, 'steps' | 'independentSteps'>): number {
  const known = new Set(plan.steps.map((step) => step.id));
  let count = 0;
  for (const stepId of plan.independentSteps ?? []) {
    if (known.has(stepId)) count += 1;
  }
  return count;
}

export function recommendedPlanExecutionMode(
  plan: Pick<SessionPlan, 'complexity' | 'steps' | 'independentSteps'>,
): PlanExecutionMode {
  if (plan.complexity !== 'long') return 'inline';
  return countIndependentSteps(plan) > 0 ? 'subagent-driven' : 'inline';
}

export type PlanExecutionGateProps = {
  plan: SessionPlan;
  onExecute: (mode: PlanExecutionMode) => void | Promise<void>;
  actionInProgress?: boolean;
};

type GateCopy = {
  status: string;
  title: string;
  recommended: string;
  inline: string;
  subagent: string;
  description: (title: string) => string;
};

const COPY_ZH: GateCopy = {
  status: '选择执行方式',
  title: '怎么执行这个计划？',
  recommended: '推荐',
  inline: '当前会话直接做',
  subagent: '子代理执行',
  description: (title) => title,
};

const COPY_EN: GateCopy = {
  status: 'Choose how to run',
  title: 'How should this plan run?',
  recommended: 'Recommended',
  inline: 'Inline in this session',
  subagent: 'Subagent-driven',
  description: (title) => title,
};

export function PlanExecutionGate(props: PlanExecutionGateProps): ReactElement {
  const { plan, onExecute, actionInProgress = false } = props;
  const { locale } = useDesktopLocale();
  const copy = locale === 'en' ? COPY_EN : COPY_ZH;
  const recommended = recommendedPlanExecutionMode(plan);
  const modes: Array<{ mode: PlanExecutionMode; badge: string; label: string }> =
    recommended === 'subagent-driven'
      ? [
          { mode: 'subagent-driven', badge: 'A', label: copy.subagent },
          { mode: 'inline', badge: 'B', label: copy.inline },
        ]
      : [
          { mode: 'inline', badge: 'A', label: copy.inline },
          { mode: 'subagent-driven', badge: 'B', label: copy.subagent },
        ];

  return (
    <AgentInterruptionFrame
      tone="question"
      statusLabel={copy.status}
      title={copy.title}
      description={plan.title ? copy.description(plan.title) : undefined}
      testId="plan-execution-gate"
      activityId="plan"
      activityAnimation={getBehaviorActivitySpec('plan').animation}
      activityStatus="idle"
    >
      <div className="agent-interruption-choices">
        {modes.map((entry) => {
          const isRecommended = entry.mode === recommended;
          return (
            <button
              type="button"
              key={entry.mode}
              className="agent-interruption-choice"
              data-testid={entry.mode === 'inline' ? 'plan-mode-inline' : 'plan-mode-subagent'}
              data-recommended={isRecommended ? 'true' : 'false'}
              disabled={actionInProgress}
              onClick={() => void onExecute(entry.mode)}
            >
              <span className="agent-interruption-choice-badge">{entry.badge}</span>
              <span className="agent-interruption-choice-label">
                {isRecommended ? `${copy.recommended} · ${entry.label}` : entry.label}
              </span>
            </button>
          );
        })}
      </div>
    </AgentInterruptionFrame>
  );
}
