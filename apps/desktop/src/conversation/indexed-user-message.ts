/**
 * A user message the Host's user-message index counts: one turn of the
 * session. Shared so ticks, the turn scrollbar and history paging agree on
 * the same ordinals as the Host (`role = 'user' AND trim(text) <> ''`).
 */
export function isIndexedUserMessage(message: { role: string; text: string }): boolean {
  return message.role === 'user' && message.text.trim().length > 0;
}

export function countIndexedUserMessages(
  messages: readonly { role: string; text: string }[],
): number {
  let count = 0;
  for (const message of messages) if (isIndexedUserMessage(message)) count += 1;
  return count;
}
