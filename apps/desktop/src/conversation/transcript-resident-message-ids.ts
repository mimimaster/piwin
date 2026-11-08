import { SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-ui-types.js';

/** Locate a bounded live tail and its query even when protected rows exceed the cache cap. */
export function collectTranscriptResidentMessageIds(
  messages: readonly Pick<ChatMessageUi, 'id' | 'role'>[],
): string[] {
  let userMessageId: string | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      userMessageId = message.id;
      break;
    }
  }
  const messageIds = messages
    .filter((message) => message.id !== userMessageId)
    .slice(-(SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS - 1))
    .map((message) => message.id);
  if (userMessageId !== undefined) messageIds.unshift(userMessageId);
  return messageIds;
}
