import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { isPauseContinueUtterance } from '@piwin/contracts';
import { AttachmentFailureDialog } from './attachment-failure-dialog';
import type { AgentModeId } from './agent-mode';
import { isFailedMediaAttachment } from './media-utils';
import { ComposerAttachmentShelf } from './composer-attachment-shelf';
import {
  buildSlashCatalog,
  detectActiveSlashToken,
  filterSlashItems,
  isReservedComposerSlashCommand,
  isReservedSlashExecuteName,
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
import { ComposerQueuedEditBanner } from './composer-queued-edit-banner';
import { composerSubscriptionBillingNotice } from './subscription-billing-notice.js';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import { KnowledgeMountChips } from './knowledge/KnowledgeMountChips.js';
import { useSpeechInput } from './hooks/use-speech-input.js';
import { PromptHistoryMenu } from './prompt-history-menu';
import {
  loadPromptHistoryFromStorage,
  mergePromptHistory,
  PROMPT_HISTORY_MAX,
  pushPromptHistory,
  savePromptHistoryToStorage,
} from './prompt-history';
import type { ComposerDockProps } from './composer-dock-types';
import { ComposerCardToolbar } from './composer-card-toolbar';
import { toThinkingEffortModels } from './ThinkingEffortControl';

function getAgentPlaceholder(
  mode: AgentModeId,
  copy: ReturnType<typeof getDesktopCopy>['composer'],
  conversationSession = false,
): string {
  if (mode === 'goal') return copy.goalPlaceholder;
  if (conversationSession) {
    return copy.chatPlaceholder;
  }
  return copy.agentPlaceholder;
}

export function ComposerCard(props: ComposerDockProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const queuedEdit = props.queuedEdit ?? null;
  const baseCopy = getDesktopCopy(locale).composer;
  const copy = {
    ...baseCopy,
    // A queued-turn edit reuses the Send control, so every send-flavoured
    // label has to say "save" instead of "queue another turn".
    ...(queuedEdit
      ? {
          send: baseCopy.saveQueuedMessage,
          sendShortcut: baseCopy.queuedEditSaveHint,
          queueFollowUp: baseCopy.saveQueuedMessage,
          queueFollowUpHint: baseCopy.queuedEditSaveHint,
        }
      : {}),
    ...(props.sendAriaLabel
      ? { send: props.sendAriaLabel, sendShortcut: props.sendAriaLabel }
      : {}),
  };
  const interruptionCopy = translator.interruption;
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
  // Paused + "继续"/"continue" (no attachments/refs) resumes the checkpoint.
  const isPauseContinueDraft =
    isPaused &&
    isPauseContinueUtterance(props.composer) &&
    props.pendingAttachments.length === 0 &&
    (props.pendingContextRefs?.length ?? 0) === 0 &&
    props.hasCarryContent !== true;
  // A queued turn may legitimately end up image-only, so Enter still saves it
  // when the text has been cleared but chips remain.
  const canKeyboardSend =
    props.composer.trim().length > 0 ||
    props.hasCarryContent === true ||
    (queuedEdit !== null && props.pendingAttachments.length > 0);
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
  const thinkingModels = useMemo(
    () => toThinkingEffortModels(props.modelOptions),
    [props.modelOptions],
  );

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

  // Entering a queued-turn edit hands the caret to the loaded text.
  useEffect(() => {
    if (props.queuedEdit === null || props.queuedEdit === undefined) {
      return;
    }
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [props.queuedEdit?.messageId]);

  const isGoalEnabled = props.goalExtensionEnabled !== false;

  // Catalog: Slash Menu items
  const slashCatalog = useMemo(
    () =>
      buildSlashCatalog({
        skills: props.menuSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: skill.enabled,
          ...(skill.source ? { source: skill.source } : {}),
        })),
        compactionSupported: props.compactionSupported !== false,
        streaming: isStreamingRun,
        compacting: props.compacting,
        hasActiveSession: Boolean(props.activeSessionId),
        projectTrusted: props.projectTrusted,
        requireProjectTrust: Boolean(props.projectPath),
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
      props.projectPath,
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
        recentFiles: (props.atWorkspaceFiles ?? [])
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.relativePath),
        recentFolders: (props.atWorkspaceFiles ?? [])
          .filter((entry) => entry.kind === 'directory')
          .map((entry) => entry.relativePath),
      }),
    [props.projectPath, props.menuMcp, props.atWorkspaceFiles],
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
    activeAtToken !== null && canComposeText && !atMenuForcedClosed && !slashMenuOpen;

  useEffect(() => {
    setAtSelectedIndex(0);
  }, [activeAtToken?.query, atMenuOpen]);

  useEffect(() => {
    if (atSelectedIndex >= atItems.length && atItems.length > 0) {
      setAtSelectedIndex(atItems.length - 1);
    }
  }, [atItems.length, atSelectedIndex]);

  // Reset forced-close only after the token is gone. Resetting on every
  // composer change reopened the menu after applying `/ultra-code` (the
  // token is still active), which is the two-Enter layout-break path.
  const hasActiveSlashToken = activeSlashToken !== null;
  useEffect(() => {
    if (!hasActiveSlashToken) {
      setSlashMenuForcedClosed(false);
    }
  }, [hasActiveSlashToken]);

  const hasActiveAtToken = activeAtToken !== null;
  useEffect(() => {
    if (!hasActiveAtToken) {
      setAtMenuForcedClosed(false);
    }
  }, [hasActiveAtToken]);

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
    if (!activeSlashToken) {
      return;
    }
    if (isReservedSlashExecuteName(item.name) || item.kind === 'mode') {
      // Menu click on a reserved command or a mode performs it immediately.
      executeSlashItem(item);
      return;
    }
    completeSlashItem(item);
  }

  /** Tab / click-into-box semantics: fill the token, never send. */
  function completeSlashItem(item: SlashItem): void {
    if (!activeSlashToken) {
      return;
    }
    if (!item.available) {
      return;
    }
    const insert =
      item.kind === 'command' && !item.acceptsArgs ? `/${item.name}` : `/${item.name} `;
    const next = replaceActiveSlashToken(props.composer, activeSlashToken, insert);
    props.onComposerChange(next);
    focusCaret(activeSlashToken.startIndex + insert.length);
    setSlashMenuForcedClosed(true);
  }

  /**
   * Enter semantics: perform the selected item now.
   * - Modes switch in place (or send when args follow the token).
   * - Skills with no args complete like click/Tab so the user can type a
   *   real prompt; skills with typed args after the token still send.
   * - Reserved commands / other execute items send immediately.
   */
  function executeSlashItem(item: SlashItem): void {
    if (!activeSlashToken) {
      return;
    }
    if (item.kind === 'mode') {
      const suffix = props.composer.slice(activeSlashToken.endIndex);
      if (suffix.trim().length > 0) {
        // `/goal fix the bug` — the send layer parses mode + args.
        executeSlashItemSend(item, suffix);
        return;
      }
      props.onAgentModeChange(item.name as AgentModeId);
      const next = replaceActiveSlashToken(props.composer, activeSlashToken, '');
      props.onComposerChange(next);
      focusCaret(activeSlashToken.startIndex);
      setSlashMenuForcedClosed(true);
      return;
    }
    if (item.kind === 'skill') {
      const suffix = props.composer.slice(activeSlashToken.endIndex);
      if (suffix.trim().length === 0) {
        completeSlashItem(item);
        return;
      }
      executeSlashItemSend(item, suffix);
      return;
    }
    executeSlashItemSend(item, props.composer.slice(activeSlashToken.endIndex));
  }

  function executeSlashItemSend(item: SlashItem, suffix: string): void {
    const next = `/${item.name}${suffix}`.replace(/[ \t]+$/u, '').trimStart();
    props.onComposerChange(next);
    setSlashMenuForcedClosed(true);
    proceedSend(next);
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
    // File/folder chips live on the shelf; keep the textarea as plain
    // prompt text instead of duplicating `@path` next to the capsule.
    const insertValue = props.onAddContextRef && mentionRef ? '' : item.insertValue;
    const next = replaceActiveAtToken(props.composer, activeAtToken, insertValue);
    props.onComposerChange(next);
    focusCaret(activeAtToken.startIndex + insertValue.length);
    setAtMenuForcedClosed(true);
  }

  function proceedSend(overrideText?: string): void {
    const trimmed = (overrideText ?? props.composer).trim();
    if (trimmed) {
      pushHistoryEntry(trimmed);
    }
    setHistoryMenuOpen(false);
    draftBeforeHistoryRef.current = '';
    props.onSend(overrideText);
  }

  function triggerResumeCheckpoint(): void {
    if (props.composer.trim().length > 0) {
      props.onComposerChange('');
    }
    void props.onResume?.();
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
    if (isPauseContinueDraft && props.onResume) {
      triggerResumeCheckpoint();
      return;
    }
    if (failedAttachments.length > 0 && !isReservedComposerSlashCommand(props.composer)) {
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
        if (selected && (selected.available || isReservedSlashExecuteName(selected.name))) {
          // Tab completes the token only; Enter performs it.
          event.preventDefault();
          completeSlashItem(selected);
          return;
        }
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        const selected = slashItems[slashSelectedIndex];
        if (selected && (selected.available || isReservedSlashExecuteName(selected.name))) {
          // Skills without args complete only (same as click/Tab). Reserved
          // commands, modes, and skills-with-args still perform on one Enter.
          event.preventDefault();
          executeSlashItem(selected);
          return;
        }
        // Unavailable / nothing selected falls through to the ordinary
        // Enter send path below (e.g. sends the typed text as-is).
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

    // 4. Escape leaves a queued-turn edit; the parked draft comes back.
    if (event.key === 'Escape' && queuedEdit && !slashMenuOpen && !atMenuOpen && !historyMenuOpen) {
      event.preventDefault();
      props.onQueuedEditCancel?.();
      return;
    }

    // 5. ⌘Enter submits a run intervention (bypasses IME protection). While a
    // queued turn owns the input box there is nothing to steer with — both
    // Enter flavours save the edit.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      const reserved = isReservedComposerSlashCommand(props.composer);
      // Paused + empty Continue is a button action. Paused + draft is an
      // ordinary new message (same as the Send circle); never swallow ⌘Enter.
      if (isStreamingRun && !queuedEdit && !reserved) {
        if (props.composer.trim().length > 0) {
          triggerSteer();
        }
      } else if (canKeyboardSend || reserved) {
        triggerSend();
      }
      return;
    }

    // 6. Enter queues a follow-up while a Run is live; Cmd/Ctrl+Enter above
    // steers the current Run. Ordinary Send stays non-destructive.
    const now = Date.now();
    const isRecentlyComposing = isComposingRef.current || now - lastCompositionEndRef.current < 100;

    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !isRecentlyComposing &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      const reserved = isReservedComposerSlashCommand(props.composer);
      // Paused empty / continue-only → resume via triggerSend; a real draft sends.
      if (canKeyboardSend || reserved) {
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
      className={`slab composer-card-v2${props.dropActive ? ' drop-active' : ''}${isStreamingRun ? ' is-streaming' : ''}${queuedEdit ? ' is-queued-edit' : ''}`}
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

      {queuedEdit ? (
        <ComposerQueuedEditBanner
          position={queuedEdit.position}
          title={copy.queuedEditTitle}
          hint={copy.queuedEditHint}
          cancelLabel={copy.cancelQueuedEdit}
          onCancel={() => props.onQueuedEditCancel?.()}
        />
      ) : null}

      {composerSubscriptionBillingNotice(selectedModel, locale === 'en' ? 'en' : 'zh-CN')}

      <KnowledgeMountChips locale={locale === 'en' ? 'en' : 'zh-CN'} />

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
          className="ta composer-v2-textarea"
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
                : queuedEdit
                  ? copy.queuedEditPlaceholder
                  : getAgentPlaceholder(props.agentMode, copy, props.isConversationSession === true)
          }
          rows={1}
        />
      </div>

      <ComposerCardToolbar
        props={props}
        copy={copy}
        locale={locale}
        isStreamingRun={isStreamingRun}
        isPaused={isPaused}
        hasContent={hasContent}
        isPauseContinueDraft={isPauseContinueDraft}
        onlyFailedAttachments={onlyFailedAttachments}
        isExtensionUiActive={isExtensionUiActive}
        canComposeText={canComposeText}
        showSpeechInput={showSpeechInput}
        speechInput={speechInput}
        thinkingModels={thinkingModels}
        selectedModel={selectedModel}
        triggerSend={triggerSend}
        onResumeCheckpoint={triggerResumeCheckpoint}
      />

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
      <AttachmentFailureDialog
        open={attachmentFailureDialogOpen}
        onOpenChange={setAttachmentFailureDialogOpen}
        failedCount={failedAttachments.length}
        copy={copy}
        onDiscardAndSend={() => {
          props.onDiscardFailedAttachments?.();
          proceedSend();
        }}
        onRetryAndSend={() => {
          props.onRetryFailedAttachments?.();
          proceedSend();
        }}
      />
    </div>
  );
}
