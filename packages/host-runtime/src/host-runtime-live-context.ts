/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { getSessionRecord } from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { resolveTurnChangeWorkspaceRoot } from './turn-changes/runtime-wiring.js';
import { isConversationIndexRecord } from './session-scope.js';
import { type SessionLiveContext } from './commands/session-live-commands.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { terminateHostRun } from './run-terminalizer.js';

export function createSessionLiveContext(deps: HostRuntimeKernel): SessionLiveContext {
  return {
    ...(deps.options.piwinRoot !== undefined ? { piwinRoot: deps.options.piwinRoot } : {}),
    host: deps.host,
    createSession: (input, options) => deps.createSession(input, options),
    sessions: deps.sessions,
    sessionFilesTouched: deps.sessionFilesTouched,
    sessionLastPromptText: deps.sessionLastPromptText,
    sideChatSnapshotInjectedVersions: deps.sideChatSnapshotInjectedVersions,
    pendingBranchCalibrationBySession: deps.pendingBranchCalibrationBySession,
    compactExportOperations: deps.compactExportOperations,
    sessionModels: deps.sessionModels,
    noteSubscriptionAuthFailure: (providerId) => {
      deps.subscriptionAuth?.markNeedsReauth(providerId);
    },
    loadSessionUsage: (sessionId) => deps.loadSessionUsage(sessionId),
    sessionAutoCompactionOverrides: deps.sessionAutoCompactionOverrides,
    unsubscribers: deps.unsubscribers,
    transcriptRecorders: deps.transcriptRecorders,
    push: (message) => deps.push(message),
    pushStatus: () => deps.pushStatus(),
    requireSession: (sessionId) => deps.requireSession(sessionId),
    bindSession: (session, projectPath, sessionName, lineage) =>
      deps.bindSession(session, projectPath, sessionName, lineage),
    loadTranscriptMessages: (sessionId) => deps.loadTranscriptMessages(sessionId),
    getTranscriptStore: (sessionId) => deps.getTranscriptStore(sessionId),
    nextModelRequestOrdinal: (sessionId) => deps.nextModelRequestOrdinal(sessionId),
    withTranscriptStore: (sessionId, operation) => deps.withTranscriptStore(sessionId, operation),
    recordCompactionBoundary: async (sessionId, result) => {
      const summary = result.summary?.trim();
      if (!result.ok || !summary) {
        return;
      }
      await deps.withTranscriptStore(sessionId, async (store) => {
        const anchorMessageId = await store.getActiveLeaf();
        const generationId = deps.runtimeController.getStatus(sessionId).generationId;
        await store.recordCompaction({
          compactionId: `compaction-${randomUUID()}`,
          anchorMessageId,
          summary,
          ...(result.firstKeptEntryId ? { firstKeptEntryId: result.firstKeptEntryId } : {}),
          ...(result.tokensBefore !== undefined ? { tokensBefore: result.tokensBefore } : {}),
          ...(result.tokensAfter !== undefined ? { tokensAfter: result.tokensAfter } : {}),
          ...(generationId !== undefined ? { runtimeGenerationId: generationId } : {}),
          createdAt: new Date().toISOString(),
        });
      });
    },
    loadSideChatSnapshot: async (sessionId) => {
      const rootDir = getPiwinRoot(deps.options.piwinRoot);
      const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
      if (record?.kind !== 'side-chat') {
        return undefined;
      }
      return record.sideChatContext;
    },
    resolveIsConversationChat: async (sessionId) => {
      const record = await getSessionRecord(
        getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot)),
        sessionId,
      );
      return record !== undefined && isConversationIndexRecord(record);
    },
    stopProcessesForSession: (sessionId) => deps.stopProcessesForSession(sessionId),
    recordUserPrompt: (sessionId, input) => deps.recordUserPrompt(sessionId, input),
    touchSession: (sessionId, previewText) => deps.touchSession(sessionId, previewText),
    needsProductHistoryInjection: (sessionId) =>
      deps.pendingColdStartGenerationId(sessionId) !== undefined,
    ensureLiveSession: (sessionId) => deps.ensureLiveSession(sessionId),
    reactivateWithSeedMessages: async (sessionId, seedMessages) => {
      // `disposeLiveSession` clears resident-only maps. Preserve the
      // in-memory session state across this internal candidate rebuild so the
      // newly bound generation receives the same Host policy and model.
      const autoCompactionOverride = deps.sessionAutoCompactionOverrides.get(sessionId);
      const activeModel = deps.sessionModels.get(sessionId);
      const delegationMode = deps.sessionRuntimeDelegationModes.get(sessionId);
      await deps.disposeLiveSession(sessionId);
      if (autoCompactionOverride !== undefined) {
        deps.sessionAutoCompactionOverrides.set(sessionId, autoCompactionOverride);
      }
      if (activeModel !== undefined) {
        deps.sessionModels.set(sessionId, activeModel);
      }
      if (delegationMode !== undefined) {
        deps.sessionRuntimeDelegationModes.set(sessionId, delegationMode);
      }
      deps.pendingActivationSeedMessages.set(sessionId, {
        seedMessages: [...seedMessages],
        seedMode: 'replay',
      });
      try {
        return await deps.activateSessionRuntime(sessionId);
      } catch (error) {
        deps.pendingActivationSeedMessages.delete(sessionId);
        await deps.activateSessionRuntime(sessionId).catch(() => undefined);
        throw error;
      } finally {
        deps.pendingActivationSeedMessages.delete(sessionId);
      }
    },
    activateSessionRuntime: (sessionId, runId, signal, excludeSeedMessageId) =>
      deps.activateSessionRuntime(sessionId, runId, signal, excludeSeedMessageId),
    markProductHistoryInjected: (sessionId) => {
      deps.coldStartHistoryBySession.delete(sessionId);
    },
    resolveAutoCompaction: (sessionId) => deps.resolveAutoCompaction(sessionId),
    buildModelPromptInput: (input, signal) => deps.buildModelPromptInput(input, signal),
    validatePromptAttachments: (input) => deps.validatePromptAttachments(input),
    loadConfig: () => loadPiwinConfig(deps.options.piwinRoot),
    setRunOrchestrationScheme: (runId, scheme) => {
      if (scheme) {
        deps.runOrchestrationSchemes.set(runId, scheme);
        deps.schemeAdmissionGate.bind(runId, {
          maxConcurrency: scheme.maxConcurrency,
          maxTasksPerRun: scheme.maxTasksPerRun,
        });
      } else {
        deps.runOrchestrationSchemes.delete(runId);
        deps.schemeAdmissionGate.clear(runId);
      }
    },
    setRunDelegationMode: (runId, mode) => {
      deps.runDelegationModes.set(runId, mode);
    },
    prepareDelegationRuntime: (sessionId, mode) => deps.prepareDelegationRuntime(sessionId, mode),
    getRunOrchestrationScheme: (runId) => deps.runOrchestrationSchemes.get(runId),
    listKnownSubagentProfileIds: async () => {
      const config = await loadPiwinConfig(deps.options.piwinRoot);
      const { resolveSubagentProfiles } = await import('./subagent-profile-resolver.js');
      return resolveSubagentProfiles(config).map((profile) => profile.id);
    },
    runWithContext: (runId, operation) => {
      void deps.runExecutionContext.run(runId, operation);
    },
    flushTranscriptRecorder: async (sessionId) => {
      const recorder = deps.transcriptRecorders.get(sessionId);
      if (recorder) {
        await recorder.flush();
      }
    },
    getForegroundRun: (sessionId) => deps.runRegistry.getForegroundRun(sessionId),
    registerForegroundRun: (sessionId, resumeCheckpointId, options) => {
      return deps.createAdmittedForegroundRun(sessionId, resumeCheckpointId, undefined, options);
    },
    replaceForegroundRun: (sessionId, previousRunId, resumeCheckpointId, options) => {
      return deps.createAdmittedForegroundRun(
        sessionId,
        resumeCheckpointId,
        previousRunId,
        options,
      );
    },
    tryReservePromptAdmission: (sessionId) => deps.promptAdmissionGate.tryReserve(sessionId),
    tryReserveSessionBody: (sessionId) => deps.sessionBodyGate.tryReserve(sessionId),
    releaseSessionBody: (sessionId) => deps.sessionBodyGate.release(sessionId),
    isSessionBodyReserved: (sessionId) => deps.sessionBodyGate.isReserved(sessionId),
    releasePromptAdmission: (sessionId) => {
      deps.promptAdmissionGate.release(sessionId);
    },
    isPromptAdmissionReserved: (sessionId) => deps.promptAdmissionGate.isReserved(sessionId),
    joinRun: (runId) => deps.runRegistry.join(runId),
    getRunSignal: (runId) => deps.runRegistry.getSignal(runId),
    hasRunAgentErrorEvidence: (runId) => deps.runRegistry.hasAgentErrorEvidence(runId),
    /** ADR 0040 §5: explicit protection lease (compaction / backend op). */
    protectRuntime: (sessionId) => {
      const generationId = deps.runtimeController.getStatus(sessionId).generationId;
      return generationId !== undefined
        ? deps.residencyController.protect(sessionId, generationId)
        : false;
    },
    releaseRuntimeProtection: (sessionId) => {
      const generationId = deps.runtimeController.getStatus(sessionId).generationId;
      if (generationId !== undefined) {
        deps.residencyController.releaseProtection(sessionId, generationId);
      }
    },
    requestCancelRun: (sessionId, runId, reason) => {
      if (runId !== undefined) {
        const run = deps.runRegistry.get(runId);
        if (!run || run.sessionId !== sessionId) return undefined;
        return deps.runRegistry.requestCancel(runId, reason);
      }
      const active = deps.runRegistry.getForegroundRun(sessionId);
      if (!active) return undefined;
      return deps.runRegistry.requestCancel(active.runId, reason);
    },
    requestPauseRun: (sessionId, runId, reason) => {
      const active = deps.runRegistry.getForegroundRun(sessionId);
      if (!active || (runId !== undefined && active.runId !== runId)) return undefined;
      return deps.runRegistry.requestPause(active.runId, reason);
    },
    isPauseRequested: (runId) => deps.runRegistry.isPauseRequested(runId),
    hasActiveDescendants: (runId) => deps.runRegistry.hasActiveDescendants(runId),
    attachResumeCheckpoint: (runId, checkpointId) => {
      const attached = deps.runRegistry.attachResumeCheckpoint(runId, checkpointId);
      if (!attached) {
        throw new Error(`cannot attach pause checkpoint to run ${runId}`);
      }
    },
    getActivePauseCheckpoint: (sessionId) =>
      deps.withTranscriptStore(sessionId, (store) => store.getActivePauseCheckpoint()),
    getPauseCheckpoint: (sessionId, checkpointId) =>
      deps.withTranscriptStore(sessionId, (store) => store.getPauseCheckpoint(checkpointId)),
    createPauseCheckpoint: (sessionId, input) =>
      deps.withTranscriptStore(sessionId, (store) => store.createPauseCheckpoint(input)),
    consumePauseCheckpoint: (sessionId, checkpointId) =>
      deps.withTranscriptStore(sessionId, (store) => store.consumePauseCheckpoint(checkpointId)),
    clearPauseCheckpoint: (sessionId, checkpointId) =>
      deps.withTranscriptStore(sessionId, (store) => store.clearPauseCheckpoint(checkpointId)),
    updateRunPhase: (runId, phase, detail) => {
      deps.runRegistry.updatePhase(runId, phase, detail);
    },
    terminateRun: async (sessionId, runId, outcome, code, message, options) => {
      return terminateHostRun(deps, sessionId, runId, outcome, code, message, options);
    },
    settlePendingPermissionsForSession: (sessionId) => {
      for (const [requestId, pending] of deps.pendingPermissions.entries()) {
        if (pending.sessionId === sessionId) {
          pending.resolve('deny');
          deps.pendingPermissions.delete(requestId);
        }
      }
    },
    settlePendingExtensionUiForSession: (sessionId) =>
      deps.settlePendingExtensionUiForSession(sessionId),
    acquireExecutionLease: async (request) => {
      const coordinator = deps.runtimeResourceCoordinator;
      if (!coordinator) {
        return { release: () => undefined };
      }
      const lease = await coordinator.acquire(request);
      return {
        release: () => {
          coordinator.release(lease);
        },
      };
    },
    setSessionPermissionOverride: (sessionId, mode) =>
      deps.setSessionPermissionOverride(sessionId, mode),
    clearSessionPermissionOverride: (sessionId) => deps.clearSessionPermissionOverride(sessionId),
    runtimeController: deps.runtimeController,
    resetSessionEventState: (sessionId) => deps.resetSessionEventState(sessionId),
    cancelRuntimeReplacement: (sessionId) => deps.runtimeReplacementEngine.cancel(sessionId),
    disposeLiveSession: (sessionId, reason) => deps.disposeLiveSession(sessionId, reason),
    quarantineSessionRuntime: (sessionId, runId) => deps.quarantineSessionRuntime(sessionId, runId),
    reloadRuntime: (request) => {
      const status = deps.runtimeController.getStatus(request.sessionId);
      return deps.runtimeReplacementEngine
        .replace({
          sessionId: request.sessionId,
          expectedSettingsRevision: request.expectedSettingsRevision,
          targetSettingsRevision:
            status.desiredSettingsRevision ?? request.expectedSettingsRevision,
          ...(status.generationId !== undefined
            ? { expectedActiveGenerationId: status.generationId }
            : {}),
          when: request.when,
        })
        .then((result) => ({
          generationId: result.candidate.generationId,
          settingsRevision: result.candidate.settingsRevision,
        }));
    },
    replaceRuntimeForModel: (sessionId, excludeSeedMessageId) =>
      deps.replaceRuntimeForModel(sessionId, excludeSeedMessageId),
    beginTurnChangeRun: (input) => {
      const runtime = deps.turnChangeRuntime;
      if (!runtime) {
        return;
      }
      const child = deps.subagentSessionContexts.get(input.sessionId);
      const workspaceRoot = resolveTurnChangeWorkspaceRoot({
        ...(child?.workingDirectory !== undefined
          ? { childWorkingDirectory: child.workingDirectory }
          : {}),
        projectPath: deps.sessionProjects.get(input.sessionId),
        piwinRoot: deps.options.piwinRoot,
      });
      runtime.coordinator.beginAttempt({
        sessionId: input.sessionId,
        userMessageId: input.userMessageId,
        runId: input.runId,
        source: child ? 'child' : input.source,
        workspaceRoot,
      });
    },
    endTurnChangeRun: (runId) => {
      deps.turnChangeRuntime?.coordinator.endRunSegment(runId);
    },
    sessionContextCoordinator: deps.sessionContextCoordinator,
  };
}
