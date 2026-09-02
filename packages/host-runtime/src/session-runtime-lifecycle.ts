/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { join } from 'node:path';
import type { CreateSessionOptions, SessionHandle } from '@piwin/contracts';
import { formatCompactionBoundary, formatError } from '@piwin/contracts';

import { getSessionRecord } from '@piwin/session';
import { buildColdActivationSeedOptions } from './cold-activation-seed.js';
import { ProductAgentHost, createRuntimeGenerationId } from './product-agent-host.js';
import { hasForeignLiveSessionRuntime, withSessionOperationLock } from './session-runtime-lease.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { ok } from './response-helpers.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

/**
 * ADR 0040 §7: activation is Host-owned and deduplicated by session id.
 * Returns the resident handle, creating a fresh runtime generation for the
 * stable product session id when the session is cold. A second concurrent
 * activation for the same session shares the in-flight transition.
 */
export function activateSessionRuntime(
  deps: HostRuntimeKernel,
  sessionId: string,
  runId?: string,
  signal?: AbortSignal,
  excludeSeedMessageId?: string,
): Promise<SessionHandle> {
  if (deps.sessionMaintenanceSessions.has(sessionId)) {
    return Promise.reject(new Error(`Session is under lifecycle maintenance: ${sessionId}`));
  }
  const suspension = deps.sessionSuspensionPromises.get(sessionId);
  if (suspension) {
    return suspension.then(() =>
      deps.activateSessionRuntime(sessionId, runId, signal, excludeSeedMessageId),
    );
  }
  const runtimeStatus = deps.runtimeController.getStatus(sessionId);
  const activeGenerationId = runtimeStatus.generationId;
  const desiredSettingsRevision = runtimeStatus.desiredSettingsRevision;
  if (deps.runtimeReplacementEngine.hasPending(sessionId)) {
    return deps.runtimeReplacementEngine
      .waitFor(sessionId)
      .then(() => deps.activateSessionRuntime(sessionId, runId, signal, excludeSeedMessageId));
  }
  if (
    activeGenerationId !== undefined &&
    desiredSettingsRevision !== undefined &&
    desiredSettingsRevision !== runtimeStatus.settingsRevision
  ) {
    return deps.runtimeReplacementEngine
      .replace({
        sessionId,
        targetSettingsRevision: desiredSettingsRevision,
        expectedActiveGenerationId: activeGenerationId,
        when: 'after-current-run',
      })
      .then(() => deps.activateSessionRuntime(sessionId, runId, signal, excludeSeedMessageId));
  }
  const existing = deps.sessions.get(sessionId);
  if (existing) {
    attachRunToResidentGeneration(deps, sessionId, runId);
    return Promise.resolve(existing);
  }
  const inFlight = deps.sessionActivationPromises.get(sessionId);
  if (inFlight) {
    if (runId !== undefined) {
      void deps.publishWaitingResourceWhileQueued(runId);
    }
    return inFlight
      .then((handle) => {
        attachRunToResidentGeneration(deps, sessionId, runId);
        return handle;
      })
      .catch((error: unknown) => {
        // The first caller owns the activation signal. If that Run is
        // superseded while a cold activation is still in flight, retry once
        // under the newer caller's signal instead of inheriting its abort.
        if (runId !== undefined && signal?.aborted !== true && isActivationAbort(error)) {
          return deps.activateSessionRuntime(sessionId, runId, signal, excludeSeedMessageId);
        }
        throw error;
      });
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const activation = withSessionOperationLock({
    rootDir,
    sessionId,
    operation: async () => {
      if (
        await hasForeignLiveSessionRuntime({
          rootDir,
          sessionId,
          ownerId: deps.runtimeLeaseOwnerId,
        })
      ) {
        throw new Error(`Session is active in another Host: ${sessionId}`);
      }
      return deps.doActivateSessionRuntime(sessionId, runId, signal, excludeSeedMessageId);
    },
  })
    .then((handle) => {
      attachRunToResidentGeneration(deps, sessionId, runId);
      return handle;
    })
    .finally(() => {
      deps.sessionActivationPromises.delete(sessionId);
    });
  deps.sessionActivationPromises.set(sessionId, activation);
  if (runId !== undefined) {
    void deps.publishWaitingResourceWhileQueued(runId);
  }
  return activation;
}

function isActivationAbort(error: unknown): boolean {
  return error instanceof Error && error.message === 'aborted';
}

function attachRunToResidentGeneration(
  deps: HostRuntimeKernel,
  sessionId: string,
  runId: string | undefined,
): void {
  if (runId === undefined) {
    return;
  }
  const run = deps.runRegistry.get(runId);
  if (
    run === undefined ||
    (run.status !== 'queued' && run.status !== 'running') ||
    run.runtimeGenerationId !== undefined
  ) {
    return;
  }
  const generationId = deps.runtimeController.getStatus(sessionId).generationId;
  if (generationId === undefined) {
    return;
  }
  const attached = deps.runRegistry.attachRuntimeGeneration(runId, generationId);
  if (!attached.ok) {
    throw new Error(
      `runtime generation attach failed for ${sessionId}: ${runId} -> ${generationId} (${attached.reason})`,
    );
  }
  deps.residencyController.markBusy(sessionId, generationId);
}

export async function doActivateSessionRuntime(
  deps: HostRuntimeKernel,
  sessionId: string,
  runId?: string,
  signal?: AbortSignal,
  excludeSeedMessageId?: string,
): Promise<SessionHandle> {
  // 1. validate the durable session record before allocating any runtime.
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  if (record.isArchived === true) {
    throw new Error(`Archived session must be restored before activation: ${sessionId}`);
  }
  if (deps.sessionMaintenanceSessions.has(sessionId)) {
    throw new Error(`Session is under lifecycle maintenance: ${sessionId}`);
  }
  // 2. reserve residency capacity (ADR 0040 §4). Admission evicts idle
  // runtimes first (with the aggregate Host/worker RSS sample); a
  // busy-only budget queues a cancellable waiter.
  const runtimeGenerationId = createRuntimeGenerationId();
  await deps.refreshWorkerRssSample();
  const admissionPromise = deps.residencyController.beginActivation(
    sessionId,
    runtimeGenerationId,
    signal ?? new AbortController().signal,
  );
  // While the activation queues for capacity, publish waiting-resource so
  // clients see the constraint instead of silence (ADR 0040 §4).
  if (runId !== undefined) {
    void deps.publishWaitingResourceWhileQueued(runId);
  }
  const admission = await admissionPromise;
  if (!admission.ok) {
    if (admission.code === 'memory-pressure') {
      const memoryError = new Error(`runtime-memory-pressure: ${admission.message}`);
      (memoryError as { code?: string }).code = 'runtime-memory-pressure';
      throw memoryError;
    }
    throw new Error(`activation aborted: ${admission.message}`);
  }
  // Native replay seed (spec: session-conversation-tree §4.4): when the
  // durable transcript owns native context copies, reconstruct the model
  // context with full fidelity instead of the text-injection prompt prefix.
  // Compact may stash product-history seeds here so a reconstructed backend
  // has a conversation to summarize instead of failing with "nothing to compact".
  let replaySeedOptions: CreateSessionOptions | undefined;
  const pendingSeedOptions = deps.pendingActivationSeedMessages.get(sessionId);
  if (pendingSeedOptions !== undefined) {
    // Live compact replacement seeds a candidate with ordinary replay
    // settings, then invokes Pi compact explicitly. The aggressive
    // keepRecent/retry overrides are reserved for disposable snapshots and
    // must not leak into the continuing user runtime.
    replaySeedOptions = {
      ...pendingSeedOptions,
      seedMode: 'replay',
    };
  } else {
    try {
      const store = await deps.getTranscriptStore(sessionId);
      replaySeedOptions = await buildColdActivationSeedOptions(store, excludeSeedMessageId);
    } catch (error) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `native replay seed build failed for ${sessionId}: ${formatError(error)}`,
      });
    }
  }
  let handle: SessionHandle;
  try {
    // 3. create and commit a generation for the same product session id.
    const activationModel = deps.sessionModels.get(sessionId) ?? record.model;
    handle = await deps.host.activateSession(
      sessionId,
      {
        projectPath: record.projectPath,
        ...(record.name ? { sessionName: record.name } : {}),
        ...(activationModel ? { model: activationModel } : {}),
        ...(record.thinkingLevel !== undefined ? { thinkingLevel: record.thinkingLevel } : {}),
      },
      runtimeGenerationId,
      replaySeedOptions ?? {},
    );
    if (runId !== undefined) {
      const attached = deps.runRegistry.attachRuntimeGeneration(runId, runtimeGenerationId);
      if (!attached.ok) {
        await deps.host.dropSession(sessionId);
        deps.residencyController.abortActivation(sessionId, runtimeGenerationId);
        throw new Error(
          `cold activation generation attach failed for ${sessionId}: ` +
            `${runId} -> ${runtimeGenerationId} (${attached.reason})`,
        );
      }
    }
  } catch (error) {
    deps.residencyController.abortActivation(sessionId, runtimeGenerationId);
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `session activation failed for ${sessionId}: ${message}`,
    });
    throw error;
  }
  try {
    // 4. bind the event stream and recorder with the attached generation.
    await deps.bindSession(handle, record.projectPath, record.name, undefined, runtimeGenerationId);
  } catch (error) {
    const unsubscribe = deps.unsubscribers.get(sessionId);
    unsubscribe?.();
    deps.unsubscribers.delete(sessionId);
    deps.sessions.delete(sessionId);
    deps.sessionRuntimeDelegationModes.delete(sessionId);
    deps.sessionProjects.delete(sessionId);
    const recorder = deps.transcriptRecorders.get(sessionId);
    recorder?.dispose();
    deps.transcriptRecorders.delete(sessionId);
    await deps.releaseRuntimeLease(sessionId).catch(() => undefined);
    await deps.host.dropSession(sessionId).catch((dropError: unknown) => {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `failed to drop unbound runtime for ${sessionId}: ${formatError(dropError)}`,
      });
    });
    deps.residencyController.abortActivation(sessionId, runtimeGenerationId);
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `session bind failed for ${sessionId}: ${message}`,
    });
    throw error;
  }
  deps.residencyController.commitActivation(sessionId, runtimeGenerationId);
  await revalidateSessionContextAfterBind(deps, sessionId, runtimeGenerationId);
  deps.sessionRuntimeDelegationModes.set(
    sessionId,
    runId ? (deps.runDelegationModes.get(runId) ?? 'auto') : 'auto',
  );
  if (runId !== undefined) {
    deps.residencyController.markBusy(sessionId, runtimeGenerationId);
  }
  if (replaySeedOptions === undefined) {
    // A reconstructed backend owns no native Pi context: the first prompt
    // must inject bounded product history exactly once for this generation.
    deps.coldStartHistoryBySession.set(sessionId, runtimeGenerationId);
  }
  // With a native replay seed the backend already owns full-fidelity
  // history, so the text-injection marker must stay unset.
  return handle;
}

