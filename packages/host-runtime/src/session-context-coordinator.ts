import {
  canPromoteLastConfirmed,
  promoteLastConfirmed,
  type AssistantUsageMeasurement,
  type ContextBoundary,
  type ContextMeasurement,
  type ContextUsageSnapshot,
  type HostPush,
  type SessionContextSnapshot,
} from '@piwin/contracts';
import {
  readOrInsertUnknownContextState,
  type SessionTranscriptStore,
} from '@piwin/session';
import {
  applyActivationRevalidate,
  applyCompactionEnd,
  applyCompactionStart,
  applyInvalidate,
  applyMeasurement,
  applyResponseEvidence,
  applyRunStarted,
  applyRunTerminal,
} from './session-context-merge.js';
import { repairPersistedCrossLeafKnownPollution } from './session-context-persisted-repair.js';
import { createSessionContextPublisher, type SessionContextPublisher } from './session-context-publish.js';

export type SessionContextCoordinatorDeps = {
  now: () => number;
  nowIso: () => string;
  getStore: (sessionId: string) => Promise<
    Pick<
      SessionTranscriptStore,
      | 'readContextState'
      | 'replaceContextState'
      | 'invalidateContextState'
      | 'putAssistantUsageMeasurement'
      | 'readLatestAssistantUsageForActivePath'
      | 'getActiveLeaf'
    >
  >;
  push: (message: HostPush) => void;
  recordFinalizedUsage: (
    sessionId: string,
    measurement: AssistantUsageMeasurement,
  ) => Promise<'inserted' | 'duplicate' | 'unavailable'>;
  log: (level: 'warn' | 'info', message: string) => void;
  getBoundGenerationId?: (sessionId: string) => string | undefined;
  schedule?: (fn: () => void, ms: number) => { clear: () => void };
};

export type SessionContextCoordinator = {
  ingestMeasurement(input: {
    sessionId: string;
    measurement: ContextMeasurement;
    boundGenerationId?: string;
  }): Promise<void>;
  ingestFinalized(input: {
    sessionId: string;
    measurement: AssistantUsageMeasurement;
    boundGenerationId?: string;
  }): Promise<void>;
  noteResponseEvidence(input: { sessionId: string; runId?: string; messageId?: string }): Promise<void>;
  noteRunStarted(input: {
    sessionId: string;
    runId: string;
    runtimeGenerationId?: string;
  }): Promise<void>;
  noteRunTerminal(input: {
    sessionId: string;
    runId: string;
    outcome: 'completed' | 'cancelled' | 'failed' | 'paused';
  }): Promise<void>;
  noteCompactionStart(sessionId: string): Promise<void>;
  noteCompactionEnd(
    sessionId: string,
    result: { ok: boolean; tokensAfter?: number; tokensBefore?: number },
  ): Promise<void>;
  invalidate(
    sessionId: string,
    input: { reason: string; empty?: boolean; contextBoundary?: ContextBoundary },
  ): Promise<SessionContextSnapshot>;
  revalidateAfterActivation(
    sessionId: string,
    input: { runtimeGenerationId: string; contextBoundary: ContextBoundary },
  ): Promise<void>;
  getSnapshot(sessionId: string): Promise<SessionContextSnapshot>;
  projectLegacyUsage(snapshot: SessionContextSnapshot): ContextUsageSnapshot | undefined;
  disposeSession(sessionId: string): void;
  dispose(): void;
  flush(sessionId?: string): Promise<void>;
};

type SessionEntry = {
  snapshot: SessionContextSnapshot;
  lastSampleSequence: number;
  barrierEpoch: number;
  compacting: boolean;
  publisher: SessionContextPublisher;
};

export function projectSnapshotToLegacyUsage(
  snapshot: SessionContextSnapshot,
): ContextUsageSnapshot | undefined {
  if (snapshot.occupancy.kind !== 'known') {
    return undefined;
  }
  const occupancy = snapshot.occupancy;
  const usage: ContextUsageSnapshot = {
    sessionId: snapshot.sessionId,
    tokensUsed: occupancy.tokensUsed,
    totalTokens: occupancy.tokensUsed,
    updatedAt: snapshot.updatedAt,
    source: occupancy.quality === 'measured' ? 'pi-contextUsage' : 'host-estimate',
  };
  if (occupancy.tokensLimit !== undefined) {
    usage.tokensLimit = occupancy.tokensLimit;
    usage.contextRatio = occupancy.tokensUsed / occupancy.tokensLimit;
  }
  return usage;
}

