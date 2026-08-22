/**
 * Mid-run "steer" (convert composer text into a run intervention) and the
 * Host next-turn queue: follow-up admission while streaming, and edit/
 * remove/send-now on queued turns.
 */
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type {
  AgentModeId,
  PromptAttachment,
  PromptContextRef,
  QueuedTurnRecord,
  RunInterventionRecord,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { PendingComposerAttachment } from '../media-utils.js';
import type { DesktopCopy, DesktopLocale } from '../desktop-locale.js';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { hostFailureNotice } from '../host-problem-copy.js';
import type { SteerQueueMessage } from '../steer-queue-model';
import type { UseComposerMediaArgs } from './composer-media-args.js';
import type { ComposerPromptRequestInput } from './use-composer-send.js';

type PromptRequestParams = {
  text: string;
  attachments?: PromptAttachment[];
  contextRefs?: PromptContextRef[];
  agentMode: AgentModeId;
  clientMessageId?: string;
  skillId?: string;
};

export type UseComposerSteerQueueArgs = {
  args: UseComposerMediaArgs;
  locale: DesktopLocale;
  attachmentCopy: DesktopCopy['composer'];
  notifyError: (message: string) => void;
  composer: string;
  setComposer: Dispatch<SetStateAction<string>>;
  pendingAttachmentsRef: MutableRefObject<PendingComposerAttachment[]>;
  promptSubmissionInProgress: MutableRefObject<boolean>;
  buildPromptRequestInput: (params: PromptRequestParams) => ComposerPromptRequestInput;
  refreshQueuedTurnQueue: (sessionId: string) => void;
};

export function useComposerSteerQueue(params: UseComposerSteerQueueArgs) {
  const {
    args,
    locale,
    attachmentCopy,
    notifyError,
    composer,
    setComposer,
    pendingAttachmentsRef,
    promptSubmissionInProgress,
    buildPromptRequestInput,
    refreshQueuedTurnQueue,
  } = params;

  const handleSteer = useCallback(async (overrideText?: string): Promise<boolean> => {
    const text = (overrideText ?? composer).trim();
    if (!text) {
      return false;
    }
    if (!args.state.activeSessionId || !args.state.activeRunId || !args.state.streaming) {
      notifyError(attachmentCopy.steerUnavailable);
      return false;
    }
    if (promptSubmissionInProgress.current) {
      return false;
    }
    promptSubmissionInProgress.current = true;
    const clientMessageId = crypto.randomUUID();
    const interventionId = crypto.randomUUID();
    // A steer belongs to the active run, so it must not reset run ownership as
    // a new `user/send` would. It is still a normal user row in the transcript.
    args.dispatch({
      type: 'user/steer',
      text,
      clientMessageId,
      instructionId: interventionId,
      targetRunId: args.state.activeRunId,
    });
    if (overrideText === undefined) {
      setComposer('');
    }
    try {
      const command = {
        type: 'run/intervention-submit',
        sessionId: args.state.activeSessionId,
        runId: args.state.activeRunId,
        interventionId,
        userMessageId: clientMessageId,
        input: { text },
      } as const;
      let response = await args.hostClient.request(command);
      if (!response.success && response.error.toLowerCase().includes('host request timed out')) {
        // Admission may already be durable when the local ACK times out. Retry
        // once with the same stable identities; Host returns the existing
        // record instead of ever applying the instruction twice.
        response = await args.hostClient.request(command);
      }
      if (!response.success) {
        args.dispatch({ type: 'user/send-rollback', clientMessageId });
        if (overrideText === undefined) {
          setComposer(text);
        }
        notifyError(hostFailureNotice(response, locale));
        return false;
      }
      const responseData = response.data as { intervention?: RunInterventionRecord } | undefined;
      if (responseData?.intervention !== undefined) {
        args.dispatch({
          type: 'run/intervention-updated',
          intervention: responseData.intervention,
        });
      }
      return true;
    } catch (error) {
      args.dispatch({ type: 'user/send-rollback', clientMessageId });
      if (overrideText === undefined) {
        setComposer(text);
      }
      notifyError(formatError(error));
      return false;
    } finally {
      promptSubmissionInProgress.current = false;
    }
  }, [args, attachmentCopy, composer, notifyError]);

  const handleFollowUp = useCallback((): void => {
    const text = composer.trim();
    const sessionId = args.state.activeSessionId;
    if (
      !text ||
      !sessionId ||
      !args.state.streaming ||
      pendingAttachmentsRef.current.length > 0
    ) {
      return;
    }
    if (promptSubmissionInProgress.current) {
      return;
    }
    promptSubmissionInProgress.current = true;
    const queuedTurnId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    setComposer('');
    void args.hostClient
      .request(
        {
          type: 'session/queued-turn-submit',
          sessionId,
          queuedTurnId,
          userMessageId,
          input: buildPromptRequestInput({
            text,
            attachments: [],
            contextRefs: [],
            agentMode: args.agentMode,
            clientMessageId: userMessageId,
          }),
        },
        { idempotencyKey: createGestureIdempotencyKey() },
      )
      .then((response) => {
        if (!response.success) {
          notifyError(hostFailureNotice(response, locale));
          setComposer(text);
          return;
        }
        const queuedTurn = (response.data as { queuedTurn?: QueuedTurnRecord } | undefined)
          ?.queuedTurn;
        if (queuedTurn) {
          args.dispatch({ type: 'session/queued-turn-updated', queuedTurn });
        }
        refreshQueuedTurnQueue(sessionId);
      })
      .catch((error: unknown) => {
        notifyError(formatError(error));
        setComposer(text);
      })
      .finally(() => {
        promptSubmissionInProgress.current = false;
      });
  }, [args, buildPromptRequestInput, composer, notifyError, refreshQueuedTurnQueue]);

  const hostQueueForActiveSession = args.state.activeSessionId
    ? (args.state.queuedTurnsBySession[args.state.activeSessionId] ?? [])
    : [];

  const handleSteerQueueEdit = useCallback(
    (messageId: string, text: string): void => {
      const sessionId = args.state.activeSessionId;
      if (!sessionId) return;
      const queuedTurn = (args.state.queuedTurnsBySession[sessionId] ?? []).find(
        (item) => item.queuedTurnId === messageId,
      );
      if (!queuedTurn || queuedTurn.status !== 'pending') return;
      void args.hostClient
        .request({
          type: 'session/queued-turn-edit',
          sessionId,
          queuedTurnId: queuedTurn.queuedTurnId,
          expectedRevision: queuedTurn.revision,
          input: { ...queuedTurn.input, text, clientMessageId: queuedTurn.userMessageId },
        })
        .then((response) => {
          if (!response.success) {
            notifyError(hostFailureNotice(response, locale));
            return;
          }
          const updated = (response.data as { queuedTurn?: QueuedTurnRecord } | undefined)
            ?.queuedTurn;
          if (updated) args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: updated });
        })
        .catch((error: unknown) => notifyError(formatError(error)));
    },
    [args, notifyError],
  );

  const handleSteerQueueRemove = useCallback(
    (messageId: string): void => {
      const sessionId = args.state.activeSessionId;
      if (!sessionId) return;
      const queuedTurn = (args.state.queuedTurnsBySession[sessionId] ?? []).find(
        (item) => item.queuedTurnId === messageId,
      );
      if (!queuedTurn || queuedTurn.status !== 'pending') return;
      void args.hostClient
        .request({
          type: 'session/queued-turn-cancel',
          sessionId,
          queuedTurnId: queuedTurn.queuedTurnId,
          expectedRevision: queuedTurn.revision,
        })
        .then((response) => {
          if (!response.success) {
            notifyError(hostFailureNotice(response, locale));
            return;
          }
          const cancelled = (response.data as { queuedTurn?: QueuedTurnRecord } | undefined)
            ?.queuedTurn;
          if (cancelled) {
            args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: cancelled });
          }
        })
        .catch((error: unknown) => notifyError(formatError(error)));
    },
    [args, notifyError],
  );

  const handleSteerQueueSendNow = useCallback(
    async (messageId: string): Promise<void> => {
      const sessionId = args.state.activeSessionId;
      if (!sessionId) return;
      const queuedTurns = args.state.queuedTurnsBySession[sessionId] ?? [];
      const target = queuedTurns.find(
        (item) => item.queuedTurnId === messageId && item.status === 'pending',
      );
      if (!target) return;
      // The arrow action is a real steer: convert the queued turn into a Run
      // intervention on the active Run. Without a foreground Run there is
      // nothing to steer — the Host drain admits the queue on its own.
      if (!args.state.activeRunId || !args.state.streaming) {
        notifyError(attachmentCopy.steerUnavailable);
        return;
      }
      if ((target.input.attachments?.length ?? 0) > 0 || (target.input.contextRefs?.length ?? 0) > 0) {
        notifyError('带附件或上下文引用的消息暂不支持调整为当前任务');
        return;
      }
      const command = {
        type: 'run/intervention-submit',
        sessionId,
        runId: args.state.activeRunId,
        interventionId: crypto.randomUUID(),
        userMessageId: target.userMessageId,
        input: { text: target.input.text },
        adoptQueuedTurn: {
          queuedTurnId: target.queuedTurnId,
          expectedRevision: target.revision,
        },
      } as const;
      let response = await args.hostClient.request(command);
      if (!response.success && response.error.toLowerCase().includes('host request timed out')) {
        // Conversion is atomic in the Host store; retrying the same identities
        // replays the durable outcome instead of converting twice.
        response = await args.hostClient.request(command);
      }
      if (!response.success) {
        notifyError(hostFailureNotice(response, locale));
        return;
      }
      const data = response.data as
        | { intervention?: RunInterventionRecord; queuedTurn?: QueuedTurnRecord }
        | undefined;
      if (data?.queuedTurn) {
        args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: data.queuedTurn });
      }
      if (data?.intervention) {
        args.dispatch({ type: 'run/intervention-updated', intervention: data.intervention });
      }
    },
    [args, attachmentCopy, notifyError],
  );

  const steerQueueMessages: SteerQueueMessage[] =
    hostQueueForActiveSession.length > 0 ||
    (args.state.activeSessionId !== null &&
      Object.prototype.hasOwnProperty.call(
        args.state.queuedTurnsBySession,
        args.state.activeSessionId,
      ))
      ? hostQueueForActiveSession
          .filter(
            (item): item is QueuedTurnRecord & { status: 'pending' | 'starting' } =>
              item.status === 'pending' || item.status === 'starting',
          )
          .sort((left, right) => left.sequence - right.sequence)
          .map((item) => ({
            id: item.queuedTurnId,
            text: item.input.text,
            createdAt: item.submittedAt,
            revision: item.revision,
            status: item.status,
          }))
      : [];

  return {
    handleSteer,
    handleFollowUp,
    steerQueueMessages,
    handleSteerQueueSendNow,
    handleSteerQueueEdit,
    handleSteerQueueRemove,
  };
}
