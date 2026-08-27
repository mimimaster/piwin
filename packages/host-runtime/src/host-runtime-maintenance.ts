/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { archiveSessionRecord, archiveSessionRecordIfUnchanged } from '@piwin/session';
import type { SessionIndexRecord } from '@piwin/contracts';
import { permanentlyDeleteSession } from './session-delete-service.js';
import {
  hasForeignLiveSessionRuntime,
  releaseSessionRuntimeLease,
  touchSessionRuntimeLease,
  tryWithSessionOperationLock,
  withSessionOperationLock,
} from './session-runtime-lease.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { ok } from './response-helpers.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function abortLiveSession(deps: HostRuntimeKernel, sessionId: string): Promise<void> {
  deps.settlePendingExtensionUiForSession(sessionId);
  const live = deps.sessions.get(sessionId);
  if (!live) {
    return;
  }
  try {
    await live.abort();
  } catch {
    // best-effort
  }
  // Stop any Jobs associated with this session (ADR 0030 lifecycle).
  await deps.stopProcessesForSession(sessionId);
}

export async function archiveSessionForMaintenance(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  return deps.withSessionMaintenance(sessionId, async () => {
    await deps.waitForSessionActivation(sessionId);
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    return withSessionOperationLock({
      rootDir,
      sessionId,
      operation: async () => {
        if (await deps.hasForeignRuntimeLease(sessionId)) {
          throw new Error(`Session is active in another Host: ${sessionId}`);
        }
        return deps.transcriptStores.withMaintenanceLease(sessionId, async () => {
          await deps.disposeLiveSession(sessionId, 'manual');
          return archiveSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
        });
      },
    });
  });
}

export async function tryArchiveLifecycleCandidate(
  deps: HostRuntimeKernel,
  input: {
    sessionId: string;
    expectedUpdatedAt: string;
  },
): Promise<
  | { status: 'archived'; record: SessionIndexRecord }
  | { status: 'busy' | 'missing' | 'already-archived' | 'changed' | 'protected' }
> {
  if (deps.isSessionLifecycleHardBusy(input.sessionId)) {
    return { status: 'busy' };
  }
  if (deps.sessionMaintenanceSessions.has(input.sessionId)) {
    return { status: 'busy' };
  }
  deps.sessionMaintenanceSessions.add(input.sessionId);
  try {
    if (deps.isSessionLifecycleHardBusy(input.sessionId)) {
      return { status: 'busy' };
    }
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const operationResult = await tryWithSessionOperationLock({
      rootDir,
      sessionId: input.sessionId,
      operation: async () => {
        if (await deps.hasForeignRuntimeLease(input.sessionId)) {
          return { status: 'busy' } as const;
        }
        // Resident-idle sessions are eligible: suspend first so archive never
        // races a live handle. Busy/protected work stays skipped.
        const idleSuspend = await deps.suspendIdleSessionForLifecycleArchive(input.sessionId);
        if (!idleSuspend.ok) {
          return { status: idleSuspend.status } as const;
        }
        if (deps.isSessionLifecycleHardBusy(input.sessionId)) {
          return { status: 'busy' } as const;
        }
        const leaseResult = await deps.transcriptStores.tryWithMaintenanceLease(
          input.sessionId,
          async () => {
            if (deps.isSessionLifecycleHardBusy(input.sessionId)) {
              return { status: 'busy' } as const;
            }
            return archiveSessionRecordIfUnchanged(getPiwinSessionIndexPath(rootDir), input);
          },
        );
        return leaseResult.acquired ? leaseResult.value : { status: 'busy' as const };
      },
    });
    return operationResult.acquired ? operationResult.value : { status: 'busy' };
  } finally {
    deps.sessionMaintenanceSessions.delete(input.sessionId);
  }
}

