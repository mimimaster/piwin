import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionRunRecord, HostPush } from '@piwin/contracts';
import { DEFAULT_ATTENTION_PREFERENCES } from '@piwin/host-client';
import {
  createMobileAttentionController,
  type MobileAttentionBanner,
  type MobileAttentionCatchUpItem,
  type MobileAttentionSnapshot,
} from './mobile-attention-controller.js';
import { MOBILE_ATTENTION_LEDGER_KEY } from './mobile-attention-preferences.js';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

type Timer = { cb: () => void; ms: number; cancelled: boolean };

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

describe('createMobileAttentionController', () => {
  it('background terminal sends a local notification once', async () => {
    const harness = createHarness({ presence: 'inactive' });
    harness.emit(runTerminal('session-1', 'run-1'));
    await Promise.resolve();
    expect(harness.local).toHaveLength(1);
    expect(harness.local[0]?.identifier).toBe('piwin.attention.session-1');
    expect(harness.banners).toHaveLength(0);
  });

  it('foreground other-session complete shows an in-app banner with sessionId', async () => {
    const harness = createHarness({
      presence: 'active',
      visibleSessionIds: new Set(['session-a']),
      activeSessionId: 'session-a',
    });
    harness.emit(runTerminal('session-b', 'run-2'));
    await Promise.resolve();
    expect(harness.local).toHaveLength(0);
    expect(harness.banners).toHaveLength(1);
    expect(harness.banners[0]?.sessionId).toBe('session-b');
  });

  it('hydration then terminals flush a catch-up summary after idle', async () => {
    const harness = createHarness({ presence: 'active' });
    harness.hydrate();
    harness.emit(runTerminal('session-1', 'run-1'));
    harness.emit(runTerminal('session-2', 'run-2'));
    expect(harness.local).toHaveLength(0);
    expect(harness.catchUp).toHaveLength(0);
    harness.fireIdle();
    expect(harness.catchUp).toHaveLength(1);
    expect(harness.catchUp[0]?.length).toBe(2);
  });
});

function createHarness(options: {
  presence?: MobileAttentionSnapshot['presence'];
  visibleSessionIds?: ReadonlySet<string>;
  activeSessionId?: string | null;
}): {
  emit: (push: HostPush) => void;
  hydrate: () => void;
  fireIdle: () => void;
  local: Array<{ identifier: string; sessionId: string }>;
  banners: MobileAttentionBanner[];
  catchUp: Array<readonly MobileAttentionCatchUpItem[]>;
} {
  const storage = new MemoryStorage();
  void storage.getItem(MOBILE_ATTENTION_LEDGER_KEY);
  const pushListeners = new Set<(push: HostPush) => void>();
  const hydrationListeners = new Set<() => void>();
  const timers: Timer[] = [];
  const local: Array<{ identifier: string; sessionId: string }> = [];
  const banners: MobileAttentionBanner[] = [];
  const catchUp: Array<readonly MobileAttentionCatchUpItem[]> = [];
  const snapshot: MobileAttentionSnapshot = {
    presence: options.presence ?? 'inactive',
    visibleSessionIds: options.visibleSessionIds ?? new Set(),
    activeSessionId: options.activeSessionId ?? null,
    conversationCovered: (options.visibleSessionIds?.size ?? 0) === 0,
    preferences: { ...DEFAULT_ATTENTION_PREFERENCES, badge: false, bounceOnNeedsInput: false },
    hostReady: true,
    describeSession: () => ({ sessionTitle: 'Alpha', projectName: 'piwin' }),
  };
  const controller = createMobileAttentionController({
    subscribePush(listener) {
      pushListeners.add(listener);
      return () => {
        pushListeners.delete(listener);
      };
    },
    subscribeHydration(listener) {
      hydrationListeners.add(listener);
      return () => {
        hydrationListeners.delete(listener);
      };
    },
    storage,
    now: () => 1_700_000_000_000,
    setTimer: (cb, ms) => {
      const timer: Timer = { cb, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    getSnapshot: () => snapshot,
    showForegroundBanner: (banner) => {
      banners.push(banner);
    },
    sendLocalNotification: async (input) => {
      local.push({ identifier: input.identifier, sessionId: input.sessionId });
      return 'delivered';
    },
    onCatchUpSummary: (items) => {
      catchUp.push(items);
    },
  });
  disposers.push(() => controller.dispose());
  return {
    emit(push) {
      for (const listener of pushListeners) {
        listener(push);
      }
    },
    hydrate() {
      for (const listener of hydrationListeners) {
        listener();
      }
    },
    fireIdle() {
      for (const timer of timers) {
        if (!timer.cancelled && timer.ms === 1500) {
          timer.cancelled = true;
          timer.cb();
        }
      }
    },
    local,
    banners,
    catchUp,
  };
}

function sessionTurn(sessionId: string, runId: string): ExecutionRunRecord {
  return {
    runId,
    kind: 'session-turn',
    status: 'completed',
    rootRunId: runId,
    sessionId,
    endedAt: '2026-09-17T12:00:00.000Z',
  };
}

function runTerminal(sessionId: string, runId: string): HostPush {
  return { type: 'run/terminal', run: sessionTurn(sessionId, runId) };
}
