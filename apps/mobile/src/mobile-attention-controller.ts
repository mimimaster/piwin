import type { HostPush, HostPushBatchFrame } from '@piwin/contracts';
import {
  decideAttention,
  formatAttentionNotification,
  hasAttentionNotified,
  readAttentionNotifyLedger,
  readAttentionSignals,
  recordAttentionNotified,
  type AttentionNotifyLedger,
  type AttentionPreferences,
  type AttentionPresence,
  type AttentionRaise,
} from '@piwin/host-client';
import { MOBILE_ATTENTION_LEDGER_KEY } from './mobile-attention-preferences.js';
import type { MobileLocalNotificationResult } from './mobile-attention-os.js';

export type MobileAttentionSnapshot = {
  presence: AttentionPresence;
  visibleSessionIds: ReadonlySet<string>;
  activeSessionId: string | null;
  conversationCovered: boolean;
  preferences: AttentionPreferences;
  hostReady: boolean;
  describeSession: (sessionId: string) => { sessionTitle?: string; projectName?: string };
};

export type MobileAttentionBanner = {
  title: string;
  body: string;
  sessionId: string;
};

export type MobileAttentionCatchUpItem = {
  sessionId: string;
  title: string;
  body: string;
  kind: AttentionRaise['kind'];
};

export type MobileAttentionControllerDeps = {
  subscribePush: (listener: (push: HostPush) => void) => () => void;
  subscribeBatch?: (listener: (frame: HostPushBatchFrame) => void) => () => void;
  subscribeHydration?: (listener: () => void) => () => void;
  subscribeSnapshot?: (listener: () => void) => () => void;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => () => void;
  getSnapshot: () => MobileAttentionSnapshot;
  showForegroundBanner: (banner: MobileAttentionBanner) => void;
  sendLocalNotification: (input: {
    identifier: string;
    title: string;
    body: string;
    sessionId: string;
    attentionKey: string;
  }) => Promise<MobileLocalNotificationResult>;
  onCatchUpSummary: (items: readonly MobileAttentionCatchUpItem[]) => void;
};

export type MobileAttentionController = {
  onPresenceChanged(presence: AttentionPresence): void;
  dispose(): void;
};

const CATCH_UP_IDLE_MS = 1500;
const ATTENTION_PUSH_TYPES = new Set<HostPush['type']>([
  'permission/request',
  'permission/resolved',
  'extension/ui_request',
  'run/terminal',
  'run/updated',
]);

