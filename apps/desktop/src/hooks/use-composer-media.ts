/**
 * Composer text, pending image attachments, paste/drop/file-picker, send prompt.
 *
 * Composed from focused sub-hooks: attachments (paste/drop/file-picker/save
 * lifecycle, `use-composer-attachments.ts`), drafts (local draft rows +
 * per-session unsent snapshots, `use-composer-drafts.ts`), send (build/paint/
 * submit the Host prompt, `use-composer-send.ts`), and steer-queue (mid-run
 * steer + Host next-turn queue, `use-composer-steer-queue.ts`). This file
 * owns only the state genuinely shared across all four — composer text,
 * pending attachments, pending context refs, per-session/draft snapshot Maps
 * — and wires the sub-hooks' outputs together.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import type { PendingComposerAttachment } from '../media-utils.js';
import { getDesktopCopy } from '../desktop-locale.js';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { pushError } from '../notification-queue';
import { useComposerAttachments } from './use-composer-attachments.js';
import {
  MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS,
  useComposerDrafts,
} from './use-composer-drafts.js';
import { useComposerQueuedEdit } from './use-composer-queued-edit.js';
import { useComposerSend } from './use-composer-send.js';
import { useComposerSteerQueue } from './use-composer-steer-queue.js';
import { parseComposerSlashSubmit } from '../slash';
import type { SessionComposerSnapshot } from './composer-session-snapshot.js';
import type { UseComposerMediaArgs } from './composer-media-args.js';

export type { UseComposerMediaArgs } from './composer-media-args.js';
export { MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS };

export function useComposerMedia(args: UseComposerMediaArgs) {
  const { locale } = useDesktopLocale();
  const attachmentCopy = getDesktopCopy(locale).composer;
  const [composer, setComposer] = useState('');
  const composerRef = useRef('');
  composerRef.current = composer;
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([]);
  // State updates are asynchronous. This ref rejects a double click or an
  // Enter+click before the streaming state has reached the next render.
  const promptSubmissionInProgress = useRef(false);
  const sendOwnerLocksRef = useRef(new Set<string>());
  /** Latest pending list for waiters that must not close over a stale render. */
  const pendingAttachmentsRef = useRef<PendingComposerAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  /** Structured refs for trusted workspace-tree drops; never inject absolute paths. */
  const pendingContextRefsRef = useRef<PromptContextRef[]>([]);
  const activeSessionIdRef = useRef<string | null>(args.state.activeSessionId);
  activeSessionIdRef.current = args.state.activeSessionId;
  /**
   * Per-session / per-draft unsent composer snapshots (text + chips + refs).
   * Declared here (rather than owned by drafts or attachments) because both
   * sides touch them: drafts persists/restores on session and draft
   * transitions, attachments checks and purges them so a just-pasted preview
   * stays valid when a chip briefly has two holders.
   */
  const sessionComposerSnapshotsRef = useRef(new Map<string, SessionComposerSnapshot>());
  const draftComposerSnapshotsRef = useRef(new Map<string, SessionComposerSnapshot>());

  const notifyError = useCallback(
    (message: string): void => {
      if (args.dispatchNotification) {
        args.dispatchNotification(pushError(message));
      } else {
        args.dispatch({ type: 'error', message });
      }
    },
    [args],
  );

  const attachments = useComposerAttachments({
    args,
    attachmentCopy,
    setComposer,
    setPendingAttachments,
    pendingAttachmentsRef,
    pendingContextRefsRef,
    sessionComposerSnapshotsRef,
    draftComposerSnapshotsRef,
  });

  // Declared before drafts so its session-change cleanup restores the parked
  // draft into the shared refs before the drafts hook snapshots them.
  const queuedEdit = useComposerQueuedEdit({
    args,
    locale,
    attachmentCopy,
    notifyError,
    setComposer,
    composerRef,
    pendingAttachmentsRef,
    setPendingAttachments,
    promptSubmissionInProgress,
    forceDisposeComposerAttachments: attachments.forceDisposeComposerAttachments,
    readResolvedComposerChips: attachments.readResolvedComposerChips,
    saveDeferredMediaChips: attachments.saveDeferredMediaChips,
  });

  const drafts = useComposerDrafts({
    args,
    composer,
    setComposer,
    composerRef,
    pendingAttachments,
    pendingAttachmentsRef,
    setPendingAttachments,
    pendingContextRefsRef,
    activeSessionIdRef,
    sessionComposerSnapshotsRef,
    draftComposerSnapshotsRef,
    disposeComposerAttachments: attachments.disposeComposerAttachments,
  });

  const send = useComposerSend({
    args,
    locale,
    attachmentCopy,
    notifyError,
    composer,
    setComposer,
    composerRef,
    pendingAttachmentsRef,
    setPendingAttachments,
    pendingContextRefsRef,
    promptSubmissionInProgress,
    activeSessionIdRef,
    sessionComposerSnapshotsRef,
    upsertCurrentDraft: drafts.upsertCurrentDraft,
    removeCurrentDraft: drafts.removeCurrentDraft,
    skipDraftSaveRef: drafts.skipDraftSaveRef,
    preserveComposerOnSessionActivationRef: drafts.preserveComposerOnSessionActivationRef,
    draftTextRef: drafts.draftTextRef,
    currentDraftScopeRef: drafts.currentDraftScopeRef,
    currentDraftIdRef: drafts.currentDraftIdRef,
    sendOwnerLocksRef,
    clearPendingAttachments: attachments.clearPendingAttachments,
    forceDisposeComposerAttachments: attachments.forceDisposeComposerAttachments,
    markAttachmentUploadStatus: attachments.markAttachmentUploadStatus,
    readResolvedComposerChips: attachments.readResolvedComposerChips,
    saveDeferredMediaChips: attachments.saveDeferredMediaChips,
  });

  const steerQueue = useComposerSteerQueue({
    args,
    locale,
    attachmentCopy,
    notifyError,
    composer,
    setComposer,
    pendingAttachmentsRef,
    promptSubmissionInProgress,
    buildPromptRequestInput: send.buildPromptRequestInput,
    refreshQueuedTurnQueue: send.refreshQueuedTurnQueue,
  });

  /**
   * A queued-turn edit owns the input box while it is active, so Send saves
   * that row instead of admitting yet another turn.
   */
  const handleSend = useCallback(
    async (overrideText?: string): Promise<void> => {
      const text = (overrideText ?? composer).trim();
      const reserved = parseComposerSlashSubmit(text, []);
      if (reserved.kind === 'command') {
        await send.handleSend(text);
        return;
      }
      if (queuedEdit.queuedTurnEditId !== null) {
        await queuedEdit.commitQueuedTurnEdit();
        return;
      }
      await send.handleSend(overrideText);
    },
    [composer, queuedEdit.commitQueuedTurnEdit, queuedEdit.queuedTurnEditId, send.handleSend],
  );

  // Teardown sweep: no holder may outlive the hook, so every retained blob
  // URL and source File (session snapshots, draft snapshots, live chips) is
  // released here instead of leaking until page reload.
  useEffect(
    () => () => {
      const retainedAttachments = [
        ...[...sessionComposerSnapshotsRef.current.values()].flatMap(
          (snapshot) => snapshot.attachments,
        ),
        ...[...draftComposerSnapshotsRef.current.values()].flatMap(
          (snapshot) => snapshot.attachments,
        ),
        ...pendingAttachmentsRef.current,
      ];
      sessionComposerSnapshotsRef.current.clear();
      draftComposerSnapshotsRef.current.clear();
      pendingAttachmentsRef.current = [];
      attachments.forceDisposeComposerAttachments(retainedAttachments);
    },
    [attachments.forceDisposeComposerAttachments],
  );

  return {
    composer,
    setComposer,
    draftSessions: drafts.draftSessions,
    activeDraftId: drafts.activeDraftId,
    startNewDraft: drafts.startNewDraft,
    resumeDraft: drafts.resumeDraft,
    pendingAttachments,
    dropActive: attachments.dropActive,
    setDropActive: attachments.setDropActive,
    revokePending: attachments.revokePending,
    clearPendingAttachments: attachments.clearPendingAttachments,
    handleComposerPaste: attachments.handleComposerPaste,
    handleComposerDrop: attachments.handleComposerDrop,
    handlePickFiles: attachments.handlePickFiles,
    handlePickImageFiles: attachments.handlePickImageFiles,
    addWebElement: attachments.addWebElement,
    addExistingMediaAttachment: attachments.addExistingMediaAttachment,
    handleSend,
    retryPendingAttachment: attachments.retryPendingAttachment,
    retryFailedAttachments: attachments.retryFailedAttachments,
    discardFailedAttachments: attachments.discardFailedAttachments,
    handleSteer: steerQueue.handleSteer,
    handleFollowUp: steerQueue.handleFollowUp,
    steerQueueMessages: steerQueue.steerQueueMessages,
    handleSteerQueueSendNow: steerQueue.handleSteerQueueSendNow,
    handleSteerQueueEdit: queuedEdit.beginQueuedTurnEdit,
    handleSteerQueueRemove: steerQueue.handleSteerQueueRemove,
    queuedTurnEditId: queuedEdit.queuedTurnEditId,
    cancelQueuedTurnEdit: queuedEdit.cancelQueuedTurnEdit,
  };
}
