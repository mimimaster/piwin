/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ChatMessageUi, PermissionPromptUi, RunRecordUi } from './chat-reducer';
import { MarkdownView } from './MarkdownView';
import { MediaPreview } from './MediaPreview';
import { MessageActions } from './message-actions';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { SubagentActivityCard } from './subagent-activity-card';
import { TurnWorkDetails } from './turn-work-details';
import { IconAgent } from './shell-icons';
import type { ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';
import { ComposerCard, type ComposerDockProps } from './composer-dock';
import type { ComposerPlusSubmenu } from './composer-plus-menu';
import type { PendingComposerAttachment } from './media-utils';

/**
 * In-place composer for editing a user message. Renders the same ComposerCard
 * as the bottom dock so the user gets the same send, model, mode, and slash
 * experience. Local state owns the draft; global composer props (model, skills,
 * thinking, etc.) are reused. Escape or clicking outside cancels the edit.
 */
function MessageEditCard(props: {
  messageId: string;
  initialText: string;
  composerCard: ComposerDockProps;
  onCancel: () => void;
  onResend: (text: string) => void;
}): ReactElement {
  const [editText, setEditTextState] = useState(props.initialText);
  const editTextRef = useRef(props.initialText);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusSubmenu, setPlusSubmenu] = useState<ComposerPlusSubmenu>('none');
  const [dropActive, setDropActive] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([]);
  const cardRef = useRef<HTMLDivElement | null>(null);

  function setEditText(value: string): void {
    setEditTextState(value);
    editTextRef.current = value;
  }

  // Click outside the edit card (and outside any open Radix popover/menu/modal)
  // collapses back to the plain message bubble.
  useEffect(() => {
    function isInsideOpenSurface(target: Node): boolean {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          '[data-radix-popper-content-wrapper], .ui-popover-content, .ui-dropdown-menu-content, .modal, .modal-backdrop',
        ),
      );
    }
    function handleMouseDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (isInsideOpenSurface(target)) return;
      if (cardRef.current && !cardRef.current.contains(target)) {
        props.onCancel();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [props.onCancel]);

  // Escape cancels, unless a popover/menu already consumed it (defaultPrevented).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented) return;
      if (
        document.querySelector(
          '[data-radix-popper-content-wrapper], .ui-popover-content, .ui-dropdown-menu-content, .modal',
        )
      ) {
        return;
      }
      props.onCancel();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [props.onCancel]);

  function handleSend(): void {
    const text = editTextRef.current.trim();
    if (text) {
      props.onResend(text);
    }
  }

  function handleRemoveAttachment(localId: string): void {
    setPendingAttachments((prev) => prev.filter((item) => item.localId !== localId));
  }

  return (
    <div ref={cardRef} className="message-edit-card-v2" data-testid="message-edit-box">
      <ComposerCard
        {...props.composerCard}
        layoutMode="docked"
        composer={editText}
        onComposerChange={setEditText}
        agentMode={props.composerCard.agentMode}
        onAgentModeChange={props.composerCard.onAgentModeChange}
        streaming={props.composerCard.streaming}
        runPhase={props.composerCard.runPhase}
        compacting={props.composerCard.compacting}
        pendingAttachments={pendingAttachments}
        onRemoveAttachment={handleRemoveAttachment}
        dropActive={dropActive}
        onDropActiveChange={setDropActive}
        plusMenuOpen={plusMenuOpen}
        onPlusMenuOpenChange={setPlusMenuOpen}
        plusSubmenu={plusSubmenu}
        onPlusSubmenuChange={setPlusSubmenu}
        onAttachImage={() => {
          /* Attachments disabled for quick edits. */
        }}
        onPaste={() => {
          /* No paste attachments in edit mode. */
        }}
        onDrop={() => {
          /* No drag attachments in edit mode. */
        }}
        onSend={handleSend}
        onAbort={() => {}}
        onSteer={() => {}}
        onFollowUp={() => {}}
        onCompact={() => {}}
      />
    </div>
  );
}

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
  /** Global composer configuration so the in-place edit card matches the bottom dock. */
  composerCard: ComposerDockProps;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
};

