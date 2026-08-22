/**
 * Local composer drafts and per-session unsent composer snapshots.
 *
 * Draft rows are deliberately Desktop-local. A Host session is still only
 * created when the user sends, so switching away never leaves empty durable
 * sessions behind.
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
import { sortDraftSessions, type DraftSessionItemUi } from '../draft-session';
import type { UseComposerMediaArgs } from './composer-media-args.js';
import type { SessionComposerSnapshot } from './composer-session-snapshot.js';

/**
 * Cap on per-session unsent composer snapshots. Each snapshot pins its
 * attachments' object URLs and source Files until disposed, so an uncapped
 * map grows without bound while the user hops between sessions with pasted
 * media. Evicted (and cleared) snapshots dispose their attachments.
 */
export const MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS = 8;

export type UseComposerDraftsArgs = {
  args: UseComposerMediaArgs;
  composer: string;
  setComposer: Dispatch<SetStateAction<string>>;
  composerRef: MutableRefObject<string>;
  pendingAttachmentsRef: MutableRefObject<PendingComposerAttachment[]>;
  setPendingAttachments: Dispatch<SetStateAction<PendingComposerAttachment[]>>;
  pendingContextRefsRef: MutableRefObject<PromptContextRef[]>;
  activeSessionIdRef: MutableRefObject<string | null>;
  sessionComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
  draftComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
  disposeComposerAttachments: (attachments: PendingComposerAttachment[]) => void;
};

export function useComposerDrafts(params: UseComposerDraftsArgs) {
  const {
    args,
    composer,
    setComposer,
    composerRef,
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

  const setActiveDraft = useCallback((draftId: string | null): void => {
    activeDraftIdRef.current = draftId;
    setActiveDraftId(draftId);
  }, []);

  const upsertCurrentDraft = useCallback(
    (text: string, scope: SessionScope): void => {
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
    (scope?: SessionScope): void => {
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
  };
}
