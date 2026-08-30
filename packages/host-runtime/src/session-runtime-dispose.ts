/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { formatError, isRunTerminal } from '@piwin/contracts';

import { ok } from './response-helpers.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function disposeLiveSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  reason: import('@piwin/contracts').SessionRuntimeEvictionReason = 'host-dispose',
): Promise<void> {
  deps.settlePendingExtensionUiForSession(sessionId);
  const replacementCleanup = deps.runtimeReplacementEngine.cancel(sessionId);
  const live = deps.sessions.get(sessionId);
  const activeRun = deps.runRegistry.getForegroundRun(sessionId);
  if (activeRun) {
    // Abort can synchronously produce provider events; close ownership
    // before invoking it so explicit old-run events are rejected.
    deps.runRegistry.requestCancel(activeRun.runId, 'session-disposed');
    deps.runEventCorrelator.markRunTerminal(sessionId, activeRun.runId);
  }
  if (live) {
    try {
      await live.abort();
    } catch {
      // best-effort
    }
  }
  await replacementCleanup;
  deps.sessions.delete(sessionId);
  deps.sessionRuntimeDelegationModes.delete(sessionId);
  const unsub = deps.unsubscribers.get(sessionId);
  if (unsub) {
    unsub();
    deps.unsubscribers.delete(sessionId);
  }
  deps.sessionProjects.delete(sessionId);
  deps.sessionModels.delete(sessionId);
  deps.sessionLastAssistantReply.delete(sessionId);
  const recorder = deps.transcriptRecorders.get(sessionId);
  if (recorder) {
    try {
      await recorder.flush();
    } catch {
      // best-effort
    }
    recorder.dispose();
    deps.transcriptRecorders.delete(sessionId);
  }
  deps.transcriptStores.close(sessionId);
  deps.resetSessionEventState(sessionId);
  // ADR 0040 §6: session disposal also releases the residency entry so the
  // sweep timer and counters never track a disposed runtime. Read the
  // generation BEFORE detaching it from the runtime registry.
  const disposedGenerationId = deps.runtimeController.getStatus(sessionId).generationId;
  deps.pendingDirectActivations.delete(sessionId);
  deps.runtimeController.detachGeneration(sessionId);
  if (disposedGenerationId !== undefined) {
    deps.residencyController.beginSuspend(sessionId, disposedGenerationId, reason);
    deps.residencyController.finishSuspend(sessionId, disposedGenerationId);
  }
  deps.runtimeController.markCold(sessionId, reason);
  deps.sessionHostToolPort?.clearSession(sessionId);
  deps.clearSessionAllowlist(sessionId);
  deps.sessionUsage.delete(sessionId);
  if (deps.sessionContextCoordinator) {
    await deps.sessionContextCoordinator.flush(sessionId);
    deps.sessionContextCoordinator.disposeSession(sessionId);
  }
  deps.sessionLastPromptText.delete(sessionId);
  deps.sessionAutoCompactionOverrides.delete(sessionId);
  deps.sessionFilesTouched.delete(sessionId);
  await deps.host.dropSession(sessionId);
  await deps.releaseRuntimeLease(sessionId);
  // §11.3: abort in-flight walkthrough generations for the disposed session.
  deps.walkthroughRegistry.abortSession(sessionId);
  // ADR 0030 Phase B: stop session-lifetime Jobs when the session is disposed.
  await deps.stopProcessesForSession(sessionId);
}

/**
 * Remove a non-responsive runtime from product authority synchronously.
 * Backend cleanup is generation-scoped and deliberately detached so a
 * stuck Pi abort cannot keep the Run/UI or the next activation blocked.
 */
export function quarantineSessionRuntime(
  deps: HostRuntimeKernel,
  sessionId: string,
  runId: string,
): void {
  const run = deps.runRegistry.get(runId);
  if (!run || run.sessionId !== sessionId || !isRunTerminal(run.status)) {
    return;
  }
  const live = deps.sessions.get(sessionId);
  const runtimeGenerationId =
    run.runtimeGenerationId ?? deps.runtimeController.getStatus(sessionId).generationId;

  deps.runEventCorrelator.markRunTerminal(sessionId, runId);
  if (live) {
    deps.sessions.delete(sessionId);
    deps.host.detachSessionHandle(sessionId, live);
  }
  const unsubscribe = deps.unsubscribers.get(sessionId);
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch (error) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `quarantined session unsubscribe failed: ${formatError(error)}`,
      });
    }
    deps.unsubscribers.delete(sessionId);
  }

  const recorder = deps.transcriptRecorders.get(sessionId);
  let recorderCleanup = Promise.resolve();
  if (recorder) {
    deps.transcriptRecorders.delete(sessionId);
    recorderCleanup = (async () => {
      try {
        await recorder.flush();
      } catch (error) {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `quarantined transcript flush failed: ${formatError(error)}`,
        });
      } finally {
        try {
          recorder.dispose();
        } catch (error) {
          deps.push({
            type: 'host/log',
            level: 'warn',
            message: `quarantined transcript dispose failed: ${formatError(error)}`,
          });
        }
      }
    })();
  }

  deps.coldStartHistoryBySession.delete(sessionId);
  deps.pendingDirectActivations.delete(sessionId);
  deps.runtimeController.detachGeneration(sessionId);
  if (runtimeGenerationId !== undefined) {
    const suspension = deps.residencyController.beginSuspend(
      sessionId,
      runtimeGenerationId,
      'manual',
    );
    if (suspension.ok) {
      deps.residencyController.finishSuspend(sessionId, runtimeGenerationId);
    }
  }
  deps.runtimeController.markCold(sessionId, 'manual');
  deps.sessionHostToolPort?.clearSession(sessionId);

  if (runtimeGenerationId !== undefined) {
    void deps.releaseQuarantinedRuntime(sessionId, runtimeGenerationId).catch((error: unknown) => {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `quarantined runtime cleanup failed: ${formatError(error)}`,
      });
    });
  }
}

export async function releaseQuarantinedRuntime(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
): Promise<void> {
  const cleanupResults = await Promise.allSettled([
    deps.host.releaseSessionGeneration(sessionId, runtimeGenerationId),
    deps.releaseGenerationToolSurface(sessionId, runtimeGenerationId),
  ]);
  const releaseLeaseResult = await Promise.allSettled([deps.releaseRuntimeLease(sessionId)]);
  const failures = [...cleanupResults, ...releaseLeaseResult].filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length > 0) {
    const generationLabel = runtimeGenerationId ?? 'untracked-generation';
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `failed to release quarantined runtime ${sessionId}/${generationLabel}`,
    );
  }
}
