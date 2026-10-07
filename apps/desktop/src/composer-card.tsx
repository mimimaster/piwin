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
import { isReservedComposerSlashCommand, SlashMenu } from './slash';
import { AtMenu } from './at';
import { useComposerSlashMenu } from './hooks/use-composer-slash-menu';
import { useComposerAtMenu } from './hooks/use-composer-at-menu';
import {
  decideComposerKeyDown,
  dispatchComposerKeyAction,
  toComposerKeyEvent,
} from './composer-key-handling';
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
import { usesOnScreenKeyboard } from './shell-runtime';
import { toThinkingEffortModels } from './ThinkingEffortControl';

function getAgentPlaceholder(
  mode: AgentModeId,
  copy: ReturnType<typeof getDesktopCopy>['composer'],
  conversationSession = false,
): string {
  if (mode === 'goal') return copy.goalPlaceholder;
  return conversationSession ? copy.chatPlaceholder : copy.agentPlaceholder;
}

export function ComposerCard(props: ComposerDockProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const queuedEdit = props.queuedEdit ?? null;
  const baseCopy = getDesktopCopy(locale).composer;
  const copy = {
    ...baseCopy,
    ...(queuedEdit ? {
      send: baseCopy.saveQueuedMessage,
      sendShortcut: baseCopy.queuedEditSaveHint,
      queueFollowUp: baseCopy.saveQueuedMessage,
      queueFollowUpHint: baseCopy.queuedEditSaveHint,
    } : {}),
    ...(props.sendAriaLabel ? { send: props.sendAriaLabel, sendShortcut: props.sendAriaLabel } : {}),
  };
  const interruptionCopy = translator.interruption;
  const isPaused = props.paused === true;
  const isStreamingRun = props.streaming || props.runPhase === 'streaming' || props.runPhase === 'pausing' || props.runPhase === 'aborting';
  const extensionUiRequest = props.extensionUiRequest ?? null;
  const isExtensionUiActive = extensionUiRequest !== null;
  const isExtensionUiInput = extensionUiRequest?.kind === 'input';
  const extensionUiInput = props.extensionUiInput ?? '';
  const canComposeText = !isExtensionUiActive;
  const composerValue = isExtensionUiInput ? extensionUiInput : props.composer;
  const hasContent = isExtensionUiActive
    ? (isExtensionUiInput ? extensionUiInput.trim().length > 0 : props.composer.trim().length > 0)
    : (props.composer.trim().length > 0 || props.pendingAttachments.length > 0 || (props.pendingContextRefs?.length ?? 0) > 0 || props.hasCarryContent === true);
  const failedAttachments = props.pendingAttachments.filter(isFailedMediaAttachment);
  const hasSendableContentBesidesFailures = props.composer.trim().length > 0 || props.pendingAttachments.some((item) => !isFailedMediaAttachment(item)) || (props.pendingContextRefs?.length ?? 0) > 0;
  const onlyFailedAttachments = failedAttachments.length > 0 && !hasSendableContentBesidesFailures;
  const isPauseContinueDraft = isPaused && isPauseContinueUtterance(props.composer) && props.pendingAttachments.length === 0 && (props.pendingContextRefs?.length ?? 0) === 0 && props.hasCarryContent !== true;
  const canKeyboardSend = props.composer.trim().length > 0 || props.hasCarryContent === true || (queuedEdit !== null && props.pendingAttachments.length > 0);
  const selectedModel = props.modelOptions.find((model) => `${model.providerId}::${model.modelId}` === props.selectedModelKey);
  const hasImageAttachment = props.pendingAttachments.some((item) => item.attachment.kind === 'media' && (item.attachment.contentKind === 'image' || (item.attachment.contentKind === undefined && item.attachment.mimeType.toLowerCase().startsWith('image/'))));
  const selectedModelSupportsImage = selectedModel?.supportsImage === true;
  const showTextOnlyImageWarning = hasImageAttachment && !selectedModelSupportsImage && props.visionDelegationEnabled !== true;
  const thinkingModels = useMemo(() => toThinkingEffortModels(props.modelOptions), [props.modelOptions]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);
  const [caretIndex, setCaretIndex] = useState(0);

  const [modalEditorOpen, setModalEditorOpen] = useState(false);
  const [attachmentFailureDialogOpen, setAttachmentFailureDialogOpen] = useState(false);

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

  const isComposingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const endedCompositionWithEnterRef = useRef(false);

  useEffect(() => {
    if (!usesOnScreenKeyboard()) textareaRef.current?.focus();
  }, [props.activeSessionId, props.projectPath]);

  useEffect(() => {
    if (isExtensionUiInput) textareaRef.current?.focus();
  }, [extensionUiRequest?.requestId, isExtensionUiInput]);

  useEffect(() => {
    if (props.queuedEdit == null) return;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [props.queuedEdit?.messageId]);

  function syncCaretFromTextarea(): void {
    const element = textareaRef.current;
    if (element) setCaretIndex(element.selectionStart ?? 0);
  }

  const focusCaret = useCallback((nextCaret: number): void => {
    setCaretIndex(nextCaret);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (element) {
        element.focus();
        element.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }, []);

  const proceedSend = useCallback((overrideText?: string): void => {
    const trimmed = (overrideText ?? props.composer).trim();
    if (trimmed) pushHistoryEntry(trimmed);
    setHistoryMenuOpen(false);
    draftBeforeHistoryRef.current = '';
    props.onSend(overrideText);
  }, [props, pushHistoryEntry]);

  function triggerResumeCheckpoint(): void {
    if (props.composer.trim().length > 0) props.onComposerChange('');
    void props.onResume?.();
  }

  function triggerSend(): void {
    if (isExtensionUiActive) {
      const text = isExtensionUiInput ? extensionUiInput.trim() : props.composer.trim();
      if (text.length > 0) {
        props.onExtensionUiResolve?.({ value: text });
        if (!isExtensionUiInput) props.onComposerChange('');
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
    if (trimmed) pushHistoryEntry(trimmed);
    setHistoryMenuOpen(false);
    draftBeforeHistoryRef.current = '';
    props.onSteer?.();
  }

  const applyHistoryItem = useCallback((text: string): void => {
    props.onComposerChange(text);
    focusCaret(text.length);
    setHistoryMenuOpen(false);
  }, [focusCaret, props]);

  const closeHistoryMenu = useCallback((restoreDraft: boolean): void => {
    setHistoryMenuOpen(false);
    if (restoreDraft) {
      props.onComposerChange(draftBeforeHistoryRef.current);
      focusCaret(draftBeforeHistoryRef.current.length);
    }
  }, [focusCaret, props]);

  const slashMenu = useComposerSlashMenu({
    props,
    composer: props.composer,
    caretIndex,
    canComposeText,
    isStreamingRun,
    focusCaret,
    proceedSend,
  });

  const atMenu = useComposerAtMenu({
    projectPath: props.projectPath,
    menuMcp: props.menuMcp,
    atWorkspaceFiles: props.atWorkspaceFiles,
    composer: props.composer,
    caretIndex,
    canComposeText,
    slashMenuOpen: slashMenu.isOpen,
    onAddContextRef: props.onAddContextRef,
    onComposerChange: props.onComposerChange,
    focusCaret,
  });

  const insertSpeechText = useCallback((text: string): void => {
    const normalized = text.trim();
    if (!normalized) return;
    const targetValue = isExtensionUiInput ? extensionUiInput : props.composer;
    const targetCaret = Math.max(0, Math.min(caretIndex, targetValue.length));
    const prefix = targetValue.slice(0, targetCaret);
    const suffix = targetValue.slice(targetCaret);
    const beforeSep = prefix && !/\s$/.test(prefix) ? ' ' : '';
    const afterSep = suffix && !/^\s/.test(suffix) ? ' ' : '';
    const inserted = `${beforeSep}${normalized}${afterSep}`;
    const nextValue = `${prefix}${inserted}${suffix}`;
    if (isExtensionUiInput) props.onExtensionUiInputChange?.(nextValue);
    else props.onComposerChange(nextValue);
    focusCaret(targetCaret + inserted.length);
  }, [caretIndex, extensionUiInput, focusCaret, isExtensionUiInput, props]);

  const speechInput = useSpeechInput({
    enabled: props.speechConfigured === true && props.speechRequest !== undefined && canComposeText,
    ...(props.speechRequest ? { request: props.speechRequest } : {}),
    onTranscript: insertSpeechText,
  });
  const showSpeechInput = props.speechConfigured === true && props.speechRequest !== undefined;

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const decision = decideComposerKeyDown(toComposerKeyEvent(event), {
      isComposing: isComposingRef.current,
      lastCompositionEnd: lastCompositionEndRef.current,
      endedCompositionWithEnter: endedCompositionWithEnterRef.current,
      isExtensionUiActive,
      isExtensionUiInput,
      extensionUiInput,
      slashMenuOpen: slashMenu.isOpen,
      slashItems: slashMenu.items,
      slashSelectedIndex: slashMenu.selectedIndex,
      atMenuOpen: atMenu.isOpen,
      atItems: atMenu.items,
      atSelectedIndex: atMenu.selectedIndex,
      historyMenuOpen,
      historyItems,
      historySelectedIndex,
      composer: props.composer,
      caretIndex,
      queuedEditActive: queuedEdit !== null,
      isStreamingRun,
      canKeyboardSend,
    });
    if (decision.nextEndedCompositionWithEnter !== undefined) {
      endedCompositionWithEnterRef.current = decision.nextEndedCompositionWithEnter;
    }
    if (decision.action.preventDefault) {
      event.preventDefault();
    }
    dispatchComposerKeyAction(decision.action, {
      onExtensionUiCancel: () => props.onExtensionUiResolve?.({ cancelled: true, confirmed: false }),
      onExtensionUiSubmit: (text, clear) => {
        props.onExtensionUiResolve?.({ value: text });
        if (clear) props.onComposerChange('');
      },
      onSlashSelectPrev: () => slashMenu.setSelectedIndex((c) => slashMenu.items.length ? (c - 1 + slashMenu.items.length) % slashMenu.items.length : 0),
      onSlashSelectNext: () => slashMenu.setSelectedIndex((c) => slashMenu.items.length ? (c + 1) % slashMenu.items.length : 0),
      onSlashClose: slashMenu.closeMenu,
      onSlashComplete: slashMenu.completeItem,
      onSlashExecute: slashMenu.executeItem,
      onAtSelectPrev: () => atMenu.setSelectedIndex((c) => atMenu.items.length ? (c - 1 + atMenu.items.length) % atMenu.items.length : 0),
      onAtSelectNext: () => atMenu.setSelectedIndex((c) => atMenu.items.length ? (c + 1) % atMenu.items.length : 0),
      onAtClose: atMenu.closeMenu,
      onAtApply: atMenu.applyItem,
      onHistorySelect: (idx, text) => { setHistorySelectedIndex(idx); props.onComposerChange(text); focusCaret(text.length); },
      onHistoryClose: closeHistoryMenu,
      onHistoryApply: applyHistoryItem,
      onHistoryOpen: (idx, text, draft) => {
        draftBeforeHistoryRef.current = draft;
        setHistorySelectedIndex(idx);
        setHistoryMenuOpen(true);
        props.onComposerChange(text);
        focusCaret(text.length);
      },
      onTabNavigate: (shiftKey) => {
        if (shiftKey) {
          const chips = event.currentTarget.closest('.composer-card-v2')?.querySelector('[data-testid="composer-attachment-shelf-chips"]')?.querySelectorAll<HTMLElement>('[data-shelf-chip]');
          chips?.[chips.length - 1]?.focus();
        }
      },
      onQueuedEditCancel: () => props.onQueuedEditCancel?.(),
      onSteer: triggerSteer,
      onSend: triggerSend,
    });
  }

  // Auto-resize textarea using rAF to avoid sync layout thrashing. One frame
  // at a time: the value effect, onInput and paste can all ask within a single
  // keystroke, and each run forces a layout to read scrollHeight.
  const resizeFrameRef = useRef<number | null>(null);
  const autoResize = useCallback(() => {
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      if (composerValue) {
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      }
    });
  }, [composerValue]);
  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    autoResize();
  }, [composerValue, props.layoutMode, autoResize]);

  return (
    <div
      className={`slab composer-card-v2${props.dropActive ? ' drop-active' : ''}${isStreamingRun ? ' is-streaming' : ''}${queuedEdit ? ' is-queued-edit' : ''}`}
      data-testid="composer-card"
      onDragEnter={(e) => { e.preventDefault(); dragDepthRef.current += 1; props.onDropActiveChange(true); }}
      onDragOver={(e) => { e.preventDefault(); dragDepthRef.current = Math.max(1, dragDepthRef.current); props.onDropActiveChange(true); }}
      onDragLeave={() => { dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) props.onDropActiveChange(false); }}
      onDrop={(e) => { dragDepthRef.current = 0; props.onDropActiveChange(false); props.onDrop(e); }}
    >
      <div className="slab-face" aria-hidden />
      {props.dropActive ? (
        <div className="composer-v2-drop-overlay">
          <div className="composer-v2-drop-content"><span className="composer-v2-drop-text">{copy.dropFiles}</span></div>
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
        {...(props.pendingContextRefs && { pendingContextRefs: props.pendingContextRefs })}
        {...(props.docCommentsAttachment && { docCommentsAttachment: props.docCommentsAttachment })}
        {...(props.onRetryAttachment && { onRetryAttachment: props.onRetryAttachment })}
        {...(props.onRemoveContextRef && { onRemoveContextRef: props.onRemoveContextRef })}
        {...(props.onRemoveDocComments && { onRemoveDocComments: props.onRemoveDocComments })}
        {...(props.onOpenModelSettings && { onOpenModelSettings: props.onOpenModelSettings })}
        onRequestComposerFocus={() => textareaRef.current?.focus()}
      />

      <div className="composer-v2-input-area">
        <SlashMenu
          open={slashMenu.isOpen}
          items={slashMenu.items}
          selectedIndex={slashMenu.selectedIndex}
          onSelectIndex={slashMenu.setSelectedIndex}
          onApply={slashMenu.applyItem}
          onClose={slashMenu.closeMenu}
        />
        <AtMenu
          open={atMenu.isOpen}
          items={atMenu.items}
          selectedIndex={atMenu.selectedIndex}
          onSelectIndex={atMenu.setSelectedIndex}
          onApply={atMenu.applyItem}
          onClose={atMenu.closeMenu}
        />
        <PromptHistoryMenu
          open={historyMenuOpen && !slashMenu.isOpen && !atMenu.isOpen}
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
            slashMenu.resetForcedClosed();
            atMenu.resetForcedClosed();
            setHistoryMenuOpen(false);
            autoResize();
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
            endedCompositionWithEnterRef.current = false;
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
        props={props} copy={copy} locale={locale}
        isStreamingRun={isStreamingRun} isPaused={isPaused} hasContent={hasContent}
        isPauseContinueDraft={isPauseContinueDraft} onlyFailedAttachments={onlyFailedAttachments}
        isExtensionUiActive={isExtensionUiActive} canComposeText={canComposeText}
        showSpeechInput={showSpeechInput} speechInput={speechInput}
        thinkingModels={thinkingModels} selectedModel={selectedModel}
        triggerSend={triggerSend} onResumeCheckpoint={triggerResumeCheckpoint}
      />

      <ComposerModalEditor
        open={modalEditorOpen} value={props.composer}
        onSave={(newValue) => { props.onComposerChange(newValue); autoResize(); }}
        onClose={() => setModalEditorOpen(false)}
      />

      <AttachmentFailureDialog
        open={attachmentFailureDialogOpen} onOpenChange={setAttachmentFailureDialogOpen}
        failedCount={failedAttachments.length} copy={copy}
        onDiscardAndSend={() => { props.onDiscardFailedAttachments?.(); proceedSend(); }}
        onRetryAndSend={() => { props.onRetryFailedAttachments?.(); proceedSend(); }}
      />
    </div>
  );
}
