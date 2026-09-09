/**
 * Queued follow-up turns, stacked as a lid on top of the composer card.
 *
 * The rows are a read-only preview: editing happens in the composer input
 * below, so a queued turn can gain or lose images the same way a new prompt
 * does. A row being edited only offers the exit back out of that edit.
 */
import { useState, type ReactElement } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconArrowUp, IconClose, IconEdit, IconImage, IconTrash } from './shell-icons';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import type { SteerQueueMessage } from './steer-queue-model';

export type { SteerQueueMessage } from './steer-queue-model';

export type SteerQueueProps = {
  messages: readonly SteerQueueMessage[];
  onSendNow: (messageId: string) => void | Promise<void>;
  /** Load this row into the composer input. */
  onEdit: (messageId: string) => void;
  onRemove: (messageId: string) => void;
  /** Row currently held by the composer input, if any. */
  editingMessageId?: string | null | undefined;
  onCancelEdit?: (() => void) | undefined;
};

export function SteerQueue(props: SteerQueueProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).composer;

  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(new Set());

  async function sendNow(messageId: string): Promise<void> {
    if (submitting.has(messageId)) return;
    setSubmitting((current) => new Set(current).add(messageId));
    try {
      await props.onSendNow(messageId);
    } finally {
      setSubmitting((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
    }
  }

  if (props.messages.length === 0) {
    return null;
  }

  return (
    <section
      className="steer-queue-dock"
      data-testid="steer-queue"
      aria-label={copy.queuedMessagesLabel}
    >
      <div className="steer-queue-header">
        <div className="steer-queue-heading">
          <span className="steer-queue-title">{copy.queuedTitle}</span>
          <span className="steer-queue-count" aria-label={copy.queuedCount(props.messages.length)}>
            {props.messages.length}
          </span>
        </div>
        <span className="steer-queue-subtitle">{copy.queuedHint}</span>
      </div>

      <ol className="steer-queue-list">
        {props.messages.map((message, index) => {
          const isEditing = props.editingMessageId === message.id;
          const isSubmitting = submitting.has(message.id);
          const attachmentCount = message.attachmentCount ?? 0;
          return (
            <li
              key={message.id}
              className={`steer-queue-item${isEditing ? ' is-editing' : ''}`}
              data-testid={`steer-queue-item-${message.id}`}
              {...(isEditing ? { 'aria-current': 'true' as const } : {})}
            >
              <span className="steer-queue-position" aria-hidden>
                {index + 1}
              </span>
              <button
                type="button"
                className="steer-queue-item-content"
                data-testid={`steer-queue-open-${message.id}`}
                disabled={isEditing || isSubmitting}
                title={isEditing ? undefined : copy.editQueuedMessageHint}
                onClick={() => props.onEdit(message.id)}
              >
                <span className={`steer-queue-item-text${message.text.trim() ? '' : ' is-empty'}`}>
                  {message.text.trim() || copy.queuedMediaOnly}
                </span>
                {attachmentCount > 0 ? (
                  <span
                    className="steer-queue-item-attachments"
                    data-testid={`steer-queue-attachments-${message.id}`}
                    title={copy.queuedAttachments(attachmentCount)}
                  >
                    <IconImage width={12} height={12} />
                    {attachmentCount}
                  </span>
                ) : null}
              </button>
              <div className="steer-queue-item-actions">
                {isEditing ? (
                  <>
                    <span className="steer-queue-editing-pill">{copy.queuedEditingBadge}</span>
                    <IconButton
                      className="steer-queue-action"
                      data-testid={`steer-queue-cancel-${message.id}`}
                      label={copy.cancelQueuedEdit}
                      title={copy.cancelQueuedEdit}
                      onClick={() => props.onCancelEdit?.()}
                    >
                      <IconClose />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton
                      className="steer-queue-action"
                      data-testid={`steer-queue-edit-button-${message.id}`}
                      label={copy.editQueuedMessage}
                      disabled={isSubmitting}
                      title={copy.editQueuedMessageHint}
                      onClick={() => props.onEdit(message.id)}
                    >
                      <IconEdit />
                    </IconButton>
                    <IconButton
                      className="steer-queue-action is-send-now"
                      data-testid={`steer-queue-send-${message.id}`}
                      label={copy.steerQueuedMessage}
                      title={copy.steerQueuedMessage}
                      disabled={isSubmitting}
                      aria-busy={isSubmitting}
                      onClick={() => void sendNow(message.id)}
                    >
                      <IconArrowUp />
                    </IconButton>
                    <IconButton
                      className="steer-queue-action is-remove"
                      data-testid={`steer-queue-remove-${message.id}`}
                      label={copy.removeQueuedMessage}
                      disabled={isSubmitting}
                      title={copy.removeQueuedMessage}
                      onClick={() => props.onRemove(message.id)}
                    >
                      <IconTrash />
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
