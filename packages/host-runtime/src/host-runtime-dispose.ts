/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { formatError } from '@piwin/contracts';

import { finalizeRunTranscriptArtifacts } from './transcript-stream-settler.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { createCancelledExtensionUiResponse } from './extension-ui-cancel.js';

export async function disposeHostRuntime(deps: HostRuntimeKernel): Promise<void> {
  const shutdownErrors: unknown[] = [];
  deps.queuedTurnController.dispose();
  deps.flashcardSelectionRegistry.abortAll();
  const replacementCleanup = deps.runtimeReplacementEngine.cancelAll();
  const activeRuns = deps.runRegistry.list({
    status: ['queued', 'running', 'cancelling'],
  });
  for (const run of activeRuns.filter((candidate) => candidate.parentRunId === undefined)) {
    deps.runRegistry.cancelRun(run.runId);
  }
  const cleanedSessions = new Set<string>();
  for (const run of activeRuns) {
    if (cleanedSessions.has(run.sessionId)) continue;
    cleanedSessions.add(run.sessionId);
    let cleanupFailed = false;
    let cleanupMessage: string | undefined;
    const liveSession = deps.sessions.get(run.sessionId);
    if (liveSession) {
      try {
        await liveSession.abort();
      } catch (error) {
        cleanupFailed = true;
        cleanupMessage = formatError(error);
      }
    }
    try {
      await deps.stopProcessesForSession(run.sessionId);
    } catch (error) {
      cleanupFailed = true;
      cleanupMessage = formatError(error);
    }
    if (cleanupFailed) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: cleanupMessage ?? `run cleanup failed for ${run.runId}`,
      });
    }
  }
  for (const run of activeRuns) {
    try {
      const finalized = await deps.withTranscriptStore(run.sessionId, (store) =>
        finalizeRunTranscriptArtifacts(store, {
          runId: run.runId,
          outcome: 'cancelled',
          interventionReason: 'run-cancelling',
          terminalMessage: 'host disposed',
        }),
      );
      for (const intervention of finalized.expired) {
        deps.push({ type: 'run/intervention-updated', intervention });
      }
    } catch (error) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `run transcript finalization failed for ${run.runId}: ${formatError(error)}`,
      });
    }
    deps.runRegistry.terminate(run.runId, 'cancelled', 'host-shutdown', 'host disposed');
  }
  // Replacement cleanup must finish before MCP/Host disposal so a cancelled
  // candidate cannot recreate a generation against already-closed services.
  try {
    await replacementCleanup;
  } catch (error) {
    shutdownErrors.push(error);
  }
  for (const pendingPermission of deps.pendingPermissions.values()) {
    pendingPermission.resolve('deny');
  }
  for (const pendingUiRequest of deps.pendingExtensionUi.values()) {
    pendingUiRequest.resolve(createCancelledExtensionUiResponse(pendingUiRequest.kind));
  }
  deps.pendingPermissions.clear();
  deps.pendingExtensionUi.clear();
  if (deps.notesServices) {
    try {
      deps.notesServices.index.close();
    } catch {
      // best-effort shutdown
    }
    deps.notesServices = null;
  }
  if (deps.folderRag) {
    try {
      deps.folderRag.close();
    } catch {
      // best-effort shutdown
    }
    deps.folderRag = null;
    deps.folderRagKey = null;
  }
  if (deps.browserSessionUnsubscribe) {
    try {
      deps.browserSessionUnsubscribe();
    } catch (error) {
      shutdownErrors.push(error);
    }
    deps.browserSessionUnsubscribe = null;
  }
  if (deps.browserSession) {
    try {
      await deps.browserSession.close();
    } catch {
      // best-effort shutdown
    }
    deps.browserSession = null;
    deps.browserSessionInit = null;
  }
  if (deps.jobController) {
    try {
      await deps.jobController.dispose();
    } catch {
      // best-effort shutdown
    }
    deps.jobController = null;
  }
  if (deps.mcpManager) {
    try {
      await deps.mcpManager.dispose();
    } catch {
      // best-effort shutdown
    }
    deps.mcpManager = null;
  }
  for (const unsubscribe of deps.unsubscribers.values()) {
    try {
      unsubscribe();
    } catch (error) {
      shutdownErrors.push(error);
    }
  }
  deps.unsubscribers.clear();
  const residentSessionIds = [...deps.sessions.keys()];
  for (const sessionId of residentSessionIds) {
    deps.runEventCorrelator.clear(sessionId);
    deps.eventEnvelopeGenerators.delete(sessionId);
  }
  deps.sessions.clear();
  deps.sessionProjects.clear();
  try {
    await Promise.all([...deps.transcriptRecorders.values()].map((recorder) => recorder.flush()));
  } catch (error) {
    shutdownErrors.push(error);
  } finally {
    for (const recorder of deps.transcriptRecorders.values()) {
      try {
        recorder.dispose();
      } catch (error) {
        shutdownErrors.push(error);
      }
    }
    deps.transcriptRecorders.clear();
    try {
      deps.transcriptStores.closeAll();
    } catch (error) {
      shutdownErrors.push(error);
    }
  }
  // ADR 0030: dispose subagent orchestration components.
  if (deps.subagentIntegrationCoordinator) {
    try {
      await deps.subagentIntegrationCoordinator.dispose();
    } catch {
      // best-effort shutdown
    }
    deps.subagentIntegrationCoordinator = null;
  }
  if (deps.agentWorkerSupervisor) {
    try {
      await deps.agentWorkerSupervisor.dispose();
    } catch {
      // best-effort shutdown
    }
    deps.agentWorkerSupervisor = null;
  }
  deps.subagentOrchestrator = null;
  deps.subagentWorkspaceService = null;
  deps.runtimeResourceCoordinator = null;
  try {
    await deps.host.dispose();
  } catch (error) {
    shutdownErrors.push(error);
  }
  await Promise.all(
    residentSessionIds.map((sessionId) =>
      deps.releaseRuntimeLease(sessionId).catch((error: unknown) => {
        shutdownErrors.push(error);
      }),
    ),
  );
  // ADR 0040: stop the residency sweep timer and reject pending waiters.
  deps.residencyController.dispose();
  deps.subagentSessionContexts.clear();
  deps.runOrchestrationSchemes.clear();
  deps.runDelegationModes.clear();
  deps.sessionRuntimeDelegationModes.clear();
  deps.generationToolSurfaces.clear();
  deps.generationMcpConfigs.clear();
  deps.generationMcpSnapshots.clear();
  deps.generationPermissionRuleRevisions.clear();
  deps.preparedRuntimeGenerations.clear();
  deps.retiredRuntimeSessions.clear();
  deps.sessionAllowlists.clear();
  deps.sessionPermissionOverrides.clear();
  await deps.flushUsageLedgerWrites();
  deps.sessionUsage.clear();
  deps.sessionLastPromptText.clear();
  deps.sessionModels.clear();
  deps.healthTurnBySession.clear();
  deps.sessionLastAssistantReply.clear();
  deps.assistantTextBuffers.clear();
  deps.sessionAutoCompactionOverrides.clear();
  deps.sessionFilesTouched.clear();
  deps.subagentTaskResults.clear();
  deps.workerCrashCleanupRoots.clear();
  deps.eventEnvelopeGenerators.clear();
  deps.sessionHostToolPort?.clear();
  deps.pendingDirectActivations.clear();
  deps.extensionDeploymentIdsBySession.clear();
  deps.extensionDeploymentPromisesById.clear();
  deps.ready = false;
  if (deps.subagentStartupRecovery) {
    try {
      await deps.subagentStartupRecovery;
    } catch (error) {
      shutdownErrors.push(error);
    }
    deps.subagentStartupRecovery = null;
  }
  if (deps.extensionDeploymentStartupRecovery) {
    try {
      await deps.extensionDeploymentStartupRecovery;
    } catch {
      // Recovery already logged at startup. Failing shutdown over it would
      // turn a known journal read error into an unclean Host exit.
    }
    deps.extensionDeploymentStartupRecovery = null;
  }
  if (deps.rootLease) {
    try {
      deps.rootLease.release();
    } catch (error) {
      shutdownErrors.push(error);
    }
  }
  if (shutdownErrors.length > 0) {
    throw new AggregateError(shutdownErrors, 'HostRuntime shutdown completed with errors');
  }
}
