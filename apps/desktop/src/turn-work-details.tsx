/** One Assistant response segment rendered in causal order. */
import { useState, type ReactElement, type ReactNode } from 'react';
import { RadialBellow } from '@piwin/ui-kit';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
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
import { buildActivityPhrases, runtimeStatusText } from './run-activity-strings.js';
import { behaviorTextClass, getBehaviorActivitySpec } from './behavior-activity.js';
import { AgentLocator, SkillActivityChip } from './agent-locator.js';
import { TurnToolGroup } from './turn-tool-group';
import { ExploreFlowCapsule } from './explore-flow-capsule';
import type { ExploreFlowRole } from './explore-flow';
import type { DocumentOpenInput } from './tool-call-card';
import type { DiffCardRequest } from './diff-card';
import type { AgentLocatorAnimation, WorkDetailsExpanded } from './ui-preferences.js';
import { IconChevronRight, IconBrain } from './shell-icons';
import { resolveGenerationToolKind } from './generation-tool-kind.js';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { ModelOption } from './model-options';

export type TurnWorkDetailsProps = {
  message: ChatMessageUi;
  /** Response text/rich blocks. They stay between this response's thought and tools. */
  children?: ReactNode;
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  permissionPrompt: PermissionPromptUi | null;
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
    thinkingIntent === 'user-open' || (thinkingIntent === 'automatic' && defaultOpen);
  const tools = presentation.workItems
    .filter((item): item is Extract<typeof item, { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => item.tool);
  const exploreRole = props.exploreRole;
  const isFlowAnchor = exploreRole?.kind === 'anchor';
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
    exploreRole === undefined;
  const thinkingIsStreaming = presentation.isThinkingActive && Boolean(hasThinking);
  const thinkingLabelClass = behaviorTextClass('thinking', thinkingIsStreaming);
  const liveActivityLabel = buildActivityPhrases(
    turnPresentationToActivityInput(presentation, props.message, locale),
  )[0];
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

  return (
    <div
      className={`turn-work-details${presentation.hasFailure ? ' has-failure' : ''}${
        presentation.isActive ? ' is-active' : ''
      }${hasThinking && thinkingOpen ? ' is-open' : ' is-collapsed'}${
        presentation.isWaitingForModel ? ' is-waiting' : ''
      }`}
      data-testid="turn-work-details"
      data-run-id={presentation.runId ?? undefined}
      data-open={hasThinking && thinkingOpen ? 'true' : 'false'}
    >
      {isFlowAnchor && exploreRole?.kind === 'anchor' ? (
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
      ) : null}
      {hasThinking && thinkingItem?.kind === 'thinking' ? (
        <>
          <button
            type="button"
            className="turn-work-details-summary"
            data-activity-id="thinking"
            data-activity-animation={getBehaviorActivitySpec('thinking').animation}
            data-tool-status={thinkingIsStreaming ? 'running' : 'done'}
            aria-label={locale === 'zh-CN' ? '思考过程' : 'Thoughts'}
            aria-expanded={thinkingOpen}
            data-testid="turn-work-details-summary"
            onClick={() => setThinkingIntent(thinkingOpen ? 'user-closed' : 'user-open')}
          >
            {thinkingIsStreaming ? (
              <span
                className="turn-summary-active-animation"
                data-testid="turn-summary-active-animation"
                aria-hidden="true"
              >
                <RadialBellow
                  size="sm"
                  label={locale === 'zh-CN' ? '代理思考中' : 'Agent is thinking'}
                  testId="turn-summary-radial-bellow"
                />
              </span>
            ) : (
              <IconBrain className="turn-summary-brain-icon" />
            )}
            <span className={`turn-work-details-label ${thinkingLabelClass}`}>
              {thinkingIsStreaming && liveActivityLabel
                ? liveActivityLabel
                : thinkingSummaryLabel({
                    isRunActive: presentation.isActive,
                    isThinkingActive: thinkingIsStreaming,
                    locale,
                    ...(presentation.thoughtSeconds !== undefined
                      ? { thoughtSeconds: presentation.thoughtSeconds }
                      : {}),
                  })}
            </span>
            <span
              className={`turn-work-details-chevron${thinkingOpen ? ' is-open' : ''}`}
              aria-hidden
            >
              <IconChevronRight />
            </span>
          </button>
          {thinkingOpen ? (
            <div className="turn-work-details-body">
              <div
                className={`turn-thinking${thinkingIsStreaming ? ' is-streaming' : ''}`}
                data-testid="turn-thinking"
              >
                <pre>
                  {thinkingItem.text}
                </pre>
              </div>
            </div>
          ) : null}
        </>
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

      {props.activeSkill && presentation.isActive && tools.length > 0 ? (
        <div className="turn-skill-activity-line" data-testid="turn-skill-activity-line">
          <SkillActivityChip
            skill={props.activeSkill}
            loading={presentation.isWaitingForModel}
            locale={locale}
          />
        </div>
      ) : null}

      {permissionItem?.kind === 'permission' ? (
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
