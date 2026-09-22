/**
 * Floating selection toolbar for transcript text (Add to Chat | Generate Flashcard).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { Popover, type VirtualAnchorRect } from '@piwin/ui-kit';
import {
  dispatchContextMenuAction,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu/index.js';
import {
  formatTranscriptSelectionLabel,
  visibleTextFromSelection,
  TRANSCRIPT_SELECTION_MAX_CHARS,
} from './transcript-selection-target.js';
import { IconCards, IconChat } from './shell-icons.js';
import type { DesktopLocale } from './desktop-locale.js';

export type TranscriptSelectionToolbarProps = {
  containerRef: RefObject<HTMLElement | null>;
  projectPath?: string | null | undefined;
  locale?: DesktopLocale | undefined;
};

export function getVirtualAnchorFromRange(range: Range): VirtualAnchorRect {
  return {
    getBoundingClientRect: () => {
      try {
        const rects = range.getClientRects();
        const first = rects.length > 0 && rects[0] ? rects[0] : null;
        const bounding = range.getBoundingClientRect();
        if (first && (first.width > 0 || first.height > 0)) {
          return new DOMRect(
            first.left,
            first.top,
            Math.max(1, first.width),
            Math.max(1, bounding.bottom - first.top),
          );
        }
        if (bounding.width > 0 || bounding.height > 0) {
          return bounding;
        }
        return new DOMRect(0, 0, 1, 1);
      } catch {
        return new DOMRect(0, 0, 1, 1);
      }
    },
  };
}

export function TranscriptSelectionToolbar(
  props: TranscriptSelectionToolbarProps,
): ReactElement | null {
  const contextMenu = useDesktopContextMenu();
  const [open, setOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [virtualAnchor, setVirtualAnchor] = useState<VirtualAnchorRect | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const checkSelection = useCallback((): void => {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setOpen(false);
      return;
    }

    const container = props.containerRef.current;
    if (!container) return;

    const range = sel.getRangeAt(0);
    // Ensure the range is inside the container
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      setOpen(false);
      return;
    }

    // Ignore selections within form controls or editable areas
    const targetNode = range.commonAncestorContainer;
    const targetEl = targetNode instanceof Element ? targetNode : targetNode.parentElement;
    if (targetEl?.closest('input, textarea, [contenteditable="true"]')) {
      setOpen(false);
      return;
    }

    // Ignore selections inside the toolbar itself
    if (targetEl?.closest('[data-testid="transcript-selection-toolbar"]')) {
      return;
    }

    const rawText = visibleTextFromSelection(sel);
    const trimmed = rawText.trim();
    if (!trimmed) {
      setOpen(false);
      return;
    }

    const cappedText = rawText.slice(0, TRANSCRIPT_SELECTION_MAX_CHARS);
    setSelectedText(cappedText);
    const clonedRange = typeof range.cloneRange === 'function' ? range.cloneRange() : range;
    setVirtualAnchor(getVirtualAnchorFromRange(clonedRange));
    setOpen(true);
  }, [props.containerRef]);

  useEffect(() => {
    const handleMouseUp = (event: globalThis.MouseEvent): void => {
      // If clicking inside the toolbar, don't dismiss or reset
      if (toolbarRef.current?.contains(event.target as Node)) {
        return;
      }
      checkSelection();
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Shift' || event.key.startsWith('Arrow')) {
        checkSelection();
      }
    };

    const handleDismiss = (): void => {
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('contextmenu', handleDismiss);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('contextmenu', handleDismiss);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [checkSelection]);

  if (!contextMenu) {
    return null;
  }

  const locale = props.locale ?? contextMenu.caps.locale ?? 'zh-CN';
  const isZh = locale === 'zh-CN';
  const addToChatLabel = isZh ? '添加到对话' : 'Add to Chat';
  const generateFlashcardLabel = isZh ? '生成闪卡' : 'Generate flashcard';
  const canSendPreset = contextMenu.caps.canSendPreset;
  const disabledHint = isZh ? '会话未就绪' : 'requires an active chat';

  const handleAddToChat = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedText) return;

    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText,
      label: formatTranscriptSelectionLabel(selectedText),
      ...(props.projectPath ? { projectPath: props.projectPath } : {}),
    };

    dispatchContextMenuAction('add-to-chat', target, contextMenu.dispatchers);
    contextMenu.dispatchers.focusComposer();
    setOpen(false);
    if (typeof window !== 'undefined' && window.getSelection) {
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleGenerateFlashcard = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedText || !canSendPreset) return;

    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText,
      label: formatTranscriptSelectionLabel(selectedText),
      ...(props.projectPath ? { projectPath: props.projectPath } : {}),
    };

    dispatchContextMenuAction('generate-flashcard', target, contextMenu.dispatchers);
    setOpen(false);
    if (typeof window !== 'undefined' && window.getSelection) {
      window.getSelection()?.removeAllRanges();
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      {...(virtualAnchor ? { virtualAnchor } : {})}
      side="top"
      align="start"
      contentClassName="transcript-selection-toolbar"
      testId="transcript-selection-toolbar"
      label="Selection actions"
      autoFocus={false}
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <div
        ref={toolbarRef}
        className="selection-toolbar-inner"
        onMouseDown={(e) => {
          // Prevent losing window text selection while clicking buttons
          e.preventDefault();
        }}
      >
        <button
          type="button"
          className="selection-toolbar-btn"
          data-testid="selection-toolbar-add-to-chat"
          onClick={handleAddToChat}
        >
          <span className="selection-toolbar-btn-icon" aria-hidden="true">
            <IconChat width={13} height={13} />
          </span>
          <span>{addToChatLabel}</span>
        </button>
        <span className="selection-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="selection-toolbar-btn"
          data-testid="selection-toolbar-generate-flashcard"
          disabled={!canSendPreset}
          title={!canSendPreset ? disabledHint : undefined}
          onClick={handleGenerateFlashcard}
        >
          <span className="selection-toolbar-btn-icon" aria-hidden="true">
            <IconCards width={13} height={13} />
          </span>
          <span>{generateFlashcardLabel}</span>
        </button>
      </div>
    </Popover>
  );
}
