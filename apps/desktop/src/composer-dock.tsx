/**
 * Composer: empty = centered with path header; active session = bottom dock.
 * Context usage ring sits on the toolbar (no project chip — workspace is left sidebar).
 * Slash menu (`/`) surfaces commands, modes, and skills.
 * At menu (`@`) surfaces workspace files, git diffs, and MCP servers.
 * History navigation (`ArrowUp`/`ArrowDown`) recalls past sent prompts.
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
import type { ContextUsageSnapshot, HostStatusData } from '@piwin/contracts';
import { IconButton } from '@piwin/ui-kit';
import {
  ComposerPlusMenu,
  type ComposerMcpOption,
  type ComposerPlusSubmenu,
  type ComposerSkillOption,
} from './composer-plus-menu';
import { getAgentMode, type AgentModeId } from './agent-mode';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';
import type { PendingComposerAttachment } from './media-utils';
import { ContextUsageRing } from './context-usage-ring';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { RunModeControl } from './RunModeControl';
import {
  IconBook,
  IconChat,
  IconClose,
  IconDocument,
  IconPlus,
  IconSend,
  IconStop,
} from './shell-icons';
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
  detectActiveAtToken,
  filterAtItems,
  replaceActiveAtToken,
  AtMenu,
  type AtItem,
} from './at';
import { ComposerModalEditor } from './ComposerModalEditor';
import {
  ExtensionUiPrompt,
  type ExtensionUiResolvePayload,
} from './extension-ui-prompt';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';

export type ComposerModelOption = {
  providerId: string;
  protocol: import('@piwin/contracts').ModelRef['protocol'];
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
  runPhase: 'idle' | 'streaming' | 'aborting';
  compacting: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  agentMode: AgentModeId;
  onAgentModeChange: (mode: AgentModeId) => void;
  pendingAttachments: PendingComposerAttachment[];
  onRemoveAttachment: (localId: string) => void;
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
  onAttachImage: () => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (event: DragEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onAbort: () => void;
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
};

export function ComposerCard(props: ComposerDockProps): ReactElement {
  const agentModeDefinition = getAgentMode(props.agentMode);
  const isStreamingRun =
    props.streaming || props.runPhase === 'streaming' || props.runPhase === 'aborting';
  const extensionUiRequest = props.extensionUiRequest ?? null;
  const isExtensionUiActive = extensionUiRequest !== null;
  const isExtensionUiInput = extensionUiRequest?.kind === 'input';
  const extensionUiInput = props.extensionUiInput ?? '';
  const canComposeText = !isExtensionUiActive;
  const composerValue = isExtensionUiInput ? extensionUiInput : props.composer;
  const hasContent = isExtensionUiActive
    ? isExtensionUiInput && extensionUiInput.trim().length > 0
    : props.composer.trim().length > 0 || props.pendingAttachments.length > 0;
  const selectedModel = props.modelOptions.find(
    (model) => `${model.providerId}::${model.modelId}` === props.selectedModelKey,
  );
  const hasMediaAttachment = props.pendingAttachments.some(
    (item) => item.attachment.kind === 'media',
  );
  const selectedModelSupportsImage = selectedModel?.supportsImage === true;
  const showTextOnlyImageWarning =
    hasMediaAttachment &&
    !selectedModelSupportsImage &&
    props.visionDelegationEnabled !== true;
  const thinkingModels = props.modelOptions.map((model) => ({
    key: `${model.providerId}::${model.modelId}`,
    label: model.label,
    protocol: model.protocol,
    ...(model.thinkingLevels !== undefined ? { thinkingLevels: model.thinkingLevels } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.supportsImage ? { supportsImage: true } : {}),
    ...(model.supportsImageGeneration ? { supportsImageGeneration: true } : {}),
  }));

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [caretIndex, setCaretIndex] = useState(0);

  // Slash Menu State
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashMenuForcedClosed, setSlashMenuForcedClosed] = useState(false);

  // At-Mention Menu State
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atMenuForcedClosed, setAtMenuForcedClosed] = useState(false);

  // Modal Editor State
  const [modalEditorOpen, setModalEditorOpen] = useState(false);

  // Prompt History Navigation State
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const draftBeforeHistoryRef = useRef<string>('');

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
      }),
    [
      props.menuSkills,
      props.compactionSupported,
      isStreamingRun,
      props.compacting,
      props.activeSessionId,
      props.projectTrusted,
      props.agentMode,
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
    const next = replaceActiveAtToken(props.composer, activeAtToken, item.insertValue);
    props.onComposerChange(next);
    focusCaret(activeAtToken.startIndex + item.insertValue.length);
    setAtMenuForcedClosed(true);
  }

  function triggerSend(): void {
    const trimmed = props.composer.trim();
    if (trimmed) {
      setHistoryStack((prev) => [trimmed, ...prev.filter((i) => i !== trimmed)]);
    }
    setHistoryIndex(-1);
    draftBeforeHistoryRef.current = '';
    props.onSend();
  }

  function triggerSteer(): void {
    const trimmed = props.composer.trim();
    if (trimmed) {
      setHistoryStack((prev) => [trimmed, ...prev.filter((i) => i !== trimmed)]);
    }
    setHistoryIndex(-1);
    draftBeforeHistoryRef.current = '';
    props.onSteer?.();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (isExtensionUiInput) {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onExtensionUiResolve?.({ cancelled: true });
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing &&
        !isComposingRef.current
      ) {
        event.preventDefault();
        props.onExtensionUiResolve?.({ value: extensionUiInput });
      }
      return;
    }

    if (isExtensionUiActive) {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onExtensionUiResolve?.({ cancelled: true, confirmed: false });
      }
      return;
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

    // 3. Prompt History Navigation (ArrowUp / ArrowDown when menus are closed)
    if (!slashMenuOpen && !atMenuOpen) {
      if (event.key === 'ArrowUp' && (caretIndex === 0 || props.composer === '')) {
        if (historyStack.length > 0 && historyIndex < historyStack.length - 1) {
          event.preventDefault();
          if (historyIndex === -1) {
            draftBeforeHistoryRef.current = props.composer;
          }
          const nextIndex = historyIndex + 1;
          setHistoryIndex(nextIndex);
          const historyText = historyStack[nextIndex] ?? '';
          props.onComposerChange(historyText);
          focusCaret(historyText.length);
          return;
        }
      }

      if (event.key === 'ArrowDown' && historyIndex >= 0) {
        event.preventDefault();
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        if (nextIndex === -1) {
          props.onComposerChange(draftBeforeHistoryRef.current);
          focusCaret(draftBeforeHistoryRef.current.length);
        } else {
          const historyText = historyStack[nextIndex] ?? '';
          props.onComposerChange(historyText);
          focusCaret(historyText.length);
        }
        return;
      }
    }

    // 4. ⌘Enter force send (bypasses IME protection)
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      if (hasContent) {
        if (isStreamingRun) {
          triggerSteer();
        } else {
          triggerSend();
        }
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
      if (hasContent) {
        if (isStreamingRun) {
          triggerSteer();
        } else {
          triggerSend();
        }
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
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
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
    >
      {/* Drop Zone Overlay */}
      {props.dropActive ? (
        <div className="composer-v2-drop-overlay">
          <div className="composer-v2-drop-content">
            <span className="composer-v2-drop-text">Drop files or images here to add context</span>
          </div>
        </div>
      ) : null}

      {/* Attachments row */}
      {props.docCommentsAttachment || props.pendingAttachments.length > 0 ? (
        <div className="composer-v2-attachments">
          {showTextOnlyImageWarning ? (
            <div
              className="composer-v2-vision-warning"
              data-testid="composer-text-only-image-warning"
              role="status"
            >
              <span className="composer-v2-vision-warning-text">
                当前为文本模型，不支持识图。请换「视觉」模型，或开启视觉委派。
              </span>
              {props.onOpenModelSettings ? (
                <button
                  type="button"
                  className="composer-v2-vision-warning-action"
                  onClick={props.onOpenModelSettings}
                >
                  设置
                </button>
              ) : null}
            </div>
          ) : null}
          {props.docCommentsAttachment ? (
            <div
              className="composer-v2-attachment-chip composer-v2-doc-comment-chip"
              data-testid="doc-comment-chip"
            >
              <span className="doc-comment-chip-icon" aria-hidden>
                {/walkthrough/i.test(props.docCommentsAttachment.docTitle) ? (
                  <IconBook width={14} height={14} />
                ) : (
                  <IconDocument width={14} height={14} />
                )}
              </span>
              <span className="doc-comment-chip-title">{props.docCommentsAttachment.docTitle}</span>
              <span className="doc-comment-chip-dot" aria-hidden>
                ·
              </span>
              <span className="doc-comment-chip-count">
                {props.docCommentsAttachment.commentCount}
                <IconChat width={12} height={12} className="doc-comment-chip-count-icon" />
              </span>
              {props.onRemoveDocComments ? (
                <button
                  type="button"
                  className="composer-v2-chip-remove doc-comment-chip-remove"
                  onClick={props.onRemoveDocComments}
                  aria-label="Remove comment attachment"
                >
                  <IconClose width={12} height={12} />
                </button>
              ) : null}
            </div>
          ) : null}
          {props.pendingAttachments.map((item) => (
            <div key={item.localId} className="composer-v2-attachment-chip">
              {item.attachment.kind === 'web-element' ? (
                <WebElementChip attachment={item.attachment} compact />
              ) : (
                <MediaPreview attachment={item.attachment} previewUrl={item.previewUrl} compact />
              )}
              <button
                type="button"
                className="composer-v2-chip-remove"
                onClick={() => props.onRemoveAttachment(item.localId)}
                aria-label="Remove attachment"
              >
                <IconClose width={12} height={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <ExtensionUiPrompt
        request={extensionUiRequest}
        onResolve={props.onExtensionUiResolve ?? (() => undefined)}
        onAbort={props.onExtensionUiAbort ?? (() => undefined)}
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
          onDragOver={(event) => {
            event.preventDefault();
            props.onDropActiveChange(true);
          }}
          onDragLeave={() => props.onDropActiveChange(false)}
          onDrop={(event) => props.onDrop(event)}
          onKeyDown={handleComposerKeyDown}
          readOnly={isExtensionUiActive && !isExtensionUiInput}
          placeholder={
            isExtensionUiInput
              ? extensionUiRequest?.placeholder ?? 'Type your answer'
              : isExtensionUiActive
                ? 'Choose an option above to continue'
                : agentModeDefinition.placeholder
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
                  title="Attach files, add context"
                  label="Attach files, add context"
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
              agentMode={props.agentMode}
              onSelectMode={props.onAgentModeChange}
              submenu={props.plusSubmenu}
              onSubmenu={props.onPlusSubmenuChange}
              skills={props.menuSkills}
              onOpenSkillsPanel={props.onOpenSkillsPanel}
              mcpServers={props.menuMcp}
              onOpenMcpPanel={props.onOpenMcpPanel}
              onAttachImage={props.onAttachImage}
            />
          </div>

          {/* Agent mode chip (non-default only) */}
          {props.agentMode !== 'agent' ? (
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
                aria-label={`Exit ${agentModeDefinition.label} mode`}
                onClick={() => props.onAgentModeChange('agent')}
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ) : null}
        </div>

        <div className="composer-v2-toolbar-right">
          {/* Run Mode pill (ADR 0024) */}
          {props.onRunModeChange && props.runModePreset ? (
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

          {/* Thinking effort control */}
          <ThinkingEffortControl
            disabled={isStreamingRun || !props.onThinkingLevelChange}
            modelLabel={selectedModel?.label ?? props.selectedModelLabel ?? 'Model'}
            ultraEnabled={props.ultraThinkingEnabled ?? false}
            value={props.thinkingLevel ?? 'off'}
            onChange={(level) => props.onThinkingLevelChange?.(level)}
            models={thinkingModels}
            selectedModelKey={props.selectedModelKey}
            onSelectModel={props.onSelectModel}
          />

          {/* Context usage ring */}
          <ContextUsageRing
            usage={props.contextUsage}
            {...(typeof props.modelContextWindow === 'number'
              ? { modelContextWindow: props.modelContextWindow }
              : {})}
            {...(props.onOpenModelSettings
              ? { onOpenModelSettings: props.onOpenModelSettings }
              : {})}
          />

          {/* Send / Stop Action Button */}
          {isStreamingRun ? (
            isExtensionUiActive ? (
              <button
                type="button"
                className="composer-v2-stop-btn is-running"
                data-testid="stop-btn"
                disabled={!props.activeSessionId || props.runPhase === 'aborting'}
                onClick={props.onAbort}
                aria-label={props.runPhase === 'aborting' ? 'Stopping' : 'Stop'}
                title={props.runPhase === 'aborting' ? 'Stopping…' : 'Stop'}
              >
                <span className="stop-btn-pulse" aria-hidden />
                <IconStop />
              </button>
            ) : hasContent ? (
              <button
                type="button"
                className="composer-v2-send-btn is-steer"
                data-testid="send-btn"
                disabled={!props.onSteer}
                onClick={triggerSteer}
                aria-label="Send steer message"
                title="发送 (进入队列/Steer)"
              >
                <IconSend />
              </button>
            ) : (
              <button
                type="button"
                className="composer-v2-stop-btn is-running"
                data-testid="stop-btn"
                disabled={!props.activeSessionId || props.runPhase === 'aborting'}
                onClick={props.onAbort}
                aria-label={props.runPhase === 'aborting' ? 'Stopping' : 'Stop'}
                title={props.runPhase === 'aborting' ? 'Stopping…' : 'Stop'}
              >
                <span className="stop-btn-pulse" aria-hidden />
                <IconStop />
              </button>
            )
          ) : (
            <button
              type="button"
              className="composer-v2-send-btn"
              data-testid="send-btn"
              disabled={!hasContent}
              onClick={triggerSend}
              aria-label="Send"
              title="Send (Enter)"
            >
              <IconSend />
            </button>
          )}
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
    </div>
  );
}

export function ComposerDock(props: ComposerDockProps): ReactElement {
  const hostReady = props.hostReady ?? props.hostStatus?.ready ?? true;
  const hostMode = (props.hostStatus?.mode ?? 'sdk').toUpperCase();
  const isMock = props.hostMock ?? props.hostStatus?.mock ?? false;

  const statusLabel = hostReady
    ? `Host: ${hostMode}${isMock ? ' (mock)' : ''}`
    : 'Host: Connecting...';

  const tooltipText = `Host Mode: ${hostMode}${isMock ? ' (Mock)' : ' (Live)'} | Status: ${
    hostReady ? 'Ready' : 'Connecting'
  }${props.transportLabel ? ` | Transport: ${props.transportLabel}` : ''}`;

  return (
    <footer
      className={`composer-dock layout-${props.layoutMode}`}
      data-testid="composer-dock"
      data-layout={props.layoutMode}
    >
      <ComposerCard {...props} />
      <div className="composer-footer-row">
        <button
          type="button"
          className="composer-host-status"
          data-testid="composer-host-status"
          title={tooltipText}
          aria-label={tooltipText}
          onClick={props.onOpenHostSettings}
        >
          <span className={`host-status-dot ${hostReady ? 'online' : 'offline'}`} />
          <span className="host-status-label">{statusLabel}</span>
        </button>
        <div className="composer-hint">
          ⏎ 发送 · ⇧⏎ 换行 · / 命令 · @ 提及 · ↑/↓ 历史记录 · Esc 中断
        </div>
      </div>
    </footer>
  );
}
