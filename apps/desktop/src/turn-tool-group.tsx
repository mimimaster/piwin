/** Tool calls emitted by one Assistant response, in provider order. */
import { useMemo, type ReactElement } from 'react';
import type {
  SessionSummary,
  SubagentControlDisplay,
  SubagentInvocation,
  SubagentResultSummary,
  SubagentReviewRecord,
  SubagentTaskResult,
} from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from './chat-reducer';
import { ToolCallCard, type DocumentOpenInput } from './tool-call-card';
import { SubagentInvocationBlock } from './subagent-invocation-block';
import { SubagentControlRow } from './subagent-control-row';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { DiffCardRequest } from './diff-card';
import type { ToolCallDensity } from './ui-preferences';
import type { ModelOption } from './model-options';
import { clusterToolCalls, resolveToolClusterKind } from './tool-group-clustering';
import { isPlanProgressTool } from './plan-todo-model.js';
import { ToolBatchCapsule } from './tool-batch-capsule';
import { GoalDeliveryCard, GoalBlockedCard, GoalWaitCard, useGoalActions } from './goal';
import { useSubagentInspectorToggle } from './subagent-inspector-context';
import { SubagentInlineSession } from './subagent-inline-session';
import {
  deriveSubagentOrchestrationView,
  deriveSubagentReviewLoopView,
  subagentInvocationDomId,
  type SubagentOrchestrationItem,
} from './subagent-orchestration-view';
import { useSubagentReviewLoopBinding } from './subagent-review-loop-context';
import { isStoppableSubagentStatus, SubagentInvocationStop } from './subagent-invocation-stop';
import { SubagentReviewSummary } from './subagent-review-summary';
import {
  mergeVerificationFacts,
  shouldPresentReviewLoop,
  verificationFactFromLoopPresentation,
  type SubagentReviewLoopAttach,
} from './subagent-review-summary-model';
import type { SubagentReviewLoop, SubagentReviewLoopVerificationFact } from './subagent-review-loop-view';

export type TurnToolGroupProps = {
  tools: ToolCardUi[];
  density?: ToolCallDensity;
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
  reviewLoopEnabled?: boolean;
  subagentResults?: Record<string, SubagentResultSummary>;
  subagentVerifications?: Record<string, SubagentReviewLoopVerificationFact>;
  subagentTaskResults?: Record<string, SubagentTaskResult>;
  subagentReviews?: Record<string, SubagentReviewRecord>;
  onApplySubagentResult?: (resultId: string) => void;
  onRequestSubagentResolution?: (resultId: string) => void;
};

function readSubagentControl(tool: ToolCardUi): SubagentControlDisplay | undefined {
  return tool.presentation?.subagentControl;
}

function isSubagentControlSurface(
  control: SubagentControlDisplay | undefined,
): control is Exclude<SubagentControlDisplay, { phase: 'accepted' }> {
  return control !== undefined && control.phase !== 'accepted';
}

function isSubagentInvocationSurface(tool: ToolCardUi): boolean {
  if (isSubagentControlSurface(readSubagentControl(tool))) return false;
  if (readSubagentControl(tool)?.phase === 'accepted') return true;
  if (tool.presentation?.kind === 'subagent') return true;
  return tool.toolName === 'piwin_subagent_run';
}

function resolveInvocationForTool(
  tool: ToolCardUi,
  invocations: Record<string, SubagentInvocation> | undefined,
): SubagentInvocation | undefined {
  const values = Object.values(invocations ?? {});
  const byTool = values.find((candidate) => candidate.parentToolCallId === tool.toolCallId);
  if (byTool) return byTool;
  const accepted = readSubagentControl(tool);
  if (accepted?.phase === 'accepted') {
    return values.find((candidate) => candidate.id === accepted.invocationId);
  }
  return undefined;
}

function findOrchestrationItem(
  items: readonly SubagentOrchestrationItem[],
  invocation: SubagentInvocation | undefined,
): SubagentOrchestrationItem | undefined {
  if (!invocation) return undefined;
  return items.find((item) => item.invocationId === invocation.id);
}

function verificationFactsFromTools(
  tools: readonly ToolCardUi[],
): Record<string, SubagentReviewLoopVerificationFact> {
  const facts: Record<string, SubagentReviewLoopVerificationFact> = {};
  for (const tool of tools) {
    const fact = verificationFactFromLoopPresentation(tool.presentation?.subagentLoop);
    if (fact === undefined) {
      continue;
    }
    facts[fact.verificationId] = fact;
  }
  return facts;
}

