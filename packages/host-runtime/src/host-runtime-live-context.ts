/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { join } from 'node:path';

import { getSessionRecord } from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
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
    replaceRuntimeForModel: (sessionId) => deps.replaceRuntimeForModel(sessionId),
  };
}