async function revalidateSessionContextAfterBind(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
): Promise<void> {
  try {
    const store = await deps.getTranscriptStore(sessionId);
    const contextBoundary: import('@piwin/contracts').ContextBoundary = {
      activeLeafMessageId: await store.getActiveLeaf(),
    };
    const latestCompaction = await store.readLatestCompaction();
    if (latestCompaction !== undefined) {
      contextBoundary.compactionBoundary = formatCompactionBoundary(latestCompaction);
    }
    const model = deps.sessionModels.get(sessionId);
    if (model !== undefined) {
      contextBoundary.model = model;
    }
    await deps.sessionContextCoordinator.revalidateAfterActivation(sessionId, {
      runtimeGenerationId,
      contextBoundary,
    });
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `session context revalidate failed for ${sessionId}: ${formatError(error)}`,
    });
  }
}

export function pendingColdStartGenerationId(
  deps: HostRuntimeKernel,
  sessionId: string,
): string | undefined {
  const pendingGeneration = deps.coldStartHistoryBySession.get(sessionId);
  if (pendingGeneration === undefined) {
    return undefined;
  }
  return deps.runtimeController.getStatus(sessionId).generationId === pendingGeneration
    ? pendingGeneration
    : undefined;
}

/**
 * ADR 0040 §8: refresh the cached aggregate worker RSS sample with a short
 * throttle. Runs before admission so the eviction decision sees current
 * Host + worker RSS; a missing/partial sample never makes a false
 * low-memory claim (count/TTL enforcement still applies).
 */
