/**
 * Composer text, pending image attachments, paste/drop/file-picker, send prompt.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
} from 'react';
import type {
  MediaSaveData,
  PromptContextRef,
  PromptAttachment,
  WebElementAttachmentRef,
  WebElementPickResult,
} from '@piwin/contracts';
import { ATTACHMENT_FILE_ACCEPT, formatError, toMediaAttachmentRef } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState, SkillActivityView } from '../chat-reducer';
import {
  fileToBase64,
  prepareComposerAttachmentForSave,
  isPendingAttachmentReady,
  isAllowedAttachmentFile,
  resolveAttachmentContentKind,
  resolveAttachmentMimeType,
  type PendingComposerAttachment,
} from '../media-utils.js';
import { type AgentModeId } from '../agent-mode';
import {
  applySkillToPrompt,
  normalizeCompactCustomInstructions,
  parseComposerSlashSubmit,
} from '../slash';
import { PIWIN_PATH_MIME } from '../workspace-path-drag';
import { deriveDefaultNameFromMessage } from '@piwin/session/derive-default-name';
import { isPlaceholderSessionName } from '../title-display';
import { canUseThinkingLevel } from '../model-thinking-policy';
import { decideDraftTransition } from '../draft-transition';
import { sortDraftSessions, type DraftSessionItemUi } from '../draft-session';
import {
  appendSteerQueueMessage,
  editSteerQueueMessage,
  removeSteerQueueMessage,
  type SteerQueueMessage,
  type SteerQueuesBySession,
} from '../steer-queue-model';

export type UseComposerMediaArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  agentMode: AgentModeId;
  onAgentModeChange?: (mode: AgentModeId) => void;
  /** Skills available for `/name` send intercept. */
  menuSkills?: Array<{ id: string; name: string; enabled: boolean }>;
  onCompact?: (customInstructions?: string) => Promise<void>;
  onAbort?: () => Promise<void>;
  onPause?: () => Promise<void>;
  /** Create (or ensure) a live session when the user sends without one. */
  ensureSession?: (options?: {
    projectPath?: string;
    alreadyTrusted?: boolean;
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  }) => Promise<string | null>;
  /** When Send has no workspace, open the workspace picker (keep draft text). */
  onNeedWorkspace?: () => void | Promise<void>;
  /** Per-next-turn model key `providerId::modelId`. */
  selectedModelKey?: string;
  modelOptions?: Array<{
    protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
    providerId: string;
    modelId: string;
    supportsImage?: boolean;
    thinkingLevels?: readonly import('@piwin/contracts').ThinkingLevel[];
    reasoning?: boolean;
  }>;
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  /** ORCH: per-send scheme id; omit/off means no scheme field. */
  orchestrationSchemeId?: string;
  /** ORCH: slash /scheme sets the composer scheme without sending. */
  onOrchestrationSchemeChange?: (schemeId: string) => void;
  /**
   * When true, text-only + media is allowed (host will describe or path-inject).
   * When false/undefined and selected model lacks vision, confirm before send.
   */
  visionDelegationEnabled?: boolean;
  /** Optional confirm dialog for text-only + media without delegation. */
  confirmTextOnlyImageSend?: (message: string) => Promise<boolean>;
};

