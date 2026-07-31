/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { SessionPlan, ThemeManifest } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type {
  ChatMessageUi,
  PermissionPromptUi,
  RunRecordUi,
  SubagentStreamState,
} from './chat-reducer';
import type {
  PermissionDecision,
  PermissionRememberScope,
  PlanExecutionMode,
} from '@piwin/contracts';
import { MarkdownView } from './MarkdownView';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';
import { MessageActions } from './message-actions';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { SubagentActivityCard } from './subagent-activity-card';
import { TurnWorkDetails } from './turn-work-details';
import { RunActivitySlot } from './RunActivitySlot.js';
import { PlanCard } from './plan-card';
import { GateCard } from './gate-card';
import type { ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';
import { ComposerCard, type ComposerDockProps } from './composer-dock';
import type { DiffCardRequest } from './diff-card';
import type { ComposerPlusSubmenu } from './composer-plus-menu';
import type { PendingComposerAttachment } from './media-utils';
import { IconCopy, IconCheck, IconRevert } from './shell-icons';

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
  /** Session-level plan rendered once at the top of the thread (not per-message). */
  plan?: SessionPlan | null;
  runRecordsById?: Record<string, RunRecordUi>;
  activeRunId?: string | null;
  permissionPrompt?: PermissionPromptUi | null;
  /** Project path used to gate "always allow" (project remember) availability. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  /** Existing permission respond handler (allow / deny / ask). */
  onPermission?: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
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
  /** When false (default), MarkdownView hides the heavy Artifact path. */
  artifactPreviewEnabled?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence. */
  artifactMaxBytes?: number;
  /** Global composer configuration so the in-place edit card matches the bottom dock. */
  composerCard: ComposerDockProps;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
  /** Called when the user selects an execution mode for the session plan. */
  onPlanExecute?: ((mode: PlanExecutionMode) => void | Promise<void>) | undefined;
  /** Called when the user aborts a running plan. */
  onPlanAbort?: (() => void | Promise<void>) | undefined;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Live subagent streams for inline expand UX (keyed by childSessionId). */
  subagentStreams?: Record<string, SubagentStreamState>;
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

  const activeToolName = useMemo(() => {
    for (let i = props.messages.length - 1; i >= 0; i--) {
      const msg = props.messages[i];
      if (msg?.role === 'assistant') {
        const runningTool = msg.tools.find((t) => t.status === 'running');
        if (runningTool) return runningTool.toolName;
      }
    }
    return undefined;
  }, [props.messages]);

  return (
    <div className="chat-thread">
      {props.plan ? (
        <PlanCard
          plan={props.plan}
          {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
          {...(props.onPlanExecute ? { onExecute: props.onPlanExecute } : {})}
          {...(props.onPlanAbort ? { onAbort: props.onPlanAbort } : {})}
        />
      ) : null}
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
          {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
          {...(props.toolDiffRequest !== undefined
            ? { toolDiffRequest: props.toolDiffRequest }
            : {})}
          onEdit={props.onEdit}
          onCancelEdit={props.onCancelEdit}
          onEditResend={props.onEditResend}
          onRetry={props.onRetry}
          onFeedback={props.onFeedback}
          onOpenSubagentSession={props.onOpenSubagentSession}
          composerCard={props.composerCard}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
          {...(props.artifactMaxBytes !== undefined
            ? { artifactMaxBytes: props.artifactMaxBytes }
            : {})}
          {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
          {...(props.locale ? { locale: props.locale } : {})}
          {...(props.subagentStreams ? { subagentStreams: props.subagentStreams } : {})}
        />
      ))}
      {props.streaming &&
      !props.permissionPrompt &&
      (props.messages.length === 0 ||
        props.messages[props.messages.length - 1]?.role === 'user') ? (
        <RunActivitySlot
          activeRunId={props.activeRunId ?? null}
          runRecordsById={props.runRecordsById ?? {}}
          {...(activeToolName ? { activeToolName } : {})}
          {...(props.locale ? { locale: props.locale } : {})}
        />
      ) : null}
      {props.permissionPrompt && props.onPermission ? (
        <GateCard
          prompt={props.permissionPrompt}
          projectPath={props.projectPath ?? null}
          onPermission={props.onPermission}
        />
      ) : null}
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
  /** Project root forwarded to tool cards → DiffCard. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onFeedback?: ((message: string, level: 'success' | 'error') => void) | undefined;
  onOpenSubagentSession: ((sessionId: string) => void) | undefined;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  /** When false (default), MarkdownView hides the heavy Artifact path. */
  artifactPreviewEnabled?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence. */
  artifactMaxBytes?: number;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Global composer card props so the edit mode matches the bottom composer. */
  composerCard: ComposerDockProps;
  /** Live subagent streams for inline expand UX. */
  subagentStreams?: Record<string, SubagentStreamState>;
};

function formatMessageTime(createdAt?: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Height (px) above which a user message bubble collapses. */
const USER_MESSAGE_COLLAPSE_THRESHOLD = 78;

function UserMessageContent(props: {
  message: ChatMessageUi;
  streaming?: boolean;
  onRetry: (messageId: string) => void;
  onFeedback?: ((message: string, level: 'success' | 'error') => void) | undefined;
}): ReactElement {
  const { message } = props;
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isOverflow, setIsOverflow] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const formattedTime = formatMessageTime(message.createdAt);

  // Measure the natural height of the text node to determine if it needs collapsing.
  useEffect(() => {
    const node = textRef.current;
    if (!node) return;

    function measure(): void {
      if (!node) return;
      const naturalHeight = node.scrollHeight;
      setIsOverflow(naturalHeight > USER_MESSAGE_COLLAPSE_THRESHOLD);
    }

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [message.text]);

  async function handleCopy(): Promise<void> {
    const payload = message.text.trim();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      props.onFeedback?.('Copied to clipboard', 'success');
    } catch {
      props.onFeedback?.('Could not copy to clipboard', 'error');
    }
  }

  const collapsed = isOverflow && isCollapsed;

  const handleToggle = isOverflow ? () => setIsCollapsed((prev) => !prev) : undefined;

  return (
    <div className="user-message-wrapper">
      <div
        className={`message-text-collapsible ${collapsed ? 'is-collapsed' : 'is-expanded'} ${isOverflow ? 'is-clickable' : ''}`}
        onClick={handleToggle}
        role={isOverflow ? 'button' : undefined}
        tabIndex={isOverflow ? 0 : undefined}
        onKeyDown={
          isOverflow
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsCollapsed((prev) => !prev);
                }
              }
            : undefined
        }
      >
        <div
          ref={textRef}
          className="message-text"
          style={collapsed ? { maxHeight: `${USER_MESSAGE_COLLAPSE_THRESHOLD}px` } : undefined}
        >
          {message.text}
        </div>
      </div>
      <div
        className="user-message-actions"
        data-testid="user-message-actions"
        onClick={(e) => e.stopPropagation()}
      >
        {formattedTime ? (
          <span className="user-message-time" data-testid="user-message-time">
            {formattedTime}
          </span>
        ) : null}
        <button
          type="button"
          className="user-msg-btn"
          onClick={() => void handleCopy()}
          title="Copy"
          aria-label="Copy message"
          data-testid="message-copy-btn"
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
        <button
          type="button"
          className="user-msg-btn"
          onClick={() => props.onRetry(message.id)}
          disabled={props.streaming}
          title="Revert"
          aria-label="Revert message"
          data-testid="message-revert-btn"
        >
          <IconRevert />
        </button>
      </div>
    </div>
  );
}

