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
  QueuedTurnRecord,
  RunInterventionRecord,
  WebElementAttachmentRef,
  WebElementPickResult,
} from '@piwin/contracts';
import { ATTACHMENT_FILE_ACCEPT, formatError, toMediaAttachmentRef } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState, SkillActivityView } from '../chat-reducer';
import {
  applyChipPreviewUrl,
  commitLimitedChipPreview,
  fileToBase64,
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
import { getDesktopCopy } from '../desktop-locale.js';
import { useDesktopLocale } from '../desktop-locale-context.js';
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
import type { SteerQueueMessage } from '../steer-queue-model';
import type { ForegroundRunMismatchProblem } from '@piwin/contracts';
import {
  foregroundMismatchNotice,
  readForegroundProblem,
  requestPromptWithForeground,
  type BusyRunChoice,
} from '../prompt-foreground';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { hostFailureNotice, hostReconnectNotice } from '../host-problem-copy.js';
import { shouldBlockRemoteHostGesture } from '../host-reconnect-gate.js';
import { flattenUnsafeRemoteContextRefs } from '../remote-context-refs.js';
import { pushError, type NotificationAction } from '../notification-queue';

export type UseComposerMediaArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification?: Dispatch<NotificationAction>;
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
  /** ORCH: omit the model-facing delegation tool for this turn. */
  delegationDisabled?: boolean;
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
  confirmForegroundReplace?: (problem: ForegroundRunMismatchProblem) => Promise<boolean>;
  confirmBusyRun?: (problem: ForegroundRunMismatchProblem) => Promise<BusyRunChoice>;
  /** CM: pending structured context refs for session/prompt. */
  getPendingContextRefs?: () => PromptContextRef[];
  /** CM: token-stable snapshot so a send never re-reads mutable chips. */
  getPendingContextRefTokens?: () => import('./use-composer-context-refs').ContextRefSnapshot;
  /** CM: clear chips after a successful optimistic send paint. */
  clearPendingContextRefs?: () => void;
  /** CM: consume only the ref instances this send actually captured. */
  consumePendingContextRefs?: (
    snapshot: import('./use-composer-context-refs').ContextRefSnapshot,
  ) => void;
  /** CM: restore chips for a session/draft snapshot (session isolation). */
  restorePendingContextRefs?: (refs: PromptContextRef[]) => void;
  /**
   * CM-08: convert a workspace file-tree path drop into a structured context
   * ref. Return false to fall back to inserting the path text into the composer.
   */
  addContextRefFromDrop?: (payload: {
    absolutePath: string;
    relativePath: string;
  }) => boolean;
  /** Conversation chat ignores Agent slash modes, skills, and orchestration. */
  conversationChat?: boolean;
  /** Open Knowledge Center overlay on slash command submit (/knowledge, /notes). */
  onOpenKnowledge?: (subTab?: 'doccards' | 'cards' | 'wiki') => void;
  /** Open the right-panel Flashcards due queue (/flashcards). */
  onOpenCardsPanel?: () => void;
};

type SessionComposerSnapshot = {
  text: string;
  attachments: PendingComposerAttachment[];
  contextRefs: PromptContextRef[];
};

/**
 * Cap on per-session unsent composer snapshots. Each snapshot pins its
 * attachments' object URLs and source Files until disposed, so an uncapped
 * map grows without bound while the user hops between sessions with pasted
 * media. Evicted (and cleared) snapshots dispose their attachments.
 */
export const MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS = 8;

