/**
 * Pending image/file attachment lifecycle: paste/drop/file-picker intake,
 * deferred `media/save`, retry/discard, and local-resource disposal.
 */
import {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { PromptAttachment, WebElementAttachmentRef } from '@piwin/contracts';
import { ATTACHMENT_FILE_ACCEPT, formatError, toMediaAttachmentRef } from '@piwin/contracts';
import type { WebElementPickResult, PromptContextRef } from '@piwin/contracts';
import {
  applyChipPreviewUrl,
  commitLimitedChipPreview,
  prepareComposerAttachmentForSave,
  isFailedMediaAttachment,
  isPendingAttachmentReady,
  isAllowedAttachmentFile,
  resolveAttachmentContentKind,
  resolveAttachmentMimeType,
  revokePendingAttachmentUrls,
  type PendingAttachmentErrorKind,
  type PendingComposerAttachment,
  type PendingAttachmentUploadStatus,
} from '../media-utils.js';
import { beginComposerImagePreview } from '../media-preview-bitmap.js';
import { MediaSaveHostRejectedError, saveMediaOverHost } from '../media-save-over-host.js';
import type { DesktopCopy } from '../desktop-locale.js';
import { PIWIN_PATH_MIME } from '../workspace-path-drag';
import type { UseComposerMediaArgs } from './composer-media-args.js';
import { isComposerAttachmentRetained } from './composer-attachment-retention.js';
import type { SessionComposerSnapshot } from './composer-session-snapshot.js';

export type UseComposerAttachmentsArgs = {
  args: UseComposerMediaArgs;
  attachmentCopy: DesktopCopy['composer'];
  setComposer: Dispatch<SetStateAction<string>>;
  setPendingAttachments: Dispatch<SetStateAction<PendingComposerAttachment[]>>;
  pendingAttachmentsRef: MutableRefObject<PendingComposerAttachment[]>;
  pendingContextRefsRef: MutableRefObject<PromptContextRef[]>;
  /** Shared holder maps keep a just-pasted preview live across a session/draft hop. */
  sessionComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
  draftComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
};

function looksLikeFilesystemPath(value: string): boolean {
  if (value.includes('\n')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  return value.includes('/') && !value.includes(' ');
}

export function useComposerAttachments(params: UseComposerAttachmentsArgs) {
  const {
    args,
    attachmentCopy,
    setComposer,
    setPendingAttachments,
    pendingAttachmentsRef,
    pendingContextRefsRef,
    sessionComposerSnapshotsRef,
    draftComposerSnapshotsRef,
  } = params;

  const [dropActive, setDropActive] = useState(false);
  /**
   * localIds removed/cleared while a background media/save is in flight.
   * Prevents late IPC from updating or re-adding chips the user already dismissed.
   */
  const cancelledAttachmentIdsRef = useRef(new Set<string>());
  /** Original File retained until Send (and one-tap retry after a failed save). */
  const sourceFilesRef = useRef(
    new Map<string, { file: File; source: 'paste' | 'drop' | 'file-picker' }>(),
  );
  /**
   * Terminal media results keyed by localId. Send reads this after awaits so it
   * does not depend on React re-render timing.
   */
  const mediaSaveResultsRef = useRef(
    new Map<
      string,
      | { ok: true; attachment: PromptAttachment }
      | { ok: false; error: string; kind: PendingAttachmentErrorKind }
    >(),
  );

  const releaseComposerAttachments = useCallback(
    (attachments: PendingComposerAttachment[], force: boolean): void => {
      const attachmentsByLocalId = new Map<string, PendingComposerAttachment>();
      for (const item of attachments) {
        attachmentsByLocalId.set(item.localId, item);
      }
      const localIds = new Set(attachmentsByLocalId.keys());
      if (force) {
        // A successful Send owns the attachments permanently. Remove any
        // duplicate parked copies before releasing the source File so a later
        // return to that session cannot resurrect an already-sent chip.
        for (const [sessionId, snapshot] of sessionComposerSnapshotsRef.current) {
          const remaining = snapshot.attachments.filter((item) => !localIds.has(item.localId));
          if (remaining.length !== snapshot.attachments.length) {
            sessionComposerSnapshotsRef.current.set(sessionId, {
              ...snapshot,
              attachments: remaining,
            });
          }
        }
        for (const [draftId, snapshot] of draftComposerSnapshotsRef.current) {
          const remaining = snapshot.attachments.filter((item) => !localIds.has(item.localId));
          if (remaining.length !== snapshot.attachments.length) {
            draftComposerSnapshotsRef.current.set(draftId, {
              ...snapshot,
              attachments: remaining,
            });
          }
        }
      }
      for (const item of attachmentsByLocalId.values()) {
        if (
          !force &&
          isComposerAttachmentRetained({
            localId: item.localId,
            liveAttachments: pendingAttachmentsRef.current,
            sessionSnapshots: sessionComposerSnapshotsRef.current,
            draftSnapshots: draftComposerSnapshotsRef.current,
          })
        ) {
          continue;
        }
        cancelledAttachmentIdsRef.current.add(item.localId);
        sourceFilesRef.current.delete(item.localId);
        mediaSaveResultsRef.current.delete(item.localId);
        revokePendingAttachmentUrls(item);
      }
    },
    [draftComposerSnapshotsRef, pendingAttachmentsRef, sessionComposerSnapshotsRef],
  );

  /** Release only when no live or parked composer still owns the attachment. */
  const disposeComposerAttachments = useCallback(
    (attachments: PendingComposerAttachment[]): void => {
      releaseComposerAttachments(attachments, false);
    },
    [releaseComposerAttachments],
  );

  /** Release after Send or an explicit user discard, purging duplicate holders. */
  const forceDisposeComposerAttachments = useCallback(
    (attachments: PendingComposerAttachment[]): void => {
      releaseComposerAttachments(attachments, true);
    },
    [releaseComposerAttachments],
  );

  const revokePending = useCallback(
    (localId: string): void => {
      const target = pendingAttachmentsRef.current.find((item) => item.localId === localId);
      const next = pendingAttachmentsRef.current.filter((item) => item.localId !== localId);
      pendingAttachmentsRef.current = next;
      setPendingAttachments(next);
      if (target) {
        forceDisposeComposerAttachments([target]);
      } else {
        cancelledAttachmentIdsRef.current.add(localId);
        sourceFilesRef.current.delete(localId);
        mediaSaveResultsRef.current.delete(localId);
      }
    },
    [forceDisposeComposerAttachments, pendingAttachmentsRef],
  );

  const clearPendingAttachments = useCallback((): void => {
    pendingContextRefsRef.current = [];
    const current = pendingAttachmentsRef.current;
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
    forceDisposeComposerAttachments(current);
  }, [forceDisposeComposerAttachments, pendingAttachmentsRef]);

  /**
   * Save one attachment to the Host media store for an already-resolved
   * session. Called from the Send path only — paste/drop never reaches here,
   * so attaching an image can no longer create a session (ADR 0045).
   */
  const runMediaSave = useCallback(
    async (params: {
      localId: string;
      file: File;
      source: 'paste' | 'drop' | 'file-picker';
      sessionId: string;
    }): Promise<void> => {
      const { localId, file, source, sessionId } = params;
      const markError = (message: string, kind: PendingAttachmentErrorKind): void => {
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }
        mediaSaveResultsRef.current.set(localId, { ok: false, error: message, kind });
        setPendingAttachments((current) =>
          current.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  uploadStatus: 'error' as const,
                  uploadError: message,
                  uploadErrorKind: kind,
                }
              : item,
          ),
        );
      };

      const removeLocalChip = (): void => {
        const target = pendingAttachmentsRef.current.find((item) => item.localId === localId);
        const next = pendingAttachmentsRef.current.filter((item) => item.localId !== localId);
        pendingAttachmentsRef.current = next;
        setPendingAttachments(next);
        if (target) {
          forceDisposeComposerAttachments([target]);
        } else {
          cancelledAttachmentIdsRef.current.add(localId);
          sourceFilesRef.current.delete(localId);
          mediaSaveResultsRef.current.delete(localId);
        }
      };

      let headerBytes: Uint8Array | undefined;
      try {
        const headerBuffer = await file.slice(0, 16).arrayBuffer();
        headerBytes = new Uint8Array(headerBuffer);
      } catch {
        headerBytes = undefined;
      }
      const mimeType = resolveAttachmentMimeType(file, headerBytes);
      const contentKind = mimeType
        ? resolveAttachmentContentKind(file, mimeType, headerBytes)
        : null;
      if (!mimeType || !contentKind) {
        removeLocalChip();
        args.dispatch({
          type: 'error',
          message: attachmentCopy.attachmentUnsupportedType(file.type || file.name),
        });
        return;
      }

      if (cancelledAttachmentIdsRef.current.has(localId)) {
        return;
      }

      // Keep chip MIME accurate once magic-byte sniff completes.
      setPendingAttachments((current) =>
        current.map((item) =>
          item.localId === localId && item.attachment.kind === 'media'
            ? {
                ...item,
                attachment: {
                  ...item.attachment,
                  mimeType,
                  byteSize: file.size,
                  name: file.name,
                  contentKind,
                },
                uploadStatus: 'saving' as const,
              }
            : item,
        ),
      );

      try {
        // Yield so the "Preparing…" chip state can paint before compress/encode/IPC.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }

        const prepared = await prepareComposerAttachmentForSave(file, mimeType, contentKind);
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }
        if (mimeType === 'image/gif' && prepared.mimeType === 'image/gif') {
          throw new Error('GIF first-frame conversion is unavailable in this runtime');
        }

        if (prepared.compressed || prepared.mimeType !== mimeType) {
          setPendingAttachments((current) =>
            current.map((item) =>
              item.localId === localId && item.attachment.kind === 'media'
                ? {
                    ...item,
                    attachment: {
                      ...item.attachment,
                      mimeType: prepared.mimeType,
                      byteSize: prepared.byteSize,
                      contentKind: prepared.contentKind,
                      ...(prepared.width !== undefined ? { width: prepared.width } : {}),
                      ...(prepared.height !== undefined ? { height: prepared.height } : {}),
                    },
                  }
                : item,
            ),
          );
        }

        const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }

        let asset;
        try {
          asset = await saveMediaOverHost({
            request: (command) => args.hostClient.request(command),
            sessionId,
            bytes,
            mimeType: prepared.mimeType,
            source,
            name: file.name,
            contentKind: prepared.contentKind,
            cancelled: () => cancelledAttachmentIdsRef.current.has(localId),
          });
        } catch (error) {
          const message = formatError(error);
          if (error instanceof MediaSaveHostRejectedError || /too[- ]?large/i.test(message)) {
            markError(
              /too[- ]?large/i.test(message) ? attachmentCopy.attachmentFailureTooLarge : message,
              'policy',
            );
            return;
          }
          markError(message, 'connection');
          return;
        }
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }
        const attachment = toMediaAttachmentRef(asset, source);
        sourceFilesRef.current.delete(localId);
        mediaSaveResultsRef.current.set(localId, { ok: true, attachment });
        setPendingAttachments((current) =>
          current.map((item) =>
            item.localId === localId
              ? (() => {
                  const {
                    uploadError: _ignoredUploadError,
                    uploadErrorKind: _ignoredKind,
                    ...rest
                  } = item;
                  return {
                    ...rest,
                    attachment,
                    uploadStatus: 'ready' as const,
                  };
                })()
              : item,
          ),
        );
      } catch (error) {
        // Reached only from local prepare/encode steps; the request has its
        // own catch above.
        markError(formatError(error), 'local');
      }
    },
    [args, attachmentCopy, forceDisposeComposerAttachments, pendingAttachmentsRef],
  );

  const enqueueAttachmentFile = useCallback(
    (file: File, source: 'paste' | 'drop' | 'file-picker', existingLocalId?: string): void => {
      const localId = existingLocalId ?? crypto.randomUUID();
      cancelledAttachmentIdsRef.current.delete(localId);
      sourceFilesRef.current.set(localId, { file, source });
      mediaSaveResultsRef.current.delete(localId);

      if (!existingLocalId) {
        // Optimistic MIME from File metadata; macOS clipboard pastes often
        // have an empty type and are refined from magic bytes in runMediaSave.
        const optimisticMime = resolveAttachmentMimeType(file) ?? 'application/octet-stream';
        const optimisticContentKind =
          resolveAttachmentContentKind(file, optimisticMime) ?? 'document';
        const placeholderAttachment: PromptAttachment = {
          id: localId,
          kind: 'media',
          path: `pending://${localId}`,
          mimeType: optimisticMime === 'image/jpg' ? 'image/jpeg' : optimisticMime,
          name: file.name,
          contentKind: optimisticContentKind,
          byteSize: file.size,
          source,
        };
        const isImage = optimisticContentKind === 'image';
        // Paint the chip immediately so paste never waits on encode/IPC.
        // ADR 0045 compatibility path: the File + blob preview stay in the
        // draft until Send; no Host session or media/save happens here.
        // Images: lightbox keeps the original File URL; the 48px chip waits
        // for a size-capped still so WebKit never decodes the full bitmap.
        if (isImage) {
          const { lightboxUrl } = beginComposerImagePreview(
            file,
            (previewUrl) => {
              const committed = commitLimitedChipPreview({
                localId,
                previewUrl,
                cancelled: cancelledAttachmentIdsRef.current.has(localId),
                live: pendingAttachmentsRef.current,
                snapshots: [
                  ...sessionComposerSnapshotsRef.current.values(),
                  ...draftComposerSnapshotsRef.current.values(),
                ],
              });
              pendingAttachmentsRef.current = committed.live;
              if (committed.keep) {
                setPendingAttachments(
                  (current) => applyChipPreviewUrl(current, localId, previewUrl).next,
                );
              }
            },
            () => cancelledAttachmentIdsRef.current.has(localId),
          );
          const next = [
            ...pendingAttachmentsRef.current,
            {
              localId,
              attachment: placeholderAttachment,
              previewUrl: '',
              lightboxUrl,
              uploadStatus: 'queued' as const,
            },
          ];
          pendingAttachmentsRef.current = next;
          setPendingAttachments(next);
        } else {
          const next = [
            ...pendingAttachmentsRef.current,
            {
              localId,
              attachment: placeholderAttachment,
              previewUrl: URL.createObjectURL(file),
              uploadStatus: 'queued' as const,
            },
          ];
          pendingAttachmentsRef.current = next;
          setPendingAttachments(next);
        }
      } else {
        // Retry: drop the failed terminal state back to queued. The save runs
        // on the next Send, not immediately. The ref updates synchronously so
        // a retry-then-send in the same tick already sees the queued chip.
        const next = pendingAttachmentsRef.current.map((item) =>
          item.localId === localId
            ? (() => {
                const { uploadError: _ignored, uploadErrorKind: _ignoredKind, ...rest } = item;
                return { ...rest, uploadStatus: 'queued' as const };
              })()
            : item,
        );
        pendingAttachmentsRef.current = next;
        setPendingAttachments(next);
      }
    },
    [],
  );

  const retryPendingAttachment = useCallback(
    (localId: string): void => {
      const source = sourceFilesRef.current.get(localId);
      if (!source) {
        args.dispatch({
          type: 'error',
          message: attachmentCopy.attachmentRetryUnavailable,
        });
        return;
      }
      enqueueAttachmentFile(source.file, source.source, localId);
    },
    [args, attachmentCopy, enqueueAttachmentFile],
  );

  /**
   * Phase 0 send confirmation "Retry": re-queue every failed chip. Updates are
   * synchronous on the ref so a handleSend in the same tick re-runs the saves.
   */
  const retryFailedAttachments = useCallback((): void => {
    for (const item of pendingAttachmentsRef.current) {
      if (isFailedMediaAttachment(item)) {
        retryPendingAttachment(item.localId);
      }
    }
  }, [retryPendingAttachment]);

  /**
   * Phase 0 send confirmation "Send the rest": drop every failed chip. Updates
   * are synchronous on the ref so a handleSend in the same tick excludes them.
   */
  const discardFailedAttachments = useCallback((): void => {
    const failed = pendingAttachmentsRef.current.filter(isFailedMediaAttachment);
    if (failed.length === 0) {
      return;
    }
    const next = pendingAttachmentsRef.current.filter((item) => !isFailedMediaAttachment(item));
    pendingAttachmentsRef.current = next;
    setPendingAttachments(next);
    forceDisposeComposerAttachments(failed);
  }, [forceDisposeComposerAttachments]);

  /**
   * Merge terminal save results into the chip list so Send never depends on
   * React having flushed setState after an awaited save.
   */
  const readResolvedComposerChips = useCallback((): PendingComposerAttachment[] => {
    const merged = pendingAttachmentsRef.current.map((item) => {
      if (item.attachment.kind !== 'media') {
        return item;
      }
      const result = mediaSaveResultsRef.current.get(item.localId);
      if (!result) {
        return item;
      }
      if (result.ok) {
        const { uploadError: _ignored, uploadErrorKind: _ignoredKind, ...rest } = item;
        return {
          ...rest,
          attachment: result.attachment,
          uploadStatus: 'ready' as const,
        };
      }
      return {
        ...item,
        uploadStatus: 'error' as const,
        uploadError: result.error,
        uploadErrorKind: result.kind,
      };
    });
    // Keep React state in sync with the merge used for send.
    pendingAttachmentsRef.current = merged;
    setPendingAttachments(merged);
    return merged;
  }, []);

  const markAttachmentUploadStatus = useCallback(
    (localIds: string[], status: PendingAttachmentUploadStatus): void => {
      const targetIds = new Set(localIds);
      setPendingAttachments((current) => {
        const next = current.map((item) =>
          targetIds.has(item.localId) && item.attachment.kind === 'media'
            ? { ...item, uploadStatus: status }
            : item,
        );
        pendingAttachmentsRef.current = next;
        return next;
      });
    },
    [],
  );

  /**
   * Run `media/save` for chips whose File is still local (queued after paste,
   * or reset by Retry). Chips that are already `ready` from an earlier
   * successful save are reused and never re-uploaded.
   */
  const saveDeferredMediaChips = useCallback(
    async (sessionId: string, chips: PendingComposerAttachment[]): Promise<void> => {
      await Promise.all(
        chips.map(async (chip) => {
          if (chip.attachment.kind !== 'media') {
            return;
          }
          if (isPendingAttachmentReady(chip)) {
            return;
          }
          const source = sourceFilesRef.current.get(chip.localId);
          if (!source) {
            // Chip survived a draft round-trip without its File (e.g. restored
            // from a stale snapshot). Never send a placeholder path.
            const message = attachmentCopy.attachmentSourceMissing;
            mediaSaveResultsRef.current.set(chip.localId, {
              ok: false,
              error: message,
              kind: 'local',
            });
            setPendingAttachments((current) =>
              current.map((item) =>
                item.localId === chip.localId
                  ? {
                      ...item,
                      uploadStatus: 'error' as const,
                      uploadError: message,
                      uploadErrorKind: 'local' as const,
                    }
                  : item,
              ),
            );
            return;
          }
          await runMediaSave({
            localId: chip.localId,
            file: source.file,
            source: source.source,
            sessionId,
          });
        }),
      );
    },
    [attachmentCopy, runMediaSave],
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      const files: File[] = [];
      for (const item of items) {
        // Some pastes expose a MIME type; others only give a file with empty type.
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && (isAllowedAttachmentFile(file) || file.type.trim() === '')) {
            files.push(file);
          }
        }
      }
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      // Each file paints a local chip immediately; media/save is deferred to Send.
      for (const file of files) {
        enqueueAttachmentFile(file, 'paste');
      }
    },
    [enqueueAttachmentFile],
  );

  const handleComposerDrop = useCallback(
    async (event: DragEvent<HTMLElement>): Promise<void> => {
      event.preventDefault();
      setDropActive(false);

      // Workspace file tree path drop → structured context ref chip (CM-08);
      // falls back to absolute-path text for text models when not wired.
      const pathPayload = event.dataTransfer?.getData(PIWIN_PATH_MIME);
      if (pathPayload) {
        try {
          const parsed = JSON.parse(pathPayload) as {
            absolutePath?: string;
            relativePath?: string;
          };
          const absolutePath = parsed.absolutePath?.trim();
          const relativePath = parsed.relativePath?.trim();
          if (absolutePath) {
            if (args.addContextRefFromDrop && relativePath) {
              const added = args.addContextRefFromDrop({ absolutePath, relativePath });
              if (added) {
                return;
              }
            }

            setComposer((current) =>
              current.trim().length > 0
                ? `${current.replace(/\s+$/, '')}\n${absolutePath}`
                : absolutePath,
            );
            return;
          }
        } catch {
          /* fall through to plain text / images */
        }
      }
      const plainPath = event.dataTransfer?.getData('text/plain')?.trim();
      if (plainPath && !event.dataTransfer?.files?.length && looksLikeFilesystemPath(plainPath)) {
        setComposer((current) =>
          current.trim().length > 0 ? `${current.replace(/\s+$/, '')}\n${plainPath}` : plainPath,
        );
        return;
      }

      // dataTransfer.files is authoritative; some engines (macOS WKWebView)
      // only expose the drop via dataTransfer.items, so fall back to that.
      const droppedFiles: File[] = [...(event.dataTransfer?.files ?? [])];
      if (droppedFiles.length === 0 && event.dataTransfer?.items) {
        for (const item of [...event.dataTransfer.items]) {
          if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
              droppedFiles.push(file);
            }
          }
        }
      }
      const files = droppedFiles.filter(
        (file) => isAllowedAttachmentFile(file) || file.type.trim() === '',
      );
      for (const file of files) {
        enqueueAttachmentFile(file, 'drop');
      }
    },
    [args.addContextRefFromDrop, enqueueAttachmentFile],
  );

  const canAttachFiles = useCallback((): boolean => {
    const isGeneral = args.state.activeScope.kind === 'general' || !args.state.projectPath;
    if (!isGeneral && !args.state.projectTrusted && !args.state.activeSessionId) {
      args.dispatch({ type: 'project/trust-dialog', open: true });
      return false;
    }
    return true;
  }, [args]);

  const openAttachmentPicker = useCallback(
    (accept: string): void => {
      if (!canAttachFiles()) {
        return;
      }
      // Session is created lazily inside enqueueAttachmentFile when needed.
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = true;
      input.onchange = () => {
        const files = [...(input.files ?? [])];
        for (const file of files) {
          enqueueAttachmentFile(file, 'file-picker');
        }
      };
      input.click();
    },
    [canAttachFiles, enqueueAttachmentFile],
  );

  const handlePickFiles = useCallback((): void => {
    openAttachmentPicker(ATTACHMENT_FILE_ACCEPT);
  }, [openAttachmentPicker]);

  const handlePickImageFiles = useCallback((): void => {
    openAttachmentPicker('image/png,image/jpeg,image/jpg,image/webp,image/gif');
  }, [openAttachmentPicker]);

  /**
   * Add a picked web element (ADR 0020 §6) as a pending composer attachment.
   * Builds a WebElementAttachmentRef with conditional-spread optional
   * fields (exactOptionalPropertyTypes: no ref: undefined).
   */
  const addWebElement = useCallback(
    (pick: WebElementPickResult): void => {
      const attachment: WebElementAttachmentRef = {
        id: crypto.randomUUID(),
        kind: 'web-element',
        url: pick.url,
        selector: pick.selector,
        text: pick.text,
        ...(pick.ref !== undefined ? { ref: pick.ref } : {}),
        ...(pick.html !== undefined ? { html: pick.html } : {}),
        ...(pick.screenshotPath !== undefined ? { screenshotPath: pick.screenshotPath } : {}),
      };
      const next = [
        ...pendingAttachmentsRef.current,
        { localId: attachment.id, attachment, previewUrl: '', uploadStatus: 'ready' as const },
      ];
      pendingAttachmentsRef.current = next;
      setPendingAttachments(next);
    },
    [pendingAttachmentsRef],
  );

  return {
    dropActive,
    setDropActive,
    disposeComposerAttachments,
    revokePending,
    clearPendingAttachments,
    runMediaSave,
    enqueueAttachmentFile,
    retryPendingAttachment,
    retryFailedAttachments,
    discardFailedAttachments,
    readResolvedComposerChips,
    markAttachmentUploadStatus,
    saveDeferredMediaChips,
    forceDisposeComposerAttachments,
    handleComposerPaste,
    handleComposerDrop,
    canAttachFiles,
    openAttachmentPicker,
    handlePickFiles,
    handlePickImageFiles,
    addWebElement,
  };
}
