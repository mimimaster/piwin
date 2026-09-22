import type { HostPush, HostServerMessage } from '@piwin/contracts';
import {
  admitAttentionBanner,
  decideAttention,
  EMPTY_ATTENTION_BURST_WINDOW,
  formatAttentionNotification,
  hasAttentionNotified,
  readAttentionNotifyLedger,
  readAttentionSignals,
  recordAttentionNotified,
  type AttentionBurstWindow,
  type AttentionContext,
  type AttentionNotifyLedger,
  type AttentionPreferences,
  type AttentionPresence,
  type AttentionRaise,
} from '@piwin/host-client';
import type { UiNotificationTone } from '@piwin/ui-kit';
import { formatDockBadge } from './attention-badge-model';
import { ATTENTION_LEDGER_KEY } from './attention-preferences';
import type {
  AttentionDeliverInput,
  AttentionOsCapabilities,
  DesktopAttentionOs,
  DockBadge,
} from './desktop-attention-os';
import type { DesktopLocale } from './desktop-locale';

export type DesktopAttentionSnapshot = {
  presence: AttentionPresence;
  visibleSessionIds: ReadonlySet<string>;
  activeSessionId: string | null;
  /** AN-R05: covered conversation is never seen; required after R05. */
  conversationCovered: boolean;
  preferences: AttentionPreferences;
  locale: DesktopLocale;
  hostReady: boolean;
  describeSession: (sessionId: string) => {
    sessionTitle?: string;
    projectName?: string;
    projectId?: string;
  };
};

export type InAppAttentionNotice = {
  tone?: UiNotificationTone;
  title?: string;
  body: string;
  action?: { label: string; sessionId: string };
};

export type DesktopAttentionControllerDeps = {
  hostClient: { subscribe(listener: (message: HostServerMessage) => void): () => void };
  os: DesktopAttentionOs;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => () => void;
  getSnapshot: () => DesktopAttentionSnapshot;
  showInAppNotice: (notice: InAppAttentionNotice) => void;
};

export type DesktopAttentionController = {
  onPresenceChanged(presence: AttentionPresence): void;
  syncAttentionSessions(sessionIds: readonly string[]): void;
  dispose(): void;
};

const CATCH_UP_IDLE_MS = 1500;
const CLICK_ACTIVATION_FALLBACK_MS = 60_000;
const SUMMARY_IDENTIFIER = 'piwin.attention.summary';

const CATCH_UP_IDLE_RESET_TYPES = new Set<HostPush['type']>([
  'permission/request',
  'permission/resolved',
  'extension/ui_request',
  'run/terminal',
  'run/updated',
]);

type LastSystemDelivery = {
  sessionId: string;
  at: number;
  chipShown: boolean;
  title: string;
  body: string;
  kind: AttentionRaise['kind'] | 'summary';
};