export function useComposerMedia(args: UseComposerMediaArgs) {
  const [composer, setComposer] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([]);
  const [dropActive, setDropActive] = useState(false);
  // State updates are asynchronous. This ref rejects a double click or an
  // Enter+click before the streaming state has reached the next render.
  const promptSubmissionInProgress = useRef(false);
  /**
   * localIds removed/cleared while a background media/save is in flight.
   * Prevents late IPC from updating or re-adding chips the user already dismissed.
   */
  const cancelledAttachmentIdsRef = useRef(new Set<string>());
  /**
   * In-flight media/save work keyed by localId. Send awaits these so the user
   * never has to "wait a moment and click again".
   */
  const uploadPromisesRef = useRef(new Map<string, Promise<void>>());
  /** Original File retained for one-tap retry after a failed save. */
  const sourceFilesRef = useRef(
    new Map<string, { file: File; source: 'paste' | 'drop' | 'file-picker' }>(),
  );
  /** Latest pending list for waiters that must not close over a stale render. */
  const pendingAttachmentsRef = useRef<PendingComposerAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  /** Structured refs for trusted workspace-tree drops; never inject absolute paths. */
  const pendingContextRefsRef = useRef<PromptContextRef[]>([]);
  const [steerQueuesBySession, setSteerQueuesBySession] = useState<SteerQueuesBySession>({});
  const steerQueuesBySessionRef = useRef<SteerQueuesBySession>({});
  const queueDrainInProgressRef = useRef(false);
  const queueDrainBlockedMessageIdRef = useRef<string | null>(null);
  const steerQueueSendNowInProgressRef = useRef(new Set<string>());
  /**
   * Terminal media results keyed by localId. Send reads this after awaits so it
   * does not depend on React re-render timing.
   */
  const mediaSaveResultsRef = useRef(
    new Map<string, { ok: true; attachment: PromptAttachment } | { ok: false; error: string }>(),
  );

  // ── Local composer drafts ───────────────────────────────────────────────
  // Draft rows are deliberately Desktop-local. A Host session is still only
  // created when the user sends, so switching away never leaves empty durable
  // sessions behind.
  const [draftSessions, setDraftSessions] = useState<DraftSessionItemUi[]>([]);
  const draftSessionsRef = useRef<DraftSessionItemUi[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const activeDraftIdRef = useRef<string | null>(null);
  /** Draft record associated with the current composer, even while its row is not selected. */
  const currentDraftIdRef = useRef<string | null>(null);
  const draftTextRef = useRef('');
  const previousActiveScopeRef = useRef(args.state.activeScope);
  // When a session is created on first send, activeSessionId transitions from
  // null → new id. The effect below would normally save the composer text as
  // draft, but the text is being sent — this flag tells the effect to skip.
  const skipDraftSaveRef = useRef(false);
  /**
   * Draft → live session for the *current* draft work (image paste/drop/picker
   * needs a session id for media/save). Keep the typed text; do not treat this
   * as "user switched to another session".
   */
  const preserveComposerOnSessionActivationRef = useRef(false);
  const prevActiveSessionIdRef = useRef<string | null>(args.state.activeSessionId);

  const setActiveDraft = useCallback((draftId: string | null): void => {
    activeDraftIdRef.current = draftId;
    setActiveDraftId(draftId);
  }, []);

  const upsertCurrentDraft = useCallback(
    (text: string, scope: import('@piwin/contracts').SessionScope): void => {
      if (text.trim().length === 0) return;
      const draftId = currentDraftIdRef.current ?? activeDraftIdRef.current ?? crypto.randomUUID();
      const existing = draftSessionsRef.current.find((draft) => draft.id === draftId);
      const createdAt = existing?.createdAt ?? new Date().toISOString();
      const draft: DraftSessionItemUi = {
        id: draftId,
        name: text.trim().replace(/\s+/g, ' '),
        text,
        createdAt,
        updatedAt: existing?.updatedAt ?? createdAt,
        scope,
        isDraft: true,
      };
      const next = [draft, ...draftSessionsRef.current.filter((item) => item.id !== draftId)];
      draftSessionsRef.current = next;
      setDraftSessions(sortDraftSessions(next));
      currentDraftIdRef.current = draftId;
      setActiveDraft(draftId);
      draftTextRef.current = text;
    },
    [setActiveDraft],
  );

  const removeCurrentDraft = useCallback((): void => {
    const draftId = currentDraftIdRef.current ?? activeDraftIdRef.current;
    currentDraftIdRef.current = null;
    setActiveDraft(null);
    draftTextRef.current = '';
    if (!draftId) return;
    const next = draftSessionsRef.current.filter((draft) => draft.id !== draftId);
    draftSessionsRef.current = next;
    setDraftSessions(next);
  }, [setActiveDraft]);

  /** Start an empty composer without restoring the previously selected draft. */
  const startNewDraft = useCallback((): void => {
    currentDraftIdRef.current = null;
    setActiveDraft(null);
    draftTextRef.current = '';
    setComposer('');
  }, [setActiveDraft]);

  const resumeDraft = useCallback(
    (draftId: string): void => {
      const draft = draftSessionsRef.current.find((item) => item.id === draftId);
      if (!draft) return;
      currentDraftIdRef.current = draft.id;
      setActiveDraft(draft.id);
      draftTextRef.current = draft.text;
      setComposer(draft.text);
      if (args.state.activeSessionId !== null) {
        args.dispatch({ type: 'session/clear-active' });
      }
    },
    [args, setActiveDraft],
  );

  // Keep a selected draft row's title in sync while the user continues typing.
  useEffect(() => {
    const draftId = activeDraftIdRef.current;
    if (!draftId || composer.trim().length === 0) return;
    const existing = draftSessionsRef.current.find((draft) => draft.id === draftId);
    if (!existing || existing.text === composer) return;
    const updated: DraftSessionItemUi = {
      ...existing,
      name: composer.trim().replace(/\s+/g, ' '),
      text: composer,
    };
    const next = draftSessionsRef.current.map((draft) => (draft.id === draftId ? updated : draft));
    draftSessionsRef.current = next;
    setDraftSessions(next);
    draftTextRef.current = composer;
  }, [composer]);

  useEffect(() => {
    const prevId = prevActiveSessionIdRef.current;
    const currentId = args.state.activeSessionId;
    const previousScope = previousActiveScopeRef.current;
    previousActiveScopeRef.current = args.state.activeScope;
    if (prevId === currentId) return;
    prevActiveSessionIdRef.current = currentId;

    // Switching between two real sessions must not leak the old composer text
    // into the newly selected session. Keep it as a local draft instead.
    if (prevId !== null && currentId !== null) {
      if (composer.trim().length > 0) {
        upsertCurrentDraft(composer, previousScope);
      } else if (currentDraftIdRef.current !== null) {
        removeCurrentDraft();
      }
      currentDraftIdRef.current = null;
      setActiveDraft(null);
      setComposer('');
      return;
    }

    const decision = decideDraftTransition({
      leavingDraft: prevId === null && currentId !== null,
      enteringDraft: prevId !== null && currentId === null,
      skipDraftSave: skipDraftSaveRef.current,
      preserveComposerOnSessionActivation: preserveComposerOnSessionActivationRef.current,
    });

    switch (decision.kind) {
      case 'noop':
        break;
      case 'skip-draft-save':
        // Session created on send — handleSend already cleared composer and draft.
        skipDraftSaveRef.current = false;
        preserveComposerOnSessionActivationRef.current = false;
        break;
      case 'preserve-composer':
        // Media attach created a session under the same draft — keep typed text
        // and pending chips. Clearing here wiped "type then paste image".
        preserveComposerOnSessionActivationRef.current = false;
        upsertCurrentDraft(composer, previousScope);
        setActiveDraft(null);
        break;
      case 'save-and-clear-composer':
        // User switched to an existing session — save draft, clear composer
        // so the draft text does not leak into the resumed session.
        if (composer.trim().length > 0) {
          upsertCurrentDraft(composer, previousScope);
        } else if (currentDraftIdRef.current !== null) {
          removeCurrentDraft();
        }
        currentDraftIdRef.current = null;
        setActiveDraft(null);
        setComposer('');
        break;
      case 'restore-draft':
        // User entered draft mode (clicked "+" or switched scope) — restore draft.
        preserveComposerOnSessionActivationRef.current = false;
        setComposer(draftTextRef.current);
        break;
    }
    // else: switching between two existing sessions — no draft management.
    // composer intentionally omitted from deps; reading it here captures the
    // value at the time activeSessionId changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.state.activeSessionId,
    args.state.activeScope,
    removeCurrentDraft,
    setActiveDraft,
    upsertCurrentDraft,
  ]);

  const revokePending = useCallback((localId: string): void => {
    cancelledAttachmentIdsRef.current.add(localId);
    uploadPromisesRef.current.delete(localId);
    sourceFilesRef.current.delete(localId);
    mediaSaveResultsRef.current.delete(localId);
    setPendingAttachments((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.localId !== localId);
    });
  }, []);

  const clearPendingAttachments = useCallback((): void => {
    pendingContextRefsRef.current = [];
    setPendingAttachments((current) => {
      for (const item of current) {
        cancelledAttachmentIdsRef.current.add(item.localId);
        uploadPromisesRef.current.delete(item.localId);
        sourceFilesRef.current.delete(item.localId);
        mediaSaveResultsRef.current.delete(item.localId);
        URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  }, []);

  const resolveSessionIdForComposer = useCallback(async (): Promise<string | null> => {
    if (args.state.activeSessionId) {
      return args.state.activeSessionId;
    }
    const isGeneral = args.state.activeScope.kind === 'general' || !args.state.projectPath;
    if (!isGeneral && !args.state.projectTrusted) {
      args.dispatch({ type: 'project/trust-dialog', open: true });
      return null;
    }
    if (!args.ensureSession) {
      args.dispatch({ type: 'error', message: 'Create a session before sending' });
      return null;
    }
    // We only reach this point from draft mode (activeSessionId was null).
    // Creating the session activates it in the reducer, which normally runs
    // the draft-exit effect and clears the composer. Media paste/drop/picker
    // runs under the same draft, so tell the effect to keep the typed text.
    // handleSend sets skipDraftSaveRef first, so the send path still clears.
    const sessionId = isGeneral
      ? await args.ensureSession({ scope: { kind: 'general' } })
      : await args.ensureSession({ alreadyTrusted: true });
    if (sessionId) {
      preserveComposerOnSessionActivationRef.current = true;
    }
    return sessionId;
  }, [args]);

  /**
   * Attach a supported file with an immediate local preview, then save to the
   * media store in the background. Paste/drop must not wait on IPC.
   */
  const runMediaSave = useCallback(
    async (
      localId: string,
      file: File,
      source: 'paste' | 'drop' | 'file-picker',
    ): Promise<void> => {
      const markError = (message: string): void => {
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }
        mediaSaveResultsRef.current.set(localId, { ok: false, error: message });
        setPendingAttachments((current) =>
          current.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  uploadStatus: 'error' as const,
                  uploadError: message,
                }
              : item,
          ),
        );
      };

      const removeLocalChip = (): void => {
        sourceFilesRef.current.delete(localId);
        mediaSaveResultsRef.current.delete(localId);
        setPendingAttachments((current) => {
          const target = current.find((item) => item.localId === localId);
          if (target) {
            URL.revokeObjectURL(target.previewUrl);
          }
          return current.filter((item) => item.localId !== localId);
        });
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
          message: `Unsupported attachment type: ${file.type || file.name}`,
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
        const sessionId = await resolveSessionIdForComposer();
        if (!sessionId || cancelledAttachmentIdsRef.current.has(localId)) {
          if (!cancelledAttachmentIdsRef.current.has(localId)) {
            removeLocalChip();
          }
          return;
        }

        // Yield so the optimistic chip can paint before compress/encode/IPC.
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

        const base64Data = await fileToBase64(prepared.blob);
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }

        const response = await args.hostClient.request({
          type: 'media/save',
          input: {
            sessionId,
            mimeType: prepared.mimeType,
            name: file.name,
            contentKind: prepared.contentKind,
            source,
            base64Data,
          },
        });
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }
        if (!response.success) {
          markError(response.error);
          return;
        }
        const asset = (response.data as MediaSaveData).asset;
        const attachment = toMediaAttachmentRef(asset, source);
        sourceFilesRef.current.delete(localId);
        mediaSaveResultsRef.current.set(localId, { ok: true, attachment });
        setPendingAttachments((current) =>
          current.map((item) =>
            item.localId === localId
              ? (() => {
                  const { uploadError: _ignoredUploadError, ...rest } = item;
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
        const message = formatError(error);
        markError(message);
      }
    },
    [args, resolveSessionIdForComposer],
  );

  const enqueueAttachmentFile = useCallback(
    (file: File, source: 'paste' | 'drop' | 'file-picker', existingLocalId?: string): void => {
      const localId = existingLocalId ?? crypto.randomUUID();
      cancelledAttachmentIdsRef.current.delete(localId);
      sourceFilesRef.current.set(localId, { file, source });
      mediaSaveResultsRef.current.delete(localId);

      if (!existingLocalId) {
        const previewUrl = URL.createObjectURL(file);
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
        // Paint the chip immediately so paste never waits on encode/IPC.
        setPendingAttachments((current) => [
          ...current,
          {
            localId,
            attachment: placeholderAttachment,
            previewUrl,
            uploadStatus: 'saving',
          },
        ]);
      } else {
        setPendingAttachments((current) =>
          current.map((item) =>
            item.localId === localId
              ? (() => {
                  const { uploadError: _ignored, ...rest } = item;
                  return { ...rest, uploadStatus: 'saving' as const };
                })()
              : item,
          ),
        );
      }

      const savePromise = runMediaSave(localId, file, source).finally(() => {
        // Keep the entry until send waiters have observed terminal state via React state.
        // Only drop if this promise is still the active one for localId.
        const current = uploadPromisesRef.current.get(localId);
        if (current === savePromise) {
          uploadPromisesRef.current.delete(localId);
        }
      });
      uploadPromisesRef.current.set(localId, savePromise);
    },
    [runMediaSave],
  );

  const retryPendingAttachment = useCallback(
    (localId: string): void => {
      const source = sourceFilesRef.current.get(localId);
      if (!source) {
        args.dispatch({
          type: 'error',
          message: 'Cannot retry this attachment — remove it and attach it again.',
        });
        return;
      }
      enqueueAttachmentFile(source.file, source.source, localId);
    },
    [args, enqueueAttachmentFile],
  );

  /**
   * Wait until every attachment chip is ready (or failed/removed).
   * Used by Send so the user can press Enter immediately after paste/drop.
   */
  const waitForPendingMediaSaves = useCallback(async (): Promise<{
    ready: PendingComposerAttachment[];
    failed: PendingComposerAttachment[];
  }> => {
    const outstanding = [...uploadPromisesRef.current.values()];
    if (outstanding.length > 0) {
      await Promise.allSettled(outstanding);
    }

    const latest = pendingAttachmentsRef.current;
    // Merge terminal results from the save map so we do not depend on React
    // having flushed setState before Send continues.
    const merged = latest.map((item) => {
      if (item.attachment.kind !== 'media') {
        return item;
      }
      const result = mediaSaveResultsRef.current.get(item.localId);
      if (!result) {
        return item;
      }
      if (result.ok) {
        const { uploadError: _ignored, ...rest } = item;
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
      };
    });
    // Keep React state in sync with the merge used for send.
    pendingAttachmentsRef.current = merged;
    setPendingAttachments(merged);

    return {
      ready: merged.filter(isPendingAttachmentReady),
      failed: merged.filter(
        (item) => item.attachment.kind === 'media' && item.uploadStatus === 'error',
      ),
    };
  }, []);

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
      // Fire-and-forget: each file paints a chip immediately, then saves async.
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

      // Workspace file tree path drop → inject absolute path for text models.
      const pathPayload = event.dataTransfer?.getData(PIWIN_PATH_MIME);
      if (pathPayload) {
        try {
          const parsed = JSON.parse(pathPayload) as {
            absolutePath?: string;
            relativePath?: string;
          };
          const absolutePath = parsed.absolutePath?.trim();
          const relativePath = parsed.relativePath?.trim();
          const projectPath = args.state.projectPath?.trim();
          if (absolutePath && relativePath && projectPath) {
            const contextRef: PromptContextRef = {
              kind: 'file',
              projectPath,
              relativePath,
              label: relativePath,
            };
            pendingContextRefsRef.current = [
              ...pendingContextRefsRef.current.filter(
                (ref) => ref.kind !== 'file' || ref.relativePath !== relativePath,
              ),
              contextRef,
            ];
            setComposer((current) =>
              current.trim().length > 0
                ? `${current.replace(/\s+$/, '')}\n${relativePath}`
                : relativePath,
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
    [enqueueAttachmentFile],
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
  const addWebElement = useCallback((pick: WebElementPickResult): void => {
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
    setPendingAttachments((current) => [
      ...current,
      { localId: attachment.id, attachment, previewUrl: '', uploadStatus: 'ready' },
    ]);
  }, []);

  const resolveTurnModel = useCallback((): import('@piwin/contracts').ModelRef | undefined => {
    const key = args.selectedModelKey?.trim();
    if (!key || !args.modelOptions?.length) {
      return undefined;
    }
    const option = args.modelOptions.find((item) => `${item.providerId}::${item.modelId}` === key);
    if (!option) {
      return undefined;
    }
    return {
      protocol: option.protocol,
      providerId: option.providerId,
      modelId: option.modelId,
    };
  }, [args.modelOptions, args.selectedModelKey]);

  const buildPromptRequestInput = useCallback(
    (params: {
      text: string;
      attachments?: PromptAttachment[];
      contextRefs?: PromptContextRef[];
      agentMode: AgentModeId;
      clientMessageId?: string;
    }): {
      text: string;
      attachments?: PromptAttachment[];
      contextRefs?: PromptContextRef[];
      model?: import('@piwin/contracts').ModelRef;
      thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
      agentMode?: import('@piwin/contracts').AgentModeId;
      orchestrationSchemeId?: string;
      clientMessageId?: string;
    } => {
      const input: {
        text: string;
        attachments?: PromptAttachment[];
        contextRefs?: PromptContextRef[];
        model?: import('@piwin/contracts').ModelRef;
        thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
        agentMode?: import('@piwin/contracts').AgentModeId;
        orchestrationSchemeId?: string;
        clientMessageId?: string;
      } = {
        text: params.text,
        agentMode: params.agentMode,
      };
      if (params.clientMessageId && params.clientMessageId.trim().length > 0) {
        input.clientMessageId = params.clientMessageId.trim();
      }
      const schemeId = args.orchestrationSchemeId?.trim();
      if (schemeId && schemeId !== 'off') {
        input.orchestrationSchemeId = schemeId;
      }
      if (params.attachments && params.attachments.length > 0) {
        input.attachments = params.attachments;
      }
      if (params.contextRefs && params.contextRefs.length > 0) {
        input.contextRefs = params.contextRefs;
      }
      const model = resolveTurnModel();
      if (model) {
        input.model = model;
      }
      const selectedOption = args.modelOptions?.find(
        (option) => `${option.providerId}::${option.modelId}` === args.selectedModelKey,
      );
      if (
        selectedOption &&
        args.thinkingLevel &&
        canUseThinkingLevel(selectedOption, args.thinkingLevel, true)
      ) {
        input.thinkingLevel = args.thinkingLevel;
      }
      return input;
    },
    [
      args.modelOptions,
      args.selectedModelKey,
      args.thinkingLevel,
      args.orchestrationSchemeId,
      resolveTurnModel,
    ],
  );

  const applyAcceptedRun = useCallback(
    (responseData: unknown): void => {
      const accepted = responseData as { runId?: string; acceptedAt?: string };
      if (typeof accepted.runId === 'string') {
        args.dispatch({
          type: 'run/accepted',
          runId: accepted.runId,
          ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
        });
      }
    },
    [args],
  );

  const paintOptimisticUserSend = useCallback(
    (params: {
      text: string;
      attachments?: PromptAttachment[];
      displayText?: string;
      skill?: SkillActivityView;
    }): string => {
      const clientMessageId = crypto.randomUUID();
      args.dispatch({
        type: 'user/send',
        text: params.displayText ?? params.text,
        attachments: params.attachments ?? [],
        clientMessageId,
        ...(params.skill ? { skill: params.skill } : {}),
      });
      setComposer('');
      clearPendingAttachments();
      return clientMessageId;
    },
    [args, clearPendingAttachments],
  );

  const rollbackOptimisticUserSend = useCallback(
    (clientMessageId: string, restoreText: string): void => {
      args.dispatch({ type: 'user/send-rollback', clientMessageId });
      setComposer(restoreText);
    },
    [args],
  );

  const handleSend = useCallback(
    async (overrideText?: string): Promise<void> => {
      const text = (overrideText ?? composer).trim();
      if (promptSubmissionInProgress.current) {
        return;
      }
      if (args.state.runTerminal.kind === 'paused') {
        return;
      }

      // Only wait on media when something is actually in flight. Pure text
      // must paint in the same turn as Enter (no microtask hop before bubble).
      let attachments: PromptAttachment[] = pendingAttachmentsRef.current
        .filter(isPendingAttachmentReady)
        .map((item) => item.attachment);
      const hasPendingMediaWork =
        uploadPromisesRef.current.size > 0 ||
        pendingAttachmentsRef.current.some(
          (item) => item.attachment.kind === 'media' && item.uploadStatus === 'saving',
        );
      if (hasPendingMediaWork) {
        // Best UX: user may hit Enter right after paste. Wait for background
        // saves instead of bouncing with "try again".
        const { ready: waitedReady, failed: waitedFailed } = await waitForPendingMediaSaves();
        if (waitedFailed.length > 0) {
          args.dispatch({
            type: 'error',
            message:
              waitedFailed.length === 1
                ? 'One attachment failed to save — tap Retry on the chip, or remove it.'
                : `${waitedFailed.length} attachments failed to save — tap Retry or remove them.`,
          });
          return;
        }
        const readyItems =
          waitedReady.length > 0
            ? waitedReady
            : pendingAttachmentsRef.current.filter(isPendingAttachmentReady);
        attachments = readyItems.map((item) => item.attachment);
      }
      if (!text && attachments.length === 0) {
        return;
      }
      // Streaming is allowed: host supersedes the in-flight run when a newer
      // message arrives (session/prompt interrupt). Users no longer need to
      // press Stop first.

      const hasImage = attachments.some(isImagePromptAttachment);
      if (hasImage) {
        const selected = args.modelOptions?.find(
          (option) => `${option.providerId}::${option.modelId}` === args.selectedModelKey,
        );
        const supportsImage = selected?.supportsImage === true;
        if (!supportsImage && !args.visionDelegationEnabled) {
          const message =
            '当前模型是纯文本（无视觉）。图片只会以本地路径字符串注入，模型看不到像素。' +
            '请切换到带「视觉」标签的模型，或在设置里开启视觉委派。仍要发送吗？';
          if (args.confirmTextOnlyImageSend) {
            const ok = await args.confirmTextOnlyImageSend(message);
            if (!ok) {
              return;
            }
          }
        }
      }

      // Sync gates before paint so we never flash a bubble that cannot send.
      const isGeneral = args.state.activeScope.kind === 'general' || !args.state.projectPath;
      if (!isGeneral) {
        if (!args.state.projectPath) {
          await args.onNeedWorkspace?.();
          return;
        }
        if (!args.state.projectTrusted) {
          args.dispatch({ type: 'project/trust-dialog', open: true });
          return;
        }
      }

      // Whole-message slash commands that must not paint a chat bubble.
      if (text.startsWith('/') && attachments.length === 0) {
        const skills = (args.menuSkills ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: skill.enabled,
        }));
        const parsed = parseComposerSlashSubmit(text, skills);

        if (parsed.kind === 'command' && parsed.commandId === 'compact') {
          promptSubmissionInProgress.current = true;
          try {
            setComposer('');
            clearPendingAttachments();
            const instructions = normalizeCompactCustomInstructions(parsed.args);
            await args.onCompact?.(instructions);
          } finally {
            promptSubmissionInProgress.current = false;
          }
          return;
        }
        if (parsed.kind === 'command' && parsed.commandId === 'stop') {
          promptSubmissionInProgress.current = true;
          try {
            setComposer('');
            clearPendingAttachments();
            await args.onAbort?.();
          } finally {
            promptSubmissionInProgress.current = false;
          }
          return;
        }
        if (parsed.kind === 'scheme') {
          args.onOrchestrationSchemeChange?.(parsed.schemeId);
          setComposer('');
          clearPendingAttachments();
          return;
        }
        if (parsed.kind === 'mode' && !parsed.args) {
          args.onAgentModeChange?.(parsed.modeId);
          setComposer('');
          clearPendingAttachments();
          return;
        }
        if (parsed.kind === 'skill') {
          const skillEnabled =
            skills.find((skill) => skill.id === parsed.skillId)?.enabled !== false;
          if (!skillEnabled) {
            args.dispatch({
              type: 'error',
              message: `Skill "${parsed.skillName}" is disabled — enable it in Settings → Skills`,
            });
            return;
          }
        }
      }

      // Paint-first: clear composer and show the user bubble before any IPC.
      // Session create / prompt ACK stay off the critical input path.
      const wasInDraftMode = !args.state.activeSessionId;
      // Sending consumes the local draft row, if this composer was resumed
      // from one. The newly created Host session will replace it in the list.
      removeCurrentDraft();
      if (wasInDraftMode) {
        skipDraftSaveRef.current = true;
        draftTextRef.current = '';
      }

      let clientMessageId: string | null = null;
      // Host injects agent-mode contracts on the model path. Send clean user
      // text so transcript + session naming never see [piwin-mode:…] noise.
      let displayText = text;
      let hostPromptText = text;
      let promptAgentMode: AgentModeId = args.agentMode;
      let promptAttachments: PromptAttachment[] = attachments;
      const promptContextRefs = [...pendingContextRefsRef.current];
      let skillActivity: SkillActivityView | undefined;

      if (text.startsWith('/') && attachments.length === 0 && promptContextRefs.length === 0) {
        const skills = (args.menuSkills ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: skill.enabled,
        }));
        const parsed = parseComposerSlashSubmit(text, skills);
        if (parsed.kind === 'mode' && parsed.args) {
          args.onAgentModeChange?.(parsed.modeId);
          displayText = parsed.args;
          hostPromptText = parsed.args;
          promptAgentMode = parsed.modeId;
          promptAttachments = [];
        } else if (parsed.kind === 'skill') {
          // Skill wrapper is model-facing guidance; host still receives it as
          // text (skill is not a first-class host field). Naming strips it.
          hostPromptText = applySkillToPrompt(parsed.skillName, parsed.skillId, parsed.args);
          promptAttachments = [];
          skillActivity = { skillId: parsed.skillId, name: parsed.skillName };
        }
      }

      clientMessageId = paintOptimisticUserSend({
        text,
        displayText,
        attachments: promptAttachments,
        ...(skillActivity ? { skill: skillActivity } : {}),
      });
      // paintOptimisticUserSend clears attachment chips; workspace refs belong
      // to this same prompt and must survive until the Host request is built.
      pendingContextRefsRef.current = promptContextRefs;

      promptSubmissionInProgress.current = true;
      try {
        const sessionId = await resolveSessionIdForComposer();
        if (!sessionId) {
          if (wasInDraftMode) {
            skipDraftSaveRef.current = false;
          }
          rollbackOptimisticUserSend(clientMessageId, text);
          return;
        }

        const input = buildPromptRequestInput({
          text: hostPromptText,
          attachments: promptAttachments,
          contextRefs: promptContextRefs,
          agentMode: promptAgentMode,
          clientMessageId,
        });
        const response = await args.hostClient.request({
          type: 'session/prompt',
          sessionId,
          input,
        });
        if (!response.success) {
          rollbackOptimisticUserSend(clientMessageId, text);
          args.dispatch({ type: 'error', message: response.error });
          return;
        }

        pendingContextRefsRef.current = [];

        applyAcceptedRun(response.data);

        // Optimistic text title on send (host also persists nameSource:text).
        // This inserts the row into the sidebar immediately; LLM may upgrade later.
        const currentName =
          args.state.sessions.find((session) => session.id === sessionId)?.name ??
          args.state.generalSessions.find((session) => session.id === sessionId)?.name;
        if (isPlaceholderSessionName(currentName)) {
          const interim = deriveDefaultNameFromMessage(displayText);
          if (interim) {
            args.dispatch({
              type: 'session/update',
              session: {
                id: sessionId,
                name: interim,
                updatedAt: new Date().toISOString(),
              },
            });
          }
        }
      } catch (error) {
        if (clientMessageId) {
          rollbackOptimisticUserSend(clientMessageId, text);
        }
        args.dispatch({ type: 'error', message: formatError(error) });
      } finally {
        promptSubmissionInProgress.current = false;
      }
    },
    [
      args,
      applyAcceptedRun,
      buildPromptRequestInput,
      clearPendingAttachments,
      composer,
      paintOptimisticUserSend,
      removeCurrentDraft,
      resolveSessionIdForComposer,
      rollbackOptimisticUserSend,
      waitForPendingMediaSaves,
    ],
  );

  const updateSteerQueues = useCallback(
    (update: (current: SteerQueuesBySession) => SteerQueuesBySession): void => {
      setSteerQueuesBySession((current) => {
        const next = update(current);
        steerQueuesBySessionRef.current = next;
        return next;
      });
    },
    [],
  );

  const handleSteer = useCallback(async (overrideText?: string): Promise<boolean> => {
    const text = (overrideText ?? composer).trim();
    if (!text || !args.state.activeSessionId || !args.state.streaming) {
      return false;
    }
    const clientMessageId = crypto.randomUUID();
    // A steer belongs to the active run, so it must not reset run ownership as
    // a new `user/send` would. It is still a normal user row in the transcript.
    args.dispatch({
      type: 'user/steer',
      text,
      clientMessageId,
    });
    if (overrideText === undefined) {
      setComposer('');
    }
    try {
      const response = await args.hostClient.request({
        type: 'session/steer',
        sessionId: args.state.activeSessionId,
        message: text,
        clientMessageId,
        ...(args.state.activeRunId ? { runId: args.state.activeRunId } : {}),
      });
      if (!response.success) {
        args.dispatch({ type: 'user/send-rollback', clientMessageId });
        if (overrideText === undefined) {
          setComposer(text);
        }
        args.dispatch({ type: 'error', message: response.error });
        return false;
      }
      return true;
    } catch (error) {
      args.dispatch({ type: 'user/send-rollback', clientMessageId });
      if (overrideText === undefined) {
        setComposer(text);
      }
      args.dispatch({ type: 'error', message: formatError(error) });
      return false;
    }
  }, [args, composer]);

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
    const message: SteerQueueMessage = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString(),
    };
    updateSteerQueues((current) => appendSteerQueueMessage(current, sessionId, message));
    setComposer('');
  }, [args.state.activeSessionId, args.state.streaming, composer, updateSteerQueues]);

  const handleSteerQueueEdit = useCallback(
    (messageId: string, text: string): void => {
      const sessionId = args.state.activeSessionId;
      if (!sessionId) return;
      queueDrainBlockedMessageIdRef.current = null;
      updateSteerQueues((current) =>
        editSteerQueueMessage(current, sessionId, messageId, text),
      );
    },
    [args.state.activeSessionId, updateSteerQueues],
  );

  const handleSteerQueueRemove = useCallback(
    (messageId: string): void => {
      const sessionId = args.state.activeSessionId;
      if (!sessionId) return;
      if (queueDrainBlockedMessageIdRef.current === messageId) {
        queueDrainBlockedMessageIdRef.current = null;
      }
      updateSteerQueues((current) => removeSteerQueueMessage(current, sessionId, messageId));
    },
    [args.state.activeSessionId, updateSteerQueues],
  );

  const handleSteerQueueSendNow = useCallback(
    async (messageId: string): Promise<void> => {
      const sessionId = args.state.activeSessionId;
      if (!sessionId || !args.state.streaming) return;
      const message = (steerQueuesBySessionRef.current[sessionId] ?? []).find(
        (item) => item.id === messageId,
      );
      if (!message || steerQueueSendNowInProgressRef.current.has(messageId)) return;
      steerQueueSendNowInProgressRef.current.add(messageId);
      try {
        const accepted = await handleSteer(message.text);
        if (accepted) {
          if (queueDrainBlockedMessageIdRef.current === messageId) {
            queueDrainBlockedMessageIdRef.current = null;
          }
          updateSteerQueues((current) =>
            removeSteerQueueMessage(current, sessionId, messageId),
          );
        }
      } finally {
        steerQueueSendNowInProgressRef.current.delete(messageId);
      }
    },
    [args.state.activeSessionId, args.state.streaming, handleSteer, updateSteerQueues],
  );

  const submitQueuedPrompt = useCallback(
    async (sessionId: string, message: SteerQueueMessage): Promise<boolean> => {
      const clientMessageId = crypto.randomUUID();
      args.dispatch({ type: 'user/send', text: message.text, clientMessageId });
      try {
        const response = await args.hostClient.request({
          type: 'session/prompt',
          sessionId,
          input: buildPromptRequestInput({
            text: message.text,
            attachments: [],
            contextRefs: [],
            agentMode: args.agentMode,
            clientMessageId,
          }),
        });
        if (!response.success) {
          args.dispatch({ type: 'user/send-rollback', clientMessageId });
          args.dispatch({ type: 'error', message: response.error });
          return false;
        }
        applyAcceptedRun(response.data);
        return true;
      } catch (error) {
        args.dispatch({ type: 'user/send-rollback', clientMessageId });
        args.dispatch({ type: 'error', message: formatError(error) });
        return false;
      }
    },
    [applyAcceptedRun, args, buildPromptRequestInput],
  );

  useEffect(() => {
    const sessionId = args.state.activeSessionId;
    if (
      !sessionId ||
      args.state.streaming ||
      args.state.runPhase !== 'idle' ||
      args.state.runTerminal.kind === 'paused' ||
      args.state.workingSessionIds[sessionId] === true ||
      queueDrainInProgressRef.current
    ) {
      return;
    }
    const nextMessage = steerQueuesBySessionRef.current[sessionId]?.[0];
    if (!nextMessage || queueDrainBlockedMessageIdRef.current === nextMessage.id) {
      return;
    }
    queueDrainInProgressRef.current = true;
    void submitQueuedPrompt(sessionId, nextMessage).then((accepted) => {
      if (accepted) {
        updateSteerQueues((current) =>
          removeSteerQueueMessage(current, sessionId, nextMessage.id),
        );
      } else {
        queueDrainBlockedMessageIdRef.current = nextMessage.id;
      }
      queueDrainInProgressRef.current = false;
    });
  }, [
    args.state.activeSessionId,
    args.state.runPhase,
    args.state.runTerminal.kind,
    args.state.streaming,
    args.state.workingSessionIds,
    steerQueuesBySession,
    submitQueuedPrompt,
    updateSteerQueues,
  ]);

  const steerQueueMessages = args.state.activeSessionId
    ? (steerQueuesBySession[args.state.activeSessionId] ?? [])
    : [];

  return {
    composer,
    setComposer,
    draftSessions,
    activeDraftId,
    startNewDraft,
    resumeDraft,
    pendingAttachments,
    dropActive,
    setDropActive,
    revokePending,
    clearPendingAttachments,
    handleComposerPaste,
    handleComposerDrop,
    handlePickFiles,
    handlePickImageFiles,
    addWebElement,
    handleSend,
    retryPendingAttachment,
    handleSteer,
    handleFollowUp,
    steerQueueMessages,
    handleSteerQueueSendNow,
    handleSteerQueueEdit,
    handleSteerQueueRemove,
  };
}

function looksLikeFilesystemPath(value: string): boolean {
  if (value.includes('\n')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  return value.includes('/') && !value.includes(' ');
}

function isImagePromptAttachment(attachment: PromptAttachment): boolean {
  return (
    attachment.kind === 'media' &&
    (attachment.contentKind === 'image' ||
      (attachment.contentKind === undefined &&
        attachment.mimeType.trim().toLowerCase().startsWith('image/')))
  );
}
