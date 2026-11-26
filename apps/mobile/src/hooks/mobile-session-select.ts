import type { Dispatch, SetStateAction } from 'react';
import {
  initialForegroundRunState,
  type ForegroundRunState,
  type HostClient,
} from '@piwin/host-client';
import { toError } from '../mobile-host-helpers.js';
import { readPauseCheckpointId } from '../mobile-host-readers.js';
import {
  readSessionMessages,
  type MobileMediaAttachment,
  type MobileTranscriptMessage,
  type RemotePermissionRequest,
} from '../mobile-transcript.js';

export type MobileSessionSelectionContext = {
  clientRef: { current: HostClient | undefined };
  activeSessionRef: { current: string | undefined };
  selectionGenerationRef: { current: number };
  setActiveSessionId: Dispatch<SetStateAction<string | undefined>>;
  setPausedCheckpointId: Dispatch<SetStateAction<string | undefined>>;
  setPermissionRequest: Dispatch<SetStateAction<RemotePermissionRequest | undefined>>;
  setAttachments: Dispatch<SetStateAction<MobileMediaAttachment[]>>;
  setErrorMessage: Dispatch<SetStateAction<string | undefined>>;
  setPendingReplaceRunId: Dispatch<SetStateAction<string | undefined>>;
  setMessages: Dispatch<SetStateAction<MobileTranscriptMessage[]>>;
  setForeground: Dispatch<SetStateAction<ForegroundRunState>>;
  beginSessionForeground: (
    client: HostClient,
    sessionId: string,
    expectedGeneration?: number,
  ) => Promise<void>;
};

/** Resume or hydrate the selected session's transcript in place. */
export async function selectMobileSession(
  ctx: MobileSessionSelectionContext,
  sessionId: string,
): Promise<void> {
  const client = ctx.clientRef.current;
  if (client === undefined) {
    return;
  }
  const generation = ctx.selectionGenerationRef.current + 1;
  ctx.selectionGenerationRef.current = generation;
  ctx.activeSessionRef.current = sessionId;
  ctx.setActiveSessionId(sessionId);
  ctx.setPausedCheckpointId(undefined);
  ctx.setPermissionRequest(undefined);
  ctx.setAttachments([]);
  ctx.setErrorMessage(undefined);
  ctx.setPendingReplaceRunId(undefined);
  // A selection change invalidates the previous foreground run immediately;
  // the new Host snapshot will install its own run after hydration.
  ctx.setForeground(initialForegroundRunState());
  const stillCurrent = (): boolean =>
    ctx.clientRef.current === client &&
    ctx.activeSessionRef.current === sessionId &&
    ctx.selectionGenerationRef.current === generation;
  try {
    const resumeResponse = await client.request({ type: 'session/resume', sessionId });
    if (!stillCurrent()) {
      return;
    }
    if (resumeResponse.success) {
      ctx.setMessages(readSessionMessages(resumeResponse));
      ctx.setPausedCheckpointId(readPauseCheckpointId(resumeResponse.data));
      await ctx.beginSessionForeground(client, sessionId, generation);
      return;
    }
    const messagesResponse = await client.request({ type: 'session/messages', sessionId });
    if (!stillCurrent()) {
      return;
    }
    ctx.setMessages(readSessionMessages(messagesResponse));
    await ctx.beginSessionForeground(client, sessionId, generation);
  } catch (error) {
    if (stillCurrent()) {
      ctx.setErrorMessage(toError(error, '读取会话消息失败。').message);
    }
  }
}
