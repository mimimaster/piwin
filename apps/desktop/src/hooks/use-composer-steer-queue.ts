/**
 * Mid-run "steer" (convert composer text into a run intervention) and the
 * Host next-turn queue: follow-up admission while streaming, and edit/
 * remove/send-now on queued turns.
 */
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type {
  AgentModeId,
  PromptAttachment,
  PromptContextRef,
  QueuedTurnRecord,
  RunInterventionRecord,
  UserInstructionPayload,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { PendingComposerAttachment } from '../media-utils.js';
import type { DesktopCopy, DesktopLocale } from '../desktop-locale.js';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { hostFailureNotice, isStaleQueuedTurnError } from '../host-problem-copy.js';
import type { SteerQueueMessage } from '../steer-queue-model';
import type { UseComposerMediaArgs } from './composer-media-args.js';
import { normalizeCompactCustomInstructions, parseComposerSlashSubmit } from '../slash';
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

  const queuedSubmissions = useRef(new Set<string>());

  const handleSteer = useCallback(
    async (overrideText?: string): Promise<boolean> => {
      // Steer currently submits text/context only; preserve the whole draft
      // instead of silently leaving its attachments for a later message.
      if (pendingAttachmentsRef.current.length > 0) {
        notifyError(
          locale === 'zh-CN'
            ? '带附件的消息请使用普通发送加入队列；文字和附件已保留。'
            : 'Use Send to queue messages with attachments. Your text and attachments are preserved.',
        );
        return false;
      }
      const text = (overrideText ?? composer).trim();
      const contextRefs = args.getPendingContextRefs?.() ?? [];
      if (!text && contextRefs.length === 0) {
        return false;
      }
      const reserved = parseComposerSlashSubmit(text, []);
      if (reserved.kind === 'command' && reserved.commandId === 'compact') {
        const compacted = await args.onCompact?.(normalizeCompactCustomInstructions(reserved.args));
        if (compacted !== false && overrideText === undefined) {
          setComposer('');
        }
        return compacted !== false;
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
        ...(contextRefs.length > 0 ? { contextRefs } : {}),
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
          input: {
            text,
            ...(contextRefs.length > 0 ? { contextRefs } : {}),
          },
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
        args.clearPendingContextRefs?.();
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
    },
    [args, attachmentCopy, composer, locale, notifyError, pendingAttachmentsRef],
  );

  const handleFollowUp = useCallback((): void => {
    const text = composer.trim();
    const sessionId = args.state.activeSessionId;
    const reserved = parseComposerSlashSubmit(text, []);
    if (reserved.kind === 'command' && reserved.commandId === 'compact') {
      if (promptSubmissionInProgress.current) {
        return;
      }
      promptSubmissionInProgress.current = true;
      void (async () => {
        try {
          const compacted = await args.onCompact?.(
            normalizeCompactCustomInstructions(reserved.args),
          );
          if (compacted !== false) {
            setComposer('');
          }
        } finally {
          promptSubmissionInProgress.current = false;
        }
      })();
      return;
    }
    if (!text || !sessionId || !args.state.streaming || pendingAttachmentsRef.current.length > 0) {
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
            if (isStaleQueuedTurnError(response.error)) refreshQueuedTurnQueue(sessionId);
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
    [args, locale, notifyError, refreshQueuedTurnQueue],
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
      const submissionKey = `${sessionId}:${messageId}`;
      if (queuedSubmissions.current.has(submissionKey)) return;
      queuedSubmissions.current.add(submissionKey);
      try {
        const reserved = parseComposerSlashSubmit(target.input.text, []);
        if (reserved.kind === 'command' && reserved.commandId === 'compact') {
          await args.onCompact?.(normalizeCompactCustomInstructions(reserved.args));
          return;
        }
        const command = {
          type: 'run/intervention-submit',
          sessionId,
          runId: args.state.activeRunId,
          interventionId: crypto.randomUUID(),
          userMessageId: target.userMessageId,
          input: instructionPayloadFromQueuedTurn(target.input),
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
          if (isStaleQueuedTurnError(response.error)) refreshQueuedTurnQueue(sessionId);
          return;
        }
        const data = response.data as
          { intervention?: RunInterventionRecord; queuedTurn?: QueuedTurnRecord } | undefined;
        if (data?.queuedTurn) {
          args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: data.queuedTurn });
        }
        if (data?.intervention) {
          args.dispatch({ type: 'run/intervention-updated', intervention: data.intervention });
        }
      } catch (error) {
        notifyError(formatError(error));
      } finally {
        queuedSubmissions.current.delete(submissionKey);
      }
    },
    [args, attachmentCopy, locale, notifyError, refreshQueuedTurnQueue],
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
            ...((item.input.attachments?.length ?? 0) > 0
              ? { attachmentCount: item.input.attachments?.length ?? 0 }
              : {}),
          }))
      : [];

  return {
    handleSteer,
    handleFollowUp,
    steerQueueMessages,
    handleSteerQueueSendNow,
    handleSteerQueueRemove,
  };
}

function instructionPayloadFromQueuedTurn(
  input: QueuedTurnRecord['input'],
): UserInstructionPayload {
  const payload: UserInstructionPayload = { text: input.text };
  if (input.attachments && input.attachments.length > 0) {
    payload.attachments = input.attachments;
  }
  if (input.contextRefs && input.contextRefs.length > 0) {
    payload.contextRefs = input.contextRefs;
  }
  return payload;
}
