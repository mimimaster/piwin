import { useCallback } from 'react';
import type {
  ExecutionRunRecord,
  PermissionDecision,
  PermissionRememberScope,
  SessionPauseAcceptedData,
  SessionResumeRunAcceptedData,
} from '@piwin/contracts';
import { formatError, isPauseContinueUtterance } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { Dispatch } from 'react';
import type { NotificationAction } from '../notification-queue';
import { pushError, pushInfo } from '../notification-queue';
import { shouldBlockRemoteHostGesture } from '../host-reconnect-gate.js';
import { desktopForegroundMutationsEnabled } from '../foreground-admission.js';
import { hostFailureNotice, hostReconnectNotice } from '../host-problem-copy.js';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { compactFailureMessage } from './session-actions-helpers.js';

export function useSessionRunActions(input: {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  locale: import('../desktop-locale.js').DesktopLocale;
}) {
  const { hostClient, state, dispatch, dispatchNotification, locale } = input;

  const handlePause = useCallback(async (): Promise<void> => {
    const sessionId = state.activeSessionId;
    if (
      !sessionId ||
      state.runPhase === 'pausing' ||
      state.runPhase === 'aborting' ||
      (state.activeRunId === null && !state.streaming)
    ) {
      return;
    }
    if (!desktopForegroundMutationsEnabled(state)) {
      return;
    }
    if (shouldBlockRemoteHostGesture(hostClient)) {
      dispatchNotification(pushInfo(hostReconnectNotice(locale)));
      return;
    }

    dispatch({ type: 'run/pausing' });
    try {
      let runId = state.activeRunId;
      if (runId === null) {
        const foregroundResponse = await hostClient.request({
          type: 'session/foreground-run',
          sessionId,
        });
        if (!foregroundResponse.success) {
          dispatch({ type: 'run/pause-failed' });
          dispatchNotification(pushError(hostFailureNotice(foregroundResponse, locale)));
          return;
        }
        const foregroundRun = (
          foregroundResponse.data as { run?: ExecutionRunRecord | null } | undefined
        )?.run;
        if (!foregroundRun) {
          dispatch({ type: 'run/stale-clear', sessionId });
          return;
        }
        runId = foregroundRun.runId;
      }

      const response = await hostClient.request(
        { type: 'session/pause', sessionId, runId },
        { idempotencyKey: createGestureIdempotencyKey() },
      );
      if (!response.success) {
        dispatch({ type: 'run/pause-failed' });
        dispatchNotification(pushError(hostFailureNotice(response, locale)));
        return;
      }
      const data = response.data as SessionPauseAcceptedData | undefined;
      if (data?.reason === 'run-mismatch') {
        dispatch({ type: 'run/pause-failed' });
        dispatchNotification(
          pushError(
            locale === 'zh-CN'
              ? '暂停失败：当前运行已经变化，请重试。'
              : 'Pause failed because the active run changed. Try again.',
          ),
        );
        return;
      }
      if (data?.reason === 'no-active-run') {
        dispatch({ type: 'run/stale-clear', sessionId });
        return;
      }
      if (data?.state !== 'pausing' && data?.state !== 'paused') {
        dispatch({ type: 'run/pause-failed' });
        dispatchNotification(
          pushError(
            locale === 'zh-CN'
              ? 'Host 未确认暂停请求，请重试。'
              : 'The Host did not confirm the pause request. Try again.',
          ),
        );
      }
    } catch (error) {
      dispatch({ type: 'run/pause-failed' });
      dispatchNotification(pushError(formatError(error)));
    }
  }, [
    dispatch,
    dispatchNotification,
    hostClient,
    locale,
    state.activeRunId,
    state.activeSessionId,
    state.foregroundAdmission,
    state.runPhase,
    state.streaming,
  ]);

  const handleResumeRun = useCallback(async (continuationText?: string): Promise<void> => {
    const sessionId = state.activeSessionId;
    if (!sessionId || state.runTerminal.kind !== 'paused' || state.runPhase !== 'idle') {
      return;
    }
    if (!desktopForegroundMutationsEnabled(state)) {
      return;
    }
    if (shouldBlockRemoteHostGesture(hostClient)) {
      dispatchNotification(pushInfo(hostReconnectNotice(locale)));
      return;
    }
    const extra =
      continuationText !== undefined && !isPauseContinueUtterance(continuationText)
        ? continuationText.trim()
        : undefined;
    try {
      const response = await hostClient.request(
        {
          type: 'session/resume-run',
          sessionId,
          ...(state.runTerminal.checkpointId
            ? { checkpointId: state.runTerminal.checkpointId }
            : {}),
          ...(extra !== undefined ? { text: extra } : {}),
        },
        { idempotencyKey: createGestureIdempotencyKey() },
      );
      if (!response.success) {
        dispatchNotification(pushError(hostFailureNotice(response, locale)));
        return;
      }
      const data = response.data as SessionResumeRunAcceptedData | undefined;
      if (!data?.runId) {
        dispatchNotification(
          pushError(
            locale === 'zh-CN'
              ? 'Host 未确认继续运行，请重试。'
              : 'The Host did not confirm the resumed run. Try again.',
          ),
        );
        return;
      }
      dispatch({ type: 'run/accepted', runId: data.runId, acceptedAt: data.acceptedAt });
    } catch (error) {
      dispatchNotification(pushError(formatError(error)));
    }
  }, [
    dispatch,
    dispatchNotification,
    hostClient,
    locale,
    state.activeSessionId,
    state.foregroundAdmission,
    state.runPhase,
    state.runTerminal,
  ]);

  const handleAbort = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId || state.runPhase === 'pausing' || state.runPhase === 'aborting') {
      return;
    }
    if (!desktopForegroundMutationsEnabled(state)) {
      return;
    }
    if (shouldBlockRemoteHostGesture(hostClient)) {
      dispatchNotification(pushInfo(hostReconnectNotice(locale)));
      return;
    }
    const live = state.activeRunId !== null || state.streaming;
    if (!live && state.runTerminal.kind === 'paused') {
      return;
    }
    if (live) {
      dispatch({ type: 'run/aborting' });
    }
    const response = await hostClient.request(
      {
        type: 'session/abort',
        sessionId: state.activeSessionId,
        ...(state.activeRunId ? { runId: state.activeRunId } : {}),
      },
      { idempotencyKey: createGestureIdempotencyKey() },
    );
    if (!response.success) {
      if (live) {
        dispatch({ type: 'run/abort-failed' });
      }
      dispatchNotification(pushError(hostFailureNotice(response, locale)));
      return;
    }
    const data = response.data as { cancelled?: boolean } | undefined;
    if (data?.cancelled === true) {
      return;
    }
    if (live) {
      dispatch({ type: 'run/stale-clear', sessionId: state.activeSessionId });
    } else {
      dispatch({ type: 'run/terminal-dismiss' });
    }
  }, [
    dispatch,
    dispatchNotification,
    hostClient,
    locale,
    state.activeRunId,
    state.activeSessionId,
    state.foregroundAdmission,
    state.runPhase,
    state.runTerminal,
    state.streaming,
  ]);

  const handleCompact = useCallback(
    async (customInstructions?: string): Promise<boolean> => {
      if (!state.activeSessionId) {
        dispatchNotification(
          pushError(
            locale === 'zh-CN'
              ? '先选一个会话再压缩上下文。'
              : 'Select a session before compacting.',
          ),
        );
        return false;
      }
      if (state.compacting) {
        dispatchNotification(
          pushInfo(locale === 'zh-CN' ? '正在压缩上下文。' : 'Compaction already running.'),
        );
        return false;
      }
      if (state.streaming) {
        dispatchNotification(
          pushError(
            locale === 'zh-CN'
              ? '当前回合还在跑。等它结束，或先 /stop 再 /compact。'
              : 'A run is still in progress. Wait for it to finish, or /stop then /compact.',
          ),
        );
        return false;
      }
      const payload: {
        type: 'session/compact';
        sessionId: string;
        customInstructions?: string;
      } = {
        type: 'session/compact',
        sessionId: state.activeSessionId,
      };
      if (customInstructions && customInstructions.trim().length > 0) {
        payload.customInstructions = customInstructions.trim();
      }
      try {
        const response = await hostClient.request(payload);
        if (!response.success) {
          dispatchNotification(pushError(compactFailureMessage(response.error, locale)));
          return false;
        }
        const data = response.data as { ok?: boolean; message?: string } | undefined;
        if (data?.ok === false) {
          dispatchNotification(
            pushError(compactFailureMessage(data.message ?? 'Compaction failed', locale)),
          );
          return false;
        }
        return true;
      } catch (error) {
        dispatchNotification(pushError(compactFailureMessage(formatError(error), locale)));
        return false;
      }
    },
    [
      dispatchNotification,
      hostClient,
      locale,
      state.activeSessionId,
      state.compacting,
      state.streaming,
    ],
  );

  const handleCompactAbort = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId) {
      return;
    }
    const response = await hostClient.request({
      type: 'session/compact-abort',
      sessionId: state.activeSessionId,
    });
    if (!response.success) {
      dispatchNotification(pushError(response.error));
    }
  }, [dispatchNotification, hostClient, state.activeSessionId]);

  const handlePermission = useCallback(
    async (
      decision: PermissionDecision,
      rememberScope: PermissionRememberScope = 'once',
    ): Promise<void> => {
      const prompt = state.permissionPrompt;
      if (!prompt) {
        return;
      }
      const payload: {
        type: 'permission/resolve';
        requestId: string;
        decision: PermissionDecision;
        rememberScope?: PermissionRememberScope;
      } = {
        type: 'permission/resolve',
        requestId: prompt.requestId,
        decision,
      };
      if (decision === 'allow') {
        payload.rememberScope = rememberScope;
      }
      const response = await hostClient.request(payload, {
        idempotencyKey: createGestureIdempotencyKey(),
      });
      dispatch({ type: 'permission/clear', requestId: prompt.requestId });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
      }
    },
    [dispatch, dispatchNotification, hostClient, state.permissionPrompt],
  );

  return {
    handlePause,
    handleResumeRun,
    handleAbort,
    handleCompact,
    handleCompactAbort,
    handlePermission,
  };
}
