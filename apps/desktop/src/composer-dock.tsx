/**
 * Composer: empty = centered with path header; active session = bottom dock.
 * Context usage ring sits on the toolbar (no project chip — workspace is left sidebar).
 * Slash menu (`/`) surfaces commands, modes, and skills.
 * At menu (`@`) surfaces workspace files, git diffs, and MCP servers.
 * History navigation (`ArrowUp`/`ArrowDown`) lists the last 10 sent prompts.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { ContextUsageSnapshot, HostStatusData, ProjectRecord } from '@piwin/contracts';
import { Button, Dialog, IconButton } from '@piwin/ui-kit';
import {
  ComposerPlusMenu,
  type ComposerMcpOption,
  type ComposerPlusSubmenu,
  type ComposerSkillOption,
} from './composer-plus-menu';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs';
import { getAgentMode, type AgentModeId } from './agent-mode';
import { isFailedMediaAttachment, type PendingComposerAttachment } from './media-utils';
import { ComposerAttachmentShelf } from './composer-attachment-shelf';
import { ContextUsageRing } from './context-usage-ring';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { RunModeControl } from './RunModeControl';
import {
  OrchestrationSchemeControl,
  type OrchestrationSchemeOption,
} from './OrchestrationSchemeControl';
import { IconClose, IconMic, IconPlus } from './shell-icons';
import { LiveComposerButton } from './live/LiveComposerButton.js';
import type { LiveCallView, LiveReadyMissing } from '@piwin/contracts';
import {
  buildSlashCatalog,
  detectActiveSlashToken,
  filterSlashItems,
  replaceActiveSlashToken,
  SlashMenu,
  type SlashItem,
} from './slash';
import {
  buildAtCatalog,
  contextRefFromAtItem,
  detectActiveAtToken,
  filterAtItems,
  replaceActiveAtToken,
  AtMenu,
  type AtItem,
} from './at';
import { ComposerModalEditor } from './ComposerModalEditor';
import type { ExtensionUiResolvePayload } from './extension-ui-prompt';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import { BranchChip, type BranchChipRequest } from './branch-chip';
import { RuntimeTargetChip } from './runtime-target-chip';
import { ProjectChip } from './project-chip';
import { projectLabel } from './project-display-name';
import { SteerQueue, type SteerQueueMessage } from './steer-queue';
import { ActiveJobsStrip } from './active-jobs-strip';
import { useSpeechInput } from './hooks/use-speech-input.js';
import { PromptHistoryMenu } from './prompt-history-menu';
import { ComposerActionSlot } from './composer-run-actions';
import {
  loadPromptHistoryFromStorage,
  mergePromptHistory,
  PROMPT_HISTORY_MAX,
  pushPromptHistory,
  savePromptHistoryToStorage,
} from './prompt-history';

export type ComposerModelOption = {
  providerId: string;
  protocol?: import('@piwin/contracts').ModelProtocol;
  modelId: string;
  label: string;
  contextWindow?: number;
  /** Configured thinking level default for this model. */
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  /** Configured thinking effort levels supported by this model. */
  thinkingLevels?: readonly import('@piwin/contracts').ThinkingLevel[];
  /** True when model.reasoning is enabled. */
  reasoning?: boolean;
  /** True when model.input includes image. */
  supportsImage?: boolean;
  /** True when model.capabilities includes image-generation. */
  supportsImageGeneration?: boolean;
};

