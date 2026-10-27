/**
 * How many readable messages arrived after the reader left the live tail.
 * Tool and system rows render inside folds, so they never count; neither do
 * empty placeholders a streaming reply starts with.
 */
export type UnseenCountMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
};

export function countUnseenTranscriptMessages(
  messages: readonly UnseenCountMessage[],
  lastSeenMessageId: string | null,
): number {
  if (lastSeenMessageId === null) return 0;
  const lastSeenIndex = messages.findIndex((message) => message.id === lastSeenMessageId);
  // The marker scrolled out of the resident window: we cannot tell what is new.
  if (lastSeenIndex < 0) return 0;
  let count = 0;
  for (let index = lastSeenIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if ((message.role === 'user' || message.role === 'assistant') && message.text.trim().length > 0) {
      count += 1;
    }
  }
  return count;
}

/** Last user message id, for telling a running turn apart from a new send. */
export function findLastUserMessageId(messages: readonly UnseenCountMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return message.id;
  }
  return null;
}
