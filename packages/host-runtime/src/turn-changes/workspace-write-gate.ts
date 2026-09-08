/**
 * In-process workspace write gate: fair FIFO S/X plus optional per-file X.
 *
 * Shared file writes take workspace S + file X. Uncontained shell, Git,
 * integration, and undo take workspace X. Undo uses wait:false.
 */
import {
  normalizeWorkspaceRoot,
  workspaceRootsOverlap,
} from './workspace-root.js';

export type WorkspaceWriteLease = {
  workspaceId: string;
  release(): void;
};

export type WorkspaceWriteAcquireInput = {
  workspaceId: string;
  rootPath: string;
  kind: 'tool' | 'git' | 'integration' | 'undo';
  mode: 'shared' | 'exclusive';
  wait: boolean;
  paths?: readonly string[];
  runId?: string;
  signal?: AbortSignal;
};

export type WorkspaceWriteAcquireResult =
  | { ok: true; lease: WorkspaceWriteLease }
  | { ok: false; reason: 'workspace-busy' | 'aborted' };

export type WorkspaceWriteGate = {
  tryAcquire(input: WorkspaceWriteAcquireInput): Promise<WorkspaceWriteAcquireResult>;
};

type RequestState = 'queued' | 'acquired' | 'released' | 'cancelled';

type GateRequest = {
  id: number;
  workspaceId: string;
  root: string;
  mode: 'shared' | 'exclusive';
  fileKeys: readonly string[];
  state: RequestState;
  released: boolean;
  resolve: (result: WorkspaceWriteAcquireResult) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
};

export { normalizeWorkspaceRoot, workspaceRootsOverlap };

export function createWorkspaceWriteGate(): WorkspaceWriteGate {
  const held: GateRequest[] = [];
  const queued: GateRequest[] = [];
  let nextId = 1;

  function conflicts(left: GateRequest, right: GateRequest): boolean {
    const filesOverlap = left.fileKeys.some((key) => right.fileKeys.includes(key));
    if (!workspaceRootsOverlap(left.root, right.root)) {
      return filesOverlap;
    }
    if (left.mode === 'exclusive' || right.mode === 'exclusive') {
      return true;
    }
    return filesOverlap;
  }

  function conflictsWith(target: GateRequest, others: readonly GateRequest[]): boolean {
    return others.some((other) => other.id !== target.id && conflicts(other, target));
  }

  function detachAbort(request: GateRequest): void {
    if (request.signal && request.abortListener) {
      request.signal.removeEventListener('abort', request.abortListener);
    }
    delete request.abortListener;
  }

  function removeQueued(request: GateRequest): void {
    const index = queued.indexOf(request);
    if (index >= 0) {
      queued.splice(index, 1);
    }
  }

  function makeLease(request: GateRequest): WorkspaceWriteLease {
    return {
      workspaceId: request.workspaceId,
      release(): void {
        if (request.released) {
          return;
        }
        request.released = true;
        if (request.state === 'acquired') {
          request.state = 'released';
          const heldIndex = held.indexOf(request);
          if (heldIndex >= 0) {
            held.splice(heldIndex, 1);
          }
          tryGrant();
        }
      },
    };
  }

  function grant(request: GateRequest): void {
    detachAbort(request);
    removeQueued(request);
    request.state = 'acquired';
    held.push(request);
    request.resolve({ ok: true, lease: makeLease(request) });
  }

  function tryGrant(): void {
    const snapshot = queued.filter((request) => request.state === 'queued');
    for (const request of snapshot) {
      if (request.state !== 'queued') {
        continue;
      }
      if (request.signal?.aborted) {
        cancelQueued(request);
        continue;
      }
      const earlierQueued = queued.filter(
        (candidate) => candidate.state === 'queued' && candidate.id < request.id,
      );
      if (conflictsWith(request, held) || conflictsWith(request, earlierQueued)) {
        continue;
      }
      grant(request);
    }
  }

  function cancelQueued(request: GateRequest): void {
    if (request.state !== 'queued') {
      return;
    }
    request.state = 'cancelled';
    detachAbort(request);
    removeQueued(request);
    request.resolve({ ok: false, reason: 'aborted' });
  }

  function enqueue(request: GateRequest, signal: AbortSignal | undefined): void {
    queued.push(request);
    if (signal) {
      const abortListener = (): void => {
        cancelQueued(request);
        tryGrant();
      };
      request.abortListener = abortListener;
      signal.addEventListener('abort', abortListener, { once: true });
    }
    tryGrant();
  }

  return {
    tryAcquire(input) {
      if (input.mode === 'shared' && (input.paths === undefined || input.paths.length === 0)) {
        throw new Error('shared acquire requires paths');
      }
      const root = normalizeWorkspaceRoot(input.rootPath);
      const fileKeys =
        input.mode === 'shared' && input.paths
          ? [...input.paths].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
          : [];
      const request: GateRequest = {
        id: nextId,
        workspaceId: input.workspaceId,
        root,
        mode: input.mode,
        fileKeys,
        state: 'queued',
        released: false,
        resolve: () => undefined,
        ...(input.signal ? { signal: input.signal } : {}),
      };
      nextId += 1;

      if (input.signal?.aborted) {
        return Promise.resolve({ ok: false, reason: 'aborted' as const });
      }

      if (!input.wait) {
        const blocking = [...held, ...queued.filter((entry) => entry.state === 'queued')];
        if (conflictsWith(request, blocking)) {
          return Promise.resolve({ ok: false, reason: 'workspace-busy' as const });
        }
        request.state = 'acquired';
        held.push(request);
        return Promise.resolve({ ok: true as const, lease: makeLease(request) });
      }

      return new Promise<WorkspaceWriteAcquireResult>((resolve) => {
        request.resolve = resolve;
        enqueue(request, input.signal);
      });
    },
  };
}
