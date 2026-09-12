/**
 * Message-bound plan execution picker.
 *
 * Shown under a turn's final reply after that turn's Run completed, using
 * the last successful `piwin_plan_present` payload in the same turn. Create
 * only persists the draft and does not show the card. The card never owns
 * plan state or blocks the composer. Buttons use the ordinary prompt path.
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
  type ExecutionRunRecord,
  type PlanDisplayPayload,
  type PlanExecutionMode,
  type SessionPlan,
  type SessionRunOutcome,
} from '@piwin/contracts';
import { recommendedPlanExecutionMode } from '@piwin/session/classify-plan';
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
  /** Owning Run outcome. The card is only offered after a completed turn. */
  runOutcome?: SessionRunOutcome;
  runStatus?: ExecutionRunRecord['status'];
};

export function canShowPlanExecutionGate(input: PlanExecutionGateVisibility): boolean {
  if (input.isConversationSession || input.streaming) return false;
  if (
    input.runStatus === 'cancelling' ||
    input.runStatus === 'queued' ||
    input.runStatus === 'running'
  ) {
    return false;
  }
  if (input.runOutcome !== 'completed') return false;
  const plan = input.plan;
  if (!plan) return false;
  const executionStatus = plan.execution?.status;
  if (executionStatus === 'running' || executionStatus === 'queued') return false;
  return plan.status === 'draft' || plan.status === 'approved';
}

export function isPlanCreateTool(tool: Pick<ToolCardUi, 'toolName' | 'presentation'>): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName];
  return names.some((name) => {
    if (!name) return false;
    const key = name.trim().toLowerCase();
    return key === 'piwin_plan_create' || key === 'plan_create';
  });
}

export function isPlanPresentTool(tool: Pick<ToolCardUi, 'toolName' | 'presentation'>): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName];
  return names.some((name) => {
    if (!name) return false;
    const key = name.trim().toLowerCase();
    return key === 'piwin_plan_present' || key === 'plan_present';
  });
}

function findSuccessfulPlanPresentPayload(
  tool: Pick<ToolCardUi, 'toolName' | 'status' | 'presentation'>,
): PlanDisplayPayload | null {
  if (tool.status !== 'done' || !isPlanPresentTool(tool)) return null;
  return parsePlanDisplayPayload(tool.presentation?.plan);
}

/** Last successful present payload in this assistant message, if any. */
export function findPlanDisplayForMessage(
  message: Pick<ChatMessageUi, 'role' | 'tools'>,
): PlanDisplayPayload | null {
  if (message.role !== 'assistant') return null;
  let last: PlanDisplayPayload | null = null;
  for (const tool of message.tools) {
    const payload = findSuccessfulPlanPresentPayload(tool);
    if (payload) last = payload;
  }
  return last;
}

/**
 * Last successful present payload in the same turn. Create-only turns return
 * null. A later ordinary text reply does not hide an earlier present.
 */
export function findLastSuccessfulPlanPresent(
  messages: readonly Pick<ChatMessageUi, 'role' | 'tools'>[],
): PlanDisplayPayload | null {
  let last: PlanDisplayPayload | null = null;
  for (const message of messages) {
    const payload = findPlanDisplayForMessage(message);
    if (payload) last = payload;
  }
  return last;
}

function hasSuccessfulPlanPresent(
  message: Pick<ChatMessageUi, 'role' | 'tools'>,
): boolean {
  return (
    message.role === 'assistant' &&
    message.tools.some((tool) => tool.status === 'done' && isPlanPresentTool(tool))
  );
}

/** Last assistant message of the latest turn that contains a successful present. */
/** Run that produced the last successful present in this turn. */
export function findPlanPresentOwningRunId(
  messages: readonly Pick<ChatMessageUi, 'role' | 'runId' | 'tools'>[],
): string | undefined {
  let last: string | undefined;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const tool of message.tools) {
      if (!findSuccessfulPlanPresentPayload(tool)) continue;
      last = tool.runId ?? message.runId ?? last;
    }
  }
  return last;
}

