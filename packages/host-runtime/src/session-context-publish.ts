import type { ContextBoundary, SessionContextSnapshot } from '@piwin/contracts';
import { snapshotDisplayEqual } from './session-context-merge.js';

export const CONTEXT_PUBLISH_INTERVAL_MS = 250;

export type PersistSnapshotResult =
  | { ok: true; snapshot: SessionContextSnapshot }
  | { ok: false; reason: 'cas-mismatch' | 'unavailable' };

export type SessionContextPublishDeps = {
  now: () => number;
  persist: (
    snapshot: SessionContextSnapshot,
    expected: { contextVersion: number; boundary: ContextBoundary },
  ) => Promise<PersistSnapshotResult>;
  push: (snapshot: SessionContextSnapshot) => void;
  logUnavailable: (sessionId: string) => void;
  schedule: (fn: () => void, ms: number) => { clear: () => void };
};

export type SessionContextPublisher = {
  notePersisted(snapshot: SessionContextSnapshot): void;
  publish(
    snapshot: SessionContextSnapshot,
    immediate: boolean,
  ): Promise<SessionContextSnapshot | undefined>;
  flush(): Promise<SessionContextSnapshot | undefined>;
  dispose(): void;
};

export function createSessionContextPublisher(
  deps: SessionContextPublishDeps,
): SessionContextPublisher {
  let lastPublishAt = 0;
  let lastPushed: SessionContextSnapshot | undefined;
  let pending: SessionContextSnapshot | undefined;
  let expected: { contextVersion: number; boundary: ContextBoundary } | undefined;
  let timer: { clear: () => void } | undefined;
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;

  function rememberExpected(snapshot: SessionContextSnapshot): void {
    expected = { contextVersion: snapshot.contextVersion, boundary: snapshot.contextBoundary };
  }

  async function persistAndPush(
    snapshot: SessionContextSnapshot,
  ): Promise<SessionContextSnapshot | undefined> {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    if (disposed) {
      return undefined;
    }
    if (lastPushed !== undefined && snapshotDisplayEqual(lastPushed, snapshot)) {
      return lastPushed;
    }
    const cas = expected ?? {
      contextVersion: snapshot.contextVersion,
      boundary: snapshot.contextBoundary,
    };
    const result = await deps.persist(snapshot, cas);
    if (!result.ok) {
      if (result.reason === 'unavailable') {
        const unavailable: SessionContextSnapshot = {
          ...snapshot,
          phase: 'unavailable',
          occupancy: { kind: 'unknown', reason: 'store-unavailable' },
        };
        deps.logUnavailable(snapshot.sessionId);
        deps.push(unavailable);
        lastPushed = unavailable;
        lastPublishAt = deps.now();
        return unavailable;
      }
      return undefined;
    }
    rememberExpected(result.snapshot);
    deps.push(result.snapshot);
    lastPushed = result.snapshot;
    lastPublishAt = deps.now();
    return result.snapshot;
  }

  function enqueue(
    snapshot: SessionContextSnapshot,
  ): Promise<SessionContextSnapshot | undefined> {
    const next = chain.then(() => persistAndPush(snapshot));
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    notePersisted(snapshot) {
      rememberExpected(snapshot);
    },
    publish(snapshot, immediate) {
      if (disposed) {
        return Promise.resolve(snapshot);
      }
      if (immediate) {
        timer?.clear();
        timer = undefined;
        pending = undefined;
        return enqueue(snapshot);
      }
      if (lastPushed !== undefined && snapshotDisplayEqual(lastPushed, snapshot) && pending === undefined) {
        return Promise.resolve(lastPushed);
      }
      const elapsed = lastPublishAt === 0 ? CONTEXT_PUBLISH_INTERVAL_MS : deps.now() - lastPublishAt;
      if (elapsed >= CONTEXT_PUBLISH_INTERVAL_MS) {
        timer?.clear();
        timer = undefined;
        pending = undefined;
        return enqueue(snapshot);
      }
      pending = snapshot;
      if (timer === undefined) {
        timer = deps.schedule(() => {
          timer = undefined;
          const queued = pending;
          pending = undefined;
          if (queued !== undefined) {
            void enqueue(queued);
          }
        }, CONTEXT_PUBLISH_INTERVAL_MS - elapsed);
      }
      return Promise.resolve(snapshot);
    },
    async flush() {
      timer?.clear();
      timer = undefined;
      const queued = pending;
      pending = undefined;
      if (queued !== undefined) {
        return enqueue(queued);
      }
      await chain;
      return lastPushed;
    },
    dispose() {
      disposed = true;
      timer?.clear();
      timer = undefined;
      pending = undefined;
    },
  };
}