function defaultSchedule(fn: () => void, ms: number): { clear: () => void } {
  const handle = setTimeout(fn, ms);
  return {
    clear: () => {
      clearTimeout(handle);
    },
  };
}

function belongsToGeneration(
  measurementGenerationId: string | undefined,
  boundGenerationId: string | undefined,
): boolean {
  if (measurementGenerationId === undefined || boundGenerationId === undefined) {
    return true;
  }
  return measurementGenerationId === boundGenerationId;
}

export function createSessionContextCoordinator(
  deps: SessionContextCoordinatorDeps,
): SessionContextCoordinator {
  const sessions = new Map<string, SessionEntry>();
  const schedule = deps.schedule ?? defaultSchedule;

  function createPublisher(sessionId: string): SessionContextPublisher {
    return createSessionContextPublisher({
      now: deps.now,
      persist: async (snapshot, expected) => {
        const store = await deps.getStore(sessionId);
        return store.replaceContextState({
          expectedContextVersion: expected.contextVersion,
          expectedBoundary: expected.boundary,
          snapshot,
        });
      },
      push: (snapshot) => {
        deps.push({ type: 'session/context-updated', sessionId, snapshot });
      },
      logUnavailable: (id) => {
        deps.log('warn', `session context store unavailable for ${id}`);
      },
      schedule,
      onCasMismatch: async () => {
        const current = sessions.get(sessionId);
        if (current === undefined) {
          return;
        }
        try {
          const store = await deps.getStore(sessionId);
          const fresh = await store.readContextState();
          if (fresh !== null) {
            current.snapshot = fresh;
            current.publisher.notePersisted(fresh);
          }
        } catch (error) {
          deps.log(
            'warn',
            `session context cas-mismatch reread failed: ${error instanceof Error ? error.message : 'error'}`,
          );
        }
      },
    });
  }

  async function hydrate(sessionId: string): Promise<SessionEntry> {
    const existing = sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const store = await deps.getStore(sessionId);
    const persisted =
      (await store.readContextState()) ??
      (await readOrInsertUnknownContextState(store, {
        sessionId,
        reason: 'never-sampled',
        updatedAt: deps.nowIso(),
      }));
    const publisher = createPublisher(sessionId);
    publisher.notePersisted(persisted);
    const entry: SessionEntry = {
      snapshot: persisted,
      lastSampleSequence: 0,
      barrierEpoch: 0,
      compacting: persisted.phase === 'compacting',
      publisher,
    };
    sessions.set(sessionId, entry);
    await repairPersistedOccupancy(entry);
    await settlePersistedOccupancy(entry);
    return entry;
  }

  async function repairPersistedOccupancy(entry: SessionEntry): Promise<void> {
    const repaired = repairPersistedCrossLeafKnownPollution(entry.snapshot);
    if (repaired === entry.snapshot) {
      return;
    }
    await commit(entry, { ...repaired, updatedAt: deps.nowIso() }, true);
  }

  async function settlePersistedOccupancy(entry: SessionEntry): Promise<void> {
    if (!canPromoteLastConfirmed(entry.snapshot)) {
      return;
    }
    await commit(entry, { ...promoteLastConfirmed(entry.snapshot), updatedAt: deps.nowIso() }, true);
  }

  async function commit(
    entry: SessionEntry,
    snapshot: SessionContextSnapshot,
    immediate: boolean,
  ): Promise<SessionContextSnapshot> {
    try {
      const outcome = await entry.publisher.publish(snapshot, immediate);
      if (outcome.status === 'cas-mismatch') {
        return entry.snapshot;
      }
      entry.snapshot = outcome.snapshot;
      return outcome.snapshot;
    } catch (error) {
      deps.log('warn', `session context publish failed: ${error instanceof Error ? error.message : 'error'}`);
      return entry.snapshot;
    }
  }

  function bumpBarrier(entry: SessionEntry): void {
    entry.barrierEpoch += 1;
  }

  return {
    async ingestMeasurement(input) {
      const boundGenerationId = input.boundGenerationId ?? deps.getBoundGenerationId?.(input.sessionId);
      if (!belongsToGeneration(input.measurement.runtimeGenerationId, boundGenerationId)) {
        return;
      }
      const entry = await hydrate(input.sessionId);
      const token = entry.barrierEpoch;
      if (input.measurement.sampleSequence <= entry.lastSampleSequence) {
        return;
      }
      const applied = applyMeasurement(entry.snapshot, input.measurement, {
        nowIso: deps.nowIso(),
        ...(boundGenerationId !== undefined ? { boundGenerationId } : {}),
      });
      if (token !== entry.barrierEpoch || applied.drop) {
        return;
      }
      entry.lastSampleSequence = input.measurement.sampleSequence;
      await commit(entry, applied.snapshot, false);
    },

    async ingestFinalized(input) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      if (input.measurement.sessionId !== input.sessionId) {
        return;
      }
      const boundGenerationId = input.boundGenerationId ?? deps.getBoundGenerationId?.(input.sessionId);
      if (!belongsToGeneration(input.measurement.runtimeGenerationId, boundGenerationId)) {
        return;
      }
      const store = await deps.getStore(input.sessionId);
      try {
        await store.putAssistantUsageMeasurement(input.measurement);
      } catch (error) {
        deps.log(
          'warn',
          `assistant usage index write failed: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
      let billed: 'inserted' | 'duplicate' | 'unavailable' = 'unavailable';
      try {
        billed = await deps.recordFinalizedUsage(input.sessionId, input.measurement);
      } catch (error) {
        deps.log(
          'warn',
          `usage ledger write failed: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
      if (billed === 'inserted') {
        const usage: ContextUsageSnapshot = {
          sessionId: input.sessionId,
          totalTokens: input.measurement.totalTokens,
          updatedAt: input.measurement.recordedAt,
          source: 'assistant-usage',
        };
        if (input.measurement.modelId !== undefined) usage.modelId = input.measurement.modelId;
        if (input.measurement.promptTokens !== undefined) {
          usage.promptTokens = input.measurement.promptTokens;
        }
        if (input.measurement.completionTokens !== undefined) {
          usage.completionTokens = input.measurement.completionTokens;
        }
        if (input.measurement.cacheReadTokens !== undefined) {
          usage.cacheReadTokens = input.measurement.cacheReadTokens;
        }
        if (input.measurement.cacheWriteTokens !== undefined) {
          usage.cacheWriteTokens = input.measurement.cacheWriteTokens;
        }
        if (input.measurement.durationMs !== undefined) usage.durationMs = input.measurement.durationMs;
        deps.push({
          type: 'event',
          sessionId: input.sessionId,
          event: { type: 'usage/update', sessionId: input.sessionId, usage },
        });
      }
      const entry = await hydrate(input.sessionId);
      await commit(entry, { ...entry.snapshot, updatedAt: deps.nowIso() }, true);
    },

    async noteResponseEvidence(input) {
      const entry = await hydrate(input.sessionId);
      if (entry.snapshot.responseEvidence.currentRunHasResponse) {
        return;
      }
      const applied = applyResponseEvidence(entry.snapshot, {
        nowIso: deps.nowIso(),
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
      });
      await commit(entry, applied.snapshot, applied.immediate);
    },

    async noteRunStarted(input) {
      const entry = await hydrate(input.sessionId);
      if (
        input.runtimeGenerationId !== undefined &&
        entry.snapshot.runtimeGenerationId !== input.runtimeGenerationId
      ) {
        entry.lastSampleSequence = 0;
      }
      const snapshot = applyRunStarted(entry.snapshot, {
        nowIso: deps.nowIso(),
        runId: input.runId,
        ...(input.runtimeGenerationId !== undefined
          ? { runtimeGenerationId: input.runtimeGenerationId }
          : {}),
      });
      await commit(entry, snapshot, false);
    },

    async noteRunTerminal(input) {
      if (input.outcome === 'paused') {
        return;
      }
      const entry = await hydrate(input.sessionId);
      const snapshot = applyRunTerminal(entry.snapshot, {
        nowIso: deps.nowIso(),
        runId: input.runId,
      });
      await commit(entry, snapshot, true);
    },

    async noteCompactionStart(sessionId) {
      const entry = await hydrate(sessionId);
      entry.compacting = true;
      await commit(entry, applyCompactionStart(entry.snapshot, deps.nowIso()), true);
    },

    async noteCompactionEnd(sessionId, result) {
      const entry = await hydrate(sessionId);
      if (!entry.compacting && entry.snapshot.phase !== 'compacting') {
        if (
          result.ok &&
          entry.snapshot.occupancy.kind === 'known' &&
          entry.snapshot.occupancy.basis === 'compaction'
        ) {
          return;
        }
        entry.compacting = true;
      }
      if (result.ok) {
        bumpBarrier(entry);
      }
      entry.compacting = false;
      await commit(
        entry,
        applyCompactionEnd(entry.snapshot, { nowIso: deps.nowIso(), ...result }),
        true,
      );
    },

    async invalidate(sessionId, input) {
      const entry = await hydrate(sessionId);
      bumpBarrier(entry);
      const store = await deps.getStore(sessionId);
      const leaf =
        input.contextBoundary !== undefined
          ? input.contextBoundary.activeLeafMessageId
          : await store.getActiveLeaf();
      const contextBoundary: ContextBoundary =
        input.contextBoundary ??
        { ...entry.snapshot.contextBoundary, activeLeafMessageId: leaf };
      const nowIso = deps.nowIso();
      try {
        const invalidated = await store.invalidateContextState({
          reason: input.reason,
          contextBoundary,
          updatedAt: nowIso,
        });
        entry.publisher.notePersisted(invalidated);
        entry.snapshot = invalidated;
      } catch (error) {
        deps.log(
          'warn',
          `session context invalidate failed: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
      const snapshot = applyInvalidate(entry.snapshot, {
        nowIso,
        reason: input.reason,
        ...(input.empty !== undefined ? { empty: input.empty } : {}),
        contextBoundary,
      });
      return commit(entry, snapshot, true);
    },

    async revalidateAfterActivation(sessionId, input) {
      const entry = await hydrate(sessionId);
      if (entry.snapshot.runtimeGenerationId !== input.runtimeGenerationId) {
        entry.lastSampleSequence = 0;
      }
      const matched =
        entry.snapshot.contextBoundary.activeLeafMessageId === input.contextBoundary.activeLeafMessageId &&
        (entry.snapshot.contextBoundary.compactionBoundary ?? '') ===
          (input.contextBoundary.compactionBoundary ?? '');
      if (!matched) {
        bumpBarrier(entry);
      }
      const snapshot = applyActivationRevalidate(entry.snapshot, {
        nowIso: deps.nowIso(),
        runtimeGenerationId: input.runtimeGenerationId,
        contextBoundary: input.contextBoundary,
      });
      await commit(entry, snapshot, true);
    },

    async getSnapshot(sessionId) {
      const entry = await hydrate(sessionId);
      await settlePersistedOccupancy(entry);
      const flushed = await entry.publisher.flush();
      if (flushed !== undefined && flushed.status !== 'cas-mismatch') {
        entry.snapshot = flushed.snapshot;
      }
      return entry.snapshot;
    },

    projectLegacyUsage: projectSnapshotToLegacyUsage,

    disposeSession(sessionId) {
      const entry = sessions.get(sessionId);
      if (entry === undefined) {
        return;
      }
      entry.publisher.dispose();
      sessions.delete(sessionId);
    },

    dispose() {
      for (const sessionId of [...sessions.keys()]) {
        const entry = sessions.get(sessionId);
        entry?.publisher.dispose();
        sessions.delete(sessionId);
      }
    },

    async flush(sessionId) {
      if (sessionId !== undefined) {
        const entry = sessions.get(sessionId);
        if (entry === undefined) {
          return;
        }
        const flushed = await entry.publisher.flush();
        if (flushed !== undefined && flushed.status !== 'cas-mismatch') {
          entry.snapshot = flushed.snapshot;
        }
        return;
      }
      await Promise.all(
        [...sessions.values()].map(async (entry) => {
          const flushed = await entry.publisher.flush();
          if (flushed !== undefined && flushed.status !== 'cas-mismatch') {
            entry.snapshot = flushed.snapshot;
          }
        }),
      );
    },
  };
}