export type ComposerDockProps = {
  /** When true, path shows above the card and outer layout can center the dock. */
  layoutMode: 'centered' | 'docked';
  projectPath: string | null;
  projectTrusted: boolean;
  activeSessionId: string | null;
  streaming: boolean;
  runPhase: 'idle' | 'streaming' | 'pausing' | 'aborting';
  compacting: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  agentMode: AgentModeId;
  onAgentModeChange: (mode: AgentModeId) => void;
  /** Whether the bundled goal extension is enabled in settings. */
  goalExtensionEnabled?: boolean;
  pendingAttachments: PendingComposerAttachment[];
  onRemoveAttachment: (localId: string) => void;
  /**
   * In-place edit: original media/refs sit read-only above the card, so Send
   * must stay enabled even when the local composer and chips are empty.
   */
  hasCarryContent?: boolean;
  /** One-tap retry after a failed media/save. */
  onRetryAttachment?: (localId: string) => void;
  /** Phase 0 send confirmation: re-queue every failed chip before sending. */
  onRetryFailedAttachments?: () => void;
  /** Phase 0 send confirmation: drop every failed chip and send the rest. */
  onDiscardFailedAttachments?: () => void;
  /** CM: structured context ref chips (file/selection/folder/…). */
  pendingContextRefs?: PendingContextRefItem[];
  onRemoveContextRef?: (key: string) => void;
  /** CM-17: `@` mention file/folder items also become structured refs. */
  onAddContextRef?: ((ref: import('@piwin/contracts').PromptContextRef) => void) | undefined;
  docCommentsAttachment?: { docTitle: string; commentCount: number } | null | undefined;
  onRemoveDocComments?: (() => void) | undefined;
  dropActive: boolean;
  onDropActiveChange: (active: boolean) => void;
  plusMenuOpen: boolean;
  onPlusMenuOpenChange: (open: boolean) => void;
  plusSubmenu: ComposerPlusSubmenu;
  onPlusSubmenuChange: (submenu: ComposerPlusSubmenu) => void;
  modelOptions: ComposerModelOption[];
  selectedModelKey: string;
  selectedModelLabel?: string;
  onSelectModel: (key: string) => void;
  /**
   * When true, text-only models can still send images (host will describe them).
   * When false/undefined, attach a composer warning if the user adds media.
   */
  visionDelegationEnabled?: boolean;
  menuSkills: ComposerSkillOption[];
  menuMcp: ComposerMcpOption[];
  onRefreshComposerMenus: () => void;
  onOpenSkillsPanel: () => void;
  onOpenMcpPanel: () => void;
  onAttachFile: () => void;
  onAttachImage: () => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onSend: () => void;
  /** Save the active turn as a resumable Host checkpoint. */
  onPause: () => void;
  /** Irreversible cancel. Esc / `stop-run` only — never a second composer circle. */
  onAbort: () => void;
  /** Host-owned admission. Run mutations stay off while unknown or reconciling. */
  mutationsEnabled?: boolean;
  /** Resume from a Host pause checkpoint. */
  onResume?: () => void;
  /** True when the Host run terminal is a resumable pause checkpoint. */
  paused?: boolean;
  /** Model-originated question rendered inline above the composer input. */
  extensionUiRequest?: ExtensionUiRequestState | null;
  extensionUiInput?: string;
  onExtensionUiInputChange?: (value: string) => void;
  onExtensionUiResolve?: (payload: ExtensionUiResolvePayload) => void;
  onExtensionUiAbort?: () => void | Promise<void>;
  onCompact: () => void;
  /** Host capability; when false compact slash is unavailable. Default true. */
  compactionSupported?: boolean;
  contextUsage: ContextUsageSnapshot | null;
  modelContextWindow?: number;
  onOpenModelSettings?: () => void;
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  onThinkingLevelChange?: (level: import('@piwin/contracts').ThinkingLevel) => void;
  ultraThinkingEnabled?: boolean;
  onSteer?: () => void;
  onFollowUp?: () => void;
  hostStatus?: HostStatusData | null;
  hostReady?: boolean;
  hostMock?: boolean;
  transportLabel?: string;
  onOpenHostSettings?: () => void;
  /** ADR 0024: Run Mode preset (Ask / Auto / YOLO). */
  runModePreset?: import('@piwin/contracts').PermissionPreset;
  onRunModeChange?: (preset: import('@piwin/contracts').PermissionPreset) => void;
  onRunModeSetDefault?: (preset: import('@piwin/contracts').PermissionPreset) => void;
  onOpenPermissionsSettings?: () => void;
  /** YOLO unavailable for untrusted projects. */
  runModeYoloDisabled?: boolean;
  /** ORCH: always-visible scheme mode picker; freehand (`off`) means no injection. */
  orchestrationSchemeId?: string;
  orchestrationSchemeOptions?: readonly OrchestrationSchemeOption[];
  onOrchestrationSchemeChange?: (schemeId: string) => void;
  /** ORCH: independent per-turn switch for model-facing delegation. */
  delegationDisabled?: boolean;
  onDelegationDisabledChange?: (disabled: boolean) => void;
  onOpenOrchestrationSchemeSettings?: () => void;
  /** Optional git request adapter for the footer branch chip. */
  branchRequest?:
    ((command: BranchChipRequest) => Promise<import('@piwin/contracts').HostResponse>) | undefined;
  /** Recently opened projects shown in the path dropdown above an empty composer. */
  recentProjects?: readonly ProjectRecord[];
  /** Switch directly to a project selected from the path dropdown. */
  onOpenProject?: ((path: string) => void) | undefined;
  /** True when Desktop is attached to a saved standalone Host. */
  runtimeRemoteConnected?: boolean;
  /** Hostname:port of the attached Host, when known. */
  runtimeRemoteHostLabel?: string;
  onSelectLocalRuntime?: () => void;
  onSelectAttachRuntime?: () => void;
  /** Open the flashcards home (legacy Knowledge Center slash aliases). */
  onOpenKnowledge?: ((subTab?: 'doccards' | 'cards' | 'wiki') => void) | undefined;
  /** Open the flashcards home from the plus menu. */
  onOpenCardsPanel?: (() => void) | undefined;
  /** True when the configured ASR provider/model is currently usable. */
  speechConfigured?: boolean;
  /** Transient Desktop → Host ASR request; audio is never saved by the composer. */
  speechRequest?: (
    input: import('@piwin/contracts').SpeechTranscribeInput,
  ) => Promise<import('@piwin/contracts').HostResponse>;
  live?: {
    enabled: boolean;
    canStart: boolean;
    starting: boolean;
    call: LiveCallView | null;
    error: string | null;
    missing: LiveReadyMissing[];
    onStart: () => void;
    onMute: (muted: boolean) => void;
    onEnd: () => void;
  };
  /** Steer messages queued for execution */
  steerQueueMessages?: readonly SteerQueueMessage[];
  onSteerQueueSendNow?: (messageId: string) => void | Promise<void>;
  onSteerQueueEdit?: (messageId: string, text: string) => void;
  onSteerQueueRemove?: (messageId: string) => void;
  /**
   * Newest-first user prompts from the active session transcript.
   * Merged under the live stack when listing history (max 10).
   */
  sessionUserPrompts?: readonly string[];
  /** AJB: active jobs owned by the current session (isJobActive filter). */
  activeJobs?: readonly import('@piwin/contracts').JobRecord[];
  /** AJB: stop a controlled program (`job/stop`). */
  onStopJob?: (jobId: string) => void;
  /** AJB: open the right Terminal panel with the job's logs. */
  onViewJobLogs?: (jobId: string) => void;
  /**
   * CHT-501: general Conversation hides Agent Mode / Run Mode / Orchestration /
   * Skills-MCP chrome. Default false so Project callers stay unchanged.
   */
  isConversationSession?: boolean;
  /** Override the Send control label (edit card: Retry vs Send new version). */
  sendAriaLabel?: string;
};

function getAgentPlaceholder(
  mode: AgentModeId,
  copy: ReturnType<typeof getDesktopCopy>['composer'],
  conversationSession = false,
): string {
  if (conversationSession) {
    return copy.chatPlaceholder;
  }
  if (mode === 'goal') return copy.goalPlaceholder;
  return copy.agentPlaceholder;
}

