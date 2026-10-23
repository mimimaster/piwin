/**
 * Linear product-transcript outline helpers for jump-scroll UI (ADR 0009).
 */
import type { SessionOutlineNode, SessionTranscriptMessage } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import { extractUserFacingBody } from '@piwin/session/derive-default-name';

const PREVIEW_MAX_CHARS = 120;

export function messageAnchorId(messageId: string): string {
  return `msg-${messageId}`;
}

export function buildOutlineFromTranscriptMessages(
  messages: readonly SessionTranscriptMessage[],
): SessionOutlineNode[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    preview: collapsePreview(
      message.role === 'user' ? extractUserFacingBody(message.text) : message.text,
    ),
    createdAt: message.createdAt,
  }));
}

export function buildOutlineFromChatMessages(
  messages: readonly ChatMessageUi[],
): SessionOutlineNode[] {
  const now = new Date().toISOString();
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      id: message.id,
      role: message.role,
      preview: collapsePreview(
        message.text ||
          (message.tools.length > 0
            ? `${message.tools.length} tool${message.tools.length === 1 ? '' : 's'}`
            : message.thinking
              ? 'Thinking…'
              : '(empty)'),
      ),
      createdAt: now,
    }));
}

export function resolveSessionOutline(options: {
  outline?: SessionOutlineNode[] | null;
  transcriptMessages?: SessionTranscriptMessage[] | null;
  chatMessages?: ChatMessageUi[] | null;
}): SessionOutlineNode[] {
  if (options.outline && options.outline.length > 0) {
    return options.outline;
  }
  if (options.transcriptMessages && options.transcriptMessages.length > 0) {
    return buildOutlineFromTranscriptMessages(options.transcriptMessages);
  }
  if (options.chatMessages && options.chatMessages.length > 0) {
    return buildOutlineFromChatMessages(options.chatMessages);
  }
  return [];
}

function collapsePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= PREVIEW_MAX_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}
