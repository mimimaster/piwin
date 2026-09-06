/**
 * In-place composer for editing a user message per docs/design/inkstone/proto-01-transcript.html.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import type { ComposerDockProps } from './composer-dock';

export type MessageEditCardProps = {
  messageId: string;
  initialText: string;
  composerCard?: ComposerDockProps | undefined;
  onCancel: () => void;
  onResend: (text: string) => void;
  interventionEdit?: boolean | undefined;
  /** Original turn still has media/refs shown read-only above this card. */
  hasCarryContent?: boolean | undefined;
  /** Unchanged send on the current user turn is a retry (ADR 0064). */
  currentTurn?: boolean | undefined;
  branchPoint?: TranscriptBranchPoint | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
};

export function MessageEditCard(props: MessageEditCardProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const locale = props.locale ?? contextLocale;
  const isChinese = locale !== 'en';

  const [editText, setEditTextState] = useState(props.initialText);
  const editTextRef = useRef(props.initialText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  function setEditText(value: string): void {
    setEditTextState(value);
    editTextRef.current = value;
  }

  // Focus textarea on mount and position cursor at the end.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const length = textarea.value.length;
    textarea.setSelectionRange(length, length);
  }, []);

  // Auto-resize textarea height to fit content.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(74, textarea.scrollHeight)}px`;
  }, [editText]);

  // Click outside the edit card collapses back to the plain message bubble.
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

  // Escape cancels, unless a popover/menu already consumed it.
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
    if (text || props.hasCarryContent === true) {
      props.onResend(text);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onCancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  }

  const unchanged = editText.trim() === props.initialText.trim();
  const sendAsRetry = props.currentTurn !== false && unchanged && !props.interventionEdit;
  const canSend = Boolean(editText.trim()) || props.hasCarryContent === true;

  const sendAriaLabel = isChinese
    ? sendAsRetry
      ? '重试'
      : '发送新版本'
    : sendAsRetry
      ? 'Retry'
      : 'Send new version';

  const sendButtonLabel = props.interventionEdit
    ? isChinese
      ? '保存调整'
      : 'Save adjustment'
    : sendAriaLabel;

  const cancelLabel = isChinese ? '取消' : 'Cancel';

  let branchHint: string | null = null;
  if (!props.interventionEdit && !sendAsRetry) {
    if (props.branchPoint) {
      const total = props.branchPoint.siblings.length + 1;
      branchHint = isChinese ? `将作为分支 ${total} / ${total}` : `Will branch as ${total} / ${total}`;
    } else if (props.currentTurn === false || !unchanged) {
      branchHint = isChinese ? '将作为分支 2 / 2' : 'Will branch as 2 / 2';
    }
  }

  const hints = [
    sendAsRetry
      ? (isChinese ? 'Enter 重试' : 'Enter to retry')
      : (isChinese ? 'Enter 发送新版本' : 'Enter to send new version'),
    isChinese ? '⇧Enter 换行' : '⇧Enter newline',
    isChinese ? 'Esc 取消' : 'Esc to cancel',
  ];
  if (branchHint) {
    hints.push(branchHint);
  }

  return (
    <div
      ref={cardRef}
      className="ucard edit message-edit-card-v2"
      data-testid="message-edit-box"
    >
      <textarea
        ref={textareaRef}
        rows={3}
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="message-edit-textarea"
      />
      <div className="efoot">
        <span>{hints.join(' · ')}</span>
        <span className="acts ml">
          <button
            type="button"
            className="btn sm"
            onClick={props.onCancel}
            data-testid="cancel-edit-btn"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn sm pri"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={sendAriaLabel}
            data-testid="send-btn"
          >
            {sendButtonLabel}
          </button>
        </span>
      </div>
    </div>
  );
}
