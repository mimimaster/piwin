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
  SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS,
  SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS,
} from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import type { ChatUiAction, ChatUiState } from '../chat-reducer.js';
import type { NotificationAction } from '../notification-queue.js';
import { pushError } from '../notification-queue.js';
import { requestSessionTranscriptPage } from '../session-transcript-page-request.js';

export function useSessionTranscriptActions(input: {
  hostClient: Pick<HostClient, 'request'>;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
}) {
  const { hostClient, state, dispatch, dispatchNotification } = input;
  const historySeekRequestGeneration = useRef(0);
  const historyRequestRef = useRef<object | null>(null);
  const [transcriptHistoryLoading, setTranscriptHistoryLoading] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadUserMessageIndex = useCallback(
    async (sessionId: string, epoch: number): Promise<void> => {
      try {
        const response = await hostClient.request({
          type: 'session/user-message-index',
          query: {
            sessionId,
            maximumTicks: SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS,
          },
        });
        if (!response.success) {
          dispatchNotification(pushError(response.error));
          return;
        }
        dispatch({
          type: 'session/user-message-index',
          sessionId,
          epoch,
          index: response.data as SessionUserMessageIndexData,
        });
      } catch (error) {
        dispatchNotification(pushError(error instanceof Error ? error.message : String(error)));
      }
    },
    [dispatch, dispatchNotification, hostClient],
  );

  const handleJumpToHistoryAnchor = useCallback(
    async (anchor: SessionUserMessageAnchor): Promise<void> => {
      const sessionId = state.activeSessionId;
      if (!sessionId) return;
      const requestGeneration = ++historySeekRequestGeneration.current;
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
      if (historySeekRequestGeneration.current !== requestGeneration) return;
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const data = response.data as SessionTranscriptWindowData;
      if (data.status === 'window')
        dispatch({
          type: 'session/seek-messages',
          sessionId,
          epoch,
          messages: data.messages,
          window: data.window,
        });
    },
    [
      dispatch,
      dispatchNotification,
      hostClient,
      state.activeSessionId,
      state.userMessageIndexEpoch,
    ],
  );

  const handleReturnToLiveTranscript = useCallback((): void => {
    historySeekRequestGeneration.current += 1;
    if (state.activeSessionId)
      dispatch({ type: 'session/return-to-live', sessionId: state.activeSessionId });
  }, [dispatch, state.activeSessionId]);

  const loadHistoryPage = useCallback(
    async (direction: 'older' | 'newer', keepMessageId?: string): Promise<void> => {
      const sessionId = state.activeSessionId;
      if (!sessionId || historyRequestRef.current) return;
      const requestToken = {};
      historyRequestRef.current = requestToken;
      const generation = historySeekRequestGeneration.current;
      const epoch = state.userMessageIndexEpoch;
      const isCurrent = () =>
        historySeekRequestGeneration.current === generation &&
        stateRef.current.activeSessionId === sessionId &&
        stateRef.current.userMessageIndexEpoch === epoch;
      setTranscriptHistoryLoading(true);
      try {
        const tailWindow = state.transcriptWindow;
        if (
          direction === 'older' &&
          !state.historyView &&
          !tailWindow?.cacheLimitReached &&
          tailWindow?.olderCursor
        ) {
          const result = await requestSessionTranscriptPage(
            (command) => hostClient.request(command),
            {
              sessionId,
              limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
              maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
              beforeCursor: tailWindow.olderCursor,
            },
          );
          if (!isCurrent()) return;
          if (!result.success) {
            dispatchNotification(pushError(result.error));
            return;
          }
          dispatch(
            result.restartedAtTail
              ? {
                  type: 'session/load-messages',
                  sessionId,
                  messages: result.data.messages,
                  transcriptPage: result.data.page,
                  outline: state.outline,
                  preserveActiveTail: true,
                }
              : {
                  type: 'session/prepend-messages',
                  sessionId,
                  messages: result.data.messages,
                  transcriptPage: result.data.page,
                },
          );
          return;
        }
        const messages = state.historyView?.messages ?? state.messages;
        const boundary = direction === 'older' ? messages[0] : messages.at(-1);
        if (!boundary) return;
        const response = await hostClient.request({
          type: 'session/transcript-window',
          query: {
            sessionId,
            anchorMessageId: boundary.id,
            beforeItems: direction === 'older' ? SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS - 1 : 0,
            afterItems: direction === 'newer' ? SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS - 1 : 0,
            maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
          },
        });
        if (!isCurrent()) return;
        if (!response.success) {
          dispatchNotification(pushError(response.error));
          return;
        }
        const data = response.data as SessionTranscriptWindowData;
        if (data.status === 'window')
          dispatch({
            type: 'session/page-history',
            sessionId,
            epoch,
            direction,
            messages: data.messages,
            window: data.window,
            ...(keepMessageId !== undefined ? { keepMessageId } : {}),
          });
      } catch (error) {
        dispatchNotification(pushError(error instanceof Error ? error.message : String(error)));
      } finally {
        if (historyRequestRef.current === requestToken) {
          historyRequestRef.current = null;
          setTranscriptHistoryLoading(false);
        }
      }
    },
    [
      state.activeSessionId,
      state.historyView,
      state.messages,
      state.outline,
      state.transcriptWindow,
      state.userMessageIndexEpoch,
      hostClient,
      dispatch,
      dispatchNotification,
    ],
  );

  const handleLoadOlderTranscript = useCallback(
    (keepMessageId?: string) => loadHistoryPage('older', keepMessageId),
    [loadHistoryPage],
  );
  const handleLoadNewerTranscript = useCallback(
    (keepMessageId?: string) => loadHistoryPage('newer', keepMessageId),
    [loadHistoryPage],
  );
  return {
    transcriptHistoryLoading,
    loadUserMessageIndex,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleLoadOlderTranscript,
    handleLoadNewerTranscript,
  };
}
