/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type {
  ProductSessionLineageView,
  SessionPlan,
  SessionSummary,
  SubagentInvocation,
  ThemeManifest,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import type {
  ChatMessageUi,
  PermissionPromptUi,
  RunRecordUi,
  SkillActivityView,
  SubagentStreamState,
  ToolCardUi,
} from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type {
  PermissionDecision,
  PermissionRememberScope,
  PlanExecutionMode,
} from '@piwin/contracts';
import { MarkdownView } from './MarkdownView';
import { CitationCards } from './CitationCards';
import { MessageAttachments } from './message-attachments';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { SubagentActivityCard } from './subagent-activity-card';
import { TurnWorkDetails } from './turn-work-details';
import type { DocumentOpenInput } from './tool-call-card';
import { RunActivitySlot } from './RunActivitySlot.js';
import { PlanCard } from './plan-card';
import { WalkthroughAction, isWalkthroughEligible } from './walkthrough-action';
import { FilesChangedBar, type FilesChangedBarRequest } from './files-changed-bar';
import { ImageGenerationProgress } from './image-generation-progress';
import { VideoGenerationProgress } from './video-generation-progress';
import { resolveGenerationToolKind, type GenerationToolKind } from './generation-tool-kind.js';
import type { AgentLocatorAnimation, ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';
import { ComposerCard, type ComposerDockProps } from './composer-dock';
import type { DiffCardRequest } from './diff-card';
import type { ComposerPlusSubmenu } from './composer-plus-menu';
import type { PendingComposerAttachment } from './media-utils';
import { IconCopy, IconCheck, IconRevert } from './shell-icons';
import { AssistantResponseActions } from './assistant-response-actions';
import { TranscriptTurnList } from './transcript-turn-list';
import { groupTranscriptTurns } from './transcript-turns';
import { SystemMessageContent } from './system-message-content';
import { collectMessageChangedFiles } from './collect-message-changed-files';
import { findStreamingCaretMessageId, resolveAssistantRenderingPhase } from './streaming-caret';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';

/** Legacy helper retained for callers that still compute the old preference. */
/** @deprecated Run Inspector disclosure is now explicitly user-owned. */
export function shouldCollapseTurnToolHistory(input: {
  workDetailsMessage: ChatMessageUi;
  activeRunId: string | null;
  answerText: string;
}): boolean {
  void input.answerText;
  const runId = input.workDetailsMessage.runId;
  const runActive =
    input.workDetailsMessage.status === 'streaming' ||
    (runId !== undefined && input.activeRunId !== null && runId === input.activeRunId);
  return !runActive;
}


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
        onAttachFile={() => {
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

export type ChatThreadProps = {
  messages: ChatMessageUi[];
  /** Active product session owning the rendered transcript. */
  sessionId?: string;
  streaming: boolean;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  /** Active session id — CM-10 message context menu source session. */
  activeSessionId?: string | null;

  /** Session-level plan rendered once at the top of the thread (not per-message). */
  plan?: SessionPlan | null;
  runRecordsById?: Record<string, RunRecordUi>;
  activeRunId?: string | null;
  /** Explicit slash Skill currently associated with the foreground prompt. */
  activeSkill?: SkillActivityView | null;
  /** Animation used by the compact live agent locator. */
  agentLocatorAnimation?: AgentLocatorAnimation;
  permissionPrompt?: PermissionPromptUi | null;
  /** Project path used to gate "always allow" (project remember) availability. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  /**
   * Host git request for turn-level files-changed stats (`git/diff-summary`).
   * Same adapter as ChangesPanel; optional so the bar still lists paths without stats.
   */
  filesChangedRequest?: FilesChangedBarRequest;
  /** Open Review / Changes inspector (FilesChangedBar Review button). */
  onReviewChanges?: () => void;
  /** Existing permission respond handler (allow / deny / ask). */
  onPermission?: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
  workDetailsExpanded?: WorkDetailsExpanded;
  toolDensity?: ToolCallDensity;
  /** Whether intermediate Agent thinking should be rendered in the timeline. */
  showThinking?: boolean;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  /** Open the read-only subagent session inspector for a transcript card. */
  onInspectSubagent: ((selection: SubagentInspectorSelection) => void) | undefined;
  /** Child projections bound to delegation tool calls in the transcript. */
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  /** Live child tails used for each inline block's latest activity. */
  subagentStreams?: Record<string, SubagentStreamState>;
  /** Whitelisted artifact actions, e.g. flashcard rating (ADR 0018 S5c). */
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  /** Open a fence explicitly declared with surface="canvas". */
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  /** When false (default), MarkdownView hides the heavy Artifact path. */
  artifactPreviewEnabled?: boolean;
  /** When true, MarkdownView displays source code first for artifact blocks. */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence. */
  artifactMaxBytes?: number;
  /** Global composer configuration so the in-place edit card matches the bottom dock. */
  composerCard: ComposerDockProps;
  /** Callback when clicking a search result file or file link. */
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Called when the user selects an execution mode for the session plan. */
  onPlanExecute?: ((mode: PlanExecutionMode) => void | Promise<void>) | undefined;
  /** Called when the user aborts a running plan. */
  onPlanAbort?: (() => void | Promise<void>) | undefined;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Walkthrough artifacts keyed by owning assistant messageId (spec §5.1). */
  walkthroughsByMessageId?: Record<string, WalkthroughArtifact>;
  /** Whether the Generate Walkthrough action is enabled (config walkthrough.enabled). */
  walkthroughEnabled?: boolean;
  /** Whether auto-generation is active (config walkthrough.autoGenerate). */
  walkthroughAutoGenerate?: boolean;
  /** Generate a walkthrough for a message; force overwrites an existing artifact. */
  onGenerateWalkthrough?:
    ((messageId: string, force?: boolean) => void | Promise<void>) | undefined;
  /** Cancel an in-flight walkthrough generation. */
  onCancelWalkthrough?:
    ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
  /** SF-03: Duplicate the entire session. */
  onDuplicateSession?: (() => void | Promise<void>) | undefined;
  /** SF-03: Fork from a specific assistant response. */
  onForkFromMessage?: ((messageId: string) => void | Promise<void>) | undefined;
  /** SF-03: Open the lineage / branch list for a message. */
  onOpenForks?: ((messageId: string) => void) | undefined;
  /** SF-03: Map of messageId → direct fork count (for badge display). */
  forkCountsByMessageId?: Record<string, number>;
  /** SF-04: Product lineage projection for the active session. */
  sessionLineage?: ProductSessionLineageView | null;
  /** SF-04: Navigate to another product session from the lineage tree. */
  onOpenSession?: ((sessionId: string) => void) | undefined;
  /** SF-03: Whether derived-session actions are disabled (e.g. no host). */
  derivedActionsDisabled?: boolean;
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

  const turnGroups = useMemo(() => groupTranscriptTurns(props.messages), [props.messages]);
  const currentResponseTurnId = turnGroups[turnGroups.length - 1]?.id ?? null;
  const showRunActivity =
    props.streaming &&
    !props.permissionPrompt &&
    (props.messages.length === 0 || props.messages[props.messages.length - 1]?.role === 'user');
  const runActivitySlot = showRunActivity ? (
    <RunActivitySlot
      activeRunId={props.activeRunId ?? null}
      runRecordsById={props.runRecordsById ?? {}}
      {...(activeToolName ? { activeToolName } : {})}
      {...(props.locale ? { locale: props.locale } : {})}
      {...(props.agentLocatorAnimation ? { animation: props.agentLocatorAnimation } : {})}
      {...(props.activeSkill ? { skill: props.activeSkill } : {})}
    />
  ) : null;
  const changedFilePathsByTurnId = useMemo(() => {
    const pathsByTurnId = new Map<string, string[]>();
    for (const turn of turnGroups) {
      const paths: string[] = [];
      const seen = new Set<string>();
      for (const { message } of turn.items) {
        for (const file of collectMessageChangedFiles(message.tools)) {
          if (!seen.has(file.path)) {
            seen.add(file.path);
            paths.push(file.path);
          }
        }
      }
      pathsByTurnId.set(turn.id, paths);
    }
    return pathsByTurnId;
  }, [turnGroups]);
  const latestAssistantMessageId = useMemo(() => {
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const message = props.messages[index];
      if (message?.role === 'assistant' && message.status === 'done') {
        return message.id;
      }
    }
    return null;
  }, [props.messages]);
  const streamingCaretMessageId = useMemo(
    () =>
      findStreamingCaretMessageId(
        props.messages,
        props.runRecordsById ?? {},
        props.activeRunId ?? null,
      ),
    [props.messages, props.runRecordsById, props.activeRunId],
  );
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
      <TranscriptTurnList
        turns={turnGroups}
        pinnedMessageId={props.editingMessageId}
        streaming={props.streaming === true}
        renderTurn={(turn) => (
          <section
            key={turn.id}
            className={`chat-turn-group${turn.id === currentResponseTurnId ? ' is-current-response' : ''}`}
            {...(turn.id === currentResponseTurnId
              ? { 'data-testid': 'current-response-turn' }
              : {})}
          >
            {turn.items.map(({ message, messageIndex }) => {
              return (
                <ChatMessageRow
                  key={message.id}
                  message={message}
                  {...(props.sessionId ? { sessionId: props.sessionId } : {})}
                  messageIndex={messageIndex}
                  showStreamingCaret={streamingCaretMessageId === message.id}
                  isLastAssistantInTurn={turn.lastAssistantMessageId === message.id}
                  isLatestAssistantResponse={latestAssistantMessageId === message.id}
                  isNew={enteringIds.has(message.id)}
                  knownFilePaths={changedFilePathsByTurnId.get(turn.id) ?? []}
                  streaming={props.streaming}
                  activeSessionId={props.activeSessionId ?? null}
                  editingMessageId={props.editingMessageId}
                  lastUserMessageId={props.lastUserMessageId}
                  activeTheme={props.activeTheme}
                  artifactThemeKey={props.artifactThemeKey}
                  runRecordsById={props.runRecordsById ?? {}}
                  {...(message.runId !== undefined &&
                  props.runRecordsById?.[message.runId] !== undefined
                    ? { runRecord: props.runRecordsById[message.runId] }
                    : {})}
                  activeRunId={props.activeRunId ?? null}
                  activeSkill={props.activeSkill ?? null}
                  {...(props.agentLocatorAnimation
                    ? { agentLocatorAnimation: props.agentLocatorAnimation }
                    : {})}
                  permissionPrompt={props.permissionPrompt ?? null}
                  workDetailsExpanded={props.workDetailsExpanded ?? 'auto'}
                  toolDensity={props.toolDensity ?? 'comfortable'}
                  showThinking={props.showThinking !== false}
                  {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
                  {...(props.toolDiffRequest !== undefined
                    ? { toolDiffRequest: props.toolDiffRequest }
                    : {})}
                  {...(props.filesChangedRequest !== undefined
                    ? { filesChangedRequest: props.filesChangedRequest }
                    : {})}
                  {...(props.onReviewChanges !== undefined
                    ? { onReviewChanges: props.onReviewChanges }
                    : {})}
                  onEdit={props.onEdit}
                  onCancelEdit={props.onCancelEdit}
                  onEditResend={props.onEditResend}
                  onRetry={props.onRetry}
                  onFeedback={props.onFeedback}
                  onInspectSubagent={props.onInspectSubagent}
                  {...(props.subagentChildren
                    ? { subagentChildren: props.subagentChildren }
                    : {})}
                  {...(props.subagentInvocations
                    ? { subagentInvocations: props.subagentInvocations }
                    : {})}
                  {...(props.subagentStreams
                    ? { subagentStreams: props.subagentStreams }
                    : {})}
                  composerCard={props.composerCard}
                  {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
                  {...(props.onOpenArtifactCanvas
                    ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                    : {})}
                  {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
                  {...(props.artifactCodeFirst !== undefined
                    ? { artifactCodeFirst: props.artifactCodeFirst }
                    : {})}
                  {...(props.artifactMaxBytes !== undefined
                    ? { artifactMaxBytes: props.artifactMaxBytes }
                    : {})}
                  {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
                  {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
                  {...(props.locale ? { locale: props.locale } : {})}
                  {...(props.walkthroughsByMessageId
                    ? { walkthroughsByMessageId: props.walkthroughsByMessageId }
                    : {})}
                  {...(props.walkthroughEnabled !== undefined
                    ? { walkthroughEnabled: props.walkthroughEnabled }
                    : {})}
                  {...(props.walkthroughAutoGenerate !== undefined
                    ? { walkthroughAutoGenerate: props.walkthroughAutoGenerate }
                    : {})}
                  {...(props.onGenerateWalkthrough
                    ? {
                        onGenerateWalkthrough: props.onGenerateWalkthrough,
                        walkthroughEligible: isWalkthroughEligible({
                          message,
                          messages: props.messages,
                          runRecordsById: props.runRecordsById ?? {},
                          activeRunId: props.activeRunId ?? null,
                          enabled: props.walkthroughEnabled !== false,
                        }),
                      }
                    : {})}
                  {...(props.onCancelWalkthrough
                    ? { onCancelWalkthrough: props.onCancelWalkthrough }
                    : {})}
                  {...(props.onDuplicateSession
                    ? { onDuplicateSession: props.onDuplicateSession }
                    : {})}
                  {...(props.onForkFromMessage
                    ? { onForkFromMessage: props.onForkFromMessage }
                    : {})}
                  {...(props.onOpenForks ? { onOpenForks: props.onOpenForks } : {})}
                  {...(props.forkCountsByMessageId
                    ? { forkCountsByMessageId: props.forkCountsByMessageId }
                    : {})}
                  {...(props.sessionLineage ? { sessionLineage: props.sessionLineage } : {})}
                  {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                  {...(props.derivedActionsDisabled !== undefined
                    ? { derivedActionsDisabled: props.derivedActionsDisabled }
                    : {})}
                />
              );
            })}
            {turn.id === currentResponseTurnId ? runActivitySlot : null}
          </section>
        )}
      />
      {currentResponseTurnId === null && runActivitySlot !== null ? (
        <section
          className="chat-turn-group is-current-response"
          data-testid="current-response-turn"
        >
          {runActivitySlot}
        </section>
      ) : null}
    </div>
  );
}

type ChatMessageRowProps = {
  message: ChatMessageUi;
  sessionId?: string;
  messageIndex: number;
  showStreamingCaret: boolean;
  /** Quiet workbench: entrance animation for messages that arrived after mount. */
  isNew: boolean;
  /** Tool-reported changed paths from the containing turn for system summaries. */
  knownFilePaths?: readonly string[] | undefined;
  streaming: boolean;
  /** CM-10: source session for the message context menu ref. */
  activeSessionId: string | null;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  runRecordsById: Record<string, RunRecordUi>;
  /** Keyed Run projection for this row; avoids whole-map memo invalidation. */
  runRecord?: RunRecordUi;
  activeRunId: string | null;
  activeSkill: SkillActivityView | null;
  agentLocatorAnimation?: AgentLocatorAnimation;
  permissionPrompt: PermissionPromptUi | null;
  workDetailsExpanded: WorkDetailsExpanded;
  toolDensity: ToolCallDensity;
  showThinking: boolean;
  /** Project root forwarded to tool cards → DiffCard. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  filesChangedRequest?: FilesChangedBarRequest;
  onReviewChanges?: () => void;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  /** Open the read-only subagent session inspector for a transcript card. */
  onInspectSubagent: ((selection: SubagentInspectorSelection) => void) | undefined;
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  subagentStreams?: Record<string, SubagentStreamState>;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  /** When false (default), MarkdownView hides the heavy Artifact path. */
  artifactPreviewEnabled?: boolean;
  /** When true, MarkdownView displays source code first for artifact blocks. */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence. */
  artifactMaxBytes?: number;
  /** Callback when clicking a search result file or file link. */
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Global composer card props so the edit mode matches the bottom composer. */
  composerCard: ComposerDockProps;
  /** Walkthrough artifacts keyed by owning assistant messageId. */
  walkthroughsByMessageId?: Record<string, WalkthroughArtifact>;
  /** Whether the Generate Walkthrough action is enabled. */
  walkthroughEnabled?: boolean;
  /** Whether auto-generation is active (hides the manual Generate button). */
  walkthroughAutoGenerate?: boolean;
  /** Pre-computed eligibility for the Generate button (computed by parent). */
  walkthroughEligible?: boolean;
  /** Generate a walkthrough for a message; force overwrites an existing artifact. */
  onGenerateWalkthrough?:
    ((messageId: string, force?: boolean) => void | Promise<void>) | undefined;
  /** Cancel an in-flight walkthrough generation. */
  onCancelWalkthrough?:
    ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
  /** SF-03: Duplicate the entire session. */
  onDuplicateSession?: (() => void | Promise<void>) | undefined;
  /** SF-03: Fork from a specific assistant response. */
  onForkFromMessage?: ((messageId: string) => void | Promise<void>) | undefined;
  /** SF-03: Open the lineage / branch list for a message. */
  onOpenForks?: ((messageId: string) => void) | undefined;
  /** SF-03: Map of messageId → direct fork count (for badge display). */
  forkCountsByMessageId?: Record<string, number>;
  /** SF-04: Product lineage projection for the active session. */
  sessionLineage?: ProductSessionLineageView | null;
  /** SF-04: Navigate to another product session from the lineage tree. */
  onOpenSession?: ((sessionId: string) => void) | undefined;
  /** SF-03: Whether derived-session actions are disabled. */
  derivedActionsDisabled?: boolean;
  /** SF-03: True only for the last assistant message in a turn group. */
  isLastAssistantInTurn?: boolean;
  /** SF-04: True only for the newest completed assistant response. */
  isLatestAssistantResponse?: boolean;
};

function formatMessageTime(createdAt?: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function areFilePathListsEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((path, index) => path === right[index]);
}

/** Height (px) above which a user message bubble collapses. */
const USER_MESSAGE_COLLAPSE_THRESHOLD = 78;

function getGenerationStatus(
  message: ChatMessageUi,
  generationKind: GenerationToolKind,
): ToolCardUi['status'] | null {
  const generationTools = message.tools.filter(
    (tool) => resolveGenerationToolKind(tool) === generationKind,
  );
  if (generationTools.length === 0) {
    return null;
  }
  if (generationTools.some((tool) => tool.status === 'running')) {
    return 'running';
  }
  if (generationTools.some((tool) => tool.status === 'error')) {
    return 'error';
  }
  return 'done';
}

function UserMessageContent(props: {
  message: ChatMessageUi;
  streaming?: boolean;
  onRetry: (messageId: string) => void;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
}): ReactElement {
  const { message } = props;
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isTextOverflow, setIsTextOverflow] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const formattedTime = formatMessageTime(message.createdAt);
  const hasAttachments = message.attachments.length > 0;

  // Measure the natural height of the text node to determine if it needs collapsing.
  useEffect(() => {
    const node = textRef.current;
    if (!node) return;

    function measure(): void {
      if (!node) return;
      const naturalHeight = node.scrollHeight;
      setIsTextOverflow(naturalHeight > USER_MESSAGE_COLLAPSE_THRESHOLD);
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

  // Attachments always start in the compact state so a history prompt cannot
  // occupy most of the transcript viewport while browsing older turns.
  const isCollapsible = hasAttachments || isTextOverflow;
  const collapsed = isCollapsible && isCollapsed;

  const handleToggle = isCollapsible ? () => setIsCollapsed((previous) => !previous) : undefined;

  return (
    <div className="user-message-wrapper">
      <div
        className={`user-message-collapsible ${collapsed ? 'is-collapsed' : 'is-expanded'} ${isCollapsible ? 'is-clickable' : ''} ${hasAttachments ? 'has-attachments' : ''}`}
        data-testid="user-message-collapsible-body"
        onClick={handleToggle}
        role={isCollapsible ? 'button' : undefined}
        tabIndex={isCollapsible ? 0 : undefined}
        aria-expanded={isCollapsible ? !collapsed : undefined}
        onKeyDown={
          isCollapsible
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsCollapsed((previous) => !previous);
                }
              }
            : undefined
        }
      >
        <MessageAttachments attachments={message.attachments} />
        <div ref={textRef} className="message-text">
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
  function ChatMessageRow(props: ChatMessageRowProps): ReactElement | null {
    const { message } = props;
    const imageGenerationStatus =
      message.role === 'assistant' ? getGenerationStatus(message, 'image') : null;
    const videoGenerationStatus =
      message.role === 'assistant' ? getGenerationStatus(message, 'video') : null;
    const contextMenu = useDesktopContextMenu();
    if (message.subagentActivity) {
      return (
        <div id={`msg-${message.id}`} className="chat-subagent-slot">
          <SubagentActivityCard
            activity={message.subagentActivity}
            {...(props.onInspectSubagent ? { onInspect: props.onInspectSubagent } : {})}
          />
        </div>
      );
    }

    const isEditingThis = props.editingMessageId === message.id;
    // Keep every lifecycle segment that contains causal output. Only discard a
    // truly empty transport placeholder; tool-only and thinking-only messages
    // are real transcript rows and must retain their event position.
    if (
      message.role === 'assistant' &&
      message.status !== 'streaming' &&
      message.text.trim().length === 0 &&
      message.thinking.trim().length === 0 &&
      message.tools.length === 0 &&
      message.attachments.length === 0 &&
      (message.searchEvidence?.citations.length ?? 0) === 0 &&
      imageGenerationStatus === null &&
      videoGenerationStatus === null
    ) {
      return null;
    }

    const rowClass = [
      'bubble',
      'chat-message-row',
      `role-${message.role}`,
      message.role === 'assistant' &&
      message.text.trim().length === 0 &&
      message.thinking.trim().length === 0 &&
      message.tools.length > 0
        ? 'is-tool-only'
        : '',
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

    // CM-10: message surface target. Capabilities follow existing session
    // action rules: retry on user bubbles; fork on completed assistants when a
    // fork hook exists; side chat when the host has a session.
    const messageTarget: ContextMenuTarget | null =
      contextMenu && props.activeSessionId && (message.role === 'user' || message.role === 'assistant')
        ? {
            surface: message.role === 'user' ? 'message-user' : 'message-assistant',
            sessionId: props.activeSessionId,
            messageId: message.id,
            text: message.text,
            label: message.role === 'user' ? 'User message' : 'Assistant response',
            capabilities: {
              canRetry: isUserMessage && !props.streaming,
              canFork:
                message.role === 'assistant' &&
                message.status === 'done' &&
                props.onForkFromMessage !== undefined &&
                !props.streaming,
              canSideChat: Boolean(props.activeSessionId && !props.streaming),
            },
          }
        : null;

    const bubble = (
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
            activeRunId={props.isLastAssistantInTurn === true ? props.activeRunId : null}
            activeSkill={props.isLastAssistantInTurn === true ? props.activeSkill : null}
            {...(props.agentLocatorAnimation
              ? { agentLocatorAnimation: props.agentLocatorAnimation }
              : {})}
            permissionPrompt={props.isLastAssistantInTurn === true ? props.permissionPrompt : null}
            workDetailsExpanded={props.workDetailsExpanded}
            toolDensity={props.toolDensity}
            showThinking={props.showThinking}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.toolDiffRequest !== undefined ? { request: props.toolDiffRequest } : {})}
            {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.onOpenDocument
              ? {
                  onOpenDocument: (input) =>
                    props.onOpenDocument?.({
                      ...input,
                      messageId: input.messageId ?? message.id,
                    }),
                }
              : {})}
            {...(props.subagentChildren
              ? { subagentChildren: props.subagentChildren }
              : {})}
            {...(props.subagentInvocations
              ? { subagentInvocations: props.subagentInvocations }
              : {})}
            {...(props.subagentStreams
              ? { subagentStreams: props.subagentStreams }
              : {})}
            {...(props.onInspectSubagent
              ? { onInspectSubagent: props.onInspectSubagent }
              : {})}
            {...(props.locale ? { locale: props.locale } : {})}
          >
            {message.text.trim().length > 0 ? (
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
                showStreamingCaret={props.showStreamingCaret}
                locale={props.locale ?? 'zh-CN'}
                {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
                {...(props.artifactMaxBytes !== undefined
                  ? { artifactMaxBytes: props.artifactMaxBytes }
                  : {})}
                {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
                {...(props.sessionId
                  ? { artifactOrigin: { sessionId: props.sessionId, messageId: message.id } }
                  : {})}
                {...(props.onOpenArtifactCanvas
                  ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                  : {})}
                {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
              />
            ) : null}
            {message.searchEvidence !== undefined ? (
              <CitationCards evidence={message.searchEvidence} />
            ) : null}
          </TurnWorkDetails>
        ) : null}
        {imageGenerationStatus ? (
          <ImageGenerationProgress
            locale={props.locale ?? 'zh-CN'}
            status={imageGenerationStatus}
          />
        ) : null}
        {videoGenerationStatus ? (
          <VideoGenerationProgress
            locale={props.locale ?? 'zh-CN'}
            status={videoGenerationStatus}
          />
        ) : null}
        {message.role === 'assistant' || isEditingThis ? (
          <MessageAttachments attachments={message.attachments} />
        ) : null}
        {message.role === 'system' ? (
          <SystemMessageContent
            text={message.text}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.knownFilePaths ? { knownFilePaths: props.knownFilePaths } : {})}
          />
        ) : isEditingThis ? (
          <MessageEditCard
            messageId={message.id}
            initialText={message.text}
            composerCard={props.composerCard}
            onCancel={props.onCancelEdit}
            onResend={(text) => props.onEditResend(message.id, text)}
          />
        ) : message.role === 'assistant' ? null : (
          <UserMessageContent
            message={message}
            streaming={props.streaming}
            onRetry={props.onRetry}
            onFeedback={props.onFeedback}
          />
        )}
        {message.role === 'assistant' && message.tools.length > 0 ? (
          <FilesChangedBar
            tools={message.tools}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.filesChangedRequest !== undefined
              ? { request: props.filesChangedRequest }
              : {})}
            {...(props.onReviewChanges !== undefined ? { onReview: props.onReviewChanges } : {})}
            {...(props.locale ? { locale: props.locale } : {})}
          />
        ) : null}
        {message.role === 'assistant' &&
        props.isLastAssistantInTurn === true &&
        props.onGenerateWalkthrough ? (
          <WalkthroughAction
            message={message}
            artifact={props.walkthroughsByMessageId?.[message.id]}
            eligible={props.walkthroughEligible === true}
            autoGenerate={props.walkthroughAutoGenerate === true}
            onGenerate={props.onGenerateWalkthrough}
            {...(props.locale ? { locale: props.locale } : {})}
            {...(props.onCancelWalkthrough ? { onCancel: props.onCancelWalkthrough } : {})}
            {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
          />
        ) : null}
        {message.role === 'assistant' &&
        message.status === 'done' &&
        props.isLastAssistantInTurn === true &&
        (props.onDuplicateSession || props.onForkFromMessage || message.text) ? (
          <AssistantResponseActions
            messageId={message.id}
            messageText={message.text}
            showDuplicate={props.onDuplicateSession !== undefined}
            showFork={props.onForkFromMessage !== undefined}
            directForkCount={props.forkCountsByMessageId?.[message.id] ?? 0}
            {...(props.sessionLineage ? { lineage: props.sessionLineage } : {})}
            showTreeOnLatestResponse={props.isLatestAssistantResponse === true}
            disabled={props.derivedActionsDisabled === true || props.streaming}
            {...(props.onDuplicateSession
              ? { onDuplicate: props.onDuplicateSession }
              : { onDuplicate: () => {} })}
            {...(props.onForkFromMessage
              ? { onFork: props.onForkFromMessage }
              : { onFork: () => {} })}
            {...(props.onOpenForks ? { onOpenForks: props.onOpenForks } : {})}
            {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
            {...(props.onFeedback ? { onFeedback: props.onFeedback } : {})}
            locale={props.locale ?? 'en'}
          />
        ) : null}
      </article>
    );

    // CM-10: message context menu wraps the whole bubble. Streaming rows keep
    // the menu (retry/fork are capability-gated off); subagent cards are
    // handled by the early return above.
    if (!messageTarget || !contextMenu) {
      return bubble;
    }
    return (
      <ContextMenuFromCatalog
        testId="message-context-menu"
        target={messageTarget}
        caps={contextMenu.caps}
        dispatchers={contextMenu.dispatchers}
      >
        {bubble}
      </ContextMenuFromCatalog>
    );
  },
  (previous, next) => {
    const isActionableUserMessage = previous.message.role === 'user';
    // composerCard only mounts for the row being edited; ignore identity churn elsewhere.
    const isEditingThisRow =
      previous.editingMessageId === previous.message.id ||
      next.editingMessageId === next.message.id;
    const callbackPropsAreStable =
      previous.onFeedback === next.onFeedback &&
      (isActionableUserMessage
        ? previous.onEdit === next.onEdit &&
          previous.onCancelEdit === next.onCancelEdit &&
          previous.onEditResend === next.onEditResend &&
          previous.onRetry === next.onRetry &&
          (!isEditingThisRow || previous.composerCard === next.composerCard)
        : previous.message.subagentActivity
          ? previous.onInspectSubagent === next.onInspectSubagent
          : true);
    // Global streaming only disables actions on user rows and the turn's last
    // assistant. Historical assistants should not re-render on every send.
    const rowUsesStreamingFlag =
      previous.message.role === 'user' ||
      next.message.role === 'user' ||
      previous.isLastAssistantInTurn === true ||
      next.isLastAssistantInTurn === true;
    const streamingIsStable = !rowUsesStreamingFlag || previous.streaming === next.streaming;
    return (
      previous.message === next.message &&
      previous.sessionId === next.sessionId &&
      previous.messageIndex === next.messageIndex &&
      previous.showStreamingCaret === next.showStreamingCaret &&
      streamingIsStable &&
      previous.activeSessionId === next.activeSessionId &&
      previous.editingMessageId === next.editingMessageId &&
      previous.lastUserMessageId === next.lastUserMessageId &&
      previous.activeTheme === next.activeTheme &&
      areFilePathListsEqual(previous.knownFilePaths, next.knownFilePaths) &&
      previous.artifactThemeKey === next.artifactThemeKey &&
      previous.runRecord === next.runRecord &&
      previous.activeRunId === next.activeRunId &&
      previous.activeSkill === next.activeSkill &&
      previous.agentLocatorAnimation === next.agentLocatorAnimation &&
      previous.permissionPrompt === next.permissionPrompt &&
      previous.workDetailsExpanded === next.workDetailsExpanded &&
      previous.toolDensity === next.toolDensity &&
      previous.showThinking === next.showThinking &&
      previous.projectPath === next.projectPath &&
      previous.toolDiffRequest === next.toolDiffRequest &&
      previous.locale === next.locale &&
      previous.onArtifactAction === next.onArtifactAction &&
      previous.onOpenArtifactCanvas === next.onOpenArtifactCanvas &&
      previous.onOpenDocument === next.onOpenDocument &&
      previous.subagentChildren === next.subagentChildren &&
      previous.subagentInvocations === next.subagentInvocations &&
      previous.subagentStreams === next.subagentStreams &&
      previous.filesChangedRequest === next.filesChangedRequest &&
      previous.onReviewChanges === next.onReviewChanges &&
      previous.walkthroughsByMessageId === next.walkthroughsByMessageId &&
      previous.walkthroughEnabled === next.walkthroughEnabled &&
      previous.walkthroughAutoGenerate === next.walkthroughAutoGenerate &&
      previous.walkthroughEligible === next.walkthroughEligible &&
      previous.onGenerateWalkthrough === next.onGenerateWalkthrough &&
      previous.onCancelWalkthrough === next.onCancelWalkthrough &&
      previous.onDuplicateSession === next.onDuplicateSession &&
      previous.onForkFromMessage === next.onForkFromMessage &&
      previous.onOpenForks === next.onOpenForks &&
      previous.forkCountsByMessageId === next.forkCountsByMessageId &&
      previous.sessionLineage === next.sessionLineage &&
      previous.onOpenSession === next.onOpenSession &&
      previous.derivedActionsDisabled === next.derivedActionsDisabled &&
      previous.isLastAssistantInTurn === next.isLastAssistantInTurn &&
      previous.isLatestAssistantResponse === next.isLatestAssistantResponse &&
      callbackPropsAreStable
    );
  },
);
