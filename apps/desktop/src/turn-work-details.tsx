/** One Assistant response segment rendered in causal order. */
import { useState, type ReactElement, type ReactNode } from 'react';
import type {
  PermissionDecision,
  PermissionRememberScope,
  SessionSummary,
  SubagentInvocation,
} from '@piwin/contracts';
import type {
  ChatMessageUi,
  PermissionPromptUi,
  RunRecordUi,
  SubagentStreamState,
} from './chat-reducer';
import type { SkillActivityView } from './chat-reducer';
import {
  buildTurnPresentation,
  resolveWorkDetailsDefaultOpen,
  type TurnPresentation,
} from './run-presentation';
import { turnPresentationToActivityInput } from './run-activity-mappers.js';
import { runtimeStatusText } from './run-activity-strings.js';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { AgentLocator, SkillActivityChip } from './agent-locator.js';
import { TurnToolGroup } from './turn-tool-group';
import { GateCard } from './gate-card';
import { ExploreFlowCapsule } from './explore-flow-capsule';
import type { ExploreFlowRole } from './explore-flow';
import type { DocumentOpenInput } from './tool-call-card';
import type { DiffCardRequest } from './diff-card';
import type { AgentLocatorAnimation, WorkDetailsExpanded } from './ui-preferences.js';
import { resolveGenerationToolKind } from './generation-tool-kind.js';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { ModelOption } from './model-options';
import {
  fileNameFromDetail,
  resolveWorkFoldCode,
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
  activeSkill?: SkillActivityView | null;
  agentLocatorAnimation?: AgentLocatorAnimation;
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  subagentStreams?: Record<string, SubagentStreamState>;
  onInspectSubagent?: (selection: SubagentInspectorSelection) => void;
  /** Folded thinking under an outer 已工作 header — proto shows `.think` only. */
  hideFoldHeader?: boolean;
};