function attachForInvocation(
  loops: readonly SubagentReviewLoop[],
  invocationId: string | undefined,
): SubagentReviewLoopAttach | undefined {
  if (invocationId === undefined) {
    return undefined;
  }
  for (const loop of loops) {
    if (!shouldPresentReviewLoop(loop)) {
      continue;
    }
    const row = loop.rows.find((candidate) => candidate.invocationId === invocationId);
    if (row === undefined) {
      continue;
    }
    return {
      kind: row.kind,
      candidateGeneration: row.candidateGeneration,
      ...(row.superseded === true ? { superseded: true } : {}),
    };
  }
  return undefined;
}

function loopTouchesInvocations(
  loop: SubagentReviewLoop,
  invocationIds: ReadonlySet<string>,
): boolean {
  return loop.rows.some(
    (row) => row.invocationId !== undefined && invocationIds.has(row.invocationId),
  );
}

/**
 * Renders tool calls from one response with automatic clustering for consecutive
 * read-only / exploratory actions into compact collapsible batch capsules.
 */
export function TurnToolGroup(props: TurnToolGroupProps): ReactElement | null {
  const tools = useMemo(
    () => props.tools.filter((tool) => !isPlanProgressTool(tool)),
    [props.tools],
  );
  const clusters = useMemo(() => clusterToolCalls(tools), [tools]);
  const inspectorToggle = useSubagentInspectorToggle();
  const goalActions = useGoalActions();
  const reviewLoopBinding = useSubagentReviewLoopBinding();
  const reviewLoopEnabled = props.reviewLoopEnabled ?? reviewLoopBinding.enabled;
  const reviewResults = props.subagentResults ?? reviewLoopBinding.results;
  const reviewTaskResults = props.subagentTaskResults ?? reviewLoopBinding.taskResults;
  const reviewRecords = props.subagentReviews ?? reviewLoopBinding.reviews;
  const reviewVerifications = useMemo(
    () =>
      mergeVerificationFacts(
        reviewLoopBinding.verifications,
        props.subagentVerifications,
        verificationFactsFromTools(tools),
      ),
    [props.subagentVerifications, reviewLoopBinding.verifications, tools],
  );
  const orchestrationItems = useMemo(() => {
    const invocations = props.subagentInvocations ?? {};
    const children = props.subagentChildren ?? {};
    const parentSessionId =
      Object.values(invocations)[0]?.parentSessionId ??
      Object.values(children)[0]?.parentSessionId;
    if (!parentSessionId) return [];
    return deriveSubagentOrchestrationView({
      parentSessionId,
      invocations,
      children,
      streams: props.subagentStreams ?? {},
    }).items;
  }, [props.subagentInvocations, props.subagentChildren, props.subagentStreams]);
  const reviewLoops = useMemo(() => {
    if (!reviewLoopEnabled) {
      return [];
    }
    const invocations = props.subagentInvocations ?? {};
    const children = props.subagentChildren ?? {};
    const parentSessionId =
      reviewLoopBinding.parentSessionId ??
      Object.values(invocations)[0]?.parentSessionId ??
      Object.values(children)[0]?.parentSessionId;
    if (!parentSessionId) {
      return [];
    }
    return deriveSubagentReviewLoopView({
      parentSessionId,
      invocations,
      results: reviewResults,
      reviews: reviewRecords,
      verifications: reviewVerifications,
      taskResults: reviewTaskResults,
    }).loops.filter(shouldPresentReviewLoop);
  }, [
    reviewLoopEnabled,
    reviewLoopBinding.parentSessionId,
    props.subagentInvocations,
    props.subagentChildren,
    reviewResults,
    reviewRecords,
    reviewVerifications,
    reviewTaskResults,
  ]);
  const reviewLoopInvocationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tool of tools) {
      const invocation = resolveInvocationForTool(tool, props.subagentInvocations);
      const accepted = readSubagentControl(tool);
      const invocationId =
        invocation?.id ?? (accepted?.phase === 'accepted' ? accepted.invocationId : undefined);
      if (invocationId !== undefined) {
        ids.add(invocationId);
      }
    }
    return ids;
  }, [props.subagentInvocations, tools]);
  const visibleReviewLoops = useMemo(
    () => reviewLoops.filter((loop) => loopTouchesInvocations(loop, reviewLoopInvocationIds)),
    [reviewLoopInvocationIds, reviewLoops],
  );

  if (tools.length === 0) {
    return null;
  }

  return (
    <div className="thread turn-tool-sequence" data-testid="turn-tool-group">
      {clusters.map((item, index) => {
        if (item.kind === 'batch') {
          return (
            <ToolBatchCapsule
              // Anchor on the first call id, not the list index: a reclassified
              // earlier row must not remount (and re-collapse) later capsules.
              key={`batch-${item.tools[0]?.toolCallId ?? index}`}
              clusterKind={item.clusterKind}
              tools={item.tools}
              summary={item.summary}
              density={props.density ?? 'compact'}
              locale={props.locale ?? 'zh-CN'}
              {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
              {...(props.request !== undefined ? { request: props.request } : {})}
              {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
              {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
              {...(props.onOpenDocument !== undefined
                ? { onOpenDocument: props.onOpenDocument }
                : {})}
            />
          );
        }

        const tool = item.tool;
        const control = readSubagentControl(tool);
        if (isSubagentControlSurface(control)) {
          return (
            <SubagentControlRow
              key={tool.toolCallId}
              control={control}
              locale={props.locale ?? 'zh-CN'}
              toolCallId={tool.toolCallId}
              {...(typeof tool.presentation?.durationMs === 'number'
                ? { durationMs: tool.presentation.durationMs }
                : {})}
              {...(props.subagentInvocations
                ? { invocations: props.subagentInvocations }
                : {})}
            />
          );
        }
        if (isSubagentInvocationSurface(tool)) {
          const invocation = resolveInvocationForTool(tool, props.subagentInvocations);
          const orchestrationItem = findOrchestrationItem(orchestrationItems, invocation);
          const child = invocation?.childSessionId
            ? props.subagentChildren?.[invocation.childSessionId]
            : Object.values(props.subagentChildren ?? {}).find(
                (candidate) => candidate.subagentParentToolCallId === tool.toolCallId,
              );
          const startControl = readSubagentControl(tool);
          const invocationId =
            invocation?.id ??
            (startControl?.phase === 'accepted' ? startControl.invocationId : undefined);
          const reviewLoopAttach = reviewLoopEnabled
            ? attachForInvocation(reviewLoops, invocationId)
            : undefined;
          // Only the top-level transcript activates anchors (nested child
          // transcripts never receive onInspectSubagent), so a nested block
          // can never claim the single expanded panel.
          const selection = inspectorToggle?.selection;
          const expanded =
            props.onInspectSubagent !== undefined &&
            child !== undefined &&
            selection?.childSessionId === child.id &&
            (selection.anchorId === tool.toolCallId ||
              selection.anchorId === invocation?.id ||
              selection.anchorId === undefined);
          const stopRunId = orchestrationItem?.runId ?? invocation?.runId;
          const stopStatus = orchestrationItem?.executionStatus ?? invocation?.status;
          return (
            <div
              key={tool.toolCallId}
              className="subagent-embed"
              data-testid="subagent-embed"
              data-expanded={expanded}
              data-stoppable={stopRunId !== undefined && isStoppableSubagentStatus(stopStatus)}
              {...(invocationId !== undefined
                ? { id: subagentInvocationDomId(invocationId) }
                : {})}
            >
              <SubagentInvocationBlock
                tool={tool}
                locale={props.locale ?? 'zh-CN'}
                expanded={expanded}
                {...(props.modelOptions ? { modelOptions: props.modelOptions } : {})}
                {...(invocation ? { invocation } : {})}
                {...(orchestrationItem ? { orchestrationItem } : {})}
                {...(child ? { child } : {})}
                {...(child &&
                props.subagentStreams?.[child.id] &&
                (!invocation ||
                  invocation.status === 'queued' ||
                  invocation.status === 'starting' ||
                  invocation.status === 'running')
                  ? { stream: props.subagentStreams[child.id] }
                  : {})}
                {...(props.onInspectSubagent
                  ? { onInspect: props.onInspectSubagent }
                  : {})}
                {...(reviewLoopAttach !== undefined ? { reviewLoopAttach } : {})}
              />
              <SubagentInvocationStop
                runId={stopRunId}
                status={stopStatus}
                locale={props.locale ?? 'zh-CN'}
              />
              {expanded ? <SubagentInlineSession /> : null}
            </div>
          );
        }

        // Structured signal first (Host lifted the tool's details onto
        // `presentation.goal`); the text-output branches below are the fallback
        // for sessions recorded before that mapping existed.
        const goal = tool.presentation?.goal;
        if (goal?.phase === 'completed') {
          return (
            <GoalDeliveryCard
              key={tool.toolCallId}
              summary={goal.summary}
              toolCallId={tool.toolCallId}
              {...(goal.verification !== undefined ? { verification: goal.verification } : {})}
              {...(goal.artifacts !== undefined ? { artifacts: goal.artifacts } : {})}
              {...(props.onOpenFile ? { onOpenFile: (path) => props.onOpenFile?.(path) } : {})}
              {...(goalActions?.reviewChanges
                ? { onOpenDiff: goalActions.reviewChanges }
                : {})}
            />
          );
        }
        if (goal?.phase === 'blocked') {
          return (
            <GoalBlockedCard
              key={tool.toolCallId}
              reason={goal.reason}
              toolCallId={tool.toolCallId}
              {...(goal.unblockAction !== undefined ? { unblockAction: goal.unblockAction } : {})}
              {...(goalActions ? { onProvideInput: goalActions.focusComposer } : {})}
              {...(goalActions ? { onSwitchToAgent: goalActions.leaveGoalMode } : {})}
            />
          );
        }
        if (goal?.phase === 'waited') {
          return (
            <GoalWaitCard
              key={tool.toolCallId}
              reason={goal.reason}
              toolCallId={tool.toolCallId}
              {...(goal.durationSeconds !== undefined
                ? { durationSeconds: goal.durationSeconds }
                : {})}
              running={false}
            />
          );
        }
        if (tool.toolName === 'goal_wait' && tool.status === 'running') {
          return (
            <GoalWaitCard
              key={tool.toolCallId}
              reason={tool.presentation?.summary || tool.output || 'Waiting'}
              toolCallId={tool.toolCallId}
              running
            />
          );
        }

        if (tool.toolName === 'goal_complete' && tool.status === 'done') {
          return (
            <GoalDeliveryCard
              key={tool.toolCallId}
              summary={tool.output || 'Goal accomplished'}
              toolCallId={tool.toolCallId}
              {...(props.onOpenFile ? { onOpenFile: (path) => props.onOpenFile?.(path) } : {})}
            />
          );
        }

        if (tool.toolName === 'goal_blocked') {
          return (
            <GoalBlockedCard
              key={tool.toolCallId}
              reason={tool.output || 'Goal execution is blocked'}
              toolCallId={tool.toolCallId}
            />
          );
        }

        // Running commands stay expanded so terminal output streams live
        // (Cursor-style "Ran …"); other tools keep the collapsed row.
        return (
          <ToolCallCard
            key={tool.toolCallId}
            tool={tool}
            density={props.density ?? 'compact'}
            expandWhileRunning={resolveToolClusterKind(tool) === 'command'}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.request !== undefined ? { request: props.request } : {})}
            {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
            {...(props.onOpenDocument !== undefined
              ? { onOpenDocument: props.onOpenDocument }
              : {})}
            {...(props.locale !== undefined ? { locale: props.locale } : {})}
          />
        );
      })}
      {visibleReviewLoops.map((loop) => (
        <SubagentReviewSummary
          key={loop.loopId}
          loop={loop}
          locale={props.locale ?? 'zh-CN'}
          enabled={reviewLoopEnabled}
          reviews={reviewRecords}
          results={reviewResults}
          {...(props.onInspectSubagent !== undefined
            ? { onInspect: props.onInspectSubagent }
            : reviewLoopBinding.onInspect !== undefined
              ? { onInspect: reviewLoopBinding.onInspect }
              : {})}
          {...(props.onApplySubagentResult !== undefined
            ? { onApply: props.onApplySubagentResult }
            : reviewLoopBinding.onApply !== undefined
              ? { onApply: reviewLoopBinding.onApply }
              : {})}
          {...(props.onRequestSubagentResolution !== undefined
            ? { onRequestResolution: props.onRequestSubagentResolution }
            : reviewLoopBinding.onRequestResolution !== undefined
              ? { onRequestResolution: reviewLoopBinding.onRequestResolution }
              : {})}
        />
      ))}
    </div>
  );
}
