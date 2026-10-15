/**
 * Session handoff: Host distills the session into a summary and opens a new
 * empty session; Desktop jumps there with the summary parked as a composer
 * chip. Nothing is sent until the user writes the next instruction.
 */
import { useCallback, useRef, type Dispatch } from 'react';
import type { PromptContextRef, SessionHandoffData } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { pushError, pushInfo, pushSuccess } from '../notification-queue';
import { transcriptOwnerBlocksDangerousAction } from '../transcript-owner-guard';
import { useDesktopLocale } from '../desktop-locale-context';
import { summaryToListItem } from './session-list-item';

export type UseSessionHandoffArgs = {
  hostClient: HostClient;
  state: Pick<ChatUiState, 'activeSessionId' | 'transcriptOwnerSessionId'>;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: (action: NotificationAction) => void;
  handleResumeSession: (sessionId: string) => Promise<void>;
  seedSessionContextRefs: (sessionId: string, contextRefs: PromptContextRef[]) => void;
};

export function useSessionHandoff(args: UseSessionHandoffArgs) {
  const {
    hostClient,
    state,
    dispatch,
    dispatchNotification,
    handleResumeSession,
    seedSessionContextRefs,
  } = args;
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  // One summary per source at a time; the Host would refuse a second anyway.
  const inFlightRef = useRef(new Set<string>());

  const handleHandoffSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (
        transcriptOwnerBlocksDangerousAction({
          transcriptOwnerSessionId: state.transcriptOwnerSessionId,
          activeSessionId: state.activeSessionId,
        })
      ) {
        dispatchNotification(
          pushError(
            zh
              ? '会话记录仍在加载，请稍后再试。'
              : 'Transcript is still loading for this session — try again in a moment.',
          ),
        );
        return;
      }
      if (inFlightRef.current.has(sessionId)) return;
      inFlightRef.current.add(sessionId);
      dispatchNotification(pushInfo(zh ? '正在生成交接摘要…' : 'Writing the handoff summary…'));
      try {
        const response = await hostClient.request({ type: 'session/handoff', sessionId });
        if (!response.success) {
          dispatchNotification(pushError(response.error));
          return;
        }
        const data = response.data as SessionHandoffData;
        const listItem = summaryToListItem(data.session, data.sessionId);
        dispatch({ type: 'session/update', session: listItem });
        seedSessionContextRefs(data.sessionId, [
          { ...data.contextRef, label: zh ? '交接摘要' : 'Handoff summary' },
        ]);
        await handleResumeSession(data.sessionId);
        dispatchNotification(
          pushSuccess(
            zh
              ? '已交接到新会话，输入下一步即可继续'
              : 'Handed off — write the next step to continue',
          ),
        );
      } catch (error) {
        dispatchNotification(pushError(formatError(error)));
      } finally {
        inFlightRef.current.delete(sessionId);
      }
    },
    [
      dispatch,
      dispatchNotification,
      handleResumeSession,
      hostClient,
      seedSessionContextRefs,
      state.activeSessionId,
      state.transcriptOwnerSessionId,
      zh,
    ],
  );

  return { handleHandoffSession };
}
