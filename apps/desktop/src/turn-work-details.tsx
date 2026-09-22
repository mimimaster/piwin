/** One Assistant response segment rendered in causal order. */
import { useState, type ReactElement, type ReactNode } from 'react';
import type {
  PermissionDecision,
  PermissionRememberScope,
  PlanExecutionMode,
  SessionPlan,
  SessionSummary,
  SubagentInvocation,
} from '@piwin/contracts';
import type {
  ChatMessageUi,
  PermissionPromptUi,
  RunRecordUi,
  SubagentStreamState,
} from './chat-reducer';
import {
  buildTurnPresentation,
  resolveWorkDetailsDefaultOpen,
  type TurnPresentation,
} from './run-presentation';
import { TurnToolGroup } from './turn-tool-group';
import { PlanExecutionGate } from './plan-execution-gate.js';
import { isPlanProgressTool } from './plan-todo-model.js';
import { ExploreFlowCapsule } from './explore-flow-capsule';
import type { ExploreFlowRole } from './explore-flow';
import type { DocumentOpenInput } from './tool-call-card';
import type { DiffCardRequest } from './diff-card';
import type { WorkDetailsExpanded } from './ui-preferences.js';
import { resolveGenerationToolKind } from './generation-tool-kind.js';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { ModelOption } from './model-options';
import {
  fileNameFromDetail,
  WorkFoldHeader,
  type WorkFoldHeaderState,
} from './work-fold-header.js';