export async function refreshWorkerRssSample(
  deps: HostRuntimeKernel,
  force = false,
): Promise<void> {
  const supervisor = deps.agentWorkerSupervisor;
  if (!supervisor) {
    deps.workerRssSample = null;
    return;
  }
  if (
    !force &&
    deps.workerRssSample !== null &&
    Date.now() - deps.workerRssSample.sampledAtMs < 1000
  ) {
    return;
  }
  try {
    const sample = await supervisor.sampleAggregateWorkerRssMiB();
    deps.workerRssSample = {
      rssMiB: sample.rssMiB,
      completeness: sample.sampleCompleteness,
      sampledAtMs: Date.now(),
    };
  } catch {
    deps.workerRssSample = { rssMiB: 0, completeness: 'missing', sampledAtMs: Date.now() };
  }
}

/**
 * ADR 0040 §4: publish `waiting-resource` while an activation queues for
 * capacity. Bounded poll (1s) — if admission resolves first, the phase was
 * never queued and no phase is emitted.
 */
export async function publishWaitingResourceWhileQueued(
  deps: HostRuntimeKernel,
  runId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (deps.residencyController.getCounts().waiterCount > 0) {
      deps.runRegistry.updatePhase(runId, 'waiting-resource', 'runtime-capacity');
      return;
    }
  }
}