export function ComposerCard(props: ComposerDockProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const copy = {
    ...getDesktopCopy(locale).composer,
    ...(props.sendAriaLabel
      ? { send: props.sendAriaLabel, sendShortcut: props.sendAriaLabel }
      : {}),
  };
  const interruptionCopy = translator.interruption;
  const agentModeDefinition = getAgentMode(props.agentMode);
  const isPaused = props.paused === true;
  const isStreamingRun =
    props.streaming ||
    props.runPhase === 'streaming' ||
    props.runPhase === 'pausing' ||
    props.runPhase === 'aborting';
  const extensionUiRequest = props.extensionUiRequest ?? null;
  const isExtensionUiActive = extensionUiRequest !== null;
  const isExtensionUiInput = extensionUiRequest?.kind === 'input';
  const extensionUiInput = props.extensionUiInput ?? '';
  const canComposeText = !isExtensionUiActive;
  const composerValue = isExtensionUiInput ? extensionUiInput : props.composer;
  const hasContent = isExtensionUiActive
    ? isExtensionUiInput
      ? extensionUiInput.trim().length > 0
      : props.composer.trim().length > 0
    : props.composer.trim().length > 0 ||
      props.pendingAttachments.length > 0 ||
      (props.pendingContextRefs?.length ?? 0) > 0 ||
      props.hasCarryContent === true;
  const failedAttachments = props.pendingAttachments.filter(isFailedMediaAttachment);
  // Phase 0 (ADR 0045 Decision 4): failed chips never disable Send. Send with
  // failures present routes through a retry / send-rest / back confirmation;
  // when failures are the only content the action button becomes Retry.
  const hasSendableContentBesidesFailures =
    props.composer.trim().length > 0 ||
    props.pendingAttachments.some((item) => !isFailedMediaAttachment(item)) ||
    (props.pendingContextRefs?.length ?? 0) > 0;
  const onlyFailedAttachments = failedAttachments.length > 0 && !hasSendableContentBesidesFailures;
  const canQueueStreamingText =
    props.composer.trim().length > 0 && props.pendingAttachments.length === 0;
  const canKeyboardSend = props.composer.trim().length > 0 || props.hasCarryContent === true;
  const selectedModel = props.modelOptions.find(
    (model) => `${model.providerId}::${model.modelId}` === props.selectedModelKey,
  );
  const hasImageAttachment = props.pendingAttachments.some(
    (item) =>
      item.attachment.kind === 'media' &&
      (item.attachment.contentKind === 'image' ||
        (item.attachment.contentKind === undefined &&
          item.attachment.mimeType.toLowerCase().startsWith('image/'))),
  );
  const selectedModelSupportsImage = selectedModel?.supportsImage === true;
  const showTextOnlyImageWarning =
    hasImageAttachment && !selectedModelSupportsImage && props.visionDelegationEnabled !== true;
  const thinkingModels = props.modelOptions.map((model) => ({
    key: `${model.providerId}::${model.modelId}`,
    label: model.label,
    ...(model.protocol !== undefined ? { protocol: model.protocol } : {}),
    ...(model.thinkingLevels !== undefined ? { thinkingLevels: model.thinkingLevels } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.supportsImage ? { supportsImage: true } : {}),
    ...(model.supportsImageGeneration ? { supportsImageGeneration: true } : {}),
  }));

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * dragenter/dragleave pair depth for the composer card. Children fire
   * dragleave when the pointer crosses into a sibling child (toolbar,
   * attachment row), so the drop-active state must only clear once the
   * pointer actually leaves the card (depth 0).
   */
  const dragDepthRef = useRef(0);
  const [caretIndex, setCaretIndex] = useState(0);

  // Slash Menu State
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashMenuForcedClosed, setSlashMenuForcedClosed] = useState(false);

  // At-Mention Menu State
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atMenuForcedClosed, setAtMenuForcedClosed] = useState(false);

  // Modal Editor State
  const [modalEditorOpen, setModalEditorOpen] = useState(false);

  // Phase 0: retry / send-rest / back confirmation for failed attachments.
  const [attachmentFailureDialogOpen, setAttachmentFailureDialogOpen] = useState(false);

  // Prompt History Navigation State (last PROMPT_HISTORY_MAX entries)
  const [historyStack, setHistoryStack] = useState<string[]>(() => loadPromptHistoryFromStorage());
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historySelectedIndex, setHistorySelectedIndex] = useState(0);
  const draftBeforeHistoryRef = useRef<string>('');

  const historyItems = useMemo(
    () => mergePromptHistory(historyStack, props.sessionUserPrompts, PROMPT_HISTORY_MAX),
    [historyStack, props.sessionUserPrompts],
  );

  const pushHistoryEntry = useCallback((text: string): void => {
    setHistoryStack((previous) => {
      const next = pushPromptHistory(previous, text, PROMPT_HISTORY_MAX);
      savePromptHistoryToStorage(next);
      return next;
    });
  }, []);

  // IME Composition Guard Refs
  const isComposingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);

  // Cold start / empty workspace: caret lands in the box.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [props.activeSessionId, props.projectPath]);

  useEffect(() => {
    if (isExtensionUiInput) {
      textareaRef.current?.focus();
    }
  }, [extensionUiRequest?.requestId, isExtensionUiInput]);

  const isGoalEnabled = props.goalExtensionEnabled !== false;

  // Catalog: Slash Menu items
  const slashCatalog = useMemo(
    () =>
      buildSlashCatalog({
        skills: props.menuSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: skill.enabled,
        })),
        compactionSupported: props.compactionSupported !== false,
        streaming: isStreamingRun,
        compacting: props.compacting,
        hasActiveSession: Boolean(props.activeSessionId),
        projectTrusted: props.projectTrusted,
        agentMode: props.agentMode,
        goalExtensionEnabled: isGoalEnabled,
        conversationChat: props.isConversationSession === true,
      }),
    [
      props.menuSkills,
      props.compactionSupported,
      isStreamingRun,
      props.compacting,
      props.activeSessionId,
      props.projectTrusted,
      props.agentMode,
      isGoalEnabled,
      props.isConversationSession,
    ],
  );

  const activeSlashToken = useMemo(
    () => detectActiveSlashToken(props.composer, caretIndex),
    [props.composer, caretIndex],
  );

  const slashItems = useMemo(() => {
    if (!activeSlashToken || !canComposeText) {
      return [];
    }
    return filterSlashItems(slashCatalog, activeSlashToken.query);
  }, [activeSlashToken, canComposeText, slashCatalog]);

  const slashMenuOpen =
    slashItems.length > 0 && activeSlashToken !== null && canComposeText && !slashMenuForcedClosed;

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [activeSlashToken?.query, slashMenuOpen]);

  useEffect(() => {
    if (slashSelectedIndex >= slashItems.length && slashItems.length > 0) {
      setSlashSelectedIndex(slashItems.length - 1);
    }
  }, [slashItems.length, slashSelectedIndex]);

  // Catalog: At-Mention items
  const atCatalog = useMemo(
    () =>
      buildAtCatalog({
        projectPath: props.projectPath,
        mcpServers: props.menuMcp.map((m) => ({ id: m.id, name: m.name })),
      }),
    [props.projectPath, props.menuMcp],
  );

  const activeAtToken = useMemo(
    () => detectActiveAtToken(props.composer, caretIndex),
    [props.composer, caretIndex],
  );

  const atItems = useMemo(() => {
    if (!activeAtToken || !canComposeText) {
      return [];
    }
    return filterAtItems(atCatalog, activeAtToken.query);
  }, [activeAtToken, canComposeText, atCatalog]);

  const atMenuOpen =
    atItems.length > 0 &&
    activeAtToken !== null &&
    canComposeText &&
    !atMenuForcedClosed &&
    !slashMenuOpen;

  useEffect(() => {
    setAtSelectedIndex(0);
  }, [activeAtToken?.query, atMenuOpen]);

  useEffect(() => {
    if (atSelectedIndex >= atItems.length && atItems.length > 0) {
      setAtSelectedIndex(atItems.length - 1);
    }
  }, [atItems.length, atSelectedIndex]);

  useEffect(() => {
    setSlashMenuForcedClosed(false);
    setAtMenuForcedClosed(false);
  }, [props.composer]);

  function syncCaretFromTextarea(): void {
    const element = textareaRef.current;
    if (element) {
      setCaretIndex(element.selectionStart ?? 0);
    }
  }

  function focusCaret(nextCaret: number): void {
    setCaretIndex(nextCaret);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (element) {
        element.focus();
        element.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  const insertSpeechText = useCallback(
    (text: string): void => {
      const normalized = text.trim();
      if (!normalized) return;
      const targetValue = isExtensionUiInput ? extensionUiInput : props.composer;
      const targetCaret = Math.max(0, Math.min(caretIndex, targetValue.length));
      const prefix = targetValue.slice(0, targetCaret);
      const suffix = targetValue.slice(targetCaret);
      const beforeSeparator = prefix && !/\s$/.test(prefix) ? ' ' : '';
      const afterSeparator = suffix && !/^\s/.test(suffix) ? ' ' : '';
      const inserted = `${beforeSeparator}${normalized}${afterSeparator}`;
      const nextValue = `${prefix}${inserted}${suffix}`;
      if (isExtensionUiInput) {
        props.onExtensionUiInputChange?.(nextValue);
      } else {
        props.onComposerChange(nextValue);
      }
      focusCaret(targetCaret + inserted.length);
    },
    [
      caretIndex,
      extensionUiInput,
      isExtensionUiInput,
      props.composer,
      props.onComposerChange,
      props.onExtensionUiInputChange,
    ],
  );

  const speechInput = useSpeechInput({
    enabled: props.speechConfigured === true && props.speechRequest !== undefined && canComposeText,
    ...(props.speechRequest ? { request: props.speechRequest } : {}),
    onTranscript: insertSpeechText,
  });
  const showSpeechInput = props.speechConfigured === true && props.speechRequest !== undefined;

  function applySlashItem(item: SlashItem): void {
    if (!activeSlashToken || !item.available) {
      return;
    }
    if (item.kind === 'mode') {
      props.onAgentModeChange(item.name as AgentModeId);
      const next = replaceActiveSlashToken(props.composer, activeSlashToken, '');
      props.onComposerChange(next);
      focusCaret(activeSlashToken.startIndex);
      setSlashMenuForcedClosed(true);
      return;
    }
    const insert =
      item.kind === 'command' && !item.acceptsArgs ? `/${item.name}` : `/${item.name} `;
    const next = replaceActiveSlashToken(props.composer, activeSlashToken, insert);
    props.onComposerChange(next);
    focusCaret(activeSlashToken.startIndex + insert.length);
    setSlashMenuForcedClosed(true);
  }

  function applyAtItem(item: AtItem): void {
    if (!activeAtToken) {
      return;
    }
    // CM-17: workspace file/folder mentions also land in the structured
    // pending refs so Host resolves them the same way as right-click refs.
    const mentionRef = contextRefFromAtItem(item, props.projectPath);
    if (props.onAddContextRef && mentionRef) {
      props.onAddContextRef(mentionRef);
    }
    const next = replaceActiveAtToken(props.composer, activeAtToken, item.insertValue);
    props.onComposerChange(next);
    focusCaret(activeAtToken.startIndex + item.insertValue.length);
    setAtMenuForcedClosed(true);
  }

  function proceedSend(): void {
    const trimmed = props.composer.trim();
    if (trimmed) {
      pushHistoryEntry(trimmed);
    }
    setHistoryMenuOpen(false);
    draftBeforeHistoryRef.current = '';
    props.onSend();
  }

  function triggerSend(): void {
    if (isExtensionUiActive) {
      // Extension UI path is text-only and does not use media attachments.
      const text = isExtensionUiInput ? extensionUiInput.trim() : props.composer.trim();
      if (text.length > 0) {
        props.onExtensionUiResolve?.({ value: text });
        if (!isExtensionUiInput) {
          props.onComposerChange('');
        }
      } else if (isExtensionUiInput) {
        props.onExtensionUiResolve?.({ value: '' });
      }
      return;
    }
    if (failedAttachments.length > 0) {
      // Failed chips are the only content: the action is a plain retry — the
      // send path re-runs the deferred saves for the re-queued chips.
      if (onlyFailedAttachments) {
        props.onRetryFailedAttachments?.();
        proceedSend();
        return;
      }
      setAttachmentFailureDialogOpen(true);
      return;
    }
    proceedSend();
  }

  function triggerSteer(): void {
    const trimmed = props.composer.trim();
    if (trimmed) {
      pushHistoryEntry(trimmed);
    }
    setHistoryMenuOpen(false);
    draftBeforeHistoryRef.current = '';
    props.onSteer?.();
  }

  function triggerFollowUp(): void {
    const trimmed = props.composer.trim();
    if (trimmed) {
      pushHistoryEntry(trimmed);
    }
    setHistoryMenuOpen(false);
    draftBeforeHistoryRef.current = '';
    props.onFollowUp?.();
  }

  function applyHistoryItem(text: string): void {
    props.onComposerChange(text);
    focusCaret(text.length);
    setHistoryMenuOpen(false);
  }

  function closeHistoryMenu(restoreDraft: boolean): void {
    setHistoryMenuOpen(false);
    if (restoreDraft) {
      props.onComposerChange(draftBeforeHistoryRef.current);
      focusCaret(draftBeforeHistoryRef.current.length);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (isExtensionUiActive) {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onExtensionUiResolve?.({ cancelled: true, confirmed: false });
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing &&
        !isComposingRef.current
      ) {
        const text = isExtensionUiInput ? extensionUiInput.trim() : props.composer.trim();
        if (text.length > 0) {
          event.preventDefault();
          props.onExtensionUiResolve?.({ value: text });
          if (!isExtensionUiInput) {
            props.onComposerChange('');
          }
          return;
        } else if (isExtensionUiInput) {
          event.preventDefault();
          props.onExtensionUiResolve?.({ value: '' });
          return;
        }
      }
    }

    // 1. Slash Menu Navigation
    if (slashMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashSelectedIndex((current) =>
          slashItems.length === 0 ? 0 : (current + 1) % slashItems.length,
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashSelectedIndex((current) =>
          slashItems.length === 0 ? 0 : (current - 1 + slashItems.length) % slashItems.length,
        );
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashMenuForcedClosed(true);
        return;
      }
      if (event.key === 'Tab') {
        const selected = slashItems[slashSelectedIndex];
        if (selected?.available) {
          event.preventDefault();
          applySlashItem(selected);
          return;
        }
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        const selected = slashItems[slashSelectedIndex];
        const query = (activeSlashToken?.query ?? '').toLowerCase();
        const exactMatch =
          selected &&
          selected.available &&
          [selected.name, ...(selected.aliases ?? [])]
            .map((name) => name.toLowerCase())
            .includes(query);
        if (exactMatch) {
          setSlashMenuForcedClosed(true);
        } else if (selected?.available) {
          event.preventDefault();
          applySlashItem(selected);
          return;
        }
      }
    }

    // 2. At-Mention Menu Navigation
    if (atMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setAtSelectedIndex((current) =>
          atItems.length === 0 ? 0 : (current + 1) % atItems.length,
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setAtSelectedIndex((current) =>
          atItems.length === 0 ? 0 : (current - 1 + atItems.length) % atItems.length,
        );
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setAtMenuForcedClosed(true);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        const selected = atItems[atSelectedIndex];
        if (selected) {
          event.preventDefault();
          applyAtItem(selected);
          return;
        }
      }
    }

    // 3. Prompt History list (ArrowUp / ArrowDown when menus are closed)
    if (!slashMenuOpen && !atMenuOpen) {
      if (historyMenuOpen) {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (historyItems.length === 0) {
            return;
          }
          const nextIndex = Math.min(historySelectedIndex + 1, historyItems.length - 1);
          setHistorySelectedIndex(nextIndex);
          const historyText = historyItems[nextIndex] ?? '';
          props.onComposerChange(historyText);
          focusCaret(historyText.length);
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (historySelectedIndex <= 0) {
            closeHistoryMenu(true);
            return;
          }
          const nextIndex = historySelectedIndex - 1;
          setHistorySelectedIndex(nextIndex);
          const historyText = historyItems[nextIndex] ?? '';
          props.onComposerChange(historyText);
          focusCaret(historyText.length);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeHistoryMenu(true);
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          const selected = historyItems[historySelectedIndex];
          if (selected !== undefined) {
            applyHistoryItem(selected);
          } else {
            closeHistoryMenu(true);
          }
          return;
        }
      }

      if (
        event.key === 'ArrowUp' &&
        (caretIndex === 0 || props.composer === '') &&
        historyItems.length > 0
      ) {
        event.preventDefault();
        draftBeforeHistoryRef.current = props.composer;
        setHistorySelectedIndex(0);
        setHistoryMenuOpen(true);
        const historyText = historyItems[0] ?? '';
        props.onComposerChange(historyText);
        focusCaret(historyText.length);
        return;
      }
    }

    // Shift+Tab from the textarea lands on the last shelf card, skipping
    // failure-row buttons that sit between the chips and the input.
    if (
      event.key === 'Tab' &&
      event.shiftKey &&
      !slashMenuOpen &&
      !atMenuOpen &&
      !historyMenuOpen
    ) {
      const shelf = event.currentTarget
        .closest('.composer-card-v2')
        ?.querySelector('[data-testid="composer-attachment-shelf-chips"]');
      const chips = shelf?.querySelectorAll<HTMLElement>('[data-shelf-chip]');
      const last = chips && chips.length > 0 ? chips[chips.length - 1] : null;
      if (last) {
        event.preventDefault();
        last.focus();
        return;
      }
    }

    // 4. ⌘Enter submits a run intervention (bypasses IME protection).
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      if (isPaused) {
        return;
      }
      if (isStreamingRun) {
        if (props.composer.trim().length > 0) {
          triggerSteer();
        }
      } else if (canKeyboardSend) {
        triggerSend();
      }
      return;
    }

    // 5. Enter Send handling with strict IME protection
    const now = Date.now();
    const isRecentlyComposing = isComposingRef.current || now - lastCompositionEndRef.current < 100;

    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !isRecentlyComposing &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (isPaused) {
        return;
      }
      if (isStreamingRun) {
        if (canQueueStreamingText) {
          triggerFollowUp();
        }
      } else if (canKeyboardSend) {
        triggerSend();
      }
    }
  }

  // Auto-resize textarea using rAF to avoid sync layout thrashing
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.height = 'auto';
      if (composerValue) {
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      }
    });
  }, [composerValue]);

  useEffect(() => {
    autoResize();
  }, [composerValue, props.layoutMode, autoResize]);

  return (
    <div
      className={`composer-card-v2${props.dropActive ? ' drop-active' : ''}${isStreamingRun ? ' is-streaming' : ''}`}
      data-testid="composer-card"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        props.onDropActiveChange(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        // dragover repeats continuously while dragging; it is the stable
        // "still dragging" signal even if a child boundary fired a spurious
        // dragleave (WebKit can do this when the drop overlay mounts).
        dragDepthRef.current = Math.max(1, dragDepthRef.current);
        props.onDropActiveChange(true);
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          props.onDropActiveChange(false);
        }
      }}
      onDrop={(event) => {
        dragDepthRef.current = 0;
        props.onDropActiveChange(false);
        props.onDrop(event);
      }}
    >
      {/* Drop Zone Overlay */}
      {props.dropActive ? (
        <div className="composer-v2-drop-overlay">
          <div className="composer-v2-drop-content">
            <span className="composer-v2-drop-text">{copy.dropFiles}</span>
          </div>
        </div>
      ) : null}

      <ComposerAttachmentShelf
        copy={copy}
        pendingAttachments={props.pendingAttachments}
        showTextOnlyImageWarning={showTextOnlyImageWarning}
        onRemoveAttachment={props.onRemoveAttachment}
        {...(props.pendingContextRefs ? { pendingContextRefs: props.pendingContextRefs } : {})}
        {...(props.docCommentsAttachment
          ? { docCommentsAttachment: props.docCommentsAttachment }
          : {})}
        {...(props.onRetryAttachment ? { onRetryAttachment: props.onRetryAttachment } : {})}
        {...(props.onRemoveContextRef ? { onRemoveContextRef: props.onRemoveContextRef } : {})}
        {...(props.onRemoveDocComments ? { onRemoveDocComments: props.onRemoveDocComments } : {})}
        {...(props.onOpenModelSettings ? { onOpenModelSettings: props.onOpenModelSettings } : {})}
        onRequestComposerFocus={() => {
          textareaRef.current?.focus();
        }}
      />

      {/* Textarea area */}
      <div className="composer-v2-input-area">
        <SlashMenu
          open={slashMenuOpen}
          items={slashItems}
          selectedIndex={slashSelectedIndex}
          onSelectIndex={setSlashSelectedIndex}
          onApply={applySlashItem}
          onClose={() => setSlashMenuForcedClosed(true)}
        />
        <AtMenu
          open={atMenuOpen}
          items={atItems}
          selectedIndex={atSelectedIndex}
          onSelectIndex={setAtSelectedIndex}
          onApply={applyAtItem}
          onClose={() => setAtMenuForcedClosed(true)}
        />
        <PromptHistoryMenu
          open={historyMenuOpen && !slashMenuOpen && !atMenuOpen}
          items={historyItems}
          selectedIndex={historySelectedIndex}
          title={copy.promptHistoryTitle}
          emptyLabel={copy.promptHistoryEmpty}
          onSelectIndex={(index) => {
            setHistorySelectedIndex(index);
            const historyText = historyItems[index] ?? '';
            props.onComposerChange(historyText);
            focusCaret(historyText.length);
          }}
          onApply={applyHistoryItem}
          onClose={() => closeHistoryMenu(true)}
        />
        <textarea
          ref={textareaRef}
          className="composer-v2-textarea"
          data-testid="composer-input"
          value={composerValue}
          onChange={(event) => {
            if (isExtensionUiInput) {
              props.onExtensionUiInputChange?.(event.target.value);
            } else if (!isExtensionUiActive) {
              props.onComposerChange(event.target.value);
            }
            setCaretIndex(event.target.selectionStart ?? event.target.value.length);
            setSlashMenuForcedClosed(false);
            setAtMenuForcedClosed(false);
            setHistoryMenuOpen(false);
            autoResize();
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            lastCompositionEndRef.current = Date.now();
          }}
          onSelect={syncCaretFromTextarea}
          onClick={syncCaretFromTextarea}
          onKeyUp={syncCaretFromTextarea}
          onPaste={(event) => props.onPaste(event)}
          onKeyDown={handleComposerKeyDown}
          readOnly={false}
          placeholder={
            isExtensionUiInput
              ? (extensionUiRequest?.placeholder ?? copy.typeYourAnswer)
              : isExtensionUiActive
                ? interruptionCopy.selectOrCustomPlaceholder
                : getAgentPlaceholder(props.agentMode, copy, props.isConversationSession === true)
          }
          rows={1}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="composer-v2-toolbar">
        <div className="composer-v2-toolbar-left">
          {/* Plus / attach button */}
          <div className="plus-anchor">
            <ComposerPlusMenu
              trigger={
                <IconButton
                  className={`composer-v2-icon-btn${props.plusMenuOpen ? ' active' : ''}`}
                  data-testid="composer-plus-btn"
                  title={copy.attachFiles}
                  label={copy.attachFiles}
                >
                  <IconPlus />
                </IconButton>
              }
              open={props.plusMenuOpen}
              onOpenChange={(open) => {
                props.onPlusMenuOpenChange(open);
                props.onPlusSubmenuChange('none');
                if (open) {
                  props.onRefreshComposerMenus();
                }
              }}
              submenu={props.plusSubmenu}
              onSubmenu={props.onPlusSubmenuChange}
              skills={props.menuSkills}
              onOpenSkillsPanel={props.onOpenSkillsPanel}
              mcpServers={props.menuMcp}
              onOpenMcpPanel={props.onOpenMcpPanel}
              onAttachFile={props.onAttachFile}
              onAttachImage={props.onAttachImage}
              onOpenKnowledge={props.onOpenKnowledge}
              onOpenCardsPanel={props.onOpenCardsPanel}
              hideAgentExtras={props.isConversationSession === true}
            />
          </div>

          {/* Thinking effort / Model control */}
          <ThinkingEffortControl
            disabled={isStreamingRun || !props.onThinkingLevelChange}
            modelLabel={selectedModel?.label ?? props.selectedModelLabel ?? copy.model}
            ultraEnabled={props.ultraThinkingEnabled ?? false}
            value={props.thinkingLevel ?? 'off'}
            onChange={(level) => props.onThinkingLevelChange?.(level)}
            models={thinkingModels}
            selectedModelKey={props.selectedModelKey}
            onSelectModel={props.onSelectModel}
          />

          <LiveComposerButton
            enabled={true}
            canStart={props.live?.canStart === true}
            starting={props.live?.starting === true}
            call={props.live?.call ?? null}
            error={props.live?.error ?? null}
            missing={props.live?.missing ?? []}
            isChinese={locale === 'zh-CN'}
            onStart={props.live?.onStart ?? (() => undefined)}
            onEnd={props.live?.onEnd ?? (() => undefined)}
          />

          {showSpeechInput ? (
            <>
              <IconButton
                className={`composer-v2-icon-btn${speechInput.status === 'listening' ? ' active' : ''}`}
                data-testid="composer-speech-btn"
                label={
                  speechInput.status === 'listening'
                    ? 'Stop recording'
                    : speechInput.status === 'transcribing'
                      ? 'Transcribing'
                      : 'Voice input'
                }
                disabled={
                  isStreamingRun || !canComposeText || speechInput.status === 'transcribing'
                }
                onClick={() => speechInput.toggle()}
              >
                <IconMic />
              </IconButton>
              {speechInput.error ? (
                <span
                  className="composer-speech-status is-error"
                  data-testid="composer-speech-error"
                >
                  {speechInput.error}
                </span>
              ) : speechInput.status === 'listening' ? (
                <span className="composer-speech-status" data-testid="composer-speech-status">
                  Recording…
                </span>
              ) : speechInput.status === 'transcribing' ? (
                <span className="composer-speech-status" data-testid="composer-speech-status">
                  Transcribing…
                </span>
              ) : null}
            </>
          ) : null}

          {/* Agent mode chip (non-default only) */}
          {props.isConversationSession !== true && props.agentMode !== 'agent' ? (
            <span
              className={`composer-v2-mode-chip mode-${props.agentMode}`}
              data-testid="agent-mode-chip"
              title={agentModeDefinition.description}
            >
              {agentModeDefinition.label}
              <button
                type="button"
                className="composer-v2-mode-dismiss"
                data-testid="agent-mode-dismiss"
                disabled={isStreamingRun}
                aria-label={copy.exitAgentMode(agentModeDefinition.label)}
                onClick={() => props.onAgentModeChange('agent')}
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ) : null}
        </div>

        <div className="composer-v2-toolbar-right">
          {/* Run Mode pill (ADR 0024) */}
          {props.isConversationSession !== true && props.onRunModeChange && props.runModePreset ? (
            <RunModeControl
              disabled={isStreamingRun}
              value={props.runModePreset}
              onChange={props.onRunModeChange}
              {...(props.onRunModeSetDefault ? { onSetDefault: props.onRunModeSetDefault } : {})}
              {...(props.onOpenPermissionsSettings
                ? { onOpenSettings: props.onOpenPermissionsSettings }
                : {})}
              {...(props.runModeYoloDisabled ? { yoloDisabled: true } : {})}
            />
          ) : null}

          {/* Always visible: scheme is a mode picker, not a feature switch.
              Default `off` = freehand (no injection); Ultra Code etc. inject on send. */}
          {props.isConversationSession !== true &&
          props.onOrchestrationSchemeChange &&
          props.orchestrationSchemeOptions ? (
            <OrchestrationSchemeControl
              disabled={false}
              value={props.orchestrationSchemeId ?? 'off'}
              options={props.orchestrationSchemeOptions}
              onChange={props.onOrchestrationSchemeChange}
              delegationDisabled={props.delegationDisabled ?? false}
              {...(props.onDelegationDisabledChange
                ? { onDelegationDisabledChange: props.onDelegationDisabledChange }
                : {})}
              {...(props.onOpenOrchestrationSchemeSettings
                ? { onOpenSettings: props.onOpenOrchestrationSchemeSettings }
                : {})}
            />
          ) : null}

          {/* Context usage ring */}
          <ContextUsageRing
            usage={props.contextUsage}
            {...(typeof props.modelContextWindow === 'number'
              ? { modelContextWindow: props.modelContextWindow }
              : {})}
            {...(props.onOpenModelSettings
              ? { onOpenModelSettings: props.onOpenModelSettings }
              : {})}
            isConversationSession={props.isConversationSession === true}
            locale={locale === 'en' ? 'en' : 'zh-CN'}
          />

          <ComposerActionSlot
            copy={copy}
            activeSessionId={props.activeSessionId}
            runPhase={props.runPhase}
            isStreamingRun={isStreamingRun}
            isPaused={isPaused}
            hasContent={hasContent}
            onlyFailedAttachments={onlyFailedAttachments}
            isExtensionUiActive={isExtensionUiActive}
            composerHasText={props.composer.trim().length > 0}
            onSend={triggerSend}
            onPause={props.onPause}
            {...(props.onResume ? { onResume: props.onResume } : {})}
            {...(props.onSteer ? { onSteer: triggerSteer } : {})}
            {...(props.mutationsEnabled === undefined
              ? {}
              : { mutationsEnabled: props.mutationsEnabled })}
          />
        </div>
      </div>

      {/* Expanded Modal Editor */}
      <ComposerModalEditor
        open={modalEditorOpen}
        value={props.composer}
        onSave={(newValue) => {
          props.onComposerChange(newValue);
          autoResize();
        }}
        onClose={() => setModalEditorOpen(false)}
      />

      {/* Phase 0: retry / send-rest / back confirmation for failed saves. */}
      <Dialog
        label={copy.attachmentFailureDialogTitle}
        open={attachmentFailureDialogOpen}
        onOpenChange={setAttachmentFailureDialogOpen}
        testId="composer-attachment-failure-dialog"
      >
        <h3>{copy.attachmentFailureDialogTitle}</h3>
        <div className="ui-confirm-description muted">
          {copy.attachmentFailureDialogBody(failedAttachments.length)}
        </div>
        <div className="modal-actions">
          <Button
            data-testid="attachment-failure-cancel"
            onClick={() => setAttachmentFailureDialogOpen(false)}
          >
            {copy.attachmentFailureBack}
          </Button>
          <Button
            data-testid="attachment-failure-send-rest"
            onClick={() => {
              setAttachmentFailureDialogOpen(false);
              props.onDiscardFailedAttachments?.();
              proceedSend();
            }}
          >
            {copy.attachmentFailureSendRest}
          </Button>
          <Button
            variant="primary"
            data-testid="attachment-failure-retry-send"
            autoFocus
            onClick={() => {
              setAttachmentFailureDialogOpen(false);
              props.onRetryFailedAttachments?.();
              proceedSend();
            }}
          >
            {copy.attachmentFailureRetrySend}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function ComposerDock(props: ComposerDockProps): ReactElement {
  const isStreamingRun =
    props.streaming ||
    props.runPhase === 'streaming' ||
    props.runPhase === 'pausing' ||
    props.runPhase === 'aborting';
  const hasSteerQueue = (props.steerQueueMessages?.length ?? 0) > 0;
  return (
    <footer
      className={`composer-dock layout-${props.layoutMode}${hasSteerQueue ? ' has-steer-queue' : ''}`}
      data-testid="composer-dock"
      data-layout={props.layoutMode}
    >
      {/* Outside the input card: floating context layer (project / branch / runtime).
          Only displayed at the start of a session before user inputs (layoutMode === 'centered'). */}
      {props.layoutMode === 'centered' ? (
        <div className="composer-context-rail" data-testid="composer-context-row">
          {props.onOpenProject && props.projectPath ? (
            <ProjectChip
              projectPath={props.projectPath}
              recentProjects={props.recentProjects ?? []}
              onOpenProject={props.onOpenProject}
            />
          ) : props.projectPath ? (
            <span
              className="composer-context-link is-static"
              data-testid="composer-project-chip"
              title={props.projectPath}
            >
              <span className="composer-context-link-label">
                {projectLabel(props.projectPath, props.recentProjects ?? [])}
              </span>
            </span>
          ) : null}
          {props.branchRequest && props.projectPath ? (
            <BranchChip
              projectPath={props.projectPath}
              disabled={isStreamingRun}
              request={props.branchRequest}
            />
          ) : null}
          <RuntimeTargetChip
            {...(props.runtimeRemoteConnected === true ? { remoteConnected: true } : {})}
            {...(props.runtimeRemoteHostLabel ? { hostLabel: props.runtimeRemoteHostLabel } : {})}
            {...(props.onSelectLocalRuntime ? { onSelectLocal: props.onSelectLocalRuntime } : {})}
            {...(props.onSelectAttachRuntime
              ? { onSelectAttach: props.onSelectAttachRuntime }
              : {})}
          />
        </div>
      ) : null}
      {props.activeJobs && props.activeJobs.length > 0 ? (
        <ActiveJobsStrip
          jobs={props.activeJobs}
          onStop={props.onStopJob ?? (() => {})}
          onViewLogs={props.onViewJobLogs ?? (() => {})}
        />
      ) : null}
      {props.steerQueueMessages && props.steerQueueMessages.length > 0 ? (
        <SteerQueue
          messages={props.steerQueueMessages}
          onSendNow={props.onSteerQueueSendNow || (() => {})}
          onEdit={props.onSteerQueueEdit || (() => {})}
          onRemove={props.onSteerQueueRemove || (() => {})}
        />
      ) : null}
      <ComposerCard {...props} />
    </footer>
  );
}
