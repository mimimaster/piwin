/**
 * Composer-adjacent plan execution picker.
 *
 * Draft/approved SessionPlans wait here — not in chat prose, and not behind
 * PlanCard's old Process click. PermissionBar keeps the interruption slot
 * when a safety prompt is active; Conversation (general scope) never shows
 * this gate.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import type { PlanExecutionMode, SessionPlan } from '@piwin/contracts';
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
  kb: string;
};

const COPY_ZH: GateCopy = {
  status: '选择执行方式',
  title: '怎么执行这个计划？',
  recommended: '推荐',
  inline: '当前会话直接做',
  subagent: '子代理执行',
  kb: 'A / B 直接按键 · 出现在作曲器上方 · 安全提示占位时让位 · Conversation 会话不显示',
};

const COPY_EN: GateCopy = {
  status: 'Choose how to run',
  title: 'How should this plan run?',
  recommended: 'Recommended',
  inline: 'Inline in this session',
  subagent: 'Subagent-driven',
  kb: 'Press A / B · Docked above composer · Yields to safety prompt · Hidden in Conversation',
};

export function formatPlanDescription(
  plan: Pick<SessionPlan, 'title' | 'steps' | 'independentSteps'>,
  locale: string,
): string {
  const title = plan.title ? plan.title.trim() : '';
  const totalSteps = plan.steps.length;
  const parallelSteps = countIndependentSteps(plan);
  if (locale === 'en') {
    const stepPart = `${totalSteps} ${totalSteps === 1 ? 'step' : 'steps'}`;
    const parallelPart = parallelSteps > 0 ? ` · ${parallelSteps} parallelizable` : '';
    return title ? `${title} · ${stepPart}${parallelPart}` : `${stepPart}${parallelPart}`;
  }
  const stepPart = `${totalSteps} 步`;
  const parallelPart = parallelSteps > 0 ? ` · ${parallelSteps} 步可并行` : '';
  return title ? `${title} · ${stepPart}${parallelPart}` : `${stepPart}${parallelPart}`;
}

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

  const onExecuteRef = useRef(onExecute);
  onExecuteRef.current = onExecute;

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'INPUT' ||
        target.isContentEditable
      );
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (actionInProgress) return;
      if (isEditableTarget(event.target)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toUpperCase();
      if (key === 'A') {
        event.preventDefault();
        const modeA = modes[0]?.mode;
        if (modeA) void onExecuteRef.current(modeA);
      } else if (key === 'B') {
        event.preventDefault();
        const modeB = modes[1]?.mode;
        if (modeB) void onExecuteRef.current(modeB);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [actionInProgress, modes]);

  const description = formatPlanDescription(plan, locale);

  return (
    <div
      className="intr plan-execution-gate"
      data-testid="plan-execution-gate"
      data-activity-id="plan"
      data-activity-animation={getBehaviorActivitySpec('plan').animation}
      data-tool-status="idle"
      aria-label={copy.status}
    >
      <span className="pill zhu-p">
        <i />
        {copy.status}
      </span>
      <h3>{copy.title}</h3>
      <div className="desc">{description}</div>
      <div className="choices">
        {modes.map((entry) => {
          const isRecommended = entry.mode === recommended;
          return (
            <button
              type="button"
              key={entry.mode}
              className={`choice${isRecommended ? ' rec' : ''}`}
              data-testid={entry.mode === 'inline' ? 'plan-mode-inline' : 'plan-mode-subagent'}
              data-recommended={isRecommended ? 'true' : 'false'}
              disabled={actionInProgress}
              onClick={() => void onExecute(entry.mode)}
            >
              <span className="bd">{entry.badge}</span>
              <span>{isRecommended ? `${copy.recommended} · ${entry.label}` : entry.label}</span>
            </button>
          );
        })}
      </div>
      <div className="kb">{copy.kb}</div>
    </div>
  );
}