/**
 * ADR 0040 §5: a session runtime is never an eviction candidate while any
 * protected work is in flight — an active/cancelling Run (or a
 * generation-correlated descendant), a pending permission or Extension UI
 * request, a compaction or replacement transaction, or an activation
 * transition already in progress.
 */
export function isSessionRuntimeProtected(deps: HostRuntimeKernel, sessionId: string): boolean {
  const generationId = deps.runtimeController.getStatus(sessionId).generationId;
  const hasActiveRun = deps.runRegistry
    .list({ status: ['queued', 'running', 'cancelling'] })
    .some(
      (run) =>
        run.sessionId === sessionId ||
        (generationId !== undefined && run.runtimeGenerationId === generationId),
    );
  if (hasActiveRun) {
    return true;
  }
  if ([...deps.pendingPermissions.values()].some((request) => request.sessionId === sessionId)) {
    return true;
  }
  if ([...deps.pendingExtensionUi.values()].some((request) => request.sessionId === sessionId)) {
    return true;
  }
  if (deps.residencyController.isProtected(sessionId)) {
    return true;
  }
  if (deps.runtimeReplacementEngine.hasPending(sessionId)) {
    return true;
  }
  if (deps.sessionActivationPromises.has(sessionId)) {
    return true;
  }
  return false;
}

/**
 * ADR 0040 §6: suspension is separate from session disposal. Executes the
 * full cleanup transaction while the residency entry remains `suspending`.
 * Capacity is released only after this returns true. The transaction is
 * idempotent and never touches independent authorities
 * (Jobs, walkthrough generation, durable session data).
 */
export function suspendSessionRuntime(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
  reason: import('@piwin/contracts').SessionRuntimeEvictionReason,
): Promise<boolean> {
  const existing = deps.sessionSuspensionPromises.get(sessionId);
  if (existing) {
    return existing;
  }
  const suspension = deps
    .doSuspendSessionRuntime(sessionId, runtimeGenerationId, reason)
    .finally(() => {
      if (deps.sessionSuspensionPromises.get(sessionId) === suspension) {
        deps.sessionSuspensionPromises.delete(sessionId);
      }
    });
  deps.sessionSuspensionPromises.set(sessionId, suspension);
  return suspension;
}