const ChatMessageRow = memo(
  function ChatMessageRow(props: ChatMessageRowProps): ReactElement {
    const { message } = props;
    if (message.subagentActivity) {
      const stream = props.subagentStreams?.[message.subagentActivity.childSessionId];
      return (
        <div id={`msg-${message.id}`} className="chat-subagent-slot">
          <SubagentActivityCard
            activity={message.subagentActivity}
            {...(props.onOpenSubagentSession ? { onOpenSession: props.onOpenSubagentSession } : {})}
            {...(stream ? { stream } : {})}
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
          <TurnWorkDetails
            message={message}
            runRecordsById={props.runRecordsById}
            activeRunId={props.activeRunId}
            permissionPrompt={props.permissionPrompt}
            workDetailsExpanded={props.workDetailsExpanded}
            toolDensity={props.toolDensity}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.toolDiffRequest !== undefined ? { request: props.toolDiffRequest } : {})}
            {...(props.locale ? { locale: props.locale } : {})}
          />
        ) : null}
        {message.attachments.length > 0 ? (
          <div className="message-attachments">
            {message.attachments.map((attachment) =>
              attachment.kind === 'web-element' ? (
                <WebElementChip key={attachment.id} attachment={attachment} />
              ) : (
                <MediaPreview key={attachment.id} attachment={attachment} />
              ),
            )}
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
            {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
            {...(props.artifactMaxBytes !== undefined
              ? { artifactMaxBytes: props.artifactMaxBytes }
              : {})}
            {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
            {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
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
          <UserMessageContent
            message={message}
            streaming={props.streaming}
            onRetry={props.onRetry}
            onFeedback={props.onFeedback}
          />
        )}
      </article>
    );
  },
  (previous, next) => {
    const isActionableUserMessage = previous.message.role === 'user';
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
      previous.onOpenDocument === next.onOpenDocument &&
      callbackPropsAreStable
    );
  },
);