export function findPlanExecutionGateMessageId(
  messages: readonly Pick<ChatMessageUi, 'id' | 'role' | 'tools'>[],
): string | null {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  const turn = messages.slice(lastUserIndex + 1);
  if (!turn.some((message) => hasSuccessfulPlanPresent(message))) return null;
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const message = turn[index];
    if (message?.role === 'assistant') return message.id;
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

export { recommendedPlanExecutionMode } from '@piwin/session/classify-plan';

export type PlanExecutionGateActionState = 'choose' | 'executed' | 'stale';

/**
 * Historical cards keep their snapshot. Buttons follow the live document:
 * a later revision or a replacement plan is stale; executing/done is executed.
 * `livePlan === undefined` means the caller has no live document yet.
 */
export function resolvePlanExecutionGateActionState(input: {
  display: Pick<SessionPlan, 'id' | 'revision'>;
  livePlan?: SessionPlan | null;
}): PlanExecutionGateActionState {
  if (input.livePlan === undefined) return 'choose';
  const live = input.livePlan;
  if (live === null || live.id !== input.display.id) return 'stale';
  if (live.revision !== input.display.revision) return 'stale';
  if (live.status === 'executing' || live.status === 'done') return 'executed';
  if (live.status === 'abandoned') return 'stale';
  const executionStatus = live.execution?.status;
  if (
    executionStatus === 'running' ||
    executionStatus === 'queued' ||
    executionStatus === 'completed'
  ) {
    return 'executed';
  }
  return 'choose';
}

export type PlanExecutionGateProps = {
  plan: SessionPlan;
  /** Durable Host path shown to the user and supplied to the next prompt. */
  planPath?: string;
  /** Logical path used when opening the read-only inspector document. */
  displayPath?: string;
  /** Current session plan, used only to age historical buttons. */
  livePlan?: SessionPlan | null;
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
  executed: string;
  stale: string;
  kb: string;
};

const COPY_ZH: GateCopy = {
  status: '选择执行方式',
  title: '选择计划执行方式',
  recommended: '推荐',
  inline: '在当前会话直接执行',
  subagent: '子代理执行',
  executed: '已执行',
  stale: '已过期',
  kb: '按 A / B 键快速执行 · 也可以直接在输入框继续提问',
};

const COPY_EN: GateCopy = {
  status: 'Choose how to run',
  title: 'How should this plan run?',
  recommended: 'Recommended',
  inline: 'Inline in this session',
  subagent: 'Subagent-driven',
  executed: 'Executed',
  stale: 'Expired',
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
    livePlan,
    onExecute,
    onOpenDocument,
    actionInProgress = false,
  } = props;
  const [internalActionInProgress, setInternalActionInProgress] = useState(false);
  const internalActionInProgressRef = useRef(false);
  const actionState = resolvePlanExecutionGateActionState({
    display: plan,
    ...(livePlan !== undefined ? { livePlan } : {}),
  });
  const choosable = actionState === 'choose';
  const busy = actionInProgress || internalActionInProgress;
  const { locale } = useDesktopLocale();
  const copy = locale === 'en' ? COPY_EN : COPY_ZH;
  const captureKeyboard = choosable && props.captureKeyboard !== false;
  const recommended = recommendedPlanExecutionMode(plan);
  const historicalLabel = actionState === 'executed' ? copy.executed : copy.stale;
  const statusLabel = choosable ? copy.status : historicalLabel;
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
      if (!choosable || busy || internalActionInProgressRef.current) return;
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
    [busy, choosable, onExecute],
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
      data-action-state={actionState}
      {...(planPath !== undefined ? { 'data-plan-path': planPath } : {})}
      aria-label={statusLabel}
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
        {statusLabel}
      </span>
      <h3>{copy.title}</h3>
      <div className="desc">{description}</div>
      {displayPath ? <div className="plan-path">{displayPath}</div> : null}
      {plan.execution?.status === 'failed' && plan.execution.error ? (
        <div role="alert">{plan.execution.error}</div>
      ) : null}
      <div className="choices">
        {modes.map((entry) => {
          const isRecommended = choosable && entry.mode === recommended;
          return (
            <button
              type="button"
              key={entry.mode}
              className={`choice${isRecommended ? ' rec' : ''}`}
              data-testid={entry.mode === 'inline' ? 'plan-mode-inline' : 'plan-mode-subagent'}
              data-recommended={isRecommended ? 'true' : 'false'}
              data-historical={choosable ? undefined : 'true'}
              disabled={busy || !choosable}
              onClick={(event) => {
                event.stopPropagation();
                void executeMode(entry.mode);
              }}
            >
              {choosable ? <span className="bd">{entry.badge}</span> : null}
              {choosable
                ? isRecommended
                  ? `${copy.recommended} · ${entry.label}`
                  : entry.label
                : historicalLabel}
            </button>
          );
        })}
      </div>
      {captureKeyboard ? <div className="kb">{copy.kb}</div> : null}
    </div>
  );
}