export async function deleteSessionForMaintenance(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<{ removed: SessionIndexRecord; cleanupWarning?: string } | undefined> {
  return deps.withSessionMaintenance(sessionId, async () => {
    await deps.waitForSessionActivation(sessionId);
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    return withSessionOperationLock({
      rootDir,
      sessionId,
      operation: async () => {
        if (await deps.hasForeignRuntimeLease(sessionId)) {
          throw new Error(`Session is active in another Host: ${sessionId}`);
        }
        return deps.transcriptStores.withMaintenanceLease(sessionId, async () => {
          await deps.disposeLiveSession(sessionId, 'manual');
          return permanentlyDeleteSession({
            rootDir,
            indexPath: getPiwinSessionIndexPath(rootDir),
            sessionId,
          });
        });
      },
    });
  });
}

export async function withSessionMaintenance<T>(
  deps: HostRuntimeKernel,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (deps.sessionMaintenanceSessions.has(sessionId)) {
    throw new Error(`Session is already under lifecycle maintenance: ${sessionId}`);
  }
  deps.sessionMaintenanceSessions.add(sessionId);
  try {
    return await operation();
  } finally {
    deps.sessionMaintenanceSessions.delete(sessionId);
  }
}

export async function waitForSessionActivation(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  const activation = deps.sessionActivationPromises.get(sessionId);
  if (activation) {
    await activation.catch(() => undefined);
  }
}

/**
 * Work that must never be archived mid-flight. Resident-idle is intentionally
 * excluded so lifecycle apply can suspend then archive cold/idle sessions.
 */
export function isSessionLifecycleHardBusy(deps: HostRuntimeKernel, sessionId: string): boolean {
  if (
    deps.sessionActivationPromises.has(sessionId) ||
    deps.sessionSuspensionPromises.has(sessionId) ||
    deps.isSessionRuntimeProtected(sessionId)
  ) {
    return true;
  }
  const residency = deps.residencyController.getResidency(sessionId);
  return residency === 'resident-busy' || residency === 'activating' || residency === 'suspending';
}

/**
 * Best-effort idle suspend before durable archive. Cold sessions pass through.
 * Busy/protected sessions return busy without mutating residency.
 */
export async function suspendIdleSessionForLifecycleArchive(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; status: 'busy' }> {
  if (!deps.sessions.has(sessionId)) {
    return { ok: true };
  }
  if (deps.isSessionLifecycleHardBusy(sessionId)) {
    return { ok: false, status: 'busy' };
  }
  const residency = deps.residencyController.getResidency(sessionId);
  if (residency !== 'resident-idle' && residency !== 'cold') {
    return { ok: false, status: 'busy' };
  }
  const generationId = deps.runtimeController.getStatus(sessionId).generationId;
  if (generationId === undefined) {
    // Inconsistent resident maps without a generation: refuse to archive.
    return { ok: false, status: 'busy' };
  }
  const suspended = await deps.suspendSessionRuntime(sessionId, generationId, 'manual');
  return suspended ? { ok: true } : { ok: false, status: 'busy' };
}

export function hasForeignRuntimeLease(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<boolean> {
  return hasForeignLiveSessionRuntime({
    rootDir: getPiwinRoot(deps.options.piwinRoot),
    sessionId,
    ownerId: deps.runtimeLeaseOwnerId,
  });
}

export function releaseRuntimeLease(deps: HostRuntimeKernel, sessionId: string): Promise<void> {
  deps.runtimeLeaseStartedAt.delete(sessionId);
  return releaseSessionRuntimeLease({
    rootDir: getPiwinRoot(deps.options.piwinRoot),
    sessionId,
    ownerId: deps.runtimeLeaseOwnerId,
  });
}

export async function heartbeatRuntimeLease(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  const startedAt = deps.runtimeLeaseStartedAt.get(sessionId);
  if (startedAt === undefined) {
    return;
  }
  await touchSessionRuntimeLease({
    rootDir: getPiwinRoot(deps.options.piwinRoot),
    sessionId,
    owner: {
      ownerId: deps.runtimeLeaseOwnerId,
      pid: process.pid,
      startedAt,
    },
  });
}
