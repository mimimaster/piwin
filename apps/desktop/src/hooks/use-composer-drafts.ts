/**
 * Local composer drafts and per-session unsent composer snapshots.
 *
 * Draft rows are deliberately Desktop-local. A Host session is still only
 * created when the user sends, so switching away never leaves empty durable
 * sessions behind. The sidebar row itself appears as soon as New Agent has
 * composer content, and stays selected until Send or the user leaves.
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
import type { PromptContextRef, SessionScope } from '@piwin/contracts';
import type { PendingComposerAttachment } from '../media-utils.js';
import { decideDraftTransition } from '../draft-transition';
import {
  findLatestDraftForScope,
  sortDraftSessions,
  type DraftSessionItemUi,
} from '../draft-session';
import type { UseComposerMediaArgs } from './composer-media-args.js';
import type { SessionComposerSnapshot } from './composer-session-snapshot.js';
import {
  buildComposerDraftStore,
  draftsFromPersistedStore,
  loadComposerDraftStore,
  readComposerDraftPartitionId,
  saveComposerDraftStore,
} from '../composer-draft-persistence.js';

/**
 * Cap on per-session unsent composer snapshots. Each snapshot pins its
 * attachments' object URLs and source Files until disposed, so an uncapped
 * map grows without bound while the user hops between sessions with pasted
 * media. Evicted (and cleared) snapshots dispose their attachments.
 */
export const MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS = 8;

/** Why the current local draft row is being removed. */
export type ComposerDraftRemovalReason = 'discard' | 'send';

export type UseComposerDraftsArgs = {
  args: UseComposerMediaArgs;
  composer: string;
  setComposer: Dispatch<SetStateAction<string>>;
  composerRef: MutableRefObject<string>;
  pendingAttachments: readonly PendingComposerAttachment[];
  pendingAttachmentsRef: MutableRefObject<PendingComposerAttachment[]>;
  setPendingAttachments: Dispatch<SetStateAction<PendingComposerAttachment[]>>;
  pendingContextRefsRef: MutableRefObject<PromptContextRef[]>;
  activeSessionIdRef: MutableRefObject<string | null>;
  sessionComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
  draftComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
  disposeComposerAttachments: (attachments: PendingComposerAttachment[]) => void;
};

function composerHasDraftContent(
  text: string,
  attachments: readonly PendingComposerAttachment[],
  contextRefs: readonly PromptContextRef[],
): boolean {
  return text.trim().length > 0 || attachments.length > 0 || contextRefs.length > 0;
}

