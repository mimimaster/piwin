/**
 * In-place composer for editing a user message.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ComposerCard, type ComposerDockProps } from './composer-dock';
import { useDesktopLocale } from './desktop-locale-context';
import type { ComposerPlusSubmenu } from './composer-plus-menu';
import type { PendingComposerAttachment } from './media-utils';

export type MessageEditCardProps = {
  messageId: string;
  initialText: string;
  composerCard: ComposerDockProps;
  onCancel: () => void;
  onResend: (text: string) => void;
  interventionEdit?: boolean;
  /** Original turn still has media/refs shown read-only above this card. */
  hasCarryContent?: boolean;
  /** Unchanged send on the current user turn is a retry (ADR 0064). */
  currentTurn?: boolean;
};

export function MessageEditCard(props: MessageEditCardProps): ReactElement {
  const { locale } = useDesktopLocale();
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

  function handleRemoveAttachment(localId: string): void {
    setPendingAttachments((prev) => prev.filter((item) => item.localId !== localId));
  }

  const unchanged = editText.trim() === props.initialText.trim();
  const sendAsRetry = props.currentTurn !== false && unchanged;
  const sendAriaLabel =
    locale === 'en'
      ? sendAsRetry
        ? 'Retry'
        : 'Send new version'
      : sendAsRetry
        ? '重试'
        : '发送新版本';

  return (
    <div ref={cardRef} className="message-edit-card-v2" data-testid="message-edit-box">
      <ComposerCard
        {...props.composerCard}
        sendAriaLabel={sendAriaLabel}
        layoutMode="docked"
        composer={editText}
        onComposerChange={setEditText}
        agentMode={props.composerCard.agentMode}
        onAgentModeChange={props.composerCard.onAgentModeChange}
        streaming={props.interventionEdit === true ? false : props.composerCard.streaming}
        runPhase={props.interventionEdit === true ? 'idle' : props.composerCard.runPhase}
        compacting={props.composerCard.compacting}
        pendingAttachments={pendingAttachments}
        onRemoveAttachment={handleRemoveAttachment}
        {...(props.hasCarryContent === true ? { hasCarryContent: true } : {})}
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