export type TurnWorkDetailsProps = {
  message: ChatMessageUi;
  /** Response text/rich blocks. They stay between this response's thought and tools. */
  children?: ReactNode;
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  permissionPrompt: PermissionPromptUi | null;
  /**
   * Show the run's non-failure terminal message. Only the last response of a
   * run may own it — every response in a tool loop shares the same run record.
   */
  showRunTerminalMessage?: boolean;
  onPermission?: ((decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void) | undefined;
  workDetailsExpanded: WorkDetailsExpanded;
  toolDensity?: 'compact' | 'comfortable' | 'detailed';
  showThinking?: boolean;
  /**
   * Cross-message explore-flow role: anchors render the grouped capsule in
   * place of their own thinking/tool rows; members and folded thoughts render
   * inside the anchor's capsule instead of their own rows.
   */
  exploreRole?: ExploreFlowRole;
  locale?: 'zh-CN' | 'en';
  modelOptions?: readonly ModelOption[];
  projectPath?: string | null;
  request?: DiffCardRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
  onOpenDiff?: (absolutePath: string, relativePath?: string) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  subagentStreams?: Record<string, SubagentStreamState>;
  onInspectSubagent?: (selection: SubagentInspectorSelection) => void;
  planExecutionGate?: {
    plan: SessionPlan;
    planPath?: string;
    displayPath?: string;
    livePlan?: SessionPlan | null;
    onExecute: (mode: PlanExecutionMode) => void | Promise<void>;
    actionInProgress?: boolean;
    captureKeyboard?: boolean;
  };
};

export function TurnWorkDetails(props: TurnWorkDetailsProps): ReactElement | null {
  const locale = props.locale ?? 'zh-CN';
  const presentation = buildTurnPresentation({
    message: props.message,
    runRecordsById: props.runRecordsById,
    activeRunId: props.activeRunId,
    permissionPrompt: props.permissionPrompt,
    locale,
  });
  const defaultOpen = resolveWorkDetailsDefaultOpen(presentation, props.workDetailsExpanded);
  const [thinkingIntent, setThinkingIntent] = useState<'automatic' | 'user-open' | 'user-closed'>(
    'automatic',
  );
  const thinkingOpen =
    thinkingIntent === 'user-open' ||
    (thinkingIntent === 'automatic' && defaultOpen);
  const tools = presentation.workItems
    .filter((item): item is Extract<typeof item, { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => item.tool);
  const exploreRole = props.exploreRole;
  const isFlowAnchor = exploreRole?.kind === 'anchor';
  const anchorHasText = isFlowAnchor && props.message.text.trim().length > 0;
  const workFoldedIntoFlow = isFlowAnchor || exploreRole?.kind === 'member';
  // Anchor/member tools and folded thoughts render inside the flow capsule.
  const inlineTools = workFoldedIntoFlow
    ? []
    : tools.filter((tool) => resolveGenerationToolKind(tool) === null);
  const callChainTools = inlineTools.filter((tool) => !isPlanProgressTool(tool));
  const thinkingItem = presentation.workItems.find((item) => item.kind === 'thinking');
  const permissionItem = presentation.workItems.find((item) => item.kind === 'permission');
  const hasThinking =
    props.showThinking !== false &&
    thinkingItem?.kind === 'thinking' &&
    (exploreRole === undefined || anchorHasText);
  const thinkingIsStreaming = presentation.isThinkingActive && Boolean(hasThinking);
  const permissionWaiting = permissionItem?.kind === 'permission';
  const foldState: WorkFoldHeaderState = permissionWaiting
    ? 'waiting'
    : presentation.isActive
      ? 'running'
      : 'done';
  // Run state is shared by every response in a tool loop: the terminal line
  // belongs to the last one only, and a failed run is owned by TurnErrorCard.
  const terminalMessage =
    props.showRunTerminalMessage === true && presentation.outcome !== 'failed'
      ? presentation.terminalMessage
      : undefined;
  const waitingCode =
    permissionItem?.kind === 'permission'
      ? fileNameFromDetail(permissionItem.detail)
      : undefined;
  // The header is the thinking toggle (or the permission wait). Live tool
  // state belongs to the chain rows and the run status footer: a second
  // 正在运行 · 第 N 个工具 line above them only repeated — and went stale
  // once the round settled while the model took its time.
  const showFoldHeader = hasThinking || foldState === 'waiting';
  const hasWorkDetails =
    isFlowAnchor ||
    hasThinking ||
    callChainTools.length > 0 ||
    presentation.isWaitingForModel ||
    presentation.outcome !== undefined ||
    Boolean(terminalMessage) ||
    Boolean(permissionItem);

  const planGate = props.planExecutionGate ? (
    <PlanExecutionGate
      plan={props.planExecutionGate.plan}
      {...(props.planExecutionGate.planPath !== undefined
        ? { planPath: props.planExecutionGate.planPath }
        : {})}
      {...(props.planExecutionGate.displayPath !== undefined
        ? { displayPath: props.planExecutionGate.displayPath }
        : {})}
      {...(props.planExecutionGate.livePlan !== undefined
        ? { livePlan: props.planExecutionGate.livePlan }
        : {})}
      onExecute={props.planExecutionGate.onExecute}
      {...(props.planExecutionGate.actionInProgress !== undefined
        ? { actionInProgress: props.planExecutionGate.actionInProgress }
        : {})}
      {...(props.planExecutionGate.captureKeyboard !== undefined
        ? { captureKeyboard: props.planExecutionGate.captureKeyboard }
        : {})}
      {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
    />
  ) : null;

  if (!hasWorkDetails) {
    return (
      <>
        {props.children}
        {planGate}
      </>
    );
  }

  const exploreCapsule =
    isFlowAnchor && exploreRole?.kind === 'anchor' ? (
      <div className="thread turn-tool-sequence">
        <ExploreFlowCapsule
          group={exploreRole.group}
          locale={locale}
          {...(props.toolDensity !== undefined ? { density: props.toolDensity } : {})}
          {...(props.showThinking !== undefined ? { showThinking: props.showThinking } : {})}
          {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
          {...(props.request !== undefined ? { request: props.request } : {})}
          {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
          {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
          {...(props.onOpenDocument !== undefined
            ? { onOpenDocument: props.onOpenDocument }
            : {})}
        />
      </div>
    ) : null;

  const workDetails = (
    <div
      className={`work turn-work-details${presentation.hasFailure ? ' has-failure' : ''}${
        foldState === 'running' ? ' is-active' : ''
      }${hasThinking && thinkingOpen ? ' is-open' : ' is-collapsed'}${
        foldState === 'waiting' ? ' is-waiting' : ''
      }`}
      data-testid="turn-work-details"
      data-run-id={presentation.runId ?? undefined}
      data-open={hasThinking && thinkingOpen ? 'true' : 'false'}
    >
      {!anchorHasText ? exploreCapsule : null}
      {showFoldHeader ? (
        <WorkFoldHeader
          state={foldState === 'waiting' ? 'waiting' : thinkingIsStreaming ? 'running' : 'done'}
          locale={locale}
          className="turn-work-details-summary"
          testId="turn-work-details-summary"
          ariaLabel={locale === 'zh-CN' ? '思考过程' : 'Thoughts'}
          doneIcon={foldState === 'waiting' ? 'bulb' : 'brain'}
          {...(hasThinking
            ? {
                open: thinkingOpen,
                onToggle: () => setThinkingIntent(thinkingOpen ? 'user-closed' : 'user-open'),
              }
            : {})}
          {...(foldState === 'waiting' && permissionItem?.kind === 'permission'
            ? {
                waitingAction: permissionItem.action,
                ...(waitingCode !== undefined ? { waitingCode } : {}),
              }
            : {})}
          {...(foldState !== 'waiting' &&
          thinkingIsStreaming &&
          props.message.thinkingStartedAt !== undefined
            ? { runningSince: props.message.thinkingStartedAt }
            : foldState !== 'waiting' && presentation.thoughtSeconds !== undefined
              ? { elapsedMs: presentation.thoughtSeconds * 1000 }
              : {})}
        >
          {foldState === 'waiting' ? undefined : locale === 'zh-CN' ? '思考过程' : 'Thoughts'}
        </WorkFoldHeader>
      ) : null}
      {hasThinking && thinkingItem?.kind === 'thinking' && thinkingOpen ? (
        <div className="turn-work-details-body">
          <div
            className={`think turn-thinking${thinkingIsStreaming ? ' is-streaming' : ''}`}
            data-testid="turn-thinking"
          >
            <pre>{thinkingItem.text}</pre>
          </div>
        </div>
      ) : null}

      {props.children}

      {anchorHasText ? exploreCapsule : null}

      <TurnToolGroup
        tools={callChainTools}
        density={props.toolDensity ?? 'compact'}
        locale={locale}
        {...(props.modelOptions ? { modelOptions: props.modelOptions } : {})}
        {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
        {...(props.request !== undefined ? { request: props.request } : {})}
        {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
        {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
        {...(props.onOpenDocument !== undefined ? { onOpenDocument: props.onOpenDocument } : {})}
        {...(props.subagentChildren ? { subagentChildren: props.subagentChildren } : {})}
        {...(props.subagentInvocations
          ? { subagentInvocations: props.subagentInvocations }
          : {})}
        {...(props.subagentStreams ? { subagentStreams: props.subagentStreams } : {})}
        {...(props.onInspectSubagent
          ? { onInspectSubagent: props.onInspectSubagent }
          : {})}
      />

      {terminalMessage ? (
        <div className="turn-terminal-message muted">{terminalMessage}</div>
      ) : null}
    </div>
  );

  return (
    <>
      {workDetails}
      {planGate}
    </>
  );
}

export type { TurnPresentation };
