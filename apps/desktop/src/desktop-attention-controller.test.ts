import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionRunRecord, HostPush, HostServerMessage } from '@piwin/contracts';
import { DEFAULT_ATTENTION_PREFERENCES } from '@piwin/host-client';
import { ATTENTION_LEDGER_KEY } from './attention-preferences';
import {
  createDesktopAttentionController,
  type DesktopAttentionSnapshot,
  type InAppAttentionNotice,
} from './desktop-attention-controller';
import type {
  AttentionDeliverResult,
  DesktopAttentionOs,
  DockBadge,
} from './desktop-attention-os';

const NOW = 1_700_000_000_000;
const ENDED_AT = '2026-09-17T12:00:00.000Z';

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

type HarnessOptions = {
  presence?: DesktopAttentionSnapshot['presence'];
  clickActivation?: boolean;
  deliverResult?: AttentionDeliverResult;
  hostReady?: boolean;
};

type Harness = {
  controller: ReturnType<typeof createDesktopAttentionController>;
  os: DesktopAttentionOs;
  snapshot: DesktopAttentionSnapshot;
  storage: MemoryStorage;
  notices: InAppAttentionNotice[];
  emit: (message: HostServerMessage) => void;
  fireIdle: () => void;
  advance: (ms: number) => void;
  flush: () => Promise<void>;
};

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

