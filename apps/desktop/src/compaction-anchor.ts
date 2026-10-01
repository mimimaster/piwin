/**
 * Where a compaction seam belongs in the transcript.
 *
 * The seam is drawn right after its anchor message, so everything the agent
 * produces after compaction lands below it. A run that has just started owns
 * an empty streaming assistant placeholder; that row is the one the
 * post-compaction reply fills in. Anchoring to it would put the seam under the
 * reply and wall off the chain the reply starts, so empty assistant rows are
 * skipped and the seam anchors to the last message that already has content.
 */
import { isAssistantContentEmpty } from './assistant-message-content.js';
import type { ChatMessageUi } from './chat-reducer.js';

export function resolveCompactionAnchorMessageId(
  messages: readonly ChatMessageUi[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && !isAssistantContentEmpty(message)) {
      return message.id;
    }
  }
  return null;
}
