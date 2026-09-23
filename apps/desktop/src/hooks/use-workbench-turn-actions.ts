/**
 * In-transcript turn actions: edit/intervention, plan prompt/abort, and
 * message feedback. Host commands stay here so App only wires the thread.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
  PlanDisplayPayload,
  PlanExecutionMode,
  RunInterventionRecord,
  SessionPlan,
} from '@piwin/contracts';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { isUnchangedCurrentTurnResend } from '../conversation-branch';
import { pushError, type NotificationAction } from '../notification-queue';
import { hostFailureNotice, isStaleInterventionError } from '../host-problem-copy.js';
import { useDesktopLocale } from '../desktop-locale-context';
import type { PlanTrayAction } from '../plan-todo-model.js';

export type UseWorkbenchTurnActionsArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  sessionPlan: SessionPlan | null;
  sendPrompt: (text: string) => void | Promise<void>;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  branchResend: (messageId: string, text: string) => void | Promise<void>;
  retryTurn: (userMessageId: string, options: { keepPrevious: boolean }) => void | Promise<void>;
};

/** Build the visible next-turn instruction emitted by a plan card. */
export function buildPlanExecutionPrompt(
  display: PlanDisplayPayload,
  mode: PlanExecutionMode,
): string {
  const path = display.path;
  if (mode === 'subagent-driven') {
    return `请读取计划文件「${path}」（展示路径：${display.displayPath}），按照该计划使用子代理执行。根据任务依赖安排委派并汇总验证结果，不要再次询问执行方式。`;
  }
  return `请读取计划文件「${path}」（展示路径：${display.displayPath}），按照该计划在当前会话直接执行。不要再次询问执行方式；保持实施工作在当前会话完成。完成每一步并用 piwin_plan_set_step 记录验证结果。`;
}

export function useWorkbenchTurnActions(args: UseWorkbenchTurnActionsArgs) {
  const {
    hostClient,
    state,
    sessionPlan,
    sendPrompt,
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
        dispatchNotification(pushError(hostFailureNotice(response, locale)));
        // Host re-pushed the applied/ended record; the editor has nothing left
        // to revise, and resending from it would branch instead.
        if (isStaleInterventionError(response.error)) setEditingMessageId(null);
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
    [
      dispatch,
      dispatchNotification,
      hostClient,
      locale,
      setEditingMessageId,
      state.activeSessionId,
      state.messages,
    ],
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
        dispatchNotification(pushError(hostFailureNotice(response, locale)));
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
    [dispatch, dispatchNotification, hostClient, locale, state.activeSessionId, state.messages],
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
    async (display: PlanDisplayPayload, mode: PlanExecutionMode): Promise<void> => {
      const activeSessionId = state.activeSessionId;
      if (!activeSessionId) return;
      if (display.plan.sessionId !== activeSessionId) {
        dispatchNotification(pushError('计划属于另一个会话，请切回原会话后再执行。'));
        return;
      }

      // The card is historical UI. Re-read the durable document before sending
      // its prompt so a stale card cannot target a replacement plan.
      const currentResponse = await hostClient.request({
        type: 'plan/get',
        sessionId: activeSessionId,
      });
      if (!currentResponse.success) {
        dispatchNotification({
          type: 'notify/push',
          notification: { level: 'error', message: hostFailureNotice(currentResponse, locale) },
        });
        return;
      }
      const currentPlan = (currentResponse.data as { plan?: SessionPlan | null } | undefined)?.plan;
      if (
        !currentPlan ||
        currentPlan.id !== display.plan.id ||
        currentPlan.revision !== display.plan.revision
      ) {
        dispatchNotification(pushError('这张计划卡已失效，请使用当前会话中的最新计划。'));
        return;
      }
      if (currentPlan.status !== 'draft' && currentPlan.status !== 'approved') {
        dispatchNotification(pushError(`计划当前状态为 ${currentPlan.status}，暂不能执行。`));
        return;
      }

      // Approval is performed atomically during Host prompt preparation. The
      // card therefore only validates its snapshot and emits the same ordinary
      // prompt as a manually typed mode selection.
      await sendPrompt(buildPlanExecutionPrompt(display, mode));
    },
    [dispatchNotification, hostClient, locale, sendPrompt, state.activeSessionId],
  );

  // `abort` stops a live Host execution; `complete`/`dismiss` close a plan the
  // agent left `executing` after its turn ended, which `plan/abort` rejects.
  const handlePlanAction = useCallback(async (action: PlanTrayAction): Promise<void> => {
    if (!state.activeSessionId || !sessionPlan) return;
    const response = await hostClient.request(
      action === 'abort'
        ? { type: 'plan/abort', sessionId: state.activeSessionId, planId: sessionPlan.id }
        : {
            type: 'plan/set-status',
            sessionId: state.activeSessionId,
            status: action === 'complete' ? 'done' : 'abandoned',
          },
    );
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
    handlePlanAction,
  };
}
