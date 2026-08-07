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
  PromptAttachment,
  WebElementAttachmentRef,
  WebElementPickResult,
} from '@piwin/contracts';
import { formatError,  toMediaAttachmentRef } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import {
  fileToBase64,
  isPendingAttachmentReady,
  prepareComposerImageForSave,
  resolveImageMimeType,
  type PendingComposerAttachment,
} from '../media-utils.js';
import { applyAgentModeToPrompt, type AgentModeId } from '../agent-mode';
import {
  applySkillToPrompt,
  normalizeCompactCustomInstructions,
  parseComposerSlashSubmit,
} from '../slash';
import { PIWIN_PATH_MIME } from '../file-tree-panel';
import { deriveDefaultNameFromMessage } from '@piwin/session/derive-default-name';
import { isPlaceholderSessionName } from '../title-display';
import { canUseThinkingLevel } from '../model-thinking-policy';

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
  const sourceFilesRef = useRef(new Map<string, { file: File; source: 'paste' | 'drop' | 'file-picker' }>());
  /** Latest pending list for waiters that must not close over a stale render. */
  const pendingAttachmentsRef = useRef<PendingComposerAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  /**
   * Terminal media results keyed by localId. Send reads this after awaits so it
   * does not depend on React re-render timing.
   */
  const mediaSaveResultsRef = useRef(
    new Map<string, { ok: true; attachment: PromptAttachment } | { ok: false; error: string }>(),
  );

  // ── Draft text for unnamed (draft) sessions ────────────────────────────
  // When the user clicks "+" (New session), we enter draft mode
  // (activeSessionId = null) without creating a host session. Text typed in
  // draft mode is preserved across session switches so the user can resume
  // their thought after briefly checking another conversation.
  const draftTextRef = useRef('');
  // When a session is created on first send, activeSessionId transitions from
  // null → new id. The effect below would normally save the composer text as
  // draft, but the text is being sent — this flag tells the effect to skip.
  const skipDraftSaveRef = useRef(false);
  const prevActiveSessionIdRef = useRef<string | null>(args.state.activeSessionId);

  useEffect(() => {
    const prevId = prevActiveSessionIdRef.current;
    const currentId = args.state.activeSessionId;
    if (prevId === currentId) return;
    prevActiveSessionIdRef.current = currentId;

    const leavingDraft = prevId === null && currentId !== null;
    const enteringDraft = prevId !== null && currentId === null;

    if (leavingDraft) {
      if (skipDraftSaveRef.current) {
        // Session created on send — handleSend already cleared composer and draft.
        skipDraftSaveRef.current = false;
      } else {
        // User switched to an existing session — save draft, clear composer
        // so the draft text does not leak into the resumed session.
        draftTextRef.current = composer;
        setComposer('');
      }
    } else if (enteringDraft) {
      // User entered draft mode (clicked "+" or switched scope) — restore draft.
      setComposer(draftTextRef.current);
    }
    // else: switching between two existing sessions — no draft management.
    // composer intentionally omitted from deps; reading it here captures the
    // value at the time activeSessionId changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.state.activeSessionId]);

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
    if (isGeneral) {
      return args.ensureSession({ scope: { kind: 'general' } });
    }
    return args.ensureSession({ alreadyTrusted: true });
  }, [args]);

  /**
   * Attach an image with an immediate local preview, then save to the media
   * store in the background. Paste/drop must not wait on base64 + IPC.
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
      const mimeType = resolveImageMimeType(file, headerBytes);
      if (!mimeType) {
        removeLocalChip();
        args.dispatch({
          type: 'error',
          message: `Unsupported image type: ${file.type || file.name}`,
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

        const prepared = await prepareComposerImageForSave(file, mimeType);
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
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

  const enqueueImageFile = useCallback(
    (file: File, source: 'paste' | 'drop' | 'file-picker', existingLocalId?: string): void => {
      const localId = existingLocalId ?? crypto.randomUUID();
      cancelledAttachmentIdsRef.current.delete(localId);
      sourceFilesRef.current.set(localId, { file, source });
      mediaSaveResultsRef.current.delete(localId);

      if (!existingLocalId) {
        const previewUrl = URL.createObjectURL(file);
        // Optimistic MIME from File metadata; macOS clipboard pastes often
        // have an empty type and are refined from magic bytes in runMediaSave.
        const optimisticMime =
          resolveImageMimeType(file) ??
          (file.type.trim().toLowerCase().startsWith('image/')
            ? file.type.trim().toLowerCase()
            : 'image/png');
        const placeholderAttachment: PromptAttachment = {
          id: localId,
          kind: 'media',
          path: `pending://${localId}`,
          mimeType: optimisticMime === 'image/jpg' ? 'image/jpeg' : optimisticMime,
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
          message: 'Cannot retry this image — remove it and paste again.',
        });
        return;
      }
      enqueueImageFile(source.file, source.source, localId);
    },
    [args, enqueueImageFile],
  );

  /**
   * Wait until every media chip is ready (or failed/removed).
   * Used by Send so the user can press Enter immediately after paste.
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
      const imageFiles: File[] = [];
      for (const item of items) {
        // Some pastes expose image/*; others only give a file with empty type.
        if (item.kind === 'file' && (item.type.startsWith('image/') || item.type === '')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }
      if (imageFiles.length === 0) {
        return;
      }
      event.preventDefault();
      // Fire-and-forget: each file paints a chip immediately, then saves async.
      for (const file of imageFiles) {
        enqueueImageFile(file, 'paste');
      }
    },
    [enqueueImageFile],
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
          if (absolutePath) {
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
        (file) => resolveImageMimeType(file) !== null || file.type.startsWith('image/'),
      );
      for (const file of files) {
        enqueueImageFile(file, 'drop');
      }
    },
    [enqueueImageFile],
  );

  const handlePickImageFiles = useCallback((): void => {
    // Session is created lazily inside enqueueImageFile when needed.
    const isGeneral = args.state.activeScope.kind === 'general' || !args.state.projectPath;
    if (!isGeneral && !args.state.projectTrusted && !args.state.activeSessionId) {
      args.dispatch({ type: 'project/trust-dialog', open: true });
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/webp,image/gif';
    input.multiple = true;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      for (const file of files) {
        enqueueImageFile(file, 'file-picker');
      }
    };
    input.click();
  }, [args, enqueueImageFile]);

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
      agentMode: AgentModeId;
      clientMessageId?: string;
    }): {
      text: string;
      attachments?: PromptAttachment[];
      model?: import('@piwin/contracts').ModelRef;
      thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
      agentMode?: import('@piwin/contracts').AgentModeId;
      orchestrationSchemeId?: string;
      clientMessageId?: string;
    } => {
      const input: {
        text: string;
        attachments?: PromptAttachment[];
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
    [args.modelOptions, args.selectedModelKey, args.thinkingLevel, args.orchestrationSchemeId, resolveTurnModel],
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
    }): string => {
      const clientMessageId = crypto.randomUUID();
      args.dispatch({
        type: 'user/send',
        text: params.displayText ?? params.text,
        attachments: params.attachments ?? [],
        clientMessageId,
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
                ? 'One image failed to save — tap Retry on the chip, or remove it.'
                : `${waitedFailed.length} images failed to save — tap Retry or remove them.`,
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

      const hasMedia = attachments.some((item) => item.kind === 'media');
      if (hasMedia) {
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
      if (wasInDraftMode) {
        skipDraftSaveRef.current = true;
        draftTextRef.current = '';
      }

      let clientMessageId: string | null = null;
      let displayText = text;
      let hostPromptText = applyAgentModeToPrompt(args.agentMode, text);
      let promptAgentMode: AgentModeId = args.agentMode;
      let promptAttachments: PromptAttachment[] = attachments;

      if (text.startsWith('/') && attachments.length === 0) {
        const skills = (args.menuSkills ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: skill.enabled,
        }));
        const parsed = parseComposerSlashSubmit(text, skills);
        if (parsed.kind === 'mode' && parsed.args) {
          args.onAgentModeChange?.(parsed.modeId);
          displayText = parsed.args;
          hostPromptText = applyAgentModeToPrompt(parsed.modeId, parsed.args);
          promptAgentMode = parsed.modeId;
          promptAttachments = [];
        } else if (parsed.kind === 'skill') {
          const hostText = applySkillToPrompt(parsed.skillName, parsed.skillId, parsed.args);
          hostPromptText = applyAgentModeToPrompt(args.agentMode, hostText);
          promptAttachments = [];
        }
      }

      clientMessageId = paintOptimisticUserSend({
        text,
        displayText,
        attachments: promptAttachments,
      });

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
      resolveSessionIdForComposer,
      rollbackOptimisticUserSend,
      waitForPendingMediaSaves,
    ],
  );

  const handleSteer = useCallback(async (): Promise<void> => {
    const text = composer.trim();
    if (!text || !args.state.activeSessionId || !args.state.streaming) {
      return;
    }
    // Paint-first local echo so Enter does not wait on host ACK.
    const clientMessageId = paintOptimisticUserSend({
      text,
      displayText: `[Steer] ${text}`,
      attachments: [],
    });
    try {
      const response = await args.hostClient.request({
        type: 'session/steer',
        sessionId: args.state.activeSessionId,
        message: text,
        ...(args.state.activeRunId ? { runId: args.state.activeRunId } : {}),
      });
      if (!response.success) {
        rollbackOptimisticUserSend(clientMessageId, text);
        args.dispatch({ type: 'error', message: response.error });
      }
    } catch (error) {
      rollbackOptimisticUserSend(clientMessageId, text);
      args.dispatch({ type: 'error', message: formatError(error) });
    }
  }, [args, composer, paintOptimisticUserSend, rollbackOptimisticUserSend]);

  const handleFollowUp = useCallback(async (): Promise<void> => {
    const text = composer.trim();
    if (!text || !args.state.activeSessionId || !args.state.streaming) {
      return;
    }
    const clientMessageId = paintOptimisticUserSend({
      text,
      displayText: `[Follow-up] ${text}`,
      attachments: [],
    });
    try {
      const response = await args.hostClient.request({
        type: 'session/follow_up',
        sessionId: args.state.activeSessionId,
        message: text,
        ...(args.state.activeRunId ? { runId: args.state.activeRunId } : {}),
      });
      if (!response.success) {
        rollbackOptimisticUserSend(clientMessageId, text);
        args.dispatch({ type: 'error', message: response.error });
      }
    } catch (error) {
      rollbackOptimisticUserSend(clientMessageId, text);
      args.dispatch({ type: 'error', message: formatError(error) });
    }
  }, [args, composer, paintOptimisticUserSend, rollbackOptimisticUserSend]);

  return {
    composer,
    setComposer,
    pendingAttachments,
    dropActive,
    setDropActive,
    revokePending,
    clearPendingAttachments,
    handleComposerPaste,
    handleComposerDrop,
    handlePickImageFiles,
    addWebElement,
    handleSend,
    retryPendingAttachment,
    handleSteer,
    handleFollowUp,
  };
}

function looksLikeFilesystemPath(value: string): boolean {
  if (value.includes('\n')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  return value.includes('/') && !value.includes(' ');
}
