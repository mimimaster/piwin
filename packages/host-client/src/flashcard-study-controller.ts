import type {
  FlashcardStudyMode,
  FlashcardStudyScope,
  FlashcardStudySnapshot,
  HostCommand,
  HostPush,
  HostResponse,
  ReviewRating,
} from '@piwin/contracts';
import {
  createHostRequestAttempt,
  createIdempotencyKey,
  executeHostRequestAttempt,
  type HostRequestAttempt,
  type HostRequestExecutor,
} from './host-request-attempt.js';
import type { FlashcardStudyPendingRecord, FlashcardStudyPendingStore } from './flashcard-study-pending.js';
import {
  deriveFlashcardStudyViewModel,
  studyTransitionId,
  type FlashcardStudyControllerState,
  type FlashcardStudyViewModel,
} from './flashcard-study-view-model.js';

export type FlashcardStudyClock = {
  now: () => number;
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

export type FlashcardStudyVisibility = {
  isVisible: () => boolean;
  subscribe: (listener: (visible: boolean) => void) => () => void;
};

export type FlashcardStudyControllerPorts = {
  request: HostRequestExecutor;
  pending: FlashcardStudyPendingStore;
  clock: FlashcardStudyClock;
  visibility: FlashcardStudyVisibility;
  createIdempotencyKey?: () => string;
  hasStudyCapability?: () => boolean;
  hostIdentity?: string;
  tearFallbackMs?: number;
};

export type FlashcardStudyController = {
  subscribe: (listener: (view: FlashcardStudyViewModel) => void) => () => void;
  getViewModel: () => FlashcardStudyViewModel;
  start: (input: {
    mode: FlashcardStudyMode;
    scope: FlashcardStudyScope;
    resumeExisting?: boolean;
  }) => Promise<void>;
  open: (roundId: string) => Promise<void>;
  claim: () => Promise<void>;
  flip: () => Promise<void>;
  next: () => Promise<void>;
  rate: (rating: ReviewRating) => Promise<void>;
  undo: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  end: () => Promise<void>;
  handlePush: (push: HostPush) => void;
  setConnected: (connected: boolean) => void;
  noteTransitionEnd: (transitionId: string) => void;
};

const DEFAULT_TEAR_FALLBACK_MS = 250;

export function createFlashcardStudyController(
  ports: FlashcardStudyControllerPorts,
): FlashcardStudyController {
  const listeners = new Set<(view: FlashcardStudyViewModel) => void>();
  const seenTransitionIds = new Set<string>();
  const newKey = ports.createIdempotencyKey ?? createIdempotencyKey;
  let state: FlashcardStudyControllerState = {
    snapshot: null,
    error: null,
    connected: true,
    pending: false,
    awaitingConfirmation: false,
    saving: false,
    transitionId: null,
    transitionSettled: true,
  };
  let inFlight: HostRequestAttempt | null = null;
  let checkpointChain: Promise<void> = Promise.resolve();
  let queuedCheckpoint: { face: 'question' | 'answer'; needsReview?: boolean } | null = null;
  let restoring = false;
  let fallbackTimer: number | null = null;
  let gestureLocked = false;
  const unsubscribeVisibility = ports.visibility.subscribe((visible) => {
    if (!visible && fallbackTimer !== null) {
      ports.clock.clearTimeout(fallbackTimer);
      fallbackTimer = null;
      if (state.transitionId && !state.transitionSettled) {
        noteTransitionEnd(state.transitionId);
      }
    }
  });

  function view(): FlashcardStudyViewModel {
    return deriveFlashcardStudyViewModel(state);
  }

  function emit(): void {
    const next = view();
    for (const listener of listeners) listener(next);
  }

  function patch(partial: Partial<FlashcardStudyControllerState>): void {
    state = { ...state, ...partial };
    emit();
  }

  function applySnapshot(
    snapshot: FlashcardStudySnapshot,
    options?: { tear?: boolean },
  ): void {
    const nextId = studyTransitionId(snapshot.round.roundId, snapshot.round.revision);
    const shouldTear =
      options?.tear === true &&
      !seenTransitionIds.has(nextId) &&
      state.snapshot !== null &&
      snapshot.round.revision > state.snapshot.round.revision;
    if (shouldTear) {
      seenTransitionIds.add(nextId);
      armFallback(nextId);
      patch({
        snapshot,
        error: null,
        saving: false,
        pending: false,
        awaitingConfirmation: false,
        transitionId: nextId,
        transitionSettled: false,
      });
      return;
    }
    seenTransitionIds.add(nextId);
    patch({
      snapshot,
      error: null,
      saving: false,
      pending: false,
      awaitingConfirmation: false,
      transitionId: nextId,
      transitionSettled: true,
    });
  }

  function armFallback(transitionId: string): void {
    if (fallbackTimer !== null) ports.clock.clearTimeout(fallbackTimer);
    fallbackTimer = ports.clock.setTimeout(() => {
      fallbackTimer = null;
      noteTransitionEnd(transitionId);
    }, ports.tearFallbackMs ?? DEFAULT_TEAR_FALLBACK_MS);
  }

  function noteTransitionEnd(transitionId: string): void {
    if (state.transitionId !== transitionId || state.transitionSettled) return;
    if (fallbackTimer !== null) {
      ports.clock.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    patch({ transitionSettled: true });
  }

  function fail(code: string, message: string): void {
    patch({ error: { code, message }, saving: false, awaitingConfirmation: false });
  }

  function blocked(): boolean {
    const phase = view().phase;
    return (
      phase === 'loading' ||
      phase === 'saving' ||
      phase === 'transitioning' ||
      phase === 'pending-confirmation' ||
      phase === 'read-only' ||
      phase === 'error' ||
      phase === 'disconnected'
    );
  }

  async function executeMutation(
    command: HostCommand,
    pending: FlashcardStudyPendingRecord,
    tear: boolean,
  ): Promise<void> {
    if (inFlight) return;
    await ports.pending.save(pending);
    patch({ pending: true, saving: true, awaitingConfirmation: false });
    const attempt = createHostRequestAttempt(command, pending.idempotencyKey);
    inFlight = attempt;
    try {
      const response = await executeHostRequestAttempt(ports.request, attempt);
      await acceptResponse(response, tear);
    } catch {
      patch({ awaitingConfirmation: true, saving: false });
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  }

  async function acceptResponse(response: HostResponse, tear: boolean): Promise<void> {
    if (!response.success) {
      if (response.problem?.code === 'idempotency-conflict') {
        fail(response.problem.code, response.error);
        return;
      }
      fail(response.problem?.code ?? 'study-error', response.error);
      await ports.pending.clear();
      return;
    }
    await ports.pending.clear();
    const snapshot = response.data as FlashcardStudySnapshot;
    applySnapshot(snapshot, { tear });
  }

  async function reconcilePending(): Promise<void> {
    const pending = await ports.pending.load();
    if (!pending) return;
    patch({ pending: true, awaitingConfirmation: true });
    const response = await ports.request({
      type: 'flashcards/study/operation',
      idempotencyKey: pending.idempotencyKey,
    });
    if (response.success && isRecord(response.data)) {
      const status = response.data.status;
      if (status === 'success' && isStudySnapshot(response.data.snapshot)) {
        await ports.pending.clear();
        applySnapshot(response.data.snapshot, { tear: true });
        return;
      }
      if (status === 'rejected') {
        const code =
          typeof response.data.code === 'string'
            ? response.data.code
            : 'StudyOperationConflictError';
        const message =
          typeof response.data.error === 'string' ? response.data.error : 'operation rejected';
        fail(code, message);
        return;
      }
    }
    const current = state.snapshot;
    const staleEpoch = current !== null && current.round.controlEpoch !== pending.controlEpoch;
    const staleVersion =
      pending.contentVersion !== undefined &&
      current?.current?.contentVersion !== undefined &&
      current.current.contentVersion !== pending.contentVersion;
    if (staleEpoch || staleVersion) {
      await ports.pending.clear();
      return;
    }
    if (inFlight) return;
    const attempt = createHostRequestAttempt(pending.command, pending.idempotencyKey);
    inFlight = attempt;
    try {
      const retried = await executeHostRequestAttempt(ports.request, attempt);
      await acceptResponse(retried, true);
    } catch {
      patch({ awaitingConfirmation: true, saving: false });
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  }

  function requireCapability(): boolean {
    if (ports.hasStudyCapability && !ports.hasStudyCapability()) {
      fail('host-too-old', '需要更新 Host');
      return false;
    }
    return true;
  }

  async function start(input: {
    mode: FlashcardStudyMode;
    scope: FlashcardStudyScope;
    resumeExisting?: boolean;
  }): Promise<void> {
    if (!requireCapability()) return;
    patch({ snapshot: null, error: null, saving: false });
    const key = newKey();
    const command: HostCommand = {
      type: 'flashcards/study/start',
      mode: input.mode,
      scope: input.scope,
      resumeExisting: input.resumeExisting !== false,
    };
    await executeMutation(
      command,
      {
        ...(ports.hostIdentity ? { hostIdentity: ports.hostIdentity } : {}),
        roundId: 'pending-start',
        idempotencyKey: key,
        command,
        expectedRevision: 0,
        controlEpoch: 0,
      },
      false,
    );
  }

  async function open(roundId: string): Promise<void> {
    if (!requireCapability()) return;
    patch({ snapshot: null, error: null });
    restoring = true;
    try {
      await reconcilePending();
      const response = await ports.request({ type: 'flashcards/study/get', roundId });
      if (response.success && isStudySnapshot(response.data)) {
        applySnapshot(response.data);
      } else if (!response.success) {
        fail(response.problem?.code ?? 'study-error', response.error);
      }
    } finally {
      restoring = false;
    }
  }

  function currentRound(): FlashcardStudySnapshot | null {
    return state.snapshot;
  }

  function roundFields(snapshot: FlashcardStudySnapshot) {
    return {
      roundId: snapshot.round.roundId,
      expectedRevision: snapshot.round.revision,
      controlEpoch: snapshot.round.controlEpoch,
    };
  }

  async function claim(): Promise<void> {
    const snapshot = currentRound();
    if (!snapshot || inFlight) return;
    const command: HostCommand = {
      type: 'flashcards/study/claim',
      roundId: snapshot.round.roundId,
      expectedRevision: snapshot.round.revision,
      expectedControlEpoch: snapshot.round.controlEpoch,
    };
    await executeMutation(
      command,
      pendingFrom(command, snapshot, newKey()),
      false,
    );
  }

  function enqueueCheckpoint(): void {
    const snapshot = currentRound();
    if (!snapshot?.current || !snapshot.access.hasControl) return;
    checkpointChain = checkpointChain.then(async () => {
      const queued = queuedCheckpoint;
      queuedCheckpoint = null;
      if (!queued || inFlight) return;
      const latest = currentRound();
      if (!latest?.current) return;
      const command: HostCommand = {
        type: 'flashcards/study/checkpoint',
        ...roundFields(latest),
        entryId: latest.current.entryId,
        contentVersion: latest.current.contentVersion,
        face: queued.face,
        ...(queued.needsReview !== undefined ? { needsReview: queued.needsReview } : {}),
      };
      await executeMutation(command, pendingFrom(command, latest, newKey()), false);
    });
  }

  async function flip(): Promise<void> {
    const snapshot = currentRound();
    if (!snapshot?.current || blocked()) return;
    const face = snapshot.round.face === 'answer' ? 'question' : 'answer';
    const current = snapshot.current;
    const { back: _ignoredBack, ...withoutBack } = current;
    const optimistic: FlashcardStudySnapshot = {
      ...snapshot,
      round: { ...snapshot.round, face },
      current: face === 'question' ? { ...withoutBack, face } : { ...current, face },
    };
    patch({ snapshot: optimistic });
    queuedCheckpoint = { face };
    enqueueCheckpoint();
    await checkpointChain;
  }

  async function advance(
    command: HostCommand,
    snapshot: FlashcardStudySnapshot,
  ): Promise<void> {
    if (blocked() || inFlight || gestureLocked) return;
    gestureLocked = true;
    try {
      await executeMutation(command, pendingFrom(command, snapshot, newKey()), true);
    } finally {
      gestureLocked = false;
    }
  }

  async function next(): Promise<void> {
    const snapshot = currentRound();
    if (!snapshot?.current) return;
    await advance(
      {
        type: 'flashcards/study/next',
        ...roundFields(snapshot),
        entryId: snapshot.current.entryId,
        contentVersion: snapshot.current.contentVersion,
      },
      snapshot,
    );
  }

  async function rate(rating: ReviewRating): Promise<void> {
    const snapshot = currentRound();
    if (!snapshot?.current) return;
    await advance(
      {
        type: 'flashcards/study/rate',
        ...roundFields(snapshot),
        entryId: snapshot.current.entryId,
        contentVersion: snapshot.current.contentVersion,
        rating,
        expectedReviewStateRevision: snapshot.current.reviewStateRevision ?? 0,
      },
      snapshot,
    );
  }

  async function simple(type: 'undo' | 'pause' | 'resume' | 'end'): Promise<void> {
    const snapshot = currentRound();
    if (!snapshot || blocked() || inFlight) return;
    if (type === 'undo' && !snapshot.canUndo) return;
    const command: HostCommand =
      type === 'undo'
        ? {
            type: 'flashcards/study/undo',
            ...roundFields(snapshot),
            targetOperationId: snapshot.round.lastAdvanceOperationId ?? '',
          }
        : { type: `flashcards/study/${type}`, ...roundFields(snapshot) };
    await executeMutation(command, pendingFrom(command, snapshot, newKey()), false);
  }

  function handlePush(push: HostPush): void {
    if (push.type !== 'flashcards/study/changed') return;
    const snapshot = currentRound();
    if (!snapshot || push.roundId !== snapshot.round.roundId) return;
    if (push.revision <= snapshot.round.revision) return;
    const id = studyTransitionId(push.roundId, push.revision);
    if (seenTransitionIds.has(id)) return;
    void open(push.roundId);
  }

  function setConnected(connected: boolean): void {
    patch({ connected });
    if (connected && !restoring) {
      const roundId = state.snapshot?.round.roundId;
      void (async () => {
        await reconcilePending();
        if (roundId) {
          const response = await ports.request({ type: 'flashcards/study/get', roundId });
          if (response.success && isStudySnapshot(response.data)) applySnapshot(response.data);
        }
      })();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(view());
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeVisibility();
          if (fallbackTimer !== null) {
            ports.clock.clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
        }
      };
    },
    getViewModel: view,
    start,
    open,
    claim,
    flip,
    next,
    rate,
    undo: () => simple('undo'),
    pause: () => simple('pause'),
    resume: () => simple('resume'),
    end: () => simple('end'),
    handlePush,
    setConnected,
    noteTransitionEnd,
  };

  function pendingFrom(
    command: HostCommand,
    snapshot: FlashcardStudySnapshot,
    idempotencyKey: string,
  ): FlashcardStudyPendingRecord {
    const record: FlashcardStudyPendingRecord = {
      roundId: snapshot.round.roundId,
      idempotencyKey,
      command,
      expectedRevision: snapshot.round.revision,
      controlEpoch: snapshot.round.controlEpoch,
    };
    if (ports.hostIdentity) record.hostIdentity = ports.hostIdentity;
    if (snapshot.current?.contentVersion) record.contentVersion = snapshot.current.contentVersion;
    return record;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isStudySnapshot(value: unknown): value is FlashcardStudySnapshot {
  return isRecord(value) && isRecord(value.round) && typeof value.round.roundId === 'string';
}
