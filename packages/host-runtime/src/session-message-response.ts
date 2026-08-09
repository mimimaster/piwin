import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  type SessionMessageProjection,
  type SessionTranscriptMessage,
  type SessionTranscriptPageInfo,
} from '@piwin/contracts';
import { createSessionTranscriptPage } from '@piwin/session';

export type SessionMessageResponseProjection = {
  messages?: SessionTranscriptMessage[];
  transcriptPage?: SessionTranscriptPageInfo;
};

/** Preserve legacy full responses while allowing page-aware shells to opt out. */
export function createSessionMessageResponse(
  sessionId: string,
  messages: readonly SessionTranscriptMessage[],
  projection: SessionMessageProjection | undefined,
): SessionMessageResponseProjection {
  if (projection === 'none') return {};
  if (projection !== 'tail') return { messages: [...messages] };
  const page = createSessionTranscriptPage(messages, {
    sessionId,
    limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
    maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  });
  if (page.status !== 'page') {
    throw new Error('Cursorless transcript mutation projection unexpectedly returned stale');
  }
  return { messages: page.messages, transcriptPage: page.page };
}