export function createMobileAttentionController(
  deps: MobileAttentionControllerDeps,
): MobileAttentionController {
  let disposed = false;
  let catchUpState: 'idle' | 'catchingUp' = 'idle';
  let cancelIdle: (() => void) | null = null;
  let ledger = loadLedger(deps.storage);
  let lastHostReady = deps.getSnapshot().hostReady;
  const pending = new Map<string, AttentionRaise>();

  const unsubscribers = [
    deps.subscribePush((push) => {
      if (!disposed) onPush(push);
    }),
  ];
  if (deps.subscribeBatch) {
    unsubscribers.push(
      deps.subscribeBatch((frame) => {
        if (disposed) return;
        for (const item of frame.items) {
          onPush(item.push);
        }
      }),
    );
  }
  if (deps.subscribeHydration) {
    unsubscribers.push(
      deps.subscribeHydration(() => {
        if (!disposed) enterCatchingUp();
      }),
    );
  }
  if (deps.subscribeSnapshot) {
    unsubscribers.push(
      deps.subscribeSnapshot(() => {
        if (!disposed) enterCatchingUp();
      }),
    );
  }

  function noteHostReady(): void {
    const ready = deps.getSnapshot().hostReady;
    if (!lastHostReady && ready) {
      enterCatchingUp();
    }
    lastHostReady = ready;
  }

  function onPush(push: HostPush): void {
    noteHostReady();
    if (push.type === 'host/replay-done') {
      exitCatchingUpAndFlush();
      return;
    }
    if (catchUpState === 'catchingUp' && ATTENTION_PUSH_TYPES.has(push.type)) {
      resetIdle();
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
    const alreadyNotified = hasAttentionNotified(ledger, raise.key, now) || pending.has(raise.key);
    const decision = decideAttention(raise, {
      presence: snapshot.presence,
      visibleSessionIds: snapshot.visibleSessionIds,
      activeSessionId: snapshot.activeSessionId,
      conversationCovered: snapshot.conversationCovered,
      catchingUp: catchUpState === 'catchingUp',
      preferences: snapshot.preferences,
      alreadyNotified,
      now,
    });
    if (decision.delivery === 'none') {
      return;
    }
    if (decision.delivery === 'catch-up-summary') {
      pending.set(raise.key, raise);
      return;
    }
    const copy = formatRaiseCopy(raise, snapshot);
    recordKey(raise.key, now);
    if (decision.delivery === 'in-app') {
      deps.showForegroundBanner({
        title: copy.title,
        body: copy.body,
        sessionId: raise.sessionId,
      });
      return;
    }
    void deps.sendLocalNotification({
      identifier: `piwin.attention.${raise.sessionId}`,
      title: copy.title,
      body: copy.body,
      sessionId: raise.sessionId,
      attentionKey: raise.key,
    });
  }

  function enterCatchingUp(): void {
    catchUpState = 'catchingUp';
    resetIdle();
  }

  function exitCatchingUpAndFlush(): void {
    if (catchUpState !== 'catchingUp') {
      return;
    }
    catchUpState = 'idle';
    if (cancelIdle) {
      cancelIdle();
      cancelIdle = null;
    }
    flushCatchUp();
  }

  function resetIdle(): void {
    if (cancelIdle) {
      cancelIdle();
    }
    cancelIdle = deps.setTimer(() => {
      cancelIdle = null;
      exitCatchingUpAndFlush();
    }, CATCH_UP_IDLE_MS);
  }

  function flushCatchUp(): void {
    const snapshot = deps.getSnapshot();
    const now = deps.now();
    const remaining: AttentionRaise[] = [];
    for (const [key, raise] of pending) {
      if (!hasAttentionNotified(ledger, key, now)) {
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
    persistLedger();
    const items = remaining.map((raise) => {
      const copy = formatRaiseCopy(raise, snapshot);
      return {
        sessionId: raise.sessionId,
        title: copy.title,
        body: copy.body,
        kind: raise.kind,
      };
    });
    if (snapshot.presence === 'active') {
      deps.onCatchUpSummary(items);
      return;
    }
    const summary = formatAttentionNotification({
      locale: 'zh-CN',
      kind: 'summary',
      count: new Set(remaining.map((item) => item.sessionId)).size,
      needsInputCount: remaining.filter((item) => item.kind === 'needs-input').length,
    });
    const first = remaining[0];
    if (first === undefined) {
      return;
    }
    void deps.sendLocalNotification({
      identifier: 'piwin.attention.summary',
      title: summary.title,
      body: summary.body,
      sessionId: first.sessionId,
      attentionKey: first.key,
    });
  }

  function recordKey(key: string, now: number): void {
    ledger = recordAttentionNotified(ledger, key, now);
    persistLedger();
  }

  function persistLedger(): void {
    try {
      deps.storage.setItem(MOBILE_ATTENTION_LEDGER_KEY, JSON.stringify(ledger));
    } catch {
      /* quota */
    }
  }

  return {
    onPresenceChanged() {
      if (disposed) return;
      noteHostReady();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (cancelIdle) {
        cancelIdle();
      }
      for (const unsub of unsubscribers) {
        unsub();
      }
    },
  };
}

function loadLedger(storage: Pick<Storage, 'getItem'>): AttentionNotifyLedger {
  try {
    const raw = storage.getItem(MOBILE_ATTENTION_LEDGER_KEY);
    if (raw == null || raw === '') {
      return readAttentionNotifyLedger(null);
    }
    return readAttentionNotifyLedger(JSON.parse(raw) as unknown);
  } catch {
    return readAttentionNotifyLedger(null);
  }
}

function formatRaiseCopy(
  raise: AttentionRaise,
  snapshot: MobileAttentionSnapshot,
): { title: string; body: string } {
  const described = snapshot.describeSession(raise.sessionId);
  return formatAttentionNotification({
    locale: 'zh-CN',
    kind: raise.kind,
    source: raise.source,
    ...(described.projectName !== undefined ? { projectName: described.projectName } : {}),
    ...(described.sessionTitle !== undefined ? { sessionTitle: described.sessionTitle } : {}),
    ...(raise.permissionAction !== undefined ? { permissionAction: raise.permissionAction } : {}),
  });
}
