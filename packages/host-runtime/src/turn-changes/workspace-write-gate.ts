/**
 * In-process workspace write gate: fair FIFO S/X plus optional per-file X.
 *
 * Shared file writes take workspace S + file X. Ordinary shell commands take
 * workspace S with no file keys: they run beside file writes and each other,
 * and only wait for X. Git mutations, listed repo-wide shell commands,
 * integration take workspace X. Undo / redo take workspace S plus file X on
 * the turn's files, with a short bounded wait (ADR 0069 revision).
 *
 * Every granted lease is also recorded in the activity log, so optimistic
 * shells and file writes can detect what other sessions did meanwhile.
 *
 * Bounded reader preference: a shared request may pass a *queued* exclusive
 * request for its first `sharedBypassMs`. Strict FIFO let one `git checkout`
 * queued behind a long test stall every other session's shell until the
 * test ended — the very convoy optimistic shell was meant to remove. After
 * the window new shared requests queue behind it, so exclusive waits are
 * bounded by the window plus the shells already admitted.
 */
import {
  createWorkspaceActivityLog,
  type WorkspaceActivityHandle,
  type WorkspaceActivityLog,
} from './workspace-activity-log.js';
import { createSessionFileLedger, type SessionFileLedger } from './session-file-ledger.js';
import { findRepairBlockForWorkspace, type RepairGuardPort } from './repair-guard.js';
import {
  normalizeWorkspaceRoot,
  workspaceRootsOverlap,
} from './workspace-root.js';

export type WorkspaceWriteLease = {
  workspaceId: string;
  /** Normalized root the lease covers; the key for activity queries. */
  root: string;
  /** Activity-log tick at grant; the start of this holder's window. */
  grantedAtTick: number;
  release(): void;
};

export type WorkspaceWriteAcquireInput = {
  workspaceId: string;
  rootPath: string;
  kind: 'tool' | 'shell' | 'git' | 'integration' | 'undo';
  mode: 'shared' | 'exclusive';
  wait: boolean;
  /** Required for shared file writes; a shared shell holds no file keys. */
  paths?: readonly string[];
  runId?: string;
  /** Session (or other actor) identity for activity attribution. */
  ownerId?: string;
  signal?: AbortSignal;
};

export type WorkspaceWriteAcquireResult =
  | { ok: true; lease: WorkspaceWriteLease }
  | { ok: false; reason: 'workspace-busy' | 'aborted' }
  /** A repo-wide operation over a workspace with an undo/redo awaiting repair. */
  | { ok: false; reason: 'needs-repair'; operationId: string };

export type WorkspaceWriteGate = {
  tryAcquire(input: WorkspaceWriteAcquireInput): Promise<WorkspaceWriteAcquireResult>;
  readonly activity: WorkspaceActivityLog;
  /** Per-session last-write hashes for write-after-write drift checks. */
  readonly fileLedger: SessionFileLedger;
  /**
   * Undo/redo stuck at needs-repair (durable). File tools and exclusive
   * operations consult it before writing; see repair-guard.ts.
   */
  readonly repairGuard?: RepairGuardPort;
};

type RequestState = 'queued' | 'acquired' | 'released' | 'cancelled';

type GateRequest = {
  id: number;
  workspaceId: string;
  root: string;
  mode: 'shared' | 'exclusive';
  kind: WorkspaceWriteAcquireInput['kind'];
  ownerId: string | undefined;
  fileKeys: readonly string[];
  queuedAt: number;
  state: RequestState;
  activity?: WorkspaceActivityHandle;
  released: boolean;
  resolve: (result: WorkspaceWriteAcquireResult) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
};

export { normalizeWorkspaceRoot, workspaceRootsOverlap };

/** How long shared requests may pass a queued exclusive request. */
export const DEFAULT_SHARED_BYPASS_MS = 20_000;

export function createWorkspaceWriteGate(
  options: {
    activity?: WorkspaceActivityLog;
    fileLedger?: SessionFileLedger;
    sharedBypassMs?: number;
    now?: () => number;
    repairGuard?: RepairGuardPort;
  } = {},
): WorkspaceWriteGate {
  const now = options.now ?? Date.now;
  const sharedBypassMs = Math.max(0, options.sharedBypassMs ?? DEFAULT_SHARED_BYPASS_MS);
  const activity = options.activity ?? createWorkspaceActivityLog();
  const fileLedger = options.fileLedger ?? createSessionFileLedger();
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

  /** Queued requests ahead of `target` that it must not pass. */
  function blockingQueued(target: GateRequest, candidates: readonly GateRequest[]): GateRequest[] {
    if (target.mode !== 'shared') {
      return [...candidates];
    }
    const cutoff = now() - sharedBypassMs;
    return candidates.filter(
      (candidate) => candidate.mode !== 'exclusive' || candidate.queuedAt <= cutoff,
    );
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

  function recordActivity(request: GateRequest): WorkspaceActivityHandle {
    const handle = activity.begin({
      root: request.root,
      kind:
        request.mode === 'exclusive'
          ? 'exclusive'
          : request.kind === 'shell'
            ? 'shell'
            : 'file-write',
      fileKeys: request.fileKeys,
      ...(request.ownerId !== undefined ? { ownerId: request.ownerId } : {}),
    });
    request.activity = handle;
    return handle;
  }

  function makeLease(request: GateRequest): WorkspaceWriteLease {
    const handle = request.activity ?? recordActivity(request);
    return {
      workspaceId: request.workspaceId,
      root: request.root,
      grantedAtTick: handle.startTick,
      release(): void {
        if (request.released) {
          return;
        }
        request.released = true;
        if (request.state === 'acquired') {
          request.state = 'released';
          request.activity?.end();
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
    recordActivity(request);
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
      const earlierQueued = blockingQueued(
        request,
        queued.filter((candidate) => candidate.state === 'queued' && candidate.id < request.id),
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
    activity,
    fileLedger,
    ...(options.repairGuard ? { repairGuard: options.repairGuard } : {}),
    tryAcquire(input) {
      if (
        input.mode === 'shared' &&
        input.kind !== 'shell' &&
        (input.paths === undefined || input.paths.length === 0)
      ) {
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
        kind: input.kind,
        ownerId: input.ownerId,
        fileKeys,
        queuedAt: now(),
        state: 'queued',
        released: false,
        resolve: () => undefined,
        ...(input.signal ? { signal: input.signal } : {}),
      };
      nextId += 1;

      if (input.signal?.aborted) {
        return Promise.resolve({ ok: false, reason: 'aborted' as const });
      }

      // Checkout / integration over a half-applied undo would mix its files
      // with the repair's; shells and single-file writes are judged elsewhere.
      if (input.mode === 'exclusive' && (input.kind === 'git' || input.kind === 'integration')) {
        const block = findRepairBlockForWorkspace(options.repairGuard, input.rootPath);
        if (block) {
          return Promise.resolve({
            ok: false as const,
            reason: 'needs-repair' as const,
            operationId: block.operationId,
          });
        }
      }

      if (!input.wait) {
        const blocking = [
          ...held,
          ...blockingQueued(
            request,
            queued.filter((entry) => entry.state === 'queued'),
          ),
        ];
        if (conflictsWith(request, blocking)) {
          return Promise.resolve({ ok: false, reason: 'workspace-busy' as const });
        }
        request.state = 'acquired';
        held.push(request);
        recordActivity(request);
        return Promise.resolve({ ok: true as const, lease: makeLease(request) });
      }

      return new Promise<WorkspaceWriteAcquireResult>((resolve) => {
        request.resolve = resolve;
        enqueue(request, input.signal);
      });
    },
  };
}
