/**
 * Call-chain plan execution picker (proto-01 #13).
 *
 * Emitted once, on the assistant message that ran `piwin_plan_create`. After
 * that it is ordinary transcript: later turns must not re-home it. Missing
 * create tool means no gate — never fall back to "latest assistant". The
 * composer stays free so the user can ignore the plan and keep working.
 * Conversation (general scope) never shows this gate.
 */
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import type { PlanExecutionMode, SessionPlan } from '@piwin/contracts';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import type { ChatMessageUi, ToolCardUi } from './chat-ui-types.js';
import { useDesktopLocale } from './desktop-locale-context';
import { planDocumentOpenInput } from './plan-card.js';
import type { DocumentOpenInput } from './tool-call-card.js';

export type PlanExecutionGateVisibility = {
  plan: SessionPlan | null | undefined;
  isConversationSession: boolean;
};

export function canShowPlanExecutionGate(input: PlanExecutionGateVisibility): boolean {
  if (input.isConversationSession) return false;
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

export function isPlanCreateTool(tool: Pick<ToolCardUi, 'toolName' | 'presentation'>): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName];
  return names.some((name) => {
    if (!name) return false;
    const key = name.trim().toLowerCase();
    return key === 'piwin_plan_create' || key === 'plan_create';
  });
}

/** Assistant message that created the plan. Null if that turn is not in the transcript. */
export function findPlanExecutionGateMessageId(
  messages: readonly Pick<ChatMessageUi, 'id' | 'role' | 'tools'>[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    if (message.tools.some((tool) => isPlanCreateTool(tool))) return message.id;
  }
  return null;
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
  onOpenDocument?: (input: DocumentOpenInput) => void;
  actionInProgress?: boolean;
  /** Global A/B shortcuts — only while this card is still the latest assistant turn. */
  captureKeyboard?: boolean;
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
  title: '选择计划执行方式',
  recommended: '推荐',
  inline: '在当前会话直接执行',
  subagent: '子代理执行',
  kb: '按 A / B 键快速执行 · 也可以直接在输入框继续提问',
};

const COPY_EN: GateCopy = {
  status: 'Choose how to run',
  title: 'How should this plan run?',
  recommended: 'Recommended',
  inline: 'Inline in this session',
  subagent: 'Subagent-driven',
  kb: 'Press A / B to run · Or continue typing in the prompt bar',
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
  const { plan, onExecute, onOpenDocument, actionInProgress = false } = props;
  const { locale } = useDesktopLocale();
  const copy = locale === 'en' ? COPY_EN : COPY_ZH;
  const captureKeyboard = props.captureKeyboard !== false;
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
    if (!captureKeyboard) return;
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
  }, [actionInProgress, captureKeyboard, modes]);

  const description = formatPlanDescription(plan, locale);

  function handleOpenDocument(): void {
    onOpenDocument?.(planDocumentOpenInput(plan));
  }

  function handleOpenDocumentKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenDocument();
  }

  return (
    <div
      className="intr plan-execution-gate"
      data-testid="plan-execution-gate"
      data-activity-id="plan"
      data-activity-animation={getBehaviorActivitySpec('plan').animation}
      data-tool-status="idle"
      aria-label={copy.status}
      {...(onOpenDocument
        ? {
            role: 'button' as const,
            tabIndex: 0,
            title: locale === 'en' ? 'Open plan document' : '点击查看计划文档',
            'data-document-openable': 'true',
            onClick: handleOpenDocument,
            onKeyDown: handleOpenDocumentKeyDown,
          }
        : {})}
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
              onClick={(event) => {
                event.stopPropagation();
                void onExecute(entry.mode);
              }}
            >
              <span className="bd">{entry.badge}</span>
              {isRecommended ? `${copy.recommended} · ${entry.label}` : entry.label}
            </button>
          );
        })}
      </div>
      {captureKeyboard ? <div className="kb">{copy.kb}</div> : null}
    </div>
  );
}
