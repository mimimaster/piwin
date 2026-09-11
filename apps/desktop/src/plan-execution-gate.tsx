/**
 * Message-bound plan execution picker.
 *
 * Emitted once, below the answer in the turn that ran `piwin_plan_create`.
 * The card is a projection of a completed plan-create tool result. It never
 * owns plan state, waits for a Run, or blocks the composer. Buttons are wired
 * by the caller to the ordinary prompt submission path.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import {
  parsePlanDisplayPayload,
  type PlanDisplayPayload,
  type PlanExecutionMode,
  type SessionPlan,
} from '@piwin/contracts';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import type { ChatMessageUi, ToolCardUi } from './chat-ui-types.js';
import { useDesktopLocale } from './desktop-locale-context';
import { planDocumentOpenInput } from './plan-card.js';
import type { DocumentOpenInput } from './tool-call-card.js';

export type PlanExecutionGateVisibility = {
  plan: SessionPlan | null | undefined;
  isConversationSession: boolean;
  /** A plan is reviewable only after the producing turn has settled. */
  streaming?: boolean;
};

export function canShowPlanExecutionGate(input: PlanExecutionGateVisibility): boolean {
  if (input.isConversationSession || input.streaming) return false;
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
    if (
      message.tools.some((tool) => isPlanCreateTool(tool) && tool.status === 'done')
    ) {
      return message.id;
    }
  }
  return null;
}

/** Find the completed plan payload owned by this assistant message. */
export function findPlanDisplayForMessage(
  message: Pick<ChatMessageUi, 'role' | 'tools'>,
): PlanDisplayPayload | null {
  if (message.role !== 'assistant') return null;
  for (let index = message.tools.length - 1; index >= 0; index -= 1) {
    const tool = message.tools[index];
    if (!tool || tool.status !== 'done' || !isPlanCreateTool(tool)) continue;
    const plan = parsePlanDisplayPayload(tool.presentation?.plan);
    if (plan) return plan;
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
  /** Durable Host path shown to the user and supplied to the next prompt. */
  planPath?: string;
  /** Logical path used when opening the read-only inspector document. */
  displayPath?: string;
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
  const {
    plan,
    planPath,
    displayPath,
    onExecute,
    onOpenDocument,
    actionInProgress = false,
  } = props;
  const [internalActionInProgress, setInternalActionInProgress] = useState(false);
  const internalActionInProgressRef = useRef(false);
  const busy = actionInProgress || internalActionInProgress;
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

  const executeMode = useCallback(
    async (mode: PlanExecutionMode): Promise<void> => {
      if (busy || internalActionInProgressRef.current) return;
      internalActionInProgressRef.current = true;
      setInternalActionInProgress(true);
      try {
        const result = onExecute(mode);
        if (result !== undefined) await result;
      } finally {
        internalActionInProgressRef.current = false;
        setInternalActionInProgress(false);
      }
    },
    [busy, onExecute],
  );
  const executeModeRef = useRef(executeMode);
  executeModeRef.current = executeMode;

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
      if (busy) return;
      if (isEditableTarget(event.target)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toUpperCase();
      if (key === 'A') {
        event.preventDefault();
        const modeA = modes[0]?.mode;
        if (modeA) void executeModeRef.current(modeA);
      } else if (key === 'B') {
        event.preventDefault();
        const modeB = modes[1]?.mode;
        if (modeB) void executeModeRef.current(modeB);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, captureKeyboard, modes]);

  const description = formatPlanDescription(plan, locale);

  function handleOpenDocument(): void {
    onOpenDocument?.(planDocumentOpenInput(plan, displayPath));
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
      {...(planPath !== undefined ? { 'data-plan-path': planPath } : {})}
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
      {planPath || displayPath ? (
        <div className="plan-path" title={planPath ?? displayPath}>
          {planPath ?? displayPath}
        </div>
      ) : null}
      {plan.execution?.status === 'failed' && plan.execution.error ? (
        <div role="alert">{plan.execution.error}</div>
      ) : null}
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
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void executeMode(entry.mode);
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