export async function doSuspendSessionRuntime(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
  reason: import('@piwin/contracts').SessionRuntimeEvictionReason,
): Promise<boolean> {
  const live = deps.sessions.get(sessionId);
  if (!live) {
    return true;
  }
  // Recheck blockers: state may have changed since the sweep decision.
  if (deps.isSessionRuntimeProtected(sessionId)) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `[residency] suspension deferred for ${sessionId}: protected work in flight`,
    });
    return false;
  }
  // Flush is the final reversible step. Once ProductAgentHost detaches the
  // generation, restoring resident-idle would publish a dead handle.
  const recorder = deps.transcriptRecorders.get(sessionId);
  if (recorder) {
    try {
      await recorder.flush();
    } catch (error) {
      const detail = formatError(error);
      deps.push({
        type: 'host/log',
        level: 'error',
        message: `[residency] suspension aborted for ${sessionId}: recorder flush failed: ${detail}`,
      });
      return false;
    }
  }

  const cleanupErrors: unknown[] = [];
  try {
    await deps.host.dropSession(sessionId);
  } catch (error) {
    // ProductAgentHost still attempts generation detach, abort, and backend
    // release before surfacing its AggregateError. Cleanup below must finish
    // the Host projection as cold; the detached runtime cannot be rolled back.
    cleanupErrors.push(error);
  }
  const generationStillAttached =
    deps.runtimeController.getStatus(sessionId).generationId === runtimeGenerationId;
  if (generationStillAttached) {
    const detail = cleanupErrors.map((error) => formatError(error)).join('; ');
    deps.push({
      type: 'host/log',
      level: 'error',
      message: `[residency] suspension failed before detach for ${sessionId} (${reason}): ${detail || 'generation remained attached'}`,
    });
    return false;
  }

  await deps.refreshWorkerRssSample(true);
  const unsub = deps.unsubscribers.get(sessionId);
  if (unsub) {
    try {
      unsub();
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      deps.unsubscribers.delete(sessionId);
    }
  }
  deps.runEventCorrelator.clear(sessionId);
  deps.sessions.delete(sessionId);
  try {
    await deps.releaseRuntimeLease(sessionId);
  } catch (error) {
    cleanupErrors.push(error);
  }
  deps.sessionRuntimeDelegationModes.delete(sessionId);
  deps.coldStartHistoryBySession.delete(sessionId);
  if (recorder) {
    try {
      recorder.dispose();
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      deps.transcriptRecorders.delete(sessionId);
    }
  }
  try {
    deps.transcriptStores.close(sessionId);
  } catch (error) {
    cleanupErrors.push(error);
  }
  // Remove resident-only maps.
  deps.sessionProjects.delete(sessionId);
  deps.sessionModels.delete(sessionId);
  deps.sessionLastAssistantReply.delete(sessionId);
  deps.sessionUsage.delete(sessionId);
  deps.sessionLastPromptText.delete(sessionId);
  deps.sessionAutoCompactionOverrides.delete(sessionId);
  deps.sessionFilesTouched.delete(sessionId);
  deps.sideChatSnapshotInjectedVersions.delete(sessionId);
  deps.clearSessionAllowlist(sessionId);
  deps.sessionPermissionOverrides.delete(sessionId);
  deps.runtimeController.markCold(sessionId, reason);
  if (cleanupErrors.length > 0) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `[residency] ${sessionId} became cold with cleanup errors: ${cleanupErrors.map((error) => formatError(error)).join('; ')}`,
    });
  }
  return true;
}

export async function ensureLiveSession(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<SessionHandle> {
  return deps.activateSessionRuntime(sessionId);
}

/**
 * Tool descriptors are frozen for a runtime generation. Rebuild a warm
 * generation only when this turn requests a different delegation surface;
 * cold activation then compiles under the foreground run context.
 */
export async function prepareDelegationRuntime(
  deps: HostRuntimeKernel,
  sessionId: string,
  mode: 'auto' | 'disabled',
): Promise<void> {
  if (!deps.sessions.has(sessionId)) return;
  const residentMode = deps.sessionRuntimeDelegationModes.get(sessionId) ?? 'auto';
  if (residentMode === mode) return;
  await deps.disposeLiveSession(sessionId, 'manual');
}
