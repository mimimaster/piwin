import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  type SessionTranscriptMessage,
  type SessionTranscriptPageInfo,
} from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import type { ChatMessageUi } from '../conversation/chat-ui-types.js';
import { collectTranscriptResidentMessageIds } from '../conversation/transcript-resident-message-ids.js';
import { requestSessionTranscriptPage } from './session-transcript-page-request.js';

type RecoveryTranscript = {
  messages?: SessionTranscriptMessage[];
  transcriptPage?: SessionTranscriptPageInfo;
};

/** Recover bounded Host order as well as content; retain the legacy Host bridge. */
export async function requestSessionRecoveryTranscript(
  hostClient: HostClient,
  sessionId: string,
  residentMessages: readonly Pick<ChatMessageUi, 'id' | 'role'>[],
): Promise<RecoveryTranscript | undefined> {
  if (hostClient.supportsCommand?.('session/transcript-page') === false) {
    const response = await hostClient.request({ type: 'session/messages', sessionId });
    return response.success ? (response.data as RecoveryTranscript) : undefined;
  }
  const result = await requestSessionTranscriptPage((command) => hostClient.request(command), {
    sessionId,
    limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
    maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
    locateMessageIds: collectTranscriptResidentMessageIds(residentMessages),
  });
  return result.success
    ? { messages: result.data.messages, transcriptPage: result.data.page }
    : undefined;
}
