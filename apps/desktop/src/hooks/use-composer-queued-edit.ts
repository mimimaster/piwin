/**
 * Load a Host queued turn into the composer input, then save it back with
 * `session/queued-turn-edit`. The live draft is parked until commit/cancel
 * or a session change.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { PromptAttachment, QueuedTurnRecord } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { DesktopCopy, DesktopLocale } from '../desktop-locale.js';
import { hostFailureNotice } from '../host-problem-copy.js';
import {
  isFailedMediaAttachment,
  isPendingAttachmentReady,
  type PendingComposerAttachment,
} from '../media-utils.js';
import type { UseComposerMediaArgs } from './composer-media-args.js';

type ParkedComposer = {
  text: string;
  attachments: PendingComposerAttachment[];
};

export type UseComposerQueuedEditArgs = {
  args: UseComposerMediaArgs;
  locale: DesktopLocale;
  attachmentCopy: DesktopCopy['composer'];
  notifyError: (message: string) => void;
  setComposer: Dispatch<SetStateAction<string>>;
  composerRef: MutableRefObject<string>;
  pendingAttachmentsRef: MutableRefObject<PendingComposerAttachment[]>;
  setPendingAttachments: Dispatch<SetStateAction<PendingComposerAttachment[]>>;
  promptSubmissionInProgress: MutableRefObject<boolean>;
  forceDisposeComposerAttachments: (attachments: PendingComposerAttachment[]) => void;
  readResolvedComposerChips: () => PendingComposerAttachment[];
  saveDeferredMediaChips: (sessionId: string, chips: PendingComposerAttachment[]) => Promise<void>;
};

function chipsFromPromptAttachments(
  attachments: readonly PromptAttachment[] | undefined,
): PendingComposerAttachment[] {
  return (attachments ?? []).map((attachment) => ({
    localId: attachment.id,
    attachment,
    previewUrl: '',
    uploadStatus: 'ready' as const,
  }));
}

export function useComposerQueuedEdit(params: UseComposerQueuedEditArgs) {
  const {
    args,
    locale,
    attachmentCopy,
    notifyError,
    setComposer,
    composerRef,
    pendingAttachmentsRef,
    setPendingAttachments,
    promptSubmissionInProgress,
    forceDisposeComposerAttachments,
    readResolvedComposerChips,
    saveDeferredMediaChips,
  } = params;

  const [queuedTurnEditId, setQueuedTurnEditId] = useState<string | null>(null);
  const queuedTurnEditIdRef = useRef<string | null>(null);
  queuedTurnEditIdRef.current = queuedTurnEditId;
  const parkedRef = useRef<ParkedComposer | null>(null);

  const restoreParked = useCallback((): void => {
    const parked = parkedRef.current;
    parkedRef.current = null;
    queuedTurnEditIdRef.current = null;
    setQueuedTurnEditId(null);
    if (!parked) {
      return;
    }
    composerRef.current = parked.text;
    setComposer(parked.text);
    pendingAttachmentsRef.current = [...parked.attachments];
    setPendingAttachments([...parked.attachments]);
  }, [composerRef, pendingAttachmentsRef, setComposer, setPendingAttachments]);

  const restoreParkedRef = useRef(restoreParked);
  restoreParkedRef.current = restoreParked;
  const forceDisposeRef = useRef(forceDisposeComposerAttachments);
  forceDisposeRef.current = forceDisposeComposerAttachments;

  // Session hops must put the parked draft back before drafts snapshot refs.
  useEffect(
    () => () => {
      if (queuedTurnEditIdRef.current === null) {
        return;
      }
      const liveChips = [...pendingAttachmentsRef.current];
      restoreParkedRef.current();
      forceDisposeRef.current(liveChips);
    },
    [args.state.activeSessionId, pendingAttachmentsRef],
  );

  const beginQueuedTurnEdit = useCallback(
    (messageId: string): void => {
      const sessionId = args.state.activeSessionId;
      if (!sessionId) return;
      const queuedTurn = (args.state.queuedTurnsBySession[sessionId] ?? []).find(
        (item) => item.queuedTurnId === messageId && item.status === 'pending',
      );
      if (!queuedTurn) return;
      if (queuedTurnEditIdRef.current === messageId) return;
      if (queuedTurnEditIdRef.current !== null) {
        const liveChips = [...pendingAttachmentsRef.current];
        restoreParked();
        forceDisposeComposerAttachments(liveChips);
      } else {
        parkedRef.current = {
          text: composerRef.current,
          attachments: [...pendingAttachmentsRef.current],
        };
      }
      const chips = chipsFromPromptAttachments(queuedTurn.input.attachments);
      composerRef.current = queuedTurn.input.text;
      setComposer(queuedTurn.input.text);
      pendingAttachmentsRef.current = chips;
      setPendingAttachments(chips);
      queuedTurnEditIdRef.current = messageId;
      setQueuedTurnEditId(messageId);
    },
    [
      args.state.activeSessionId,
      args.state.queuedTurnsBySession,
      composerRef,
      forceDisposeComposerAttachments,
      pendingAttachmentsRef,
      restoreParked,
      setComposer,
      setPendingAttachments,
    ],
  );

  const cancelQueuedTurnEdit = useCallback((): void => {
    if (queuedTurnEditIdRef.current === null) return;
    const liveChips = [...pendingAttachmentsRef.current];
    restoreParked();
    forceDisposeComposerAttachments(liveChips);
  }, [forceDisposeComposerAttachments, pendingAttachmentsRef, restoreParked]);

  const commitQueuedTurnEdit = useCallback(async (): Promise<void> => {
    const sessionId = args.state.activeSessionId;
    const editId = queuedTurnEditIdRef.current;
    if (!sessionId || editId === null || promptSubmissionInProgress.current) {
      return;
    }
    const queuedTurn = (args.state.queuedTurnsBySession[sessionId] ?? []).find(
      (item): item is QueuedTurnRecord & { status: 'pending' } =>
        item.queuedTurnId === editId && item.status === 'pending',
    );
    if (!queuedTurn) {
      cancelQueuedTurnEdit();
      return;
    }
    const failed = pendingAttachmentsRef.current.filter(isFailedMediaAttachment);
    if (failed.length > 0) {
      args.dispatch({
        type: 'error',
        message: attachmentCopy.attachmentSendBlocked(failed.length),
      });
      return;
    }
    promptSubmissionInProgress.current = true;
    try {
      const deferredChips = pendingAttachmentsRef.current.filter(
        (item) =>
          item.attachment.kind === 'media' &&
          !isPendingAttachmentReady(item) &&
          item.uploadStatus !== 'error',
      );
      if (deferredChips.length > 0) {
        await saveDeferredMediaChips(sessionId, deferredChips);
        const stillFailed = readResolvedComposerChips().filter(isFailedMediaAttachment);
        if (stillFailed.length > 0) {
          args.dispatch({
            type: 'error',
            message: attachmentCopy.attachmentSendBlocked(stillFailed.length),
          });
          return;
        }
      }
      const attachments = readResolvedComposerChips()
        .filter(isPendingAttachmentReady)
        .map((item) => item.attachment);
      const text = composerRef.current.trim();
      const response = await args.hostClient.request({
        type: 'session/queued-turn-edit',
        sessionId,
        queuedTurnId: queuedTurn.queuedTurnId,
        expectedRevision: queuedTurn.revision,
        input: {
          ...queuedTurn.input,
          text,
          attachments,
          clientMessageId: queuedTurn.userMessageId,
        },
      });
      if (!response.success) {
        notifyError(hostFailureNotice(response, locale));
        return;
      }
      const updated = (response.data as { queuedTurn?: QueuedTurnRecord } | undefined)?.queuedTurn;
      if (updated) {
        args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: updated });
      }
      const liveChips = [...pendingAttachmentsRef.current];
      restoreParked();
      forceDisposeComposerAttachments(liveChips);
    } catch (error) {
      notifyError(formatError(error));
    } finally {
      promptSubmissionInProgress.current = false;
    }
  }, [
    args,
    attachmentCopy,
    cancelQueuedTurnEdit,
    composerRef,
    forceDisposeComposerAttachments,
    locale,
    notifyError,
    pendingAttachmentsRef,
    promptSubmissionInProgress,
    readResolvedComposerChips,
    restoreParked,
    saveDeferredMediaChips,
  ]);

  return {
    queuedTurnEditId,
    beginQueuedTurnEdit,
    commitQueuedTurnEdit,
    cancelQueuedTurnEdit,
  };
}