describe('createDesktopAttentionController', () => {
  it('AN-T50 inactive run/terminal delivers once with session identifier and project threadId', async () => {
    const harness = await createHarness();
    harness.emit(runTerminal('session-1', 'run-1'));
    await harness.flush();

    expect(harness.os.deliver).toHaveBeenCalledTimes(1);
    expect(harness.os.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'piwin.attention.session-1',
        threadId: 'proj-1',
        sessionId: 'session-1',
        attentionKey: 'run:run-1',
      }),
    );
    const input = vi.mocked(harness.os.deliver).mock.calls[0]?.[0];
    expect(input?.body).not.toContain('session-1');
  });

  it('AN-T51 same runId terminal run/updated does not deliver again', async () => {
    const harness = await createHarness();
    const run = sessionTurn('session-1', 'run-1');
    harness.emit({ type: 'run/terminal', run });
    await harness.flush();
    expect(harness.os.deliver).toHaveBeenCalledTimes(1);

    harness.emit({ type: 'run/updated', run });
    await harness.flush();
    expect(harness.os.deliver).toHaveBeenCalledTimes(1);
  });

  it('AN-T52 hydration then five terminals yields no singles; idle timer flushes one summary', async () => {
    const harness = await createHarness();
    harness.emit({ type: 'hydration' } as HostServerMessage);
    for (let i = 0; i < 5; i += 1) {
      harness.emit(runTerminal(`session-${i}`, `run-${i}`));
    }
    await harness.flush();
    expect(harness.os.deliver).not.toHaveBeenCalled();

    harness.emit({ type: 'host/log', level: 'info', message: 'noise' });
    await harness.flush();
    expect(harness.os.deliver).not.toHaveBeenCalled();

    harness.fireIdle();
    await harness.flush();
    expect(harness.os.deliver).toHaveBeenCalledTimes(1);
    expect(harness.os.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'piwin.attention.summary' }),
    );
  });

  it('AN-T53 host/replay-done flushes catch-up immediately', async () => {
    const harness = await createHarness();
    harness.emit({ type: 'snapshot' } as HostServerMessage);
    harness.emit(runTerminal('session-1', 'run-1'));
    harness.emit(runTerminal('session-2', 'run-2'));
    await harness.flush();
    expect(harness.os.deliver).not.toHaveBeenCalled();

    harness.emit({ type: 'host/replay-done', sinceSeq: 0 });
    await harness.flush();
    expect(harness.os.deliver).toHaveBeenCalledTimes(1);
    expect(harness.os.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'piwin.attention.summary' }),
    );

    harness.fireIdle();
    await harness.flush();
    expect(harness.os.deliver).toHaveBeenCalledTimes(1);
  });

  it('AN-T54 ledger restored from storage suppresses a repeat permission/request', async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      ATTENTION_LEDGER_KEY,
      JSON.stringify({ entries: [{ key: 'permission:req-1', at: NOW }] }),
    );
    const harness = await createHarness({ storage });
    harness.emit({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'req-1',
      action: 'bash',
      detail: '/secret/path --force',
      defaultDecision: 'ask',
    });
    await harness.flush();
    expect(harness.os.deliver).not.toHaveBeenCalled();
    expect(harness.notices).toHaveLength(0);
  });

  it('AN-T55 deliver not-authorized: active falls back in-app; inactive is silent', async () => {
    const silent = await createHarness({
      presence: 'inactive',
      deliverResult: 'not-authorized',
    });
    silent.emit(runTerminal('session-1', 'run-silent'));
    await silent.flush();
    expect(silent.os.deliver).toHaveBeenCalledTimes(1);
    expect(silent.notices).toHaveLength(0);

    const fallback = await createHarness({
      presence: 'inactive',
      deliverResult: 'not-authorized',
    });
    fallback.emit(runTerminal('session-1', 'run-fallback'));
    fallback.snapshot.presence = 'active';
    await fallback.flush();
    expect(fallback.os.deliver).toHaveBeenCalledTimes(1);
    expect(fallback.notices).toHaveLength(1);
    expect(fallback.notices[0]?.action).toEqual({
      label: '跳转到 Alpha',
      sessionId: 'session-1',
    });
  });

  it('foreground in-app delivery includes a jump action', async () => {
    const harness = await createHarness({ presence: 'active' });
    harness.snapshot.conversationCovered = true;
    harness.emit(runTerminal('session-1', 'run-fg'));
    await harness.flush();
    expect(harness.os.deliver).not.toHaveBeenCalled();
    expect(harness.notices).toHaveLength(1);
    expect(harness.notices[0]?.action).toEqual({
      label: '跳转到 Alpha',
      sessionId: 'session-1',
    });
  });

  it('AN-T56 syncAttentionSessions removes delivered ids, skips identical badge, clears when pref off', async () => {
    const harness = await createHarness();
    harness.controller.syncAttentionSessions(['session-a', 'session-b']);
    expect(harness.os.setBadge).toHaveBeenCalledTimes(1);
    expect(harness.os.setBadge).toHaveBeenCalledWith({ kind: 'count', value: 2 } satisfies DockBadge);

    harness.controller.syncAttentionSessions(['session-a', 'session-b']);
    expect(harness.os.setBadge).toHaveBeenCalledTimes(1);

    harness.controller.syncAttentionSessions(['session-a']);
    expect(harness.os.removeDelivered).toHaveBeenCalledWith(['piwin.attention.session-b']);
    expect(harness.os.setBadge).toHaveBeenCalledWith({ kind: 'count', value: 1 });

    harness.snapshot.preferences = { ...harness.snapshot.preferences, badge: false };
    harness.controller.syncAttentionSessions(['session-a']);
    expect(harness.os.setBadge).toHaveBeenCalledWith({ kind: 'clear' });
  });

  it('AN-T57 fourth system banner within 60s uses the summary identifier', async () => {
    const harness = await createHarness();
    for (let i = 0; i < 4; i += 1) {
      harness.emit(runTerminal(`session-${i}`, `run-${i}`));
    }
    await harness.flush();
    expect(harness.os.deliver).toHaveBeenCalledTimes(4);
    expect(vi.mocked(harness.os.deliver).mock.calls[0]?.[0]?.identifier).toBe(
      'piwin.attention.session-0',
    );
    expect(vi.mocked(harness.os.deliver).mock.calls[1]?.[0]?.identifier).toBe(
      'piwin.attention.session-1',
    );
    expect(vi.mocked(harness.os.deliver).mock.calls[2]?.[0]?.identifier).toBe(
      'piwin.attention.session-2',
    );
    expect(vi.mocked(harness.os.deliver).mock.calls[3]?.[0]?.identifier).toBe(
      'piwin.attention.summary',
    );
  });

  it('AN-T58 clickActivation false: system then active within 60s shows one jump chip; after 60s none', async () => {
    const soon = await createHarness({ clickActivation: false });
    soon.emit(runTerminal('session-1', 'run-1'));
    await soon.flush();
    expect(soon.os.deliver).toHaveBeenCalledTimes(1);

    soon.controller.onPresenceChanged('active');
    expect(soon.notices).toHaveLength(1);
    expect(soon.notices[0]?.action).toEqual({
      label: '跳转到 Alpha',
      sessionId: 'session-1',
    });

    soon.controller.onPresenceChanged('inactive');
    soon.controller.onPresenceChanged('active');
    expect(soon.notices).toHaveLength(1);

    const late = await createHarness({ clickActivation: false });
    late.emit(runTerminal('session-1', 'run-late'));
    await late.flush();
    late.advance(60_001);
    late.controller.onPresenceChanged('active');
    expect(late.notices).toHaveLength(0);
  });

  it('maps completed turn to success tone and truncates long action labels', async () => {
    const harness = await createHarness({ presence: 'active' });
    harness.snapshot.conversationCovered = true;
    harness.snapshot.describeSession = () => ({
      sessionTitle: '如果你有一个二次元形象，你认为你应该长什么样子',
      projectName: 'piwin',
      projectId: 'proj-1',
    });
    harness.emit(runTerminal('session-1', 'run-long-title'));
    await harness.flush();
    expect(harness.notices).toHaveLength(1);
    expect(harness.notices[0]?.tone).toBe('success');
    expect(harness.notices[0]?.action).toEqual({
      label: '跳转到 如果你有一个二次元形象，你认为…',
      sessionId: 'session-1',
    });
  });

  it('maps failed turn to error tone', async () => {
    const harness = await createHarness({ presence: 'active' });
    harness.snapshot.conversationCovered = true;
    harness.emit({
      type: 'run/terminal',
      run: {
        runId: 'run-fail',
        kind: 'session-turn',
        status: 'failed',
        rootRunId: 'run-fail',
        sessionId: 'session-1',
        endedAt: ENDED_AT,
      },
    });
    await harness.flush();
    expect(harness.notices).toHaveLength(1);
    expect(harness.notices[0]?.tone).toBe('error');
  });
});

