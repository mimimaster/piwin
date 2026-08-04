/**
 * Per-turn call chain (visual): Thought row + tool timeline.
 * Explore batches and light tool rows help users scan what the agent did.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { WorkDetailsExpanded } from './ui-preferences';
import {
  buildTurnPresentation,
  resolveWorkDetailsDefaultOpen,
  type TurnPresentation,
} from './run-presentation';
import type { ChatMessageUi, PermissionPromptUi, RunRecordUi } from './chat-reducer';
import { TurnToolGroup } from './turn-tool-group';
import { IconChevronDown, IconBrain } from './shell-icons';
import { RunActivitySplash } from './RunActivitySplash.js';
import { turnPresentationToActivityInput } from './run-activity-mappers.js';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';
import type { DiffCardRequest } from './diff-card';

export type TurnWorkDetailsProps = {
  message: ChatMessageUi;
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  permissionPrompt: PermissionPromptUi | null;
  workDetailsExpanded: WorkDetailsExpanded;
  toolDensity?: 'compact' | 'comfortable' | 'detailed';
  /** Whether intermediate Agent thinking should be rendered. */
  showThinking?: boolean;
  locale?: 'zh-CN' | 'en';
  /** Project root forwarded to tool cards → DiffCard. */
  projectPath?: string | null;
  /** Host request adapter forwarded to tool cards → DiffCard. */
  request?: DiffCardRequest;
};

function thinkingSummaryLabel(input: {
  isActive: boolean;
  answerStarted: boolean;
  thoughtSeconds?: number;
  locale: 'zh-CN' | 'en';
}): string {
  const isChinese = input.locale === 'zh-CN';
  if (input.isActive && !input.answerStarted) {
    return isChinese ? '思考中' : 'Thinking';
  }
  if (input.thoughtSeconds !== undefined) {
    return isChinese ? `已思考 ${input.thoughtSeconds} 秒` : `Thought for ${input.thoughtSeconds}s`;
  }
  return isChinese ? '思考过程' : 'Thoughts';
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
  const [thinkingOpen, setThinkingOpen] = useState(defaultOpen);

  useEffect(() => {
    setThinkingOpen(resolveWorkDetailsDefaultOpen(presentation, props.workDetailsExpanded));
    // Re-evaluate when activity, answer start, or failure changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- presentation fields are intentional
  }, [
    presentation.isActive,
    presentation.answerStarted,
    presentation.hasFailure,
    presentation.isWaitingForModel,
    props.workDetailsExpanded,
    presentation.summaryLabel,
    presentation.outcome,
  ]);

  const tools = presentation.workItems
    .filter((item): item is Extract<typeof item, { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => item.tool);
  const thinkingItem = presentation.workItems.find((item) => item.kind === 'thinking');
  const permissionItem = presentation.workItems.find((item) => item.kind === 'permission');
  const hasThinking = props.showThinking !== false && Boolean(thinkingItem);
  const thinkingIsStreaming = presentation.isActive && !presentation.answerStarted && hasThinking;

  const hasVisibleWork =
    hasThinking ||
    tools.length > 0 ||
    presentation.isWaitingForModel ||
    presentation.outcome !== undefined ||
    Boolean(presentation.terminalMessage);

  if (!hasVisibleWork) {
    return null;
  }

  const toolGroupProps = {
    tools,
    ...(props.toolDensity ? { density: props.toolDensity } : { density: 'compact' as const }),
    locale,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request !== undefined ? { request: props.request } : {}),
  };

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
      {/* Thought row — muted timeline line; expand for full reasoning text. */}
      {hasThinking && thinkingItem && thinkingItem.kind === 'thinking' ? (
        <>
          <button
            type="button"
            className="turn-work-details-summary"
            aria-label={locale === 'zh-CN' ? '思考过程' : 'Thoughts'}
            aria-expanded={thinkingOpen}
            data-testid="turn-work-details-summary"
            onClick={() => setThinkingOpen((previous) => !previous)}
          >
            {presentation.isActive && !presentation.answerStarted ? (
              <ActivitySvgIcon kind="working" className="turn-summary-active-icon" />
            ) : (
              <IconBrain className="turn-summary-brain-icon" />
            )}
            <span className="turn-work-details-label">
              {thinkingSummaryLabel({
                isActive: presentation.isActive,
                answerStarted: presentation.answerStarted,
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
              <IconChevronDown />
            </span>
          </button>

          <div className="turn-work-details-body" hidden={!thinkingOpen}>
            <div
              className={`turn-thinking${thinkingIsStreaming ? ' is-streaming' : ''}`}
              data-testid="turn-thinking"
            >
              <pre className={thinkingIsStreaming ? 'turn-shimmer-text' : undefined}>
                {thinkingItem.text}
              </pre>
            </div>
          </div>
        </>
      ) : null}

      {presentation.isWaitingForModel && tools.length === 0 && !hasThinking ? (
        <div className="turn-waiting-line" data-testid="turn-waiting-line">
          <RunActivitySplash
            input={turnPresentationToActivityInput(presentation, props.message, locale)}
          />
        </div>
      ) : null}

      {permissionItem && permissionItem.kind === 'permission' ? (
        <div className="turn-permission-wait" data-testid="turn-permission-wait" role="status">
          <strong>{locale === 'zh-CN' ? '等待权限' : 'Waiting for permission'}</strong>
          <div>{permissionItem.action}</div>
          {permissionItem.detail ? <div className="muted">{permissionItem.detail}</div> : null}
        </div>
      ) : null}

      {/* Tool timeline: Explore groups + individual Read/Ran/Edit rows. */}
      {tools.length > 0 ? <TurnToolGroup {...toolGroupProps} /> : null}

      {presentation.terminalMessage ? (
        <div className="turn-terminal-message muted">{presentation.terminalMessage}</div>
      ) : null}
    </div>
  );
}

/** Exported for tests that need the presentation without rendering. */
export type { TurnPresentation };
