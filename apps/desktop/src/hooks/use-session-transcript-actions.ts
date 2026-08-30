import { useCallback, useRef, useState, type Dispatch } from 'react';
import type {
  SessionTranscriptWindowData,
  SessionUserMessageAnchor,
  SessionUserMessageIndexData,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
  SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS,
} from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { pushError } from '../notification-queue';
import { requestSessionTranscriptPage } from '../session-transcript-page-request';

export function useSessionTranscriptActions(input: {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
}) {
  const { hostClient, state, dispatch, dispatchNotification } = input;
  const transcriptHistoryRequestSessionId = useRef<string | null>(null);
  const historySeekRequestGeneration = useRef(0);
  const [transcriptHistoryLoading, setTranscriptHistoryLoading] = useState(false);

  const loadUserMessageIndex = useCallback(
    async (sessionId: string, epoch: number): Promise<void> => {
      const response = await hostClient.request({
        type: 'session/user-message-index',
        query: {
          sessionId,
          maximumTicks: SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS,
        },
      });
      if (!response.success) {
        return;
      }
      const index = response.data as SessionUserMessageIndexData;
      dispatch({ type: 'session/user-message-index', sessionId, epoch, index });
    },
    [dispatch, hostClient],
  );

  const handleJumpToHistoryAnchor = useCallback(
    async (anchor: SessionUserMessageAnchor): Promise<void> => {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        return;
      }
      const requestGeneration = historySeekRequestGeneration.current + 1;
      historySeekRequestGeneration.current = requestGeneration;
      const epoch = state.userMessageIndexEpoch;
      const response = await hostClient.request({
        type: 'session/transcript-window',
        query: {
          sessionId,
          anchorMessageId: anchor.messageId,
          beforeItems: SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
          afterItems: SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
          maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
        },
      });
      if (historySeekRequestGeneration.current !== requestGeneration) {
        return;
      }
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const data = response.data as SessionTranscriptWindowData;
      if (data.status === 'window') {
        dispatch({
          type: 'session/seek-messages',
          sessionId,
          epoch,
          messages: data.messages,
          window: data.window,
        });
      }
    },
    [dispatch, hostClient, state.activeSessionId, state.userMessageIndexEpoch],
  );

  const handleReturnToLiveTranscript = useCallback((): void => {
    historySeekRequestGeneration.current += 1;
    const sessionId = state.activeSessionId;
    if (sessionId) {
      dispatch({ type: 'session/return-to-live', sessionId });
    }
  }, [dispatch, state.activeSessionId]);

  const handleLoadOlderTranscript = useCallback(async (): Promise<void> => {
    const sessionId = state.activeSessionId;
    const transcriptWindow = state.transcriptWindow;
    const olderCursor = transcriptWindow?.olderCursor;
    if (
      !sessionId ||
      !transcriptWindow ||
      !olderCursor ||
      transcriptWindow.cacheLimitReached ||
      transcriptHistoryRequestSessionId.current !== null
    ) {
      return;
    }

    transcriptHistoryRequestSessionId.current = sessionId;
    setTranscriptHistoryLoading(true);
    try {
      const pageResult = await requestSessionTranscriptPage(
        (command) => hostClient.request(command),
        {
          sessionId,
          limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
          maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
          beforeCursor: olderCursor,
        },
      );
      if (!pageResult.success) {
        dispatchNotification(pushError(pageResult.error));
        return;
      }
      if (!pageResult.restartedAtTail) {
        dispatch({
          type: 'session/prepend-messages',
          sessionId,
          messages: pageResult.data.messages,
          transcriptPage: pageResult.data.page,
        });
        return;
      }

      dispatch({
        type: 'session/load-messages',
        sessionId,
        messages: pageResult.data.messages,
        transcriptPage: pageResult.data.page,
        outline: state.outline,
        preserveActiveTail: true,
      });
    } finally {
      if (transcriptHistoryRequestSessionId.current === sessionId) {
        transcriptHistoryRequestSessionId.current = null;
        setTranscriptHistoryLoading(false);
      }
    }
  }, [
    dispatch,
    dispatchNotification,
    hostClient,
    state.activeSessionId,
    state.outline,
    state.transcriptWindow,
  ]);

  return {
    transcriptHistoryLoading,
    loadUserMessageIndex,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleLoadOlderTranscript,
  };
}