export function createDesktopAttentionController(
  deps: DesktopAttentionControllerDeps,
): DesktopAttentionController {
  let disposed = false;
  let catchUpState: 'idle' | 'catchingUp' = 'idle';
  let cancelIdleTimer: (() => void) | null = null;
  let ledger = loadLedger(deps.storage);
  let ledgerWriteQueued = false;
  let burst: AttentionBurstWindow = EMPTY_ATTENTION_BURST_WINDOW;
  let lastHostReady = deps.getSnapshot().hostReady;
  let capabilities: AttentionOsCapabilities | null = null;
  let lastBadge: DockBadge | null = null;
  let syncedSessionIds = new Set<string>();
  let lastSystemDelivery: LastSystemDelivery | null = null;
  const pending = new Map<string, AttentionRaise>();
  const delivering = new Set<string>();

  const unsubscribe = deps.hostClient.subscribe((message) => {
    if (disposed) return;
    noteHostReadyTransition();
    onHostMessage(message);
  });

  void deps.os.getCapabilities().then(
    (value) => {
      if (!disposed) capabilities = value;
    },
    () => {
      /* keep capabilities unset; AN-R21 stays inert */
    },
  );

  function noteHostReadyTransition(): void {
    const ready = deps.getSnapshot().hostReady;
    if (!lastHostReady && ready) {
      enterCatchingUp();
    }
    lastHostReady = ready;
  }

  function onHostMessage(message: HostServerMessage): void {
    if (message.type === 'push/batch') {
      for (const item of message.items) {
        onPush(item.push);
      }
      return;
    }
    if (message.type === 'hydration' || message.type === 'snapshot') {
      enterCatchingUp();
      return;
    }
    if (message.type === 'response') {
      return;
    }
    onPush(message);
  }

  function onPush(push: HostPush): void {
    if (push.type === 'host/replay-done') {
      exitCatchingUpAndFlush();
      return;
    }
    if (catchUpState === 'catchingUp' && CATCH_UP_IDLE_RESET_TYPES.has(push.type)) {
      resetIdleTimer();
    }
    for (const signal of readAttentionSignals(push)) {
      if (signal.type === 'raise') {
        handleRaise(signal);
      }
    }
  }

  function handleRaise(raise: AttentionRaise): void {
    const snapshot = deps.getSnapshot();
    const now = deps.now();
    const alreadyNotified =
      hasAttentionNotified(ledger, raise.key, now) ||
      pending.has(raise.key) ||
      delivering.has(raise.key);
    const decision = decideAttention(raise, {
      presence: snapshot.presence,
      visibleSessionIds: snapshot.visibleSessionIds,
      activeSessionId: snapshot.activeSessionId,
      conversationCovered: snapshot.conversationCovered,
      catchingUp: catchUpState === 'catchingUp',
      preferences: snapshot.preferences,
      alreadyNotified,
      now,
    } as AttentionContext);

    if (decision.delivery === 'none') {
      return;
    }
    if (decision.delivery === 'catch-up-summary') {
      pending.set(raise.key, raise);
      return;
    }
    if (decision.delivery === 'in-app') {
      deliverInApp(raise, snapshot, now, decision.bounce);
      return;
    }
    void deliverSystem(raise, snapshot, now, decision.bounce);
  }

  function deliverInApp(
    raise: AttentionRaise,
    snapshot: DesktopAttentionSnapshot,
    now: number,
    bounce: boolean,
  ): void {
    const copy = formatRaiseCopy(raise, snapshot);
    deps.showInAppNotice(
      inAppNotice(copy, snapshot, raise.sessionId, raise.kind),
    );
    recordDelivered(raise.key, now);
    if (bounce) {
      void deps.os.requestAttention();
    }
  }

  async function deliverSystem(
    raise: AttentionRaise,
    snapshot: DesktopAttentionSnapshot,
    now: number,
    bounce: boolean,
  ): Promise<void> {
    delivering.add(raise.key);
    try {
      const admitted = admitAttentionBanner(burst, now);
      burst = admitted.window;
      const described = snapshot.describeSession(raise.sessionId);
      const copy = formatRaiseCopy(raise, snapshot);
      const input: AttentionDeliverInput = {
        identifier:
          admitted.mode === 'summary' ? SUMMARY_IDENTIFIER : sessionIdentifier(raise.sessionId),
        threadId: described.projectId ?? 'general',
        title: copy.title,
        body: copy.body,
        sessionId: raise.sessionId,
        attentionKey: raise.key,
        sound: snapshot.preferences.sound,
      };
      const result = await deps.os.deliver(input);
      if (disposed) return;
      if (result === 'delivered') {
        lastSystemDelivery = {
          sessionId: raise.sessionId,
          at: now,
          chipShown: false,
          title: copy.title,
          body: copy.body,
          kind: raise.kind,
        };
        recordDelivered(raise.key, now);
        if (bounce) {
          void deps.os.requestAttention();
        }
        return;
      }
      if (result !== 'not-authorized' && result !== 'unsupported') {
        return;
      }
      if (deps.getSnapshot().presence === 'active') {
        deps.showInAppNotice(
          inAppNotice(copy, snapshot, raise.sessionId, raise.kind),
        );
        recordDelivered(raise.key, now);
      }
    } finally {
      delivering.delete(raise.key);
    }
  }

  function enterCatchingUp(): void {
    catchUpState = 'catchingUp';
    resetIdleTimer();
  }

  function exitCatchingUpAndFlush(): void {
    if (catchUpState !== 'catchingUp') {
      return;
    }
    catchUpState = 'idle';
    clearIdleTimer();
    flushCatchUp();
  }

  function resetIdleTimer(): void {
    clearIdleTimer();
    cancelIdleTimer = deps.setTimer(() => {
      cancelIdleTimer = null;
      exitCatchingUpAndFlush();
    }, CATCH_UP_IDLE_MS);
  }

  function clearIdleTimer(): void {
    if (cancelIdleTimer) {
      cancelIdleTimer();
      cancelIdleTimer = null;
    }
  }

  function flushCatchUp(): void {
    const snapshot = deps.getSnapshot();
    const now = deps.now();
    const remaining: AttentionRaise[] = [];
    for (const [key, raise] of pending) {
      if (!hasAttentionNotified(ledger, key, now) && !delivering.has(key)) {
        remaining.push(raise);
      }
    }
    pending.clear();
    if (remaining.length === 0) {
      return;
    }
    for (const raise of remaining) {
      ledger = recordAttentionNotified(ledger, raise.key, now);
    }
    queueLedgerWrite();

    const sessionIds = new Set(remaining.map((item) => item.sessionId));
    let needsInputCount = 0;
    for (const raise of remaining) {
      if (raise.kind === 'needs-input') {
        needsInputCount += 1;
      }
    }
    const copy = formatAttentionNotification({
      locale: snapshot.locale,
      kind: 'summary',
      count: sessionIds.size,
      needsInputCount,
    });
    if (snapshot.presence === 'active') {
      const jumpSessionId =
        remaining.find((item) => item.kind === 'needs-input')?.sessionId ?? remaining[0]?.sessionId;
      if (jumpSessionId !== undefined) {
        deps.showInAppNotice(inAppNotice(copy, snapshot, jumpSessionId, 'summary'));
      } else {
        deps.showInAppNotice({ tone: 'info', title: copy.title, body: copy.body });
      }
      return;
    }
    const first = remaining[0];
    if (!first) {
      return;
    }
    void deliverCatchUpSummary(copy, first, snapshot);
  }

  async function deliverCatchUpSummary(
    copy: { title: string; body: string },
    first: AttentionRaise,
    snapshot: DesktopAttentionSnapshot,
  ): Promise<void> {
    const result = await deps.os.deliver({
      identifier: SUMMARY_IDENTIFIER,
      threadId: 'general',
      title: copy.title,
      body: copy.body,
      sessionId: first.sessionId,
      attentionKey: first.key,
      sound: snapshot.preferences.sound,
    });
    if (disposed) return;
    if (result === 'delivered') {
      lastSystemDelivery = {
        sessionId: first.sessionId,
        at: deps.now(),
        chipShown: false,
        title: copy.title,
        body: copy.body,
        kind: 'summary',
      };
      return;
    }
    if (
      (result === 'not-authorized' || result === 'unsupported') &&
      deps.getSnapshot().presence === 'active'
    ) {
      deps.showInAppNotice(inAppNotice(copy, snapshot, first.sessionId, 'summary'));
    }
  }

  function recordDelivered(key: string, now: number): void {
    ledger = recordAttentionNotified(ledger, key, now);
    queueLedgerWrite();
  }

  function queueLedgerWrite(): void {
    if (ledgerWriteQueued) {
      return;
    }
    ledgerWriteQueued = true;
    queueMicrotask(() => {
      ledgerWriteQueued = false;
      if (disposed) return;
      try {
        deps.storage.setItem(ATTENTION_LEDGER_KEY, JSON.stringify(ledger));
      } catch {
        /* quota / private mode */
      }
    });
  }

  function maybeShowJumpChip(presence: AttentionPresence): void {
    if (presence !== 'active') {
      return;
    }
    if (capabilities?.clickActivation !== false) {
      return;
    }
    const last = lastSystemDelivery;
    if (!last || last.chipShown) {
      return;
    }
    if (deps.now() - last.at > CLICK_ACTIVATION_FALLBACK_MS) {
      return;
    }
    last.chipShown = true;
    const snapshot = deps.getSnapshot();
    deps.showInAppNotice({
      tone: attentionKindToTone(last.kind),
      ...(last.kind === 'turn-complete' ? {} : { title: last.title }),
      body: last.body,
      action: {
        label: jumpActionLabel(snapshot.locale),
        sessionId: last.sessionId,
      },
    });
  }

  return {
    onPresenceChanged(presence) {
      if (disposed) return;
      noteHostReadyTransition();
      maybeShowJumpChip(presence);
    },
    syncAttentionSessions(sessionIds) {
      if (disposed) return;
      const next = new Set(sessionIds);
      const removed: string[] = [];
      for (const id of syncedSessionIds) {
        if (!next.has(id)) {
          removed.push(sessionIdentifier(id));
        }
      }
      syncedSessionIds = next;
      if (removed.length > 0) {
        void deps.os.removeDelivered(removed);
      }
      const snapshot = deps.getSnapshot();
      const badge = snapshot.preferences.badge
        ? formatDockBadge(sessionIds.length)
        : { kind: 'clear' as const };
      if (lastBadge !== null && dockBadgesEqual(lastBadge, badge)) {
        return;
      }
      lastBadge = badge;
      void deps.os.setBadge(badge);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      clearIdleTimer();
    },
  };
}