export function ChatThread(props: ChatThreadProps): ReactElement {
  // Quiet workbench: msg-in only for messages that arrive after first mount
  // (history hydrate must not replay entrance animation).
  const knownIdsRef = useRef<Set<string> | null>(null);
  const isInitialMountRef = useRef(true);
  if (knownIdsRef.current === null) {
    knownIdsRef.current = new Set(props.messages.map((message) => message.id));
  }
  const enteringIds = new Set<string>();
  if (!isInitialMountRef.current) {
    for (const message of props.messages) {
      if (!knownIdsRef.current.has(message.id)) {
        enteringIds.add(message.id);
      }
    }
  }
  useEffect(() => {
    isInitialMountRef.current = false;
    const known = knownIdsRef.current ?? new Set<string>();
    for (const message of props.messages) {
      known.add(message.id);
    }
    knownIdsRef.current = known;
  }, [props.messages]);

  return (
    <div className="chat-thread">
      {props.messages.map((message, messageIndex) => (
        <ChatMessageRow
          key={message.id}
          message={message}
          messageIndex={messageIndex}
          isNew={enteringIds.has(message.id)}
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
          composerCard={props.composerCard}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          {...(props.locale ? { locale: props.locale } : {})}
        />
      ))}
    </div>
  );
}

type ChatMessageRowProps = {
  message: ChatMessageUi;
  messageIndex: number;
  /** Quiet workbench: entrance animation for messages that arrived after mount. */
  isNew: boolean;
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
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Global composer card props so the edit mode matches the bottom composer. */
  composerCard: ComposerDockProps;
};

const ChatMessageRow = memo(
  function ChatMessageRow(props: ChatMessageRowProps): ReactElement {
    const { message } = props;
    if (message.subagentActivity) {
      return (
        <div id={`msg-${message.id}`} className="chat-subagent-slot">
          <SubagentActivityCard
            activity={message.subagentActivity}
            {...(props.onOpenSubagentSession ? { onOpenSession: props.onOpenSubagentSession } : {})}
          />
        </div>
      );
    }

    const isEditingThis = props.editingMessageId === message.id;

    const rowClass = [
      'bubble',
      `role-${message.role}`,
      message.status === 'streaming' ? 'is-streaming' : '',
      props.isNew ? 'is-new' : '',
      isEditingThis ? 'is-editing' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const isUserMessage = message.role === 'user';
    // Double-click any user bubble (or click the pencil action) to enter edit
    // mode in-place. Editing the last user message sends immediately; editing
    // an earlier message triggers the revert confirmation in App.
    const handleDoubleClick =
      isUserMessage && !isEditingThis && !props.streaming
        ? () => props.onEdit(message.id)
        : undefined;

    return (
      <article
        id={`msg-${message.id}`}
        className={rowClass}
        data-testid="message-bubble"
        data-role={message.role}
        {...(handleDoubleClick ? { onDoubleClick: handleDoubleClick } : {})}
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
            {...(props.locale ? { locale: props.locale } : {})}
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
        ) : isEditingThis ? (
          <MessageEditCard
            messageId={message.id}
            initialText={message.text}
            composerCard={props.composerCard}
            onCancel={props.onCancelEdit}
            onResend={(text) => props.onEditResend(message.id, text)}
          />
        ) : (
          <div className="message-text">{message.text}</div>
        )}
        {message.status !== 'streaming' &&
        message.text.trim() &&
        !isEditingThis &&
        message.role === 'assistant' ? (
          <MessageActions
            text={message.text}
            showRetry={false}
            showEdit={false}
            onFeedback={props.onFeedback}
          />
        ) : null}
      </article>
    );
  },
  (previous, next) => {
    const isActionableUserMessage =
      previous.message.role === 'user' &&
      (previous.message.id === previous.lastUserMessageId ||
        previous.message.id === previous.editingMessageId);
    const callbackPropsAreStable = isActionableUserMessage
      ? previous.onEdit === next.onEdit &&
        previous.onCancelEdit === next.onCancelEdit &&
        previous.onEditResend === next.onEditResend &&
        previous.onRetry === next.onRetry &&
        previous.onFeedback === next.onFeedback &&
        previous.composerCard === next.composerCard
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
      previous.locale === next.locale &&
      previous.onArtifactAction === next.onArtifactAction &&
      callbackPropsAreStable
    );
  },
);
