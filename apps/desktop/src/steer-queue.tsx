import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconCheck, IconChevronRight, IconClose, IconEdit, IconTrash } from './shell-icons';

export type SteerQueueMessage = {
  id: string;
  text: string;
};

export type SteerQueueProps = {
  messages: readonly SteerQueueMessage[];
  onSendNow: (messageId: string) => void | Promise<void>;
  onEdit: (messageId: string, text: string) => void;
  onRemove: (messageId: string) => void;
};

export function SteerQueue(props: SteerQueueProps): ReactElement | null {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  useEffect(() => {
    if (editingMessageId && !props.messages.some((message) => message.id === editingMessageId)) {
      setEditingMessageId(null);
      setEditingText('');
    }
  }, [editingMessageId, props.messages]);

  if (props.messages.length === 0) {
    return null;
  }

  function startEditing(message: SteerQueueMessage): void {
    setEditingMessageId(message.id);
    setEditingText(message.text);
  }

  function cancelEditing(): void {
    setEditingMessageId(null);
    setEditingText('');
  }

  function saveEditing(messageId: string): void {
    const nextText = editingText.trim();
    if (!nextText) {
      return;
    }
    props.onEdit(messageId, nextText);
    cancelEditing();
  }

  function handleEditingKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    messageId: string,
  ): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      saveEditing(messageId);
    }
  }

  return (
    <section className="steer-queue-dock" data-testid="steer-queue" aria-label="Queued messages">
      <div className="steer-queue-header">
        <div className="steer-queue-heading">
          <span className="steer-queue-title">Queued Messages</span>
          <span
            className="steer-queue-count"
            aria-label={`${props.messages.length} queued messages`}
          >
            {props.messages.length}
          </span>
          <span className="steer-queue-subtitle">Sends after agent finishes working</span>
        </div>
        <span className="steer-queue-status" aria-hidden>
          <span className="steer-queue-status-dot" />
          waiting
        </span>
      </div>

      <div className="steer-queue-list">
        {props.messages.map((message, index) => {
          const isEditing = editingMessageId === message.id;
          return (
            <div
              key={message.id}
              className="steer-queue-item"
              data-testid={`steer-queue-item-${message.id}`}
            >
              <span className="steer-queue-item-index" aria-hidden>
                {index + 1}
              </span>
              <div className="steer-queue-item-content">
                {isEditing ? (
                  <textarea
                    className="steer-queue-edit-input"
                    data-testid={`steer-queue-edit-${message.id}`}
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    onKeyDown={(event) => handleEditingKeyDown(event, message.id)}
                    rows={1}
                    autoFocus
                    aria-label="Edit queued message"
                  />
                ) : (
                  <span className="steer-queue-item-text">{message.text}</span>
                )}
              </div>
              <div className="steer-queue-item-actions">
                {isEditing ? (
                  <>
                    <IconButton
                      className="steer-queue-action is-confirm"
                      data-testid={`steer-queue-save-${message.id}`}
                      label="Save queued message"
                      title="Save"
                      onClick={() => saveEditing(message.id)}
                    >
                      <IconCheck />
                    </IconButton>
                    <IconButton
                      className="steer-queue-action"
                      data-testid={`steer-queue-cancel-${message.id}`}
                      label="Cancel editing queued message"
                      title="Cancel"
                      onClick={cancelEditing}
                    >
                      <IconClose />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton
                      className="steer-queue-action is-send-now"
                      data-testid={`steer-queue-send-${message.id}`}
                      label="Send queued message now"
                      title="Send now"
                      onClick={() => void props.onSendNow(message.id)}
                    >
                      <IconChevronRight />
                    </IconButton>
                    <IconButton
                      className="steer-queue-action"
                      data-testid={`steer-queue-edit-button-${message.id}`}
                      label="Edit queued message"
                      title="Edit"
                      onClick={() => startEditing(message)}
                    >
                      <IconEdit />
                    </IconButton>
                    <IconButton
                      className="steer-queue-action is-remove"
                      data-testid={`steer-queue-remove-${message.id}`}
                      label="Remove queued message"
                      title="Remove"
                      onClick={() => props.onRemove(message.id)}
                    >
                      <IconTrash />
                    </IconButton>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
