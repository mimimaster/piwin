/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { memo, type ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import type { ChatMessageUi, PermissionPromptUi, RunRecordUi } from './chat-reducer';
import { MarkdownView } from './MarkdownView';
import { MediaPreview } from './MediaPreview';
import { MessageActions } from './message-actions';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { SubagentActivityCard } from './subagent-activity-card';
import { TurnWorkDetails } from './turn-work-details';
import { IconAgent } from './shell-icons';
import type { ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';

/**
 * C5: completed Markdown/Artifact only after the message is done *and* its
 * owning run is terminal (or legacy messages without run identity).
 */
function resolveAssistantRenderingPhase(
  message: ChatMessageUi,
  runRecordsById: Record<string, RunRecordUi>,
  activeRunId: string | null,
): 'streaming' | 'completed' {
  if (message.status === 'streaming' || message.status === 'error') {
    return message.status === 'error' ? 'completed' : 'streaming';
  }
  const runId = message.runId;
  if (!runId) {
    return 'completed';
  }
  if (activeRunId === runId) {
    return 'streaming';
  }
  const record = runRecordsById[runId];
  if (record?.outcome) {
    return 'completed';
  }
  // Hydrated transcripts have terminal message status but may predate run
  // records. A live message still has activeRunId until run/terminal arrives,
  // so this fallback does not enable Artifact rendering early.
  return activeRunId === null ? 'completed' : 'streaming';
}

export type ChatThreadProps = {
  messages: ChatMessageUi[];
  streaming: boolean;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: number;
  runRecordsById?: Record<string, RunRecordUi>;
  activeRunId?: string | null;
  permissionPrompt?: PermissionPromptUi | null;
  workDetailsExpanded?: WorkDetailsExpanded;
  toolDensity?: ToolCallDensity;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onFeedback?: ((message: string, level: 'success' | 'error') => void) | undefined;
  onOpenSubagentSession: ((sessionId: string) => void) | undefined;
  /** Whitelisted artifact actions, e.g. flashcard rating (ADR 0018 S5c). */
  onArtifactAction?: (action: ArtifactActionMessage) => void;
};

export function ChatThread(props: ChatThreadProps): ReactElement {
  return (
    <div className="chat-thread">
      {props.messages.map((message, messageIndex) => (
        <ChatMessageRow
          key={message.id}
          message={message}
          messageIndex={messageIndex}
          streaming={props.streaming}
          editingMessageId={props.editingMessageId}
          lastUserMessageId={props.lastUserMessageId}
          activeTheme={props.activeTheme}
          artifactThemeKey={props.artifactThemeKey}
          runRecordsById={props.runRecordsById ?? {}}
          activeRunId={props.activeRunId ?? null}
          permissionPrompt={props.permissionPrompt ?? null}
          workDetailsExpanded={props.workDetailsExpanded ?? 'auto'}
          toolDensity={props.toolDensity ?? 'comfortable'}
          onEdit={props.onEdit}
          onCancelEdit={props.onCancelEdit}
          onEditResend={props.onEditResend}
          onRetry={props.onRetry}
          onFeedback={props.onFeedback}
          onOpenSubagentSession={props.onOpenSubagentSession}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
        />
      ))}
    </div>
  );
}

type ChatMessageRowProps = {
  message: ChatMessageUi;
  messageIndex: number;
  streaming: boolean;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: number;
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  permissionPrompt: PermissionPromptUi | null;
  workDetailsExpanded: WorkDetailsExpanded;
  toolDensity: ToolCallDensity;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onFeedback?: ((message: string, level: 'success' | 'error') => void) | undefined;
  onOpenSubagentSession: ((sessionId: string) => void) | undefined;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
};

const ChatMessageRow = memo(function ChatMessageRow(props: ChatMessageRowProps): ReactElement {
  const { message } = props;
  if (message.subagentActivity) {
    return (
      <div id={`msg-${message.id}`} className="chat-subagent-slot">
        <SubagentActivityCard
          activity={message.subagentActivity}
          {...(props.onOpenSubagentSession
            ? { onOpenSession: props.onOpenSubagentSession }
            : {})}
        />
      </div>
    );
  }

  return (
    <article
      id={`msg-${message.id}`}
      className={`bubble role-${message.role}${message.status === 'streaming' ? ' is-streaming' : ''}`}
      data-testid="message-bubble"
      data-role={message.role}
    >
      {message.role === 'assistant' ? (
        <header className="bubble-header">
          <span className="bubble-agent-icon" aria-hidden>
            <IconAgent />
          </span>
          <strong className="bubble-role">piwin</strong>
          {message.status === 'streaming' ? (
            <span className="stream-dot" aria-label="Streaming" />
          ) : null}
        </header>
      ) : null}
      {message.role === 'assistant' ? (
        <TurnWorkDetails
          message={message}
          runRecordsById={props.runRecordsById}
          activeRunId={props.activeRunId}
          permissionPrompt={props.permissionPrompt}
          workDetailsExpanded={props.workDetailsExpanded}
          toolDensity={props.toolDensity}
        />
      ) : null}
      {message.attachments.length > 0 ? (
        <div className="message-attachments">
          {message.attachments.map((attachment) => (
            <MediaPreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
      {message.role === 'assistant' ? (
        <MarkdownView
          text={message.text}
          renderingPhase={resolveAssistantRenderingPhase(
            message,
            props.runRecordsById,
            props.activeRunId,
          )}
          artifactTheme={mapThemeToArtifactVariables(props.activeTheme)}
          initPriorityBase={props.messageIndex * 10}
          artifactThemeKey={`${props.activeTheme?.id ?? 'none'}:${props.artifactThemeKey}`}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
        />
      ) : props.editingMessageId === message.id ? (
        <div className="message-edit-box" data-testid="message-edit-box">
          <textarea
            className="message-edit-input"
            data-testid="message-edit-input"
            defaultValue={message.text}
            rows={3}
            id={`edit-${message.id}`}
          />
          <div className="message-edit-actions">
            <Button
              size="compact"
              data-testid="message-edit-cancel"
              onClick={props.onCancelEdit}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="compact"
              data-testid="message-edit-resend"
              disabled={props.streaming}
              onClick={() => {
                const element = document.getElementById(
                  `edit-${message.id}`,
                ) as HTMLTextAreaElement | null;
                props.onEditResend(message.id, element?.value ?? message.text);
              }}
            >
              Save & resend
            </Button>
          </div>
        </div>
      ) : (
        <div className="message-text">{message.text}</div>
      )}
      {message.status !== 'streaming' &&
      message.text.trim() &&
      props.editingMessageId !== message.id ? (
        <MessageActions
          text={message.text}
          showRetry={message.role === 'user' && message.id === props.lastUserMessageId}
          showEdit={message.role === 'user' && message.id === props.lastUserMessageId}
          disabled={props.streaming}
          {...(message.role === 'user' && message.id === props.lastUserMessageId
            ? {
                onRetry: () => props.onRetry(message.id),
                onEdit: () => props.onEdit(message.id),
              }
            : {})}
          onFeedback={props.onFeedback}
        />
      ) : null}
    </article>
  );
}, (previous, next) => {
  const isActionableUserMessage =
    previous.message.role === 'user' &&
    previous.message.id === previous.lastUserMessageId;
  const callbackPropsAreStable = isActionableUserMessage
    ? previous.onEdit === next.onEdit &&
      previous.onCancelEdit === next.onCancelEdit &&
      previous.onEditResend === next.onEditResend &&
      previous.onRetry === next.onRetry &&
      previous.onFeedback === next.onFeedback
    : previous.message.subagentActivity
      ? previous.onOpenSubagentSession === next.onOpenSubagentSession
      : true;
  return (
    previous.message === next.message &&
    previous.messageIndex === next.messageIndex &&
    previous.streaming === next.streaming &&
    previous.editingMessageId === next.editingMessageId &&
    previous.lastUserMessageId === next.lastUserMessageId &&
    previous.activeTheme === next.activeTheme &&
    previous.artifactThemeKey === next.artifactThemeKey &&
    previous.runRecordsById === next.runRecordsById &&
    previous.activeRunId === next.activeRunId &&
    previous.permissionPrompt === next.permissionPrompt &&
    previous.workDetailsExpanded === next.workDetailsExpanded &&
    previous.toolDensity === next.toolDensity &&
    previous.onArtifactAction === next.onArtifactAction &&
    callbackPropsAreStable
  );
});