function thinkingSummaryLabel(input: {
  isRunActive: boolean;
  isThinkingActive: boolean;
  thoughtSeconds?: number;
  locale: 'zh-CN' | 'en';
}): string {
  if (input.isThinkingActive) {
    return runtimeStatusText('thinking', input.locale);
  }
  if (input.isRunActive) {
    return runtimeStatusText('working', input.locale);
  }
  if (input.thoughtSeconds !== undefined) {
    return input.locale === 'zh-CN'
      ? `已思考 ${input.thoughtSeconds} 秒`
      : `Thought for ${input.thoughtSeconds}s`;
  }
  return input.locale === 'zh-CN' ? '思考过程' : 'Thoughts';
}

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
    props.hideFoldHeader === true ||
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
  const runningToolIndex = tools.findIndex((tool) => tool.status === 'running');
  const runningTool =
    runningToolIndex >= 0 ? tools[runningToolIndex] : tools[tools.length - 1];
  const runningCode = runningTool ? resolveWorkFoldCode(runningTool) : undefined;
  const runningOrdinal =
    tools.length === 0
      ? undefined
      : runningToolIndex >= 0
        ? runningToolIndex + 1
        : tools.length;
  const waitingCode =
    permissionItem?.kind === 'permission'
      ? fileNameFromDetail(permissionItem.detail)
      : undefined;
  const showFoldHeader =
    props.hideFoldHeader !== true &&
    (hasThinking || foldState === 'running' || foldState === 'waiting');
  const hasVisibleWork =
    isFlowAnchor ||
    hasThinking ||
    inlineTools.length > 0 ||
    presentation.isWaitingForModel ||
    presentation.outcome !== undefined ||
    Boolean(presentation.terminalMessage) ||
    Boolean(permissionItem) ||
    Boolean(props.activeSkill && presentation.isActive);

  if (!hasVisibleWork) {
    return <>{props.children}</>;
  }

  const exploreCapsule =
    isFlowAnchor && exploreRole?.kind === 'anchor' ? (
      <div className="thread turn-tool-sequence">
        <ExploreFlowCapsule
          group={exploreRole.group}
          locale={locale}
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

  return (
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
          state={foldState}
          locale={locale}
          className="turn-work-details-summary"
          testId="turn-work-details-summary"
          ariaLabel={locale === 'zh-CN' ? '思考过程' : 'Thoughts'}
          {...(hasThinking
            ? {
                open: thinkingOpen,
                onToggle: () => setThinkingIntent(thinkingOpen ? 'user-closed' : 'user-open'),
              }
            : {})}
          {...(foldState === 'running'
            ? {
                ...(runningOrdinal !== undefined ? { runningToolIndex: runningOrdinal } : {}),
                ...(runningCode !== undefined ? { runningCode } : {}),
              }
            : {})}
          {...(foldState === 'waiting' && permissionItem?.kind === 'permission'
            ? {
                waitingAction: permissionItem.action,
                ...(waitingCode !== undefined ? { waitingCode } : {}),
              }
            : {})}
        >
          {foldState === 'done'
            ? thinkingSummaryLabel({
                isRunActive: presentation.isActive,
                isThinkingActive: thinkingIsStreaming,
                locale,
                ...(presentation.thoughtSeconds !== undefined
                  ? { thoughtSeconds: presentation.thoughtSeconds }
                  : {}),
              })
            : undefined}
        </WorkFoldHeader>
      ) : null}
      {hasThinking && thinkingItem?.kind === 'thinking' && (thinkingOpen || props.hideFoldHeader) ? (
        <div className="turn-work-details-body">
          <div
            className={`think turn-thinking${thinkingIsStreaming ? ' is-streaming' : ''}`}
            data-testid="turn-thinking"
          >
            <pre>{thinkingItem.text}</pre>
          </div>
        </div>
      ) : null}

      {presentation.isWaitingForModel && tools.length === 0 && !hasThinking ? (
        <div className="turn-waiting-line" data-testid="turn-waiting-line">
          <div className="agent-locator-stack">
            {props.activeSkill ? (
              <SkillActivityChip skill={props.activeSkill} loading locale={locale} />
            ) : null}
            <AgentLocator
              input={turnPresentationToActivityInput(presentation, props.message, locale)}
              {...(props.agentLocatorAnimation ? { animation: props.agentLocatorAnimation } : {})}
            />
          </div>
        </div>
      ) : null}

      {props.children}

      {anchorHasText ? exploreCapsule : null}

      {props.activeSkill && presentation.isActive && tools.length > 0 ? (
        <div className="turn-skill-activity-line" data-testid="turn-skill-activity-line">
          <SkillActivityChip
            skill={props.activeSkill}
            loading={presentation.isWaitingForModel}
            locale={locale}
          />
        </div>
      ) : null}

      {permissionItem?.kind === 'permission' &&
      props.permissionPrompt !== null &&
      props.onPermission !== undefined ? (
        <GateCard
          prompt={props.permissionPrompt}
          projectPath={props.projectPath ?? null}
          onPermission={props.onPermission}
        />
      ) : permissionItem?.kind === 'permission' ? (
        <div
          className="turn-permission-wait behavior-gate-surface"
          data-testid="turn-permission-wait"
          data-activity-id="permission"
          data-activity-animation={getBehaviorActivitySpec('permission').animation}
          data-tool-status="running"
          role="status"
        >
          <strong>{runtimeStatusText('asking', locale)}</strong>
          <div>{permissionItem.action}</div>
          {permissionItem.detail ? <div className="muted">{permissionItem.detail}</div> : null}
        </div>
      ) : null}

      <TurnToolGroup
        tools={inlineTools}
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

      {presentation.terminalMessage ? (
        <div className="turn-terminal-message muted">{presentation.terminalMessage}</div>
      ) : null}
    </div>
  );
}

export type { TurnPresentation };