export function useComposerDrafts(params: UseComposerDraftsArgs) {
  const {
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
    disposeComposerAttachments,
  } = params;

  /**
   * Visible chips live in useComposerContextRefs (external authority). Prefer
   * that list for snapshots/content checks; the internal ref is only a fallback
   * for harnesses without the external wiring.
   */
  const readVisibleContextRefs = useCallback((): PromptContextRef[] => {
    return args.getPendingContextRefs?.() ?? [...pendingContextRefsRef.current];
  }, [args]);

  const [draftSessions, setDraftSessions] = useState<DraftSessionItemUi[]>([]);
  const draftSessionsRef = useRef<DraftSessionItemUi[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const activeDraftIdRef = useRef<string | null>(null);
  /** Draft record associated with the current composer, even while its row is not selected. */
  const currentDraftIdRef = useRef<string | null>(null);
  const draftTextRef = useRef('');
  /** Scope chosen by the New Agent entry point, independent of async navigation. */
  const currentDraftScopeRef = useRef(args.state.activeScope);
  const explicitDraftScopeRef = useRef<SessionScope | null>(null);
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
  /**
   * startNewDraft clears the composer before session/clear-active restores a
   * parked row. Ignore that one empty pass so we do not delete the row we are
   * about to put back.
   */
  const holdLiveDraftOnEmptyRef = useRef(false);
  const loadedDraftPartitionRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  const persistComposerDrafts = useCallback((): void => {
    const partition = readComposerDraftPartitionId(args.hostClient);
    if (!partition) {
      return;
    }
    saveComposerDraftStore(
      buildComposerDraftStore({
        hostInstanceId: partition,
        drafts: draftSessionsRef.current,
        draftSnapshots: draftComposerSnapshotsRef.current,
        sessionSnapshots: sessionComposerSnapshotsRef.current,
      }),
    );
  }, [args.hostClient, draftComposerSnapshotsRef, sessionComposerSnapshotsRef]);

  const scheduleComposerDraftPersist = useCallback((): void => {
    if (typeof window === 'undefined') {
      persistComposerDrafts();
      return;
    }
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      persistComposerDrafts();
    }, 250);
  }, [persistComposerDrafts]);

  const setActiveDraft = useCallback((draftId: string | null): void => {
    activeDraftIdRef.current = draftId;
    setActiveDraftId(draftId);
  }, []);

  const upsertCurrentDraft = useCallback(
    (text: string, scope: SessionScope, options?: { select?: boolean }): void => {
      const attachments = [...pendingAttachmentsRef.current];
      const contextRefs = readVisibleContextRefs();
      if (text.trim().length === 0 && attachments.length === 0 && contextRefs.length === 0) {
        return;
      }
      const draftId =
        options?.select === false
          ? crypto.randomUUID()
          : (currentDraftIdRef.current ?? activeDraftIdRef.current ?? crypto.randomUUID());
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
        updatedAt: new Date().toISOString(),
        scope,
        isDraft: true,
      };
      const next = [draft, ...draftSessionsRef.current.filter((item) => item.id !== draftId)];
      draftSessionsRef.current = next;
      draftComposerSnapshotsRef.current.set(draftId, { text, attachments, contextRefs });
      setDraftSessions(sortDraftSessions(next));
      scheduleComposerDraftPersist();
      if (options?.select !== false) {
        currentDraftIdRef.current = draftId;
        setActiveDraft(draftId);
      }
      draftTextRef.current = text;
    },
    [readVisibleContextRefs, scheduleComposerDraftPersist, setActiveDraft],
  );

  const removeCurrentDraft = useCallback(
    (reason: ComposerDraftRemovalReason = 'discard'): void => {
      const draftId = currentDraftIdRef.current ?? activeDraftIdRef.current;
      currentDraftIdRef.current = null;
      setActiveDraft(null);
      draftTextRef.current = '';
      if (!draftId) return;
      const droppedSnapshot = draftComposerSnapshotsRef.current.get(draftId);
      draftComposerSnapshotsRef.current.delete(draftId);
      // Send still holds the live chips and their source Files. Dropping the
      // draft row must not revoke those; ACK/failure paths release them.
      if (droppedSnapshot && reason === 'discard') {
        disposeComposerAttachments(droppedSnapshot.attachments);
      }
      const next = draftSessionsRef.current.filter((draft) => draft.id !== draftId);
      draftSessionsRef.current = next;
      setDraftSessions(next);
      scheduleComposerDraftPersist();
    },
    [disposeComposerAttachments, scheduleComposerDraftPersist, setActiveDraft],
  );

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
        scheduleComposerDraftPersist();
        return;
      }
      // Delete-then-set refreshes LRU recency for the just-saved session.
      sessionComposerSnapshotsRef.current.delete(sessionId);
      sessionComposerSnapshotsRef.current.set(sessionId, snapshot);
      const attachmentHolders = [...sessionComposerSnapshotsRef.current.entries()].filter(
        ([, held]) => held.attachments.length > 0,
      );
      while (attachmentHolders.length > MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS) {
        const oldest = attachmentHolders.shift();
        if (oldest === undefined) break;
        const [oldestId, oldestSnapshot] = oldest;
        if (oldestId === activeSessionIdRef.current) continue;
        sessionComposerSnapshotsRef.current.set(oldestId, {
          text: oldestSnapshot.text,
          attachments: [],
          contextRefs: oldestSnapshot.contextRefs,
        });
        disposeComposerAttachments(oldestSnapshot.attachments);
      }
      scheduleComposerDraftPersist();
    },
    [disposeComposerAttachments, readVisibleContextRefs, scheduleComposerDraftPersist],
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

  useEffect(() => {
    const partition = readComposerDraftPartitionId(args.hostClient);
    if (!partition || loadedDraftPartitionRef.current === partition) {
      return;
    }
    loadedDraftPartitionRef.current = partition;
    const stored = loadComposerDraftStore(partition);
    if (stored === null) {
      return;
    }
    const restored = draftsFromPersistedStore(stored);
    if (draftSessionsRef.current.length === 0 && restored.drafts.length > 0) {
      draftSessionsRef.current = restored.drafts;
      setDraftSessions(restored.drafts);
      for (const [draftId, snapshot] of restored.draftSnapshots) {
        draftComposerSnapshotsRef.current.set(draftId, snapshot);
      }
    }
    for (const [sessionId, snapshot] of restored.sessionSnapshots) {
      if (!sessionComposerSnapshotsRef.current.has(sessionId)) {
        sessionComposerSnapshotsRef.current.set(sessionId, snapshot);
      }
    }
  }, [args.hostClient, args.state.hostReady]);

  useEffect(() => {
    const onHide = (): void => {
      persistComposerDrafts();
    };
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      persistComposerDrafts();
    };
  }, [persistComposerDrafts]);

  /** Leave the current session for New Agent. Resume a parked draft for this scope if one exists. */
  const startNewDraft = useCallback(
    (scope?: SessionScope): void => {
      holdLiveDraftOnEmptyRef.current = true;
      const targetScope = scope ?? args.state.activeScope;
      if (scope !== undefined) {
        explicitDraftScopeRef.current = targetScope;
      }
      const sessionId = activeSessionIdRef.current;
      if (sessionId !== null) {
        saveSessionComposerSnapshot(sessionId);
        const existing = findLatestDraftForScope(draftSessionsRef.current, targetScope);
        currentDraftIdRef.current = existing?.id ?? null;
        setActiveDraft(existing?.id ?? null);
        currentDraftScopeRef.current = existing?.scope ?? targetScope;
      } else if (
        composerRef.current.trim().length > 0 ||
        pendingAttachmentsRef.current.length > 0 ||
        readVisibleContextRefs().length > 0
      ) {
        upsertCurrentDraft(composerRef.current, currentDraftScopeRef.current);
        currentDraftIdRef.current = null;
        setActiveDraft(null);
        currentDraftScopeRef.current = targetScope;
      } else if (currentDraftIdRef.current !== null || activeDraftIdRef.current !== null) {
        removeCurrentDraft();
        currentDraftScopeRef.current = targetScope;
      } else {
        currentDraftScopeRef.current = targetScope;
      }
      // Clear the live composer before session/clear-active so A→null cannot
      // overwrite the session snapshot with the draft we are about to restore.
      draftTextRef.current = '';
      composerRef.current = '';
      pendingAttachmentsRef.current = [];
      pendingContextRefsRef.current = [];
      setComposer('');
      setPendingAttachments([]);
      args.restorePendingContextRefs?.([]);
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
        args.onLeaveActiveSession?.();
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

  // New Agent: as soon as the composer has content, admit a selected local
  // draft row. Host session creation still waits for Send.
  useEffect(() => {
    if (args.state.activeSessionId !== null) {
      return;
    }
    // The session-transition effect still holds the previous id on this
    // tick. Do not admit the outgoing session composer as a New Agent row.
    if (prevActiveSessionIdRef.current !== null) {
      return;
    }
    if (skipDraftSaveRef.current || preserveComposerOnSessionActivationRef.current) {
      return;
    }
    const contextRefs = readVisibleContextRefs();
    const hasContent = composerHasDraftContent(composer, pendingAttachments, contextRefs);
    if (!hasContent) {
      if (holdLiveDraftOnEmptyRef.current) {
        holdLiveDraftOnEmptyRef.current = false;
        return;
      }
      if (currentDraftIdRef.current !== null || activeDraftIdRef.current !== null) {
        removeCurrentDraft();
      }
      return;
    }
    holdLiveDraftOnEmptyRef.current = false;
    const draftId = currentDraftIdRef.current ?? activeDraftIdRef.current;
    const existing = draftId
      ? draftSessionsRef.current.find((draft) => draft.id === draftId)
      : undefined;
    const snapshot = existing ? draftComposerSnapshotsRef.current.get(existing.id) : undefined;
    if (
      existing &&
      existing.text === composer &&
      snapshot !== undefined &&
      snapshot.attachments.length === pendingAttachments.length &&
      snapshot.contextRefs.length === contextRefs.length
    ) {
      return;
    }
    upsertCurrentDraft(composer, currentDraftScopeRef.current);
  }, [
    args.state.activeSessionId,
    composer,
    pendingAttachments,
    readVisibleContextRefs,
    removeCurrentDraft,
    upsertCurrentDraft,
  ]);

  // Host-less blank composer follows the latest navigation scope unless an
  // explicit New-in-P target is still waiting for that project to activate.
  useEffect(() => {
    if (args.state.activeSessionId !== null) {
      return;
    }
    if (explicitDraftScopeRef.current !== null) {
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
    if (currentId !== null) {
      explicitDraftScopeRef.current = null;
    }

    const hasComposerContent =
      composerRef.current.trim().length > 0 ||
      pendingAttachmentsRef.current.length > 0 ||
      readVisibleContextRefs().length > 0;

    // Switching between two real sessions must not leak the old composer text
    // into the newly selected session, and must not create a phantom draft row.
    // Each session owns an independent composer snapshot.
    if (prevId !== null && currentId !== null) {
      saveSessionComposerSnapshot(prevId);
      restoreSessionComposerSnapshot(currentId);
      return;
    }

    // project/set and project/clear null activeSessionId before the next
    // session/set. Persist unsent chips; if the composer is already empty,
    // leave a snapshot that startNewDraft just wrote.
    if (prevId !== null && currentId === null && hasComposerContent) {
      saveSessionComposerSnapshot(prevId);
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
        if (hasComposerContent) {
          upsertCurrentDraft(composerRef.current, previousScope);
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

  return {
    draftSessions,
    activeDraftId,
    startNewDraft,
    resumeDraft,
    upsertCurrentDraft,
    removeCurrentDraft,
    skipDraftSaveRef,
    preserveComposerOnSessionActivationRef,
    draftTextRef,
    currentDraftScopeRef,
    currentDraftIdRef,
  };
}
