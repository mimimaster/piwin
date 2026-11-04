/**
 * Walk newest-first transcript pages until Summary has enough identities.
 * Does not invent records; it only feeds `projectSessionResources`.
 */
import {
  projectSessionResources,
  SESSION_RESOURCE_MAX_PAGES,
  SESSION_RESOURCE_MESSAGE_WINDOW,
  SESSION_RESOURCES_MAX,
  type SessionTranscriptMessage,
} from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';

export async function collectSessionResourceMessages(
  sessionId: string,
  store: Pick<SessionTranscriptStore, 'listTailPage'>,
): Promise<SessionTranscriptMessage[]> {
  const pages: SessionTranscriptMessage[][] = [];
  let beforeSequence: number | undefined;
  for (let page = 0; page < SESSION_RESOURCE_MAX_PAGES; page += 1) {
    const result = await store.listTailPage(SESSION_RESOURCE_MESSAGE_WINDOW, beforeSequence);
    if (result.messages.length === 0) break;
    pages.push(result.messages);
    const chronological = flattenNewestFirstPages(pages);
    if (projectSessionResources(sessionId, chronological).length >= SESSION_RESOURCES_MAX) {
      return chronological;
    }
    if (result.nextBeforeSequence === undefined) break;
    beforeSequence = result.nextBeforeSequence;
  }
  return flattenNewestFirstPages(pages);
}

function flattenNewestFirstPages(
  pages: readonly (readonly SessionTranscriptMessage[])[],
): SessionTranscriptMessage[] {
  const messages: SessionTranscriptMessage[] = [];
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (page) messages.push(...page);
  }
  return messages;
}
