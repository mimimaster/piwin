import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AssistantUsageMeasurement,
  ContextBoundary,
  ContextMeasurement,
  ContextOccupancy,
  HostPush,
  SessionContextSnapshot,
} from '@piwin/contracts';
import { openSessionTranscriptStore, type SessionTranscriptStore } from '@piwin/session';
import {
  createSessionContextCoordinator,
  type SessionContextCoordinator,
  type SessionContextCoordinatorDeps,
} from './session-context-coordinator.js';

async function openStore(label: string): Promise<{
  store: SessionTranscriptStore;
  sessionId: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-context-coord-${label}-`));
  const sessionId = `session-${label}`;
  const store = await openSessionTranscriptStore({
    dbPath: join(rootDir, 'transcript.sqlite3'),
    sessionId,
    projectPath: '/tmp/project',
  });
  return { store, sessionId };
}

function knownOccupancy(tokensUsed: number, sampledAt: string): ContextOccupancy {
  return {
    kind: 'known',
    tokensUsed,
    tokensLimit: 128_000,
    quality: 'measured',
    coverage: 'complete',
    basis: 'pi-context-usage',
    sampledAt,
  };
}

function measurement(
  sessionId: string,
  overrides: Partial<ContextMeasurement> & { occupancy: ContextOccupancy; sampleSequence: number },
): ContextMeasurement {
  const sampledAt = overrides.sampledAt ?? '2026-08-30T00:00:00.000Z';
  const contextBoundary: ContextBoundary = overrides.contextBoundary ?? {
    activeLeafMessageId: overrides.messageId ?? 'msg-1',
  };
  const result: ContextMeasurement = {
    sessionId,
    sampleSequence: overrides.sampleSequence,
    occupancy: overrides.occupancy,
    contextBoundary,
    sampledAt,
  };
  if (overrides.runId !== undefined) result.runId = overrides.runId;
  if (overrides.runtimeGenerationId !== undefined) {
    result.runtimeGenerationId = overrides.runtimeGenerationId;
  }
  if (overrides.messageId !== undefined) result.messageId = overrides.messageId;
  return result;
}

function finalized(
  sessionId: string,
  messageId: string,
  totalTokens: number,
  extras: Partial<AssistantUsageMeasurement> = {},
): AssistantUsageMeasurement {
  const record: AssistantUsageMeasurement = {
    measurementId: extras.measurementId ?? `${sessionId}:gen-1:${messageId}`,
    sessionId,
    messageId,
    totalTokens,
    recordedAt: extras.recordedAt ?? '2026-08-30T00:00:01.000Z',
  };
  if (extras.runId !== undefined) record.runId = extras.runId;
  if (extras.runtimeGenerationId !== undefined) {
    record.runtimeGenerationId = extras.runtimeGenerationId;
  }
  if (extras.modelId !== undefined) record.modelId = extras.modelId;
  if (extras.promptTokens !== undefined) record.promptTokens = extras.promptTokens;
  if (extras.completionTokens !== undefined) record.completionTokens = extras.completionTokens;
  return record;
}

type Clock = {
  nowMs: number;
  timers: Array<{ at: number; fn: () => void; cleared: boolean }>;
  advance(ms: number): void;
};

function createClock(): Clock {
  const clock: Clock = {
    nowMs: 1_000,
    timers: [],
    advance(ms: number): void {
      clock.nowMs += ms;
      const due = clock.timers.filter((timer) => !timer.cleared && timer.at <= clock.nowMs);
      for (const timer of due) {
        timer.cleared = true;
        timer.fn();
      }
    },
  };
  return clock;
}

async function createHarness(
  label: string,
  options: {
    failWrites?: boolean;
    boundGenerationId?: string;
  } = {},
): Promise<{
  coordinator: SessionContextCoordinator;
  store: SessionTranscriptStore;
  sessionId: string;
  pushes: HostPush[];
  billed: AssistantUsageMeasurement[];
  clock: Clock;
  logs: Array<{ level: string; message: string }>;
}> {
  const { store, sessionId } = await openStore(label);
  const pushes: HostPush[] = [];
  const billed: AssistantUsageMeasurement[] = [];
  const logs: Array<{ level: string; message: string }> = [];
  const clock = createClock();
  const persistStore: Pick<
    SessionTranscriptStore,
    | 'readContextState'
    | 'replaceContextState'
    | 'invalidateContextState'
    | 'putAssistantUsageMeasurement'
    | 'readLatestAssistantUsageForActivePath'
    | 'getActiveLeaf'
  > = options.failWrites
    ? {
        readContextState: () => store.readContextState(),
        replaceContextState: async () => ({ ok: false, reason: 'unavailable' as const }),
        invalidateContextState: (input) => store.invalidateContextState(input),
        putAssistantUsageMeasurement: (measurementRow) =>
          store.putAssistantUsageMeasurement(measurementRow),
        readLatestAssistantUsageForActivePath: () => store.readLatestAssistantUsageForActivePath(),
        getActiveLeaf: () => store.getActiveLeaf(),
      }
    : store;
  const deps: SessionContextCoordinatorDeps = {
    now: () => clock.nowMs,
    nowIso: () => new Date(clock.nowMs).toISOString(),
    getStore: async () => persistStore as SessionTranscriptStore,
    push: (message) => {
      pushes.push(message);
    },
    recordFinalizedUsage: async (_sessionId, usage) => {
      billed.push(usage);
      return billed.filter((row) => row.measurementId === usage.measurementId).length > 1
        ? 'duplicate'
        : 'inserted';
    },
    log: (level, message) => {
      logs.push({ level, message });
    },
    getBoundGenerationId: () => options.boundGenerationId ?? 'gen-1',
    schedule: (fn, ms) => {
      const timer = { at: clock.nowMs + ms, fn, cleared: false };
      clock.timers.push(timer);
      return {
        clear: () => {
          timer.cleared = true;
        },
      };
    },
  };
  if (options.failWrites) {
    deps.recordFinalizedUsage = async (_sessionId, usage) => {
      billed.push(usage);
      return 'inserted';
    };
  }
  return {
    coordinator: createSessionContextCoordinator(deps),
    store,
    sessionId,
    pushes,
    billed,
    clock,
    logs,
  };
}

function contextUpdates(pushes: HostPush[]): SessionContextSnapshot[] {
  return pushes.flatMap((push) =>
    push.type === 'session/context-updated' ? [push.snapshot] : [],
  );
}

describe('session context coordinator', () => {
  it('T14: 100 occupancy samples do not bill and do not emit agent events', async () => {
    const harness = await createHarness('t14');
    const { coordinator, sessionId, billed, pushes } = harness;
    await coordinator.noteRunStarted({ sessionId, runId: 'run-1', runtimeGenerationId: 'gen-1' });
    await coordinator.noteResponseEvidence({ sessionId, runId: 'run-1', messageId: 'msg-1' });
    for (let index = 0; index < 100; index += 1) {
      await coordinator.ingestMeasurement({
        sessionId,
        boundGenerationId: 'gen-1',
        measurement: measurement(sessionId, {
          sampleSequence: index + 1,
          runtimeGenerationId: 'gen-1',
          messageId: 'msg-1',
          occupancy: knownOccupancy(1_000 + index, '2026-08-30T00:00:00.000Z'),
        }),
      });
    }
    await coordinator.flush(sessionId);
    expect(billed).toEqual([]);
    expect(pushes.some((push) => push.type === 'event')).toBe(false);
    const snapshots = contextUpdates(pushes);
    expect(snapshots.length).toBeGreaterThan(0);
    const latest = snapshots.at(-1);
    expect(latest?.occupancy).toMatchObject({ kind: 'known', tokensUsed: 1_099 });
    harness.store.close();
  });

  it('T14 publish policy: leading + max-wait at 4Hz, not trailing-only', async () => {
    const harness = await createHarness('t14-hz');
    const { coordinator, sessionId, clock, pushes } = harness;
    await coordinator.noteRunStarted({ sessionId, runId: 'run-1', runtimeGenerationId: 'gen-1' });
    await coordinator.noteResponseEvidence({ sessionId, runId: 'run-1', messageId: 'msg-1' });
    pushes.length = 0;
    for (let index = 0; index < 40; index += 1) {
      await coordinator.ingestMeasurement({
        sessionId,
        boundGenerationId: 'gen-1',
        measurement: measurement(sessionId, {
          sampleSequence: index + 1,
          runtimeGenerationId: 'gen-1',
          occupancy: knownOccupancy(10_000 + index, '2026-08-30T00:00:00.000Z'),
        }),
      });
      clock.advance(10);
    }
    await coordinator.flush(sessionId);
    const updates = contextUpdates(pushes);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.length).toBeLessThanOrEqual(4);
    expect(updates.at(-1)?.occupancy).toMatchObject({ kind: 'known', tokensUsed: 10_039 });
    harness.store.close();
  });

  it('T14b: three finalized measurements bill three times without a turn_end path', async () => {
    const harness = await createHarness('t14b');
    const { coordinator, sessionId, billed, pushes } = harness;
    await coordinator.noteRunStarted({ sessionId, runId: 'run-1', runtimeGenerationId: 'gen-1' });
    await coordinator.noteResponseEvidence({ sessionId, runId: 'run-1', messageId: 'msg-1' });
    for (const messageId of ['msg-a', 'msg-b', 'msg-c']) {
      await coordinator.ingestFinalized({
        sessionId,
        boundGenerationId: 'gen-1',
        measurement: finalized(sessionId, messageId, 90, {
          runId: 'run-1',
          runtimeGenerationId: 'gen-1',
        }),
      });
    }
    await coordinator.flush(sessionId);
    expect(billed).toHaveLength(3);
    expect(new Set(billed.map((row) => row.messageId)).size).toBe(3);
    expect(pushes.filter((push) => push.type === 'event' && push.event.type === 'usage/update')).toHaveLength(
      3,
    );
    harness.store.close();
  });

  it('T13: message_end and agent_end with the same measurementId bill once', async () => {
    const harness = await createHarness('t13');
    const { coordinator, sessionId, billed, store } = harness;
    await store.appendMessage({
      id: 'msg-1',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'b-1',
      role: 'assistant',
      text: 'hello',
      status: 'done',
      createdAt: '2026-08-30T00:00:00.000Z',
    });
    const row = finalized(sessionId, 'msg-1', 42, {
      measurementId: `${sessionId}:gen-1:msg-1`,
      runtimeGenerationId: 'gen-1',
    });
    await coordinator.ingestFinalized({ sessionId, boundGenerationId: 'gen-1', measurement: row });
    await coordinator.ingestFinalized({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: { ...row, totalTokens: 99 },
    });
    expect(new Set(billed.map((entry) => entry.measurementId)).size).toBe(1);
    expect(await store.readLatestAssistantUsageForActivePath()).toMatchObject({
      measurementId: row.measurementId,
      totalTokens: 42,
    });
    store.close();
  });

  it('T16: compact 80k→5k replaces occupancy as estimated', async () => {
    const harness = await createHarness('t16');
    const { coordinator, sessionId, store } = harness;
    await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        runtimeGenerationId: 'gen-1',
        occupancy: knownOccupancy(80_000, '2026-08-30T00:00:00.000Z'),
      }),
    });
    await coordinator.noteCompactionStart(sessionId);
    await coordinator.noteCompactionEnd(sessionId, { ok: true, tokensBefore: 80_000, tokensAfter: 5_000 });
    await coordinator.flush(sessionId);
    const snapshot = await coordinator.getSnapshot(sessionId);
    expect(snapshot.occupancy).toMatchObject({
      kind: 'known',
      tokensUsed: 5_000,
      quality: 'estimated',
    });
    expect(snapshot.phase).toBe('idle');
    expect(snapshot.contextVersion).toBeGreaterThan(1);
    store.close();
  });

  it('T17: compact missing tokensAfter becomes unknown and does not keep 80k', async () => {
    const harness = await createHarness('t17');
    const { coordinator, sessionId, store } = harness;
    await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        occupancy: knownOccupancy(80_000, '2026-08-30T00:00:00.000Z'),
      }),
    });
    await coordinator.noteCompactionEnd(sessionId, { ok: true, tokensBefore: 80_000 });
    await coordinator.flush(sessionId);
    const snapshot = await coordinator.getSnapshot(sessionId);
    expect(snapshot.occupancy.kind).toBe('unknown');
    if (snapshot.occupancy.kind === 'known') {
      throw new Error('compact without tokensAfter must not keep the old full occupancy');
    }
    store.close();
  });

  it('T18: matching boundary restores after dispose; mismatch invalidates; ledger unused', async () => {
    const harness = await createHarness('t18');
    const { coordinator, sessionId, store } = harness;
    await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        runtimeGenerationId: 'gen-1',
        occupancy: knownOccupancy(5_000, '2026-08-30T00:00:00.000Z'),
        contextBoundary: { activeLeafMessageId: 'leaf-1', compactionBoundary: 'c1' },
      }),
    });
    await coordinator.flush(sessionId);
    coordinator.disposeSession(sessionId);
    const restored = await coordinator.getSnapshot(sessionId);
    expect(restored.occupancy).toMatchObject({ kind: 'known', tokensUsed: 5_000 });
    expect(restored.runId).toBeUndefined();

    await coordinator.revalidateAfterActivation(sessionId, {
      runtimeGenerationId: 'gen-2',
      contextBoundary: {
        activeLeafMessageId: 'leaf-1',
        compactionBoundary: 'c1',
      },
    });
    const matched = await coordinator.getSnapshot(sessionId);
    expect(matched.occupancy).toMatchObject({ kind: 'known', tokensUsed: 5_000 });
    expect(matched.runtimeGenerationId).toBe('gen-2');
    expect(matched.runId).toBeUndefined();

    await coordinator.revalidateAfterActivation(sessionId, {
      runtimeGenerationId: 'gen-3',
      contextBoundary: {
        activeLeafMessageId: 'leaf-other',
        compactionBoundary: 'c-other',
      },
    });
    const mismatched = await coordinator.getSnapshot(sessionId);
    expect(mismatched.occupancy.kind).toBe('unknown');
    expect(mismatched.contextVersion).toBeGreaterThan(matched.contextVersion);
    store.close();
  });

  it('T19: truncate-to-empty hides occupancy and rejects pre-barrier samples', async () => {
    const harness = await createHarness('t19');
    const { coordinator, sessionId, store, pushes } = harness;
    await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        occupancy: knownOccupancy(9_000, '2026-08-30T00:00:00.000Z'),
      }),
    });
    const before = await coordinator.getSnapshot(sessionId);
    await coordinator.invalidate(sessionId, { reason: 'truncate', empty: true });
    const empty = await coordinator.getSnapshot(sessionId);
    expect(empty.phase).toBe('empty');
    expect(empty.occupancy.kind).toBe('unknown');
    expect(empty.responseEvidence.historyHasDisplayableResponse).toBe(false);
    expect(empty.contextVersion).toBeGreaterThan(before.contextVersion);

    pushes.length = 0;
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 2,
        occupancy: knownOccupancy(9_000, '2026-08-30T00:00:01.000Z'),
      }),
    });
    await coordinator.flush(sessionId);
    const afterLate = await coordinator.getSnapshot(sessionId);
    expect(afterLate.occupancy.kind).toBe('unknown');
    expect(afterLate.phase).toBe('empty');
    const cas = await store.replaceContextState({
      expectedContextVersion: before.contextVersion,
      expectedBoundary: before.contextBoundary,
      snapshot: before,
    });
    expect(cas.ok).toBe(false);
    store.close();
  });

  it('T12: aborted all-zero does not persist known 0; finalized still bills', async () => {
    const harness = await createHarness('t12');
    const { coordinator, sessionId, billed, store } = harness;
    await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        occupancy: knownOccupancy(4_000, '2026-08-30T00:00:00.000Z'),
      }),
    });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 2,
        occupancy: { kind: 'unknown', reason: 'error-or-aborted-usage' },
      }),
    });
    await coordinator.flush(sessionId);
    const snapshot = await coordinator.getSnapshot(sessionId);
    expect(snapshot.occupancy.kind).toBe('unknown');
    expect(snapshot.lastConfirmed?.occupancy.tokensUsed).toBe(4_000);
    await coordinator.ingestFinalized({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: finalized(sessionId, 'msg-1', 12, { runtimeGenerationId: 'gen-1' }),
    });
    expect(billed).toHaveLength(1);
    expect(billed[0]?.totalTokens).toBe(12);
    store.close();
  });

  it('T30: store write failure marks unavailable and does not throw', async () => {
    const harness = await createHarness('t30', { failWrites: true });
    const { coordinator, sessionId, logs, billed, pushes } = harness;
    await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        occupancy: knownOccupancy(3_000, '2026-08-30T00:00:00.000Z'),
      }),
    });
    const snapshot = await coordinator.getSnapshot(sessionId);
    expect(snapshot.phase).toBe('unavailable');
    expect(logs.some((row) => row.level === 'warn' && row.message.includes('unavailable'))).toBe(
      true,
    );
    await coordinator.ingestFinalized({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: finalized(sessionId, 'msg-1', 8),
    });
    expect(billed).toHaveLength(1);
    expect(pushes.some((push) => push.type === 'session/context-updated')).toBe(true);
    harness.store.close();
  });

  it('T32: new Run hides occupancy until evidence; tool-loop keeps showing', async () => {
    const harness = await createHarness('t32');
    const { coordinator, sessionId, store } = harness;
    await coordinator.noteRunStarted({ sessionId, runId: 'run-1', runtimeGenerationId: 'gen-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        occupancy: knownOccupancy(2_000, '2026-08-30T00:00:00.000Z'),
      }),
    });
    const waiting = await coordinator.getSnapshot(sessionId);
    expect(waiting.phase).toBe('waiting-response');
    expect(waiting.occupancy.kind).toBe('unknown');
    expect(waiting.responseEvidence.currentRunHasResponse).toBe(false);

    await coordinator.noteResponseEvidence({ sessionId, runId: 'run-1', messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 2,
        occupancy: knownOccupancy(2_400, '2026-08-30T00:00:01.000Z'),
      }),
    });
    const showing = await coordinator.getSnapshot(sessionId);
    expect(showing.responseEvidence.currentRunHasResponse).toBe(true);
    expect(showing.occupancy).toMatchObject({ kind: 'known', tokensUsed: 2_400 });

    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-1',
      measurement: measurement(sessionId, {
        sampleSequence: 3,
        occupancy: knownOccupancy(2_800, '2026-08-30T00:00:02.000Z'),
      }),
    });
    const loop = await coordinator.getSnapshot(sessionId);
    expect(loop.occupancy).toMatchObject({ kind: 'known', tokensUsed: 2_800 });
    expect(loop.responseEvidence.currentRunHasResponse).toBe(true);

    await coordinator.noteRunStarted({ sessionId, runId: 'run-2', runtimeGenerationId: 'gen-1' });
    const nextWait = await coordinator.getSnapshot(sessionId);
    expect(nextWait.phase).toBe('waiting-response');
    expect(nextWait.occupancy.kind).toBe('unknown');
    expect(nextWait.lastConfirmed?.occupancy.tokensUsed).toBe(2_800);
    store.close();
  });

  it('rejects a late sample from a previous runtimeGenerationId', async () => {
    const harness = await createHarness('gen-reject', { boundGenerationId: 'gen-2' });
    const { coordinator, sessionId, store } = harness;
    await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
    await coordinator.ingestMeasurement({
      sessionId,
      boundGenerationId: 'gen-2',
      measurement: measurement(sessionId, {
        sampleSequence: 1,
        runtimeGenerationId: 'gen-1',
        occupancy: knownOccupancy(7_000, '2026-08-30T00:00:00.000Z'),
      }),
    });
    const snapshot = await coordinator.getSnapshot(sessionId);
    expect(snapshot.occupancy.kind).not.toBe('known');
    store.close();
  });
});
