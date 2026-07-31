/**
 * Collapsible per-turn work record: thinking, tools, permission, outcome.
 * Quiet workbench: grey streaming process → chip summary when answer starts.
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
import { IconChevronDown } from './shell-icons';
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
  locale?: 'zh-CN' | 'en';
  /** Project root forwarded to tool cards → DiffCard. */
  projectPath?: string | null;
  /** Host request adapter forwarded to tool cards → DiffCard. */
  request?: DiffCardRequest;
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
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(resolveWorkDetailsDefaultOpen(presentation, props.workDetailsExpanded));
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

  const hasVisibleWork =
    presentation.workItems.length > 0 ||
    presentation.isWaitingForModel ||
    presentation.outcome !== undefined ||
    Boolean(presentation.terminalMessage) ||
    (presentation.toolCallCount > 0 && !presentation.isActive) ||
    (presentation.thoughtSeconds !== undefined && !presentation.isActive);

  if (!hasVisibleWork) {
    return null;
  }

  const tools = presentation.workItems
    .filter((item): item is Extract<typeof item, { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => item.tool);
  const thinkingItem = presentation.workItems.find((item) => item.kind === 'thinking');
  const permissionItem = presentation.workItems.find((item) => item.kind === 'permission');
  const thinkingIsStreaming =
    presentation.isActive && !presentation.answerStarted && Boolean(thinkingItem);

  return (
    <div
      className={`turn-work-details${presentation.hasFailure ? ' has-failure' : ''}${
        presentation.isActive ? ' is-active' : ''
      }${open ? ' is-open' : ' is-collapsed'}${
        presentation.isWaitingForModel ? ' is-waiting' : ''
      }`}
      data-testid="turn-work-details"
      data-run-id={presentation.runId ?? undefined}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className="turn-work-details-summary"
        aria-label="Work details"
        aria-expanded={open}
        data-testid="turn-work-details-summary"
        onClick={() => setOpen((previous) => !previous)}
      >
        {presentation.isActive ? (
          <ActivitySvgIcon kind="working" className="turn-summary-active-icon" />
        ) : null}
        <span className="turn-work-details-label">{presentation.summaryLabel}</span>
        {presentation.outcome ? (
          <span className="muted turn-work-details-outcome" data-outcome={presentation.outcome}>
            {presentation.outcome}
          </span>
        ) : null}
        <span className={`turn-work-details-chevron${open ? ' is-open' : ''}`} aria-hidden>
          <IconChevronDown />
        </span>
      </button>

      <div className="turn-work-details-body" hidden={!open}>
        {presentation.isWaitingForModel && tools.length === 0 && !thinkingItem ? (
          <div className="turn-waiting-line" data-testid="turn-waiting-line">
            <RunActivitySplash
              input={turnPresentationToActivityInput(presentation, props.message, locale)}
            />
          </div>
        ) : null}

        {thinkingItem && thinkingItem.kind === 'thinking' ? (
          <div
            className={`turn-thinking${thinkingIsStreaming ? ' is-streaming' : ''}`}
            data-testid="turn-thinking"
          >
            <pre className={thinkingIsStreaming ? 'turn-shimmer-text' : undefined}>
              {thinkingItem.text}
            </pre>
          </div>
        ) : null}

        {permissionItem && permissionItem.kind === 'permission' ? (
          <div className="turn-permission-wait" data-testid="turn-permission-wait" role="status">
            <strong>{locale === 'zh-CN' ? '等待权限' : 'Waiting for permission'}</strong>
            <div>{permissionItem.action}</div>
            {permissionItem.detail ? <div className="muted">{permissionItem.detail}</div> : null}
          </div>
        ) : null}

        {tools.length > 0 ? (
          <TurnToolGroup
            tools={tools}
            {...(props.toolDensity ? { density: props.toolDensity } : { density: 'compact' })}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.request !== undefined ? { request: props.request } : {})}
          />
        ) : null}

        {presentation.terminalMessage ? (
          <div className="turn-terminal-message muted">{presentation.terminalMessage}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Exported for tests that need the presentation without rendering. */
export type { TurnPresentation };
