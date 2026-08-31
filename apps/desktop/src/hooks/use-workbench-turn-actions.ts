/**
 * In-transcript turn actions: edit/intervention, plan execute/abort, and
 * message feedback. Host commands stay here so App only wires the thread.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { PlanExecutionMode, RunInterventionRecord, SessionPlan } from '@piwin/contracts';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { isUnchangedCurrentTurnResend } from '../conversation-branch';
import { pushError, type NotificationAction } from '../notification-queue';
import { hostFailureNotice } from '../host-problem-copy.js';
import { useDesktopLocale } from '../desktop-locale-context';

export type UseWorkbenchTurnActionsArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  sessionPlan: SessionPlan | null;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  branchResend: (messageId: string, text: string) => void | Promise<void>;
  retryTurn: (userMessageId: string, options: { keepPrevious: boolean }) => void | Promise<void>;
};

export function useWorkbenchTurnActions(args: UseWorkbenchTurnActionsArgs) {
  const {
    hostClient,
    state,
    sessionPlan,
    dispatch,
    dispatchNotification,
    setEditingMessageId,
    branchResend,
    retryTurn,
  } = args;
  const { locale } = useDesktopLocale();

  const handleCancelMessageEdit = useCallback((): void => {
    setEditingMessageId(null);
  }, [setEditingMessageId]);

  const handleInterventionEdit = useCallback(
    async (messageId: string, text: string): Promise<void> => {
      const message = state.messages.find((candidate) => candidate.id === messageId);
      const delivery = message?.instructionDelivery;
      if (
        !state.activeSessionId ||
        delivery?.kind !== 'run-intervention' ||
        delivery.status !== 'pending' ||
        !delivery.targetRunId
      ) {
        dispatchNotification(pushError('这条调整已不能编辑，请重新发送。'));
        return;
      }
      const response = await hostClient.request({
        type: 'run/intervention-edit',
        sessionId: state.activeSessionId,
        runId: delivery.targetRunId,
        interventionId: delivery.instructionId,
        expectedRevision: delivery.revision,
        input: { text },
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const responseData = response.data as { intervention?: RunInterventionRecord } | undefined;
      if (responseData?.intervention !== undefined) {
        dispatch({
          type: 'run/intervention-updated',
          intervention: responseData.intervention,
        });
      }
      setEditingMessageId(null);
    },
    [dispatch, dispatchNotification, hostClient, setEditingMessageId, state.activeSessionId, state.messages],
  );

  const handleInterventionCancel = useCallback(
    async (messageId: string): Promise<void> => {
      const message = state.messages.find((candidate) => candidate.id === messageId);
      const delivery = message?.instructionDelivery;
      if (
        !state.activeSessionId ||
        delivery?.kind !== 'run-intervention' ||
        delivery.status !== 'pending' ||
        !delivery.targetRunId
      ) {
        return;
      }
      const response = await hostClient.request({
        type: 'run/intervention-cancel',
        sessionId: state.activeSessionId,
        runId: delivery.targetRunId,
        interventionId: delivery.instructionId,
        expectedRevision: delivery.revision,
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const responseData = response.data as { intervention?: RunInterventionRecord } | undefined;
      if (responseData?.intervention !== undefined) {
        dispatch({
          type: 'run/intervention-updated',
          intervention: responseData.intervention,
        });
      }
    },
    [dispatch, dispatchNotification, hostClient, state.activeSessionId, state.messages],
  );

  const handleEditAndResendMessage = useCallback(
    (messageId: string, text: string): void => {
      if (isUnchangedCurrentTurnResend(state.messages, messageId, { text })) {
        void retryTurn(messageId, { keepPrevious: false });
        return;
      }
      void branchResend(messageId, text);
    },
    [branchResend, retryTurn, state.messages],
  );

  const handleMessageFeedback = useCallback(
    (message: string, level: 'info' | 'success' | 'error'): void => {
      dispatchNotification({
        type: 'notify/push',
        notification: { level, message },
      });
    },
    [dispatchNotification],
  );

  const handlePlanExecute = useCallback(
    async (mode: PlanExecutionMode): Promise<void> => {
      if (!state.activeSessionId || !sessionPlan) return;
      const response = await hostClient.request({
        type: 'plan/execute',
        request: {
          sessionId: state.activeSessionId,
          planId: sessionPlan.id,
          mode,
          expectedRevision: sessionPlan.revision,
          ...(sessionPlan.status === 'draft' ? { approveDraft: true } : {}),
        },
      });
      if (!response.success) {
        dispatchNotification({
          type: 'notify/push',
          notification: { level: 'error', message: hostFailureNotice(response, locale) },
        });
      }
    },
    [hostClient, locale, state.activeSessionId, sessionPlan, dispatchNotification],
  );

  const handlePlanAbort = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId || !sessionPlan) return;
    const response = await hostClient.request({
      type: 'plan/abort',
      sessionId: state.activeSessionId,
      planId: sessionPlan.id,
    });
    if (!response.success) {
      dispatchNotification({
        type: 'notify/push',
        notification: { level: 'error', message: response.error },
      });
    }
  }, [hostClient, state.activeSessionId, sessionPlan, dispatchNotification]);

  return {
    handleCancelMessageEdit,
    handleInterventionEdit,
    handleInterventionCancel,
    handleEditAndResendMessage,
    handleMessageFeedback,
    handlePlanExecute,
    handlePlanAbort,
  };
}