function attentionKindToTone(kind: AttentionRaise['kind'] | 'summary'): UiNotificationTone {
  switch (kind) {
    case 'turn-complete':
      return 'success';
    case 'turn-failed':
      return 'error';
    case 'needs-input':
      return 'warning';
    case 'summary':
    default:
      return 'info';
  }
}

function inAppNotice(
  copy: { title: string; body: string },
  snapshot: DesktopAttentionSnapshot,
  sessionId: string,
  kind: AttentionRaise['kind'] | 'summary',
): InAppAttentionNotice {
  return {
    tone: attentionKindToTone(kind),
    // A finished turn is already announced by the success seal; its title
    // ("已完成" / "Finished") only repeats that, so the in-app toast shows
    // the session line alone.
    ...(kind === 'turn-complete' ? {} : { title: copy.title }),
    body: copy.body,
    action: {
      label: jumpActionLabel(snapshot.locale),
      sessionId,
    },
  };
}

function loadLedger(storage: Pick<Storage, 'getItem'>): AttentionNotifyLedger {
  try {
    const raw = storage.getItem(ATTENTION_LEDGER_KEY);
    if (raw == null || raw === '') {
      return readAttentionNotifyLedger(null);
    }
    return readAttentionNotifyLedger(JSON.parse(raw) as unknown);
  } catch {
    return readAttentionNotifyLedger(null);
  }
}

function sessionIdentifier(sessionId: string): string {
  return `piwin.attention.${sessionId}`;
}

function formatRaiseCopy(
  raise: AttentionRaise,
  snapshot: DesktopAttentionSnapshot,
): { title: string; body: string } {
  const described = snapshot.describeSession(raise.sessionId);
  return formatAttentionNotification({
    locale: snapshot.locale,
    kind: raise.kind,
    source: raise.source,
    ...(described.projectName !== undefined ? { projectName: described.projectName } : {}),
    ...(described.sessionTitle !== undefined ? { sessionTitle: described.sessionTitle } : {}),
    ...(raise.permissionAction !== undefined ? { permissionAction: raise.permissionAction } : {}),
  });
}

function jumpActionLabel(locale: DesktopLocale): string {
  return locale === 'en' ? 'Jump' : '跳转';
}

function dockBadgesEqual(left: DockBadge, right: DockBadge): boolean {
  if (left.kind === 'clear') {
    return right.kind === 'clear';
  }
  if (left.kind === 'count') {
    return right.kind === 'count' && left.value === right.value;
  }
  return right.kind === 'label' && left.value === right.value;
}
