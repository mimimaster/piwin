/**
 * Session handoff: Host distills the session into a summary and opens a new
 * empty session; Desktop parks the summary as a composer chip there. Nothing
 * is sent until the user writes the next instruction.
 *
 * The summary takes tens of seconds, so the gesture returns at once: a sticky
 * toast tracks it and can cancel it, and the jump only happens when the user
 * is still looking at the source session.
 */
import { useCallback, useRef, type Dispatch } from 'react';
import type { HostResponse, PromptContextRef, SessionHandoffData } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import type { ChatUiAction, ChatUiState } from '../conversation/chat-reducer';
import type { NotificationAction } from '../notifications/notification-queue';
import { pushError, pushInfo, pushSuccess } from '../notifications/notification-queue';
import { transcriptOwnerBlocksDangerousAction } from '../conversation/transcript-owner-guard';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { hostFailureNotice } from '../host/host-problem-copy';
import { summaryToListItem } from './session-list-item';

export type UseSessionHandoffArgs = {
  hostClient: HostClient;
  state: Pick<ChatUiState, 'activeSessionId' | 'transcriptOwnerSessionId'>;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: (action: NotificationAction) => void;
  handleResumeSession: (sessionId: string) => Promise<void>;
  seedSessionContextRefs: (sessionId: string, contextRefs: PromptContextRef[]) => void;
};

export type SessionHandoffOptions = {
  /** Optional focus for the summary, e.g. "only the auth refactor". */
  instructions?: string;
};

/** True when the handoff started; false when it was refused before any request. */
export type StartSessionHandoff = (sessionId: string, options?: SessionHandoffOptions) => boolean;

/** A handed-off session opens in this long only when the user is elsewhere. */
const OPEN_HANDOFF_TOAST_TTL_MS = 10_000;

export function handoffProgressNotificationId(sessionId: string): string {
  return `session-handoff-progress-${sessionId}`;
}

function isHandoffCancelled(response: HostResponse): boolean {
  if (response.success || response.problem?.code !== 'session-handoff-refused') return false;
  const data = response.problem.data as { reason?: unknown } | undefined;
  return data?.reason === 'cancelled';
}

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
  // Read when the summary lands, which is long after this render.
  const activeSessionIdRef = useRef(state.activeSessionId);
  activeSessionIdRef.current = state.activeSessionId;

  const cancelHandoff = useCallback(
    (sessionId: string): void => {
      void hostClient
        .request({ type: 'session/compact-abort', sessionId })
        .then((response) => {
          if (!response.success) dispatchNotification(pushError(hostFailureNotice(response, locale)));
        })
        .catch((error: unknown) => dispatchNotification(pushError(formatError(error))));
    },
    [dispatchNotification, hostClient, locale],
  );

  const finishHandoff = useCallback(
    async (sourceSessionId: string, data: SessionHandoffData): Promise<void> => {
      dispatch({ type: 'session/update', session: summaryToListItem(data.session, data.sessionId) });
      // Seed before any switch: the switch restores this composer snapshot.
      seedSessionContextRefs(data.sessionId, [
        { ...data.contextRef, label: zh ? '交接摘要' : 'Handoff summary' },
      ]);
      const stillOnSource =
        activeSessionIdRef.current === sourceSessionId || activeSessionIdRef.current === null;
      if (stillOnSource) {
        await handleResumeSession(data.sessionId);
        dispatchNotification(
          pushSuccess(
            zh
              ? '已交接到新会话。摘要在输入框的「交接摘要」里，写下一步发送即可；原会话没有变化。'
              : 'Handed off. The summary rides along as the “Handoff summary” chip — write the next step and send. The source session is unchanged.',
          ),
        );
        return;
      }
      const name = data.session.name ?? data.sessionId.slice(0, 8);
      dispatchNotification({
        type: 'notify/push',
        notification: {
          level: 'success',
          message: zh ? `交接摘要已生成：「${name}」` : `Handoff ready: “${name}”`,
          ttlMs: OPEN_HANDOFF_TOAST_TTL_MS,
          action: {
            label: zh ? '打开' : 'Open',
            onClick: () => void handleResumeSession(data.sessionId),
          },
        },
      });
    },
    [dispatch, dispatchNotification, handleResumeSession, seedSessionContextRefs, zh],
  );

  const runHandoff = useCallback(
    async (sessionId: string, instructions: string | undefined): Promise<void> => {
      const progressId = handoffProgressNotificationId(sessionId);
      dispatchNotification({
        type: 'notify/push',
        notification: {
          id: progressId,
          level: 'info',
          message: zh
            ? '正在生成交接摘要，通常需要十几秒到一分钟。原会话可以继续用。'
            : 'Writing the handoff summary — usually 10–60 seconds. The source session stays usable.',
          ttlMs: 0,
          action: { label: zh ? '取消' : 'Cancel', onClick: () => cancelHandoff(sessionId) },
        },
      });
      try {
        const response = await hostClient.request({
          type: 'session/handoff',
          sessionId,
          ...(instructions ? { instructions } : {}),
        });
        dispatchNotification({ type: 'notify/dismiss', id: progressId });
        if (!response.success) {
          if (isHandoffCancelled(response)) {
            dispatchNotification(pushInfo(zh ? '已取消交接' : 'Handoff cancelled'));
            return;
          }
          const notice = hostFailureNotice(response, locale);
          if (notice) dispatchNotification(pushError(notice));
          return;
        }
        await finishHandoff(sessionId, response.data as SessionHandoffData);
      } catch (error) {
        dispatchNotification({ type: 'notify/dismiss', id: progressId });
        dispatchNotification(pushError(formatError(error)));
      }
    },
    [cancelHandoff, dispatchNotification, finishHandoff, hostClient, locale, zh],
  );

  const startHandoff = useCallback<StartSessionHandoff>(
    (sessionId, options) => {
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
        return false;
      }
      if (inFlightRef.current.has(sessionId)) {
        dispatchNotification(
          pushInfo(zh ? '这个会话的交接摘要还在生成中' : 'A handoff for this session is already running'),
        );
        return false;
      }
      inFlightRef.current.add(sessionId);
      const instructions = options?.instructions?.trim();
      void runHandoff(sessionId, instructions || undefined).finally(() => {
        inFlightRef.current.delete(sessionId);
      });
      return true;
    },
    [dispatchNotification, runHandoff, state.activeSessionId, state.transcriptOwnerSessionId, zh],
  );

  return { startHandoff };
}
