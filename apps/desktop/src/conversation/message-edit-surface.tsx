/**
 * In-transcript edit surface: the edited turn's carried attachments stay above
 * the card (proto-01), but they are now droppable — the old read-only row left
 * a pasted screenshot stuck in the resend payload with no way out.
 *
 * Mounted only while a message is being edited, so drops reset with the card
 * instead of leaking into the next edit of the same message.
 */
import { useState, type ReactElement } from 'react';
import type { PromptAttachment, PromptContextRef } from '@piwin/contracts';
import type { ComposerDockProps } from '../composer/composer-dock';
import { MessageAttachments } from './message-attachments';
import { MessageEditCard } from './chat-message-edit-card';
import type { EditResendCarry } from './conversation-branch';

export function MessageEditSurface(props: {
  messageId: string;
  initialText: string;
  attachments: readonly PromptAttachment[];
  contextRefs?: readonly PromptContextRef[] | undefined;
  composerCard?: ComposerDockProps | undefined;
  onCancel: () => void;
  onResend: (text: string, carry: EditResendCarry) => void;
  onOpenBranch?: ((text: string, carry: EditResendCarry) => void) | undefined;
  interventionEdit?: boolean | undefined;
  currentTurn?: boolean | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
}): ReactElement {
  const [droppedIds, setDroppedIds] = useState<ReadonlySet<string>>(() => new Set());
  const keptAttachments = props.attachments.filter((item) => !droppedIds.has(item.id));
  const contextRefs = props.contextRefs ?? [];
  const carry: EditResendCarry = {
    attachments: [...keptAttachments],
    contextRefs: [...contextRefs],
  };

  return (
    <>
      <MessageAttachments
        attachments={carry.attachments}
        {...(contextRefs.length > 0 ? { contextRefs } : {})}
        role="user"
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
        // Intervention edit patches a pending instruction the Host already owns;
        // dropping a chip there would be a control that changes nothing.
        {...(props.interventionEdit === true
          ? {}
          : {
              onRemoveAttachment: (attachmentId: string) =>
                setDroppedIds((current) => new Set(current).add(attachmentId)),
            })}
      />
      <MessageEditCard
        messageId={props.messageId}
        initialText={props.initialText}
        {...(props.composerCard !== undefined ? { composerCard: props.composerCard } : {})}
        hasCarryContent={carry.attachments.length > 0 || carry.contextRefs.length > 0}
        onCancel={props.onCancel}
        onResend={(text) => props.onResend(text, carry)}
        {...(props.onOpenBranch !== undefined
          ? { onOpenBranch: (text: string) => props.onOpenBranch?.(text, carry) }
          : {})}
        {...(props.interventionEdit !== undefined
          ? { interventionEdit: props.interventionEdit }
          : {})}
        {...(props.currentTurn !== undefined ? { currentTurn: props.currentTurn } : {})}
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
      />
    </>
  );
}
