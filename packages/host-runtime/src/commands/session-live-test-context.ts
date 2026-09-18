/**
 * Shared SessionLiveContext fixtures for Host command tests.
 * Not a production module.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentHost,
  AgentMessageView,
  ExecutionRunRecord,
  HostPush,
  ResolvedOrchestrationScheme,
  SessionHandle,
  SessionTreeView,
} from '@piwin/contracts';
import { COMPLETED_STOP_OUTCOME } from '@piwin/contracts';
import { createDefaultPiwinConfig } from '../config-store.js';
import { RunRegistry } from '../run-registry.js';
import { SessionRuntimeController } from '../sessions/session-runtime-controller.js';
import type { SessionLiveContext } from './session-live-context.js';

export function createSilentSessionHandle(): SessionHandle {
  const sessionId = randomUUID();
  return {
    id: sessionId,
    async prompt() {
      return COMPLETED_STOP_OUTCOME;
    },
    async steer(): Promise<void> {},
    async followUp(): Promise<void> {},
    async abort(): Promise<void> {},
    async getMessages(): Promise<AgentMessageView[]> {
      return [];
    },
    async getTree(): Promise<SessionTreeView> {
      return { root: null, activeLeafId: null };
    },
    subscribe(): () => void {
      return () => {};
    },
  };
}

export function createPromptContext(session: SessionHandle): {
  context: SessionLiveContext;
  events: HostPush[];
} {
  const control = createControlContext(session);
  control.registry.clear();
  const events: HostPush[] = [];
  control.context.push = (message): void => {
    events.push(message);
  };
  control.context.updateRunPhase = (runId, phase, detail): void => {
    const updated = control.registry.updatePhase(runId, phase, detail);
    if (updated) {
      events.push({ type: 'run/updated', run: updated });
    }
  };
  control.context.terminateRun = (_sessionId, runId, outcome, code, message, options): boolean => {
    const terminal = control.registry.terminate(
      runId,
      outcome === 'paused' ? 'interrupted' : outcome,
      code,
      message,
      options === undefined
        ? undefined
        : {
            ...(options.agentStopReason === undefined
              ? {}
              : { agentStopReason: options.agentStopReason }),
            ...(options.failure === undefined ? {} : { failure: options.failure }),
          },
    );
    if (terminal) {
      events.push({ type: 'run/terminal', run: terminal });
    }
    return terminal !== undefined;
  };
  return { context: control.context, events };
}

export function createControlContext(
  session: SessionHandle,
  cleanupDelayMs = 0,
): {
  context: SessionLiveContext;
  registry: RunRegistry;
  activeRun: ExecutionRunRecord;
} {
  const registry = new RunRegistry();
  const activeRun = registry.createForegroundRun(session.id);
  const host: AgentHost = {
    mode: 'sdk',
    createSession: async () => session,
    resumeSession: async () => session,
    listSessions: async () => [],
    dropSession: async () => undefined,
    dispose: async () => undefined,
  };
  const context: SessionLiveContext = {
    host,
    createSession: async () => session,
    sessions: new Map([[session.id, session]]),
    sessionFilesTouched: new Map(),
    sessionLastPromptText: new Map(),
    sessionModels: new Map(),
    sessionThinkingLevels: new Map(),
    sessionAutoCompactionOverrides: new Map(),
    unsubscribers: new Map(),
    transcriptRecorders: new Map(),
    push: (_message: HostPush): void => undefined,
    pushStatus: (): void => undefined,
    requireSession: (): SessionHandle => session,
    bindSession: async (): Promise<void> => undefined,
    loadTranscriptMessages: async () => [],
    loadSessionUsage: async () => null,
    getTranscriptStore: async () => {
      throw new Error('transcript store is not configured for this control-only test');
    },
    nextModelRequestOrdinal: async (): Promise<number> => 1,
    withTranscriptStore: async () => {
      throw new Error('transcript store is not configured for this control-only test');
    },
    recordCompactionBoundary: async () => undefined,
    loadSideChatSnapshot: async () => undefined,
    sideChatSnapshotInjectedVersions: new Map(),
    pendingBranchCalibrationBySession: new Map(),
    compactExportOperations: new Map(),
    stopProcessesForSession: async (): Promise<void> => {
      if (cleanupDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, cleanupDelayMs));
      }
    },
    recordUserPrompt: async (): Promise<void> => undefined,
    touchSession: async (): Promise<void> => undefined,
    needsProductHistoryInjection: (): boolean => false,
    ensureLiveSession: async () => session,
    reactivateWithSeedMessages: async () => session,
    activateSessionRuntime: async () => session,
    markProductHistoryInjected: (): void => undefined,
    protectRuntime: (): boolean => true,
    releaseRuntimeProtection: (): void => undefined,
    resolveAutoCompaction: async () => ({ enabled: true, source: 'test', globalDefault: true }),
    buildModelPromptInput: async (input) => input,
    validatePromptAttachments: () => undefined,
    runWithContext: (_runId, operation): void => {
      void operation();
    },
    getForegroundRun: (sessionId) => registry.getForegroundRun(sessionId),
    registerForegroundRun: (sessionId, resumeCheckpointId) =>
      registry.createForegroundRun(sessionId, undefined, resumeCheckpointId),
    replaceForegroundRun: (sessionId, previousRunId, resumeCheckpointId) =>
      registry.replaceForegroundRun(sessionId, previousRunId, undefined, resumeCheckpointId),
    tryReservePromptAdmission: () => true,
    releasePromptAdmission: (): void => undefined,
    isPromptAdmissionReserved: () => false,
    tryReserveSessionBody: () => true,
    releaseSessionBody: (): void => undefined,
    isSessionBodyReserved: () => false,
    joinRun: (runId) => registry.join(runId),
    getRunSignal: (runId) => registry.getSignal(runId),
    getRunAbortReason: (runId) => registry.getAbortReason(runId),
    hasRunAgentErrorEvidence: (runId) => registry.hasAgentErrorEvidence(runId),
    requestCancelRun: (_sessionId, runId, reason) =>
      runId === undefined ? undefined : registry.requestCancel(runId, reason),
    requestPauseRun: (_sessionId, runId, reason) =>
      runId === undefined ? undefined : registry.requestPause(runId, reason),
    isPauseRequested: (runId) => registry.isPauseRequested(runId),
    hasActiveDescendants: (runId) => registry.hasActiveDescendants(runId),
    getPauseInterruptedSubagentRunIds: (runId) => registry.getPauseInterruptedBatchRunIds(runId),
    attachResumeCheckpoint: (runId, checkpointId): void => {
      registry.attachResumeCheckpoint(runId, checkpointId);
    },
    getActivePauseCheckpoint: async () => undefined,
    getPauseCheckpoint: async () => undefined,
    createPauseCheckpoint: async (_sessionId, input) => ({
      ...input,
      checkpointId: input.checkpointId ?? 'test-checkpoint',
      status: 'active' as const,
    }),
    consumePauseCheckpoint: async () => false,
    clearPauseCheckpoint: async () => false,
    updateRunPhase: (runId, phase, detail): void => {
      registry.updatePhase(runId, phase, detail);
    },
    terminateRun: (_sessionId, runId, outcome, code, message, options): boolean =>
      registry.terminate(
        runId,
        outcome === 'paused' ? 'interrupted' : outcome,
        code,
        message,
        options === undefined
          ? undefined
          : {
              ...(options.agentStopReason === undefined
                ? {}
                : { agentStopReason: options.agentStopReason }),
              ...(options.failure === undefined ? {} : { failure: options.failure }),
            },
      ) !== undefined,
    settlePendingPermissionsForSession: (): void => undefined,
    settlePendingExtensionUiForSession: (): void => undefined,
    setSessionPermissionOverride: (): void => undefined,
    clearSessionPermissionOverride: (): void => undefined,
    runtimeController: new SessionRuntimeController({
      isRunInFlight: (sessionId) => registry.getForegroundRun(sessionId) !== undefined,
    }),
    cancelRuntimeReplacement: async () => undefined,
    disposeLiveSession: async () => undefined,
    quarantineSessionRuntime: (): void => undefined,
    reloadRuntime: async () => ({ generationId: 'generation-2', settingsRevision: 'rev-2' }),
    replaceRuntimeForModel: async (): Promise<void> => undefined,
    loadConfig: async () => createDefaultPiwinConfig(),
    setRunOrchestrationScheme: (_runId, _scheme): void => undefined,
    getRunOrchestrationScheme: (_runId): ResolvedOrchestrationScheme | undefined => undefined,
    listKnownSubagentProfileIds: async () => ['explorer', 'reviewer', 'implementer', 'tester'],
  };
  return { context, registry, activeRun };
}