async function createHarness(
  options: HarnessOptions & { storage?: MemoryStorage } = {},
): Promise<Harness> {
  const storage = options.storage ?? new MemoryStorage();
  const listeners = new Set<(message: HostServerMessage) => void>();
  const timers: Timer[] = [];
  let nowMs = NOW;
  const notices: InAppAttentionNotice[] = [];
  const snapshot: DesktopAttentionSnapshot = {
    presence: options.presence ?? 'inactive',
    visibleSessionIds: new Set(),
    activeSessionId: null,
    conversationCovered: false,
    preferences: { ...DEFAULT_ATTENTION_PREFERENCES },
    locale: 'zh-CN',
    hostReady: options.hostReady ?? true,
    describeSession: () => ({
      sessionTitle: 'Alpha',
      projectName: 'piwin',
      projectId: 'proj-1',
    }),
  };
  const clickActivation = options.clickActivation ?? true;
  const deliverResult = options.deliverResult ?? 'delivered';
  const os: DesktopAttentionOs = {
    getCapabilities: vi.fn(async () => ({
      nativeCenter: clickActivation,
      clickActivation,
      authorizationReliable: clickActivation,
    })),
    getAuthorization: vi.fn(async () => 'granted' as const),
    requestAuthorization: vi.fn(async () => 'granted' as const),
    deliver: vi.fn(async () => deliverResult),
    removeDelivered: vi.fn(async () => {}),
    setBadge: vi.fn(async () => {}),
    requestAttention: vi.fn(async () => {}),
    takePendingActivation: vi.fn(async () => null),
    subscribeActivation: vi.fn(() => () => {}),
    openSystemSettings: vi.fn(async () => {}),
  };

  const controller = createDesktopAttentionController({
    hostClient: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    os,
    storage,
    now: () => nowMs,
    setTimer: (cb, ms) => {
      const timer: Timer = { cb, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    getSnapshot: () => snapshot,
    showInAppNotice: (notice) => {
      notices.push(notice);
    },
  });
  disposers.push(() => controller.dispose());
  await Promise.resolve();

  return {
    controller,
    os,
    snapshot,
    storage,
    notices,
    emit(message) {
      for (const listener of listeners) {
        listener(message);
      }
    },
    fireIdle() {
      for (const timer of [...timers]) {
        if (!timer.cancelled && timer.ms === 1500) {
          timer.cancelled = true;
          timer.cb();
        }
      }
    },
    advance(ms) {
      nowMs += ms;
    },
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function sessionTurn(sessionId: string, runId: string): ExecutionRunRecord {
  return {
    runId,
    kind: 'session-turn',
    status: 'completed',
    rootRunId: runId,
    sessionId,
    endedAt: ENDED_AT,
  };
}

function runTerminal(sessionId: string, runId: string): HostPush {
  return { type: 'run/terminal', run: sessionTurn(sessionId, runId) };
}