export function useComposerMedia(args: UseComposerMediaArgs) {
  const { locale } = useDesktopLocale();
  const attachmentCopy = getDesktopCopy(locale).composer;
  const [composer, setComposer] = useState('');
  const composerRef = useRef('');
  composerRef.current = composer;
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
  /** Original File retained until Send (and one-tap retry after a failed save). */
  const sourceFilesRef = useRef(
    new Map<string, { file: File; source: 'paste' | 'drop' | 'file-picker' }>(),
  );
  /** Latest pending list for waiters that must not close over a stale render. */
  const pendingAttachmentsRef = useRef<PendingComposerAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  /** Structured refs for trusted workspace-tree drops; never inject absolute paths. */
  const pendingContextRefsRef = useRef<PromptContextRef[]>([]);
  /**
   * Visible chips live in useComposerContextRefs (external authority). Prefer
   * that list for snapshots/content checks; the internal ref is only a fallback
   * for harnesses without the external wiring.
   */
  const readVisibleContextRefs = useCallback((): PromptContextRef[] => {
    return args.getPendingContextRefs?.() ?? [...pendingContextRefsRef.current];
  }, [args]);
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

  // ── Local composer drafts ───────────────────────────────────────────────
  // Draft rows are deliberately Desktop-local. A Host session is still only
  // created when the user sends, so switching away never leaves empty durable
  // sessions behind.
  const [draftSessions, setDraftSessions] = useState<DraftSessionItemUi[]>([]);
  const draftSessionsRef = useRef<DraftSessionItemUi[]>([]);
  const draftComposerSnapshotsRef = useRef(new Map<string, SessionComposerSnapshot>());
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const activeDraftIdRef = useRef<string | null>(null);
  /** Draft record associated with the current composer, even while its row is not selected. */
  const currentDraftIdRef = useRef<string | null>(null);
  const draftTextRef = useRef('');
  /** Per-session unsent composer state (text + chips + refs). */
  const sessionComposerSnapshotsRef = useRef(new Map<string, SessionComposerSnapshot>());
  /** Scope chosen by the New Agent entry point, independent of async navigation. */
  const currentDraftScopeRef = useRef(args.state.activeScope);
  const previousActiveScopeRef = useRef(args.state.activeScope);
  // When a session is created on first send, activeSessionId transitions from
  // null → new id. The effect below would normally save the composer text as
  // draft, but the text is being sent — this flag tells the effect to skip.
  const skipDraftSaveRef = useRef(false);
  /**
   * Safety net for the null → session transition during Send: media/save is
   * deferred until Send, and `skipDraftSaveRef` is set before the session is
   * ensured, so `decideDraftTransition` already short-circuits. Kept so a
   * session activation triggered inside `resolveSessionIdForComposer` can
   * never take the "user switched sessions" clear path.
   */
  const preserveComposerOnSessionActivationRef = useRef(false);
  const prevActiveSessionIdRef = useRef<string | null>(args.state.activeSessionId);
  const activeSessionIdRef = useRef<string | null>(args.state.activeSessionId);
  activeSessionIdRef.current = args.state.activeSessionId;

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

  const setActiveDraft = useCallback((draftId: string | null): void => {
    activeDraftIdRef.current = draftId;
    setActiveDraftId(draftId);
  }, []);

  const upsertCurrentDraft = useCallback(
    (text: string, scope: import('@piwin/contracts').SessionScope): void => {
      const attachments = [...pendingAttachmentsRef.current];
      const contextRefs = readVisibleContextRefs();
      if (text.trim().length === 0 && attachments.length === 0 && contextRefs.length === 0) {
        return;
      }
      const draftId = currentDraftIdRef.current ?? activeDraftIdRef.current ?? crypto.randomUUID();
      const existing = draftSessionsRef.current.find((draft) => draft.id === draftId);
      const createdAt = existing?.createdAt ?? new Date().toISOString();
      const attachmentTitle = attachments
        .map((item) =>
          item.attachment.kind === 'media'
            ? item.attachment.name?.trim()
            : item.attachment.text.trim().slice(0, 80),
        )
        .find((name) => name);
      const draft: DraftSessionItemUi = {
        id: draftId,
        name: text.trim().replace(/\s+/g, ' ') || attachmentTitle || 'Attachment draft',
        text,
        createdAt,
        updatedAt: existing?.updatedAt ?? createdAt,
        scope,
        isDraft: true,
      };
      const next = [draft, ...draftSessionsRef.current.filter((item) => item.id !== draftId)];
      draftSessionsRef.current = next;
      draftComposerSnapshotsRef.current.set(draftId, { text, attachments, contextRefs });
      setDraftSessions(sortDraftSessions(next));
      currentDraftIdRef.current = draftId;
      setActiveDraft(draftId);
      draftTextRef.current = text;
    },
    [readVisibleContextRefs, setActiveDraft],
  );

  /**
   * Release the local resources of detached attachments: object URL, retained
   * source File, and any parked media/save result. Called after `session/prompt`
   * ACKs, on snapshot eviction/clear, and on teardown.
   */
  const disposeComposerAttachments = useCallback(
    (attachments: PendingComposerAttachment[]): void => {
      for (const item of attachments) {
        cancelledAttachmentIdsRef.current.add(item.localId);
        sourceFilesRef.current.delete(item.localId);
        mediaSaveResultsRef.current.delete(item.localId);
        revokePendingAttachmentUrls(item);
      }
    },
    [],
  );

  const removeCurrentDraft = useCallback((): void => {
    const draftId = currentDraftIdRef.current ?? activeDraftIdRef.current;
    currentDraftIdRef.current = null;
    setActiveDraft(null);
    draftTextRef.current = '';
    if (!draftId) return;
    const droppedSnapshot = draftComposerSnapshotsRef.current.get(draftId);
    draftComposerSnapshotsRef.current.delete(draftId);
    if (droppedSnapshot) {
      disposeComposerAttachments(droppedSnapshot.attachments);
    }
    const next = draftSessionsRef.current.filter((draft) => draft.id !== draftId);
    draftSessionsRef.current = next;
    setDraftSessions(next);
  }, [disposeComposerAttachments, setActiveDraft]);

  const saveSessionComposerSnapshot = useCallback(
    (sessionId: string): void => {
      const snapshot: SessionComposerSnapshot = {
        text: composerRef.current,
        attachments: [...pendingAttachmentsRef.current],
        contextRefs: readVisibleContextRefs(),
      };
      if (
        snapshot.text.trim().length === 0 &&
        snapshot.attachments.length === 0 &&
        snapshot.contextRefs.length === 0
      ) {
        const previous = sessionComposerSnapshotsRef.current.get(sessionId);
        sessionComposerSnapshotsRef.current.delete(sessionId);
        if (previous) {
          disposeComposerAttachments(previous.attachments);
        }
        return;
      }
      // Delete-then-set refreshes LRU recency for the just-saved session.
      sessionComposerSnapshotsRef.current.delete(sessionId);
      sessionComposerSnapshotsRef.current.set(sessionId, snapshot);
      while (sessionComposerSnapshotsRef.current.size > MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS) {
        const oldest = sessionComposerSnapshotsRef.current.entries().next();
        const [oldestId, oldestSnapshot] = oldest.value ?? [];
        if (oldest.done || oldestId === undefined || oldestSnapshot === undefined) break;
        sessionComposerSnapshotsRef.current.delete(oldestId);
        // The active session's chips may still be live in the composer; only
        // dispose attachments that no other holder can reach.
        if (oldestId !== activeSessionIdRef.current) {
          disposeComposerAttachments(oldestSnapshot.attachments);
        }
      }
    },
    [disposeComposerAttachments, readVisibleContextRefs],
  );

  const restoreSessionComposerSnapshot = useCallback(
    (sessionId: string): void => {
      const snapshot = sessionComposerSnapshotsRef.current.get(sessionId);
      const text = snapshot?.text ?? '';
      const contextRefs = [...(snapshot?.contextRefs ?? [])];
      composerRef.current = text;
      pendingAttachmentsRef.current = [...(snapshot?.attachments ?? [])];
      pendingContextRefsRef.current = contextRefs;
      currentDraftIdRef.current = null;
      setActiveDraft(null);
      setComposer(text);
      setPendingAttachments([...(snapshot?.attachments ?? [])]);
      args.restorePendingContextRefs?.(contextRefs);
    },
    [args, setActiveDraft, setComposer],
  );

  const restoreDraftComposerSnapshot = useCallback(
    (draft: DraftSessionItemUi): void => {
      const snapshot = draftComposerSnapshotsRef.current.get(draft.id) ?? {
        text: draft.text,
        attachments: [],
        contextRefs: [],
      };
      composerRef.current = snapshot.text;
      pendingAttachmentsRef.current = [...snapshot.attachments];
      pendingContextRefsRef.current = [...snapshot.contextRefs];
      currentDraftScopeRef.current = draft.scope;
      draftTextRef.current = snapshot.text;
      setComposer(snapshot.text);
      setPendingAttachments([...snapshot.attachments]);
      args.restorePendingContextRefs?.([...snapshot.contextRefs]);
    },
    [args, setComposer],
  );

  // Teardown sweep: no holder may outlive the hook, so every retained blob
  // URL and source File (session snapshots, draft snapshots, live chips) is
  // released here instead of leaking until page reload.
  useEffect(
    () => () => {
      for (const snapshot of sessionComposerSnapshotsRef.current.values()) {
        disposeComposerAttachments(snapshot.attachments);
      }
      sessionComposerSnapshotsRef.current.clear();
      for (const snapshot of draftComposerSnapshotsRef.current.values()) {
        disposeComposerAttachments(snapshot.attachments);
      }
      draftComposerSnapshotsRef.current.clear();
      disposeComposerAttachments(pendingAttachmentsRef.current);
    },
    [disposeComposerAttachments],
  );

  /** Start an empty composer without restoring the previously selected draft. */
  const startNewDraft = useCallback(
    (scope?: import('@piwin/contracts').SessionScope): void => {
      const sessionId = activeSessionIdRef.current;
      if (sessionId !== null) {
        saveSessionComposerSnapshot(sessionId);
      } else if (
        composerRef.current.trim().length > 0 ||
        pendingAttachmentsRef.current.length > 0 ||
        readVisibleContextRefs().length > 0
      ) {
        upsertCurrentDraft(composerRef.current, currentDraftScopeRef.current);
      } else if (currentDraftIdRef.current !== null || activeDraftIdRef.current !== null) {
        removeCurrentDraft();
      }
      currentDraftIdRef.current = null;
      setActiveDraft(null);
      draftTextRef.current = '';
      composerRef.current = '';
      pendingAttachmentsRef.current = [];
      pendingContextRefsRef.current = [];
      setComposer('');
      setPendingAttachments([]);
      args.restorePendingContextRefs?.([]);
      currentDraftScopeRef.current = scope ?? args.state.activeScope;
    },
    [
      args.state.activeScope,
      removeCurrentDraft,
      saveSessionComposerSnapshot,
      setActiveDraft,
      setComposer,
      upsertCurrentDraft,
    ],
  );

  const resumeDraft = useCallback(
    (draftId: string): void => {
      const draft = draftSessionsRef.current.find((item) => item.id === draftId);
      if (!draft) return;
      const sessionId = activeSessionIdRef.current;
      if (sessionId !== null) {
        saveSessionComposerSnapshot(sessionId);
      } else {
        const currentDraftId = currentDraftIdRef.current ?? activeDraftIdRef.current;
        if (currentDraftId !== draftId) {
          if (
            composerRef.current.trim().length > 0 ||
            pendingAttachmentsRef.current.length > 0 ||
            readVisibleContextRefs().length > 0
          ) {
            upsertCurrentDraft(composerRef.current, currentDraftScopeRef.current);
          } else if (currentDraftId !== null) {
            removeCurrentDraft();
          }
        }
      }
      currentDraftIdRef.current = draft.id;
      setActiveDraft(draft.id);
      restoreDraftComposerSnapshot(draft);
      if (sessionId !== null) {
        args.dispatch({ type: 'session/clear-active' });
      }
    },
    [
      args,
      removeCurrentDraft,
      restoreDraftComposerSnapshot,
      saveSessionComposerSnapshot,
      setActiveDraft,
      upsertCurrentDraft,
    ],
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
    const snapshot = draftComposerSnapshotsRef.current.get(draftId);
    if (snapshot) {
      draftComposerSnapshotsRef.current.set(draftId, { ...snapshot, text: composer });
    }
  }, [composer]);

  // Host-less blank composer follows the latest navigation scope. Contentful
  // drafts keep their explicit/restored binding.
  useEffect(() => {
    if (args.state.activeSessionId !== null) {
      return;
    }
    const hasContent =
      composerRef.current.trim().length > 0 ||
      pendingAttachmentsRef.current.length > 0 ||
      readVisibleContextRefs().length > 0 ||
      currentDraftIdRef.current !== null ||
      activeDraftIdRef.current !== null;
    if (hasContent) {
      return;
    }
    currentDraftScopeRef.current = args.state.activeScope;
  }, [args.state.activeScope, args.state.activeSessionId]);

  useEffect(() => {
    const prevId = prevActiveSessionIdRef.current;
    const currentId = args.state.activeSessionId;
    const previousScope = previousActiveScopeRef.current;
    previousActiveScopeRef.current = args.state.activeScope;
    if (prevId === currentId) return;
    prevActiveSessionIdRef.current = currentId;

    // Switching between two real sessions must not leak the old composer text
    // into the newly selected session, and must not create a phantom draft row.
    // Each session owns an independent composer snapshot.
    if (prevId !== null && currentId !== null) {
      saveSessionComposerSnapshot(prevId);
      restoreSessionComposerSnapshot(currentId);
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
        // User switched to an existing session — park any unsent content as a
        // draft row, then restore that session's own snapshot.
        if (
          composer.trim().length > 0 ||
          pendingAttachmentsRef.current.length > 0 ||
          readVisibleContextRefs().length > 0
        ) {
          upsertCurrentDraft(composer, previousScope);
        } else if (currentDraftIdRef.current !== null) {
          removeCurrentDraft();
        }
        currentDraftIdRef.current = null;
        setActiveDraft(null);
        setComposer('');
        if (currentId !== null) {
          restoreSessionComposerSnapshot(currentId);
        }
        break;
      case 'restore-draft':
        // Only an explicitly resumed phantom draft restores old New Agent
        // text. Scope changes also pass through activeSessionId=null and must
        // not resurrect a previously parked draft while another session loads.
        preserveComposerOnSessionActivationRef.current = false;
        const draftId = currentDraftIdRef.current ?? activeDraftIdRef.current;
        const draft = draftId
          ? draftSessionsRef.current.find((item) => item.id === draftId)
          : undefined;
        if (draft) {
          restoreDraftComposerSnapshot(draft);
        } else {
          composerRef.current = '';
          pendingAttachmentsRef.current = [];
          pendingContextRefsRef.current = [];
          setComposer('');
          setPendingAttachments([]);
        }
        break;
    }
    // composer intentionally omitted from deps; reading it here captures the
    // value at the time activeSessionId changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.state.activeSessionId,
    args.state.activeScope,
    readVisibleContextRefs,
    removeCurrentDraft,
    restoreDraftComposerSnapshot,
    restoreSessionComposerSnapshot,
    saveSessionComposerSnapshot,
    setActiveDraft,
    setComposer,
    upsertCurrentDraft,
  ]);

  const revokePending = useCallback((localId: string): void => {
    cancelledAttachmentIdsRef.current.add(localId);
    sourceFilesRef.current.delete(localId);
    mediaSaveResultsRef.current.delete(localId);
    setPendingAttachments((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) {
        revokePendingAttachmentUrls(target);
      }
      return current.filter((item) => item.localId !== localId);
    });
  }, []);

  const clearPendingAttachments = useCallback((): void => {
    pendingContextRefsRef.current = [];
    setPendingAttachments((current) => {
      for (const item of current) {
        cancelledAttachmentIdsRef.current.add(item.localId);
        sourceFilesRef.current.delete(item.localId);
        mediaSaveResultsRef.current.delete(item.localId);
        revokePendingAttachmentUrls(item);
      }
      return [];
    });
  }, []);

  /**
   * A queued turn is represented by the Host queue until it starts. Keep the
   * composer cleared while admission is in flight, but do not create a second
   * optimistic transcript row: the Host's queued-turn projection is the
   * single durable source for that pending message.
   */
  const clearComposerForQueuedAdmission = useCallback((): void => {
    setComposer('');
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
  }, []);

  const resolveSessionIdForComposer = useCallback(async (): Promise<string | null> => {
    if (args.state.activeSessionId) {
      return args.state.activeSessionId;
    }
    // Explicit New Agent scope binding (clicked project folder / restored
    // draft) wins over the latest navigation scope, so project first-send
    // never falls back to a General session.
    const draftScope = currentDraftScopeRef.current;
    const isGeneral = draftScope.kind === 'general';
    const draftProjectTrusted =
      draftScope.kind === 'project' &&
      args.state.projectPath === draftScope.projectPath &&
      args.state.projectTrusted;
    if (!isGeneral && !draftProjectTrusted) {
      args.dispatch({ type: 'project/trust-dialog', open: true });
      return null;
    }
    if (!args.ensureSession) {
      notifyError('Create a session before sending');
      return null;
    }
    // We only reach this point from draft mode (activeSessionId was null).
    // Creating the session activates it in the reducer, which normally runs
    // the draft-exit effect and clears the composer. handleSend sets
    // skipDraftSaveRef first, so the send path still clears.
    const sessionId = isGeneral
      ? await args.ensureSession({ scope: { kind: 'general' } })
      : await args.ensureSession({
          scope: draftScope,
          projectPath: draftScope.projectPath,
          alreadyTrusted: true,
        });
    if (sessionId) {
      preserveComposerOnSessionActivationRef.current = true;
    }
    return sessionId;
  }, [args]);

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
        sourceFilesRef.current.delete(localId);
        mediaSaveResultsRef.current.delete(localId);
        setPendingAttachments((current) => {
          const target = current.find((item) => item.localId === localId);
          if (target) {
            revokePendingAttachmentUrls(target);
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

        const base64Data = await fileToBase64(prepared.blob);
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }

        // A thrown request is a transport/IPC failure (retry usually helps);
        // success:false means the Host received and rejected the save (policy).
        let response;
        try {
          response = await args.hostClient.request({
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
        } catch (error) {
          markError(formatError(error), 'connection');
          return;
        }
        if (cancelledAttachmentIdsRef.current.has(localId)) {
          return;
        }
        if (!response.success) {
          markError(response.error, 'policy');
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
    [args, attachmentCopy],
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
                setPendingAttachments((current) =>
                  applyChipPreviewUrl(current, localId, previewUrl).next,
                );
              }
            },
            () => cancelledAttachmentIdsRef.current.has(localId),
          );
          setPendingAttachments((current) => [
            ...current,
            {
              localId,
              attachment: placeholderAttachment,
              previewUrl: '',
              lightboxUrl,
              uploadStatus: 'queued',
            },
          ]);
        } else {
          setPendingAttachments((current) => [
            ...current,
            {
              localId,
              attachment: placeholderAttachment,
              previewUrl: URL.createObjectURL(file),
              uploadStatus: 'queued',
            },
          ]);
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
    for (const item of failed) {
      cancelledAttachmentIdsRef.current.add(item.localId);
      sourceFilesRef.current.delete(item.localId);
      mediaSaveResultsRef.current.delete(item.localId);
      revokePendingAttachmentUrls(item);
    }
    const next = pendingAttachmentsRef.current.filter((item) => !isFailedMediaAttachment(item));
    pendingAttachmentsRef.current = next;
    setPendingAttachments(next);
  }, []);

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
      skillId?: string;
    }): {
      text: string;
      attachments?: PromptAttachment[];
      contextRefs?: PromptContextRef[];
      model?: import('@piwin/contracts').ModelRef;
      thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
      agentMode?: import('@piwin/contracts').AgentModeId;
      orchestrationSchemeId?: string;
      clientMessageId?: string;
      skillId?: string;
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
        skillId?: string;
      } = {
        text: params.text,
      };
      if (args.conversationChat !== true) {
        input.agentMode = params.agentMode;
      }
      if (params.clientMessageId && params.clientMessageId.trim().length > 0) {
        input.clientMessageId = params.clientMessageId.trim();
      }
      if (args.conversationChat !== true && params.skillId && params.skillId.trim().length > 0) {
        input.skillId = params.skillId.trim();
      }
      const schemeId = args.orchestrationSchemeId?.trim();
      if (args.conversationChat !== true && schemeId && schemeId !== 'off') {
        input.orchestrationSchemeId = schemeId;
      }
      if (params.attachments && params.attachments.length > 0) {
        input.attachments = params.attachments;
      }
      // Immutable send snapshot: never re-read live pending refs.
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
      args.orchestrationSchemeId,
      args.selectedModelKey,
      args.thinkingLevel,
      args.conversationChat,

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
      contextRefs?: PromptContextRef[];
      displayText?: string;
      skill?: SkillActivityView;
    }): string => {
      const clientMessageId = crypto.randomUUID();
      args.dispatch({
        type: 'user/send',
        text: params.displayText ?? params.text,
        attachments: params.attachments ?? [],
        ...(params.contextRefs && params.contextRefs.length > 0
          ? { contextRefs: params.contextRefs }
          : {}),
        clientMessageId,
        ...(params.skill ? { skill: params.skill } : {}),
      });
      setComposer('');
      // Hide chips without releasing them: File, blob URL and save results
      // survive until the session/prompt ACK. On failure the snapshot is
      // restored; on ACK disposeComposerAttachments releases everything.
      pendingAttachmentsRef.current = [];
      setPendingAttachments([]);
      return clientMessageId;
    },
    [args],
  );

  const rollbackOptimisticUserSend = useCallback(
    (
      clientMessageId: string,
      restoreText: string,
      restoreAttachments?: PendingComposerAttachment[],
    ): void => {
      args.dispatch({ type: 'user/send-rollback', clientMessageId });
      composerRef.current = restoreText;
      setComposer(restoreText);
      if (restoreAttachments && restoreAttachments.length > 0) {
        pendingAttachmentsRef.current = [...restoreAttachments];
        setPendingAttachments([...restoreAttachments]);
      }
      // Send from New Agent deletes the local draft before ACK. If Host never
      // accepted the turn, park the unsent text: live session → composer
      // snapshot, still-draft → draft row. Reconnect must not restore empty.
      skipDraftSaveRef.current = false;
      const sessionId = activeSessionIdRef.current;
      if (sessionId) {
        sessionComposerSnapshotsRef.current.delete(sessionId);
        sessionComposerSnapshotsRef.current.set(sessionId, {
          text: restoreText,
          attachments: [...(restoreAttachments ?? pendingAttachmentsRef.current)],
          contextRefs: [...pendingContextRefsRef.current],
        });
      } else {
        upsertCurrentDraft(restoreText, currentDraftScopeRef.current);
      }
    },
    [args, upsertCurrentDraft],
  );

  const refreshQueuedTurnQueue = useCallback(
    (sessionId: string): void => {
      void args.hostClient
        .request({ type: 'session/queued-turn-list', sessionId })
        .then((response) => {
          if (!response.success) return;
          const data = response.data as
            | { queueRevision?: unknown; queuedTurns?: unknown }
            | undefined;
          if (
            data === undefined ||
            !Number.isSafeInteger(data.queueRevision) ||
            !Array.isArray(data.queuedTurns)
          ) {
            return;
          }
          args.dispatch({
            type: 'session/queued-turns-hydrate',
            sessionId,
            queueRevision: data.queueRevision as number,
            queuedTurns: data.queuedTurns as QueuedTurnRecord[],
          });
        })
        .catch((error: unknown) => {
          args.dispatch({ type: 'error', message: formatError(error) });
        });
    },
    [args],
  );

  const handleSend = useCallback(
    async (overrideText?: string): Promise<void> => {
      const text = (overrideText ?? composer).trim();
      if (promptSubmissionInProgress.current) {
        return;
      }
      if (shouldBlockRemoteHostGesture(args.hostClient)) {
        notifyError(hostReconnectNotice(locale));
        return;
      }
      // Legacy Host checkpoint pause (CLI): clear it so a normal prompt can
      // proceed. Desktop no longer exposes Pause/Continue as a second control.
      if (args.state.runTerminal.kind === 'paused' && args.state.activeSessionId) {
        const clearPause = await args.hostClient.request({
          type: 'session/abort',
          sessionId: args.state.activeSessionId,
        });
        if (!clearPause.success) {
          args.dispatch({ type: 'error', message: clearPause.error });
          return;
        }
        args.dispatch({ type: 'run/terminal-dismiss' });
      }

      const promptRefsSnapshot = args.getPendingContextRefTokens?.() ?? null;
      const contextRefs = promptRefsSnapshot
        ? promptRefsSnapshot.items.map((item) => item.ref)
        : (args.getPendingContextRefs?.() ?? []);

      // Failed chips are never dropped into a prompt silently and never
      // auto-retried here. The composer confirmation (Phase 0) resolves them
      // through retryFailedAttachments/discardFailedAttachments before this
      // point; anything left is a hard stop that keeps the draft intact.
      const failedChipsAtEntry = pendingAttachmentsRef.current.filter(isFailedMediaAttachment);
      if (failedChipsAtEntry.length > 0) {
        args.dispatch({
          type: 'error',
          message: attachmentCopy.attachmentSendBlocked(failedChipsAtEntry.length),
        });
        return;
      }

      // ADR 0045 compatibility path: pastes are queued locally and only reach
      // `media/save` here, after Send resolves the destination session. The
      // bubble must carry real Host attachment refs, so deferred saves run
      // before the optimistic paint. Error chips stay visible for Retry.
      const deferredChips = [...pendingAttachmentsRef.current].filter(
        (item) =>
          item.attachment.kind === 'media' &&
          !isPendingAttachmentReady(item) &&
          item.uploadStatus !== 'error',
      );

      const wasInDraftMode = !args.state.activeSessionId;
      const isGeneral = args.state.activeScope.kind === 'general' || !args.state.projectPath;

      // Sync gates before paint so we never flash a bubble that cannot send.
      // The check itself stays synchronous so a plain trusted send still paints
      // in the same turn as Enter; only a missing workspace awaits the picker.
      const checkSendGates = (): { ok: true } | { ok: false; awaitWorkspacePicker?: true } => {
        if (!isGeneral) {
          if (!args.state.projectPath) {
            return { ok: false, awaitWorkspacePicker: true };
          }
          if (!args.state.projectTrusted) {
            args.dispatch({ type: 'project/trust-dialog', open: true });
            return { ok: false };
          }
        }
        return { ok: true };
      };

      let deferredSessionId: string | null = null;
      if (deferredChips.length > 0) {
        const gates = checkSendGates();
        if (!gates.ok) {
          if (gates.awaitWorkspacePicker) {
            await args.onNeedWorkspace?.();
          }
          return;
        }
        // Sending consumes the local draft row, if this composer was resumed
        // from one. The newly created Host session will replace it in the list.
        removeCurrentDraft();
        if (wasInDraftMode) {
          skipDraftSaveRef.current = true;
          draftTextRef.current = '';
        }
        markAttachmentUploadStatus(
          deferredChips.map((item) => item.localId),
          'saving',
        );
        const sessionId = await resolveSessionIdForComposer();
        if (!sessionId) {
          if (wasInDraftMode) {
            skipDraftSaveRef.current = false;
          }
          // Nothing painted yet: text stays, unsaved chips return to queued.
          markAttachmentUploadStatus(
            deferredChips.map((item) => item.localId),
            'queued',
          );
          return;
        }
        deferredSessionId = sessionId;
        await saveDeferredMediaChips(sessionId, deferredChips);
        const failed = readResolvedComposerChips().filter(isFailedMediaAttachment);
        if (failed.length > 0) {
          args.dispatch({
            type: 'error',
            message: attachmentCopy.attachmentSendBlocked(failed.length),
          });
          return;
        }
      }

      // Include ready chips only; error chips stay visible for an explicit
      // Retry and are never silently dropped into the prompt.
      let attachments: PromptAttachment[] = readResolvedComposerChips()
        .filter(isPendingAttachmentReady)
        .map((item) => item.attachment);
      if (!text && attachments.length === 0 && contextRefs.length === 0) {
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

      if (deferredChips.length === 0) {
        const gates = checkSendGates();
        if (!gates.ok) {
          if (gates.awaitWorkspacePicker) {
            await args.onNeedWorkspace?.();
          }
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
          if (args.conversationChat === true) {
            return;
          }
          args.onOrchestrationSchemeChange?.(parsed.schemeId);
          setComposer('');
          clearPendingAttachments();
          return;
        }
        if (parsed.kind === 'knowledge') {
          setComposer('');
          clearPendingAttachments();
          args.onOpenKnowledge?.(parsed.subTab);
          return;
        }
        if (parsed.kind === 'cards-panel') {
          setComposer('');
          clearPendingAttachments();
          args.onOpenCardsPanel?.();
          return;
        }
        if (parsed.kind === 'mode' && !parsed.args) {
          if (args.conversationChat === true) {
            return;
          }
          args.onAgentModeChange?.(parsed.modeId);
          setComposer('');
          clearPendingAttachments();
          return;
        }
        if (parsed.kind === 'skill') {
          if (args.conversationChat === true) {
            return;
          }
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

      // Freeze all model-facing prompt choices before either the queue or the
      // ordinary prompt path. A slash-mode/skill send while a Run is active
      // must carry the same transformed text and metadata as an idle send.
      let displayText = text;
      let hostPromptText = text;
      let promptAgentMode: AgentModeId = args.agentMode;
      let promptAttachments: PromptAttachment[] = attachments;
      let promptContextRefs = contextRefs;
      let skillActivity: SkillActivityView | undefined;
      if (text.startsWith('/') && attachments.length === 0 && promptContextRefs.length === 0) {
        const skills = (args.menuSkills ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: skill.enabled,
        }));
        const parsed = parseComposerSlashSubmit(text, skills);
        if (parsed.kind === 'mode' && parsed.args) {
          if (args.conversationChat === true) {
            return;
          }
          args.onAgentModeChange?.(parsed.modeId);
          displayText = parsed.args;
          hostPromptText = parsed.args;
          promptAgentMode = parsed.modeId;
          promptAttachments = [];
        } else if (parsed.kind === 'skill') {
          if (args.conversationChat === true) {
            return;
          }
          hostPromptText = applySkillToPrompt(parsed.skillName, parsed.skillId, parsed.args);
          promptAttachments = [];
          skillActivity = { skillId: parsed.skillId, name: parsed.skillName };
        }
      }

      if (args.hostClient.getTransport?.() === 'remote') {
        const flattened = flattenUnsafeRemoteContextRefs(hostPromptText, promptContextRefs);
        hostPromptText = flattened.text;
        promptContextRefs = flattened.contextRefs;
      }

      // Stage 4: an ordinary Send during an active Run is a Host-owned
      // next-turn queue admission. The Host persists the same user identity
      // and later drains it after the exact foreground Run terminalizes.
      if (args.state.streaming && args.state.activeSessionId) {
        const sessionId = args.state.activeSessionId;
        const queuedTurnId = crypto.randomUUID();
        const paintSnapshotAttachments = [...pendingAttachmentsRef.current];
        const clientMessageId = crypto.randomUUID();
        clearComposerForQueuedAdmission();
        pendingContextRefsRef.current = contextRefs;
        promptSubmissionInProgress.current = true;
        try {
          const response = await args.hostClient.request(
            {
              type: 'session/queued-turn-submit',
              sessionId,
              queuedTurnId,
              userMessageId: clientMessageId,
              input: buildPromptRequestInput({
                text: hostPromptText,
                attachments: promptAttachments,
                contextRefs: promptContextRefs,
                agentMode: promptAgentMode,
                clientMessageId,
                ...(skillActivity ? { skillId: skillActivity.skillId } : {}),
              }),
            },
            { idempotencyKey: createGestureIdempotencyKey() },
          );
          if (!response.success) {
            setComposer(text);
            if (paintSnapshotAttachments.length > 0) {
              pendingAttachmentsRef.current = [...paintSnapshotAttachments];
              setPendingAttachments([...paintSnapshotAttachments]);
            }
            notifyError(hostFailureNotice(response, locale));
            return;
          }
          disposeComposerAttachments(paintSnapshotAttachments);
          pendingContextRefsRef.current = [];
          const data = response.data as { queuedTurn?: QueuedTurnRecord } | undefined;
          if (data?.queuedTurn) {
            args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: data.queuedTurn });
          }
          refreshQueuedTurnQueue(sessionId);
          if (promptRefsSnapshot) {
            args.consumePendingContextRefs?.(promptRefsSnapshot);
          } else {
            args.clearPendingContextRefs?.();
          }
        } catch (error) {
          setComposer(text);
          if (paintSnapshotAttachments.length > 0) {
            pendingAttachmentsRef.current = [...paintSnapshotAttachments];
            setPendingAttachments([...paintSnapshotAttachments]);
          }
          notifyError(formatError(error));
        } finally {
          promptSubmissionInProgress.current = false;
        }
        return;
      }

      // Paint-first: clear composer and show the user bubble before any IPC.
      // Session create / prompt ACK stay off the critical input path. A send
      // with deferred media already ensured the session above.
      if (deferredSessionId === null) {
        // Sending consumes the local draft row, if this composer was resumed
        // from one. The newly created Host session will replace it in the list.
        removeCurrentDraft();
        if (wasInDraftMode) {
          skipDraftSaveRef.current = true;
          draftTextRef.current = '';
        }
      }

      let clientMessageId: string | null = null;

      // Chips exactly as painted (deferred saves already resolved to ready).
      // Kept alive until ACK so a failed prompt can restore them intact.
      const paintSnapshotAttachments = [...pendingAttachmentsRef.current];
      clientMessageId = paintOptimisticUserSend({
        text,
        displayText,
        attachments: promptAttachments,
        contextRefs,
        ...(skillActivity ? { skill: skillActivity } : {}),
      });
      // paintOptimisticUserSend hides attachment chips; workspace refs belong
      // to this same prompt and must survive until the Host request is built.
      pendingContextRefsRef.current = promptContextRefs;

      promptSubmissionInProgress.current = true;
      try {
        const sessionId = deferredSessionId ?? (await resolveSessionIdForComposer());
        if (!sessionId) {
          if (wasInDraftMode) {
            skipDraftSaveRef.current = false;
          }
          rollbackOptimisticUserSend(clientMessageId, text, paintSnapshotAttachments);
          return;
        }

        const input = buildPromptRequestInput({
          text: hostPromptText,
          attachments: promptAttachments,
          contextRefs: promptContextRefs,
          agentMode: promptAgentMode,
          clientMessageId,
          ...(skillActivity ? { skillId: skillActivity.skillId } : {}),
        });
        const response = await requestPromptWithForeground({
          request: (command, options) => args.hostClient.request(command, options),
          sessionId,
          input,
          createIdempotencyKey: createGestureIdempotencyKey,
          ...(args.confirmBusyRun ? { resolveBusy: args.confirmBusyRun } : {}),
          ...(args.confirmForegroundReplace
            ? { confirmReplace: args.confirmForegroundReplace }
            : {}),
          onQueue: async () => {
            rollbackOptimisticUserSend(clientMessageId, text, paintSnapshotAttachments);
            const queuedTurnId = crypto.randomUUID();
            return args.hostClient.request(
              {
                type: 'session/queued-turn-submit',
                sessionId,
                queuedTurnId,
                userMessageId: clientMessageId,
                input,
              },
              { idempotencyKey: createGestureIdempotencyKey() },
            );
          },
          ...(typeof args.hostClient.supportsForegroundAdmission === 'function'
            ? { remoteForegroundAdmission: args.hostClient.supportsForegroundAdmission() }
            : {}),
        });
        if (response.command === 'session/queued-turn-submit') {
          if (!response.success) {
            rollbackOptimisticUserSend(clientMessageId, text, paintSnapshotAttachments);
            notifyError(hostFailureNotice(response, locale));
            return;
          }
          disposeComposerAttachments(paintSnapshotAttachments);
          pendingContextRefsRef.current = [];
          const queuedData = response.data as { queuedTurn?: QueuedTurnRecord } | undefined;
          if (queuedData?.queuedTurn) {
            args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: queuedData.queuedTurn });
          }
          refreshQueuedTurnQueue(sessionId);
          if (promptRefsSnapshot) {
            args.consumePendingContextRefs?.(promptRefsSnapshot);
          } else {
            args.clearPendingContextRefs?.();
          }
          return;
        }
        if (!response.success) {
          rollbackOptimisticUserSend(clientMessageId, text, paintSnapshotAttachments);
          const problem = readForegroundProblem(response);
          if (problem) {
            notifyError(foregroundMismatchNotice(problem, locale));
          } else {
            notifyError(hostFailureNotice(response, locale));
          }
          return;
        }

        // ACK: the prompt now owns the attachments. Only here may the local
        // File, blob preview and save results be released (ADR 0045 recovery).
        disposeComposerAttachments(paintSnapshotAttachments);
        pendingContextRefsRef.current = [];

        applyAcceptedRun(response.data);
        if (promptRefsSnapshot) {
          args.consumePendingContextRefs?.(promptRefsSnapshot);
        } else {
          args.clearPendingContextRefs?.();
        }

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
          rollbackOptimisticUserSend(clientMessageId, text, paintSnapshotAttachments);
        }
        notifyError(formatError(error));
      } finally {
        promptSubmissionInProgress.current = false;
      }
    },
    [
      args,
      applyAcceptedRun,
      attachmentCopy,
      buildPromptRequestInput,
      clearPendingAttachments,
      clearComposerForQueuedAdmission,
      composer,
      disposeComposerAttachments,
      markAttachmentUploadStatus,
      paintOptimisticUserSend,
      readResolvedComposerChips,
      refreshQueuedTurnQueue,
      removeCurrentDraft,
      resolveSessionIdForComposer,
      rollbackOptimisticUserSend,
      saveDeferredMediaChips,
      upsertCurrentDraft,
    ],
  );

  const handleSteer = useCallback(async (overrideText?: string): Promise<boolean> => {
    const text = (overrideText ?? composer).trim();
    if (
      !text ||
      !args.state.activeSessionId ||
      !args.state.activeRunId ||
      !args.state.streaming
    ) {
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
  }, [args, composer, notifyError]);

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
      if (!args.state.activeRunId || !args.state.streaming) return;
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
    [args],
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
    retryFailedAttachments,
    discardFailedAttachments,
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
