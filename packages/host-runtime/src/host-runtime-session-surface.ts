import type {
  CreateSessionInput,
  CreateSessionOptions,
  ExecutionRunRecord,
  PromptInput,
  SessionHandle,
  SessionIndexRecord,
  SessionTranscriptMessage,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
  ContextUsageSnapshot,
} from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';
import type { RuntimeReplacementCandidate } from './session-runtime-replacement.js';
import { bindSession } from './host-runtime-bind-session.js';
import {
  resolveAutoCompaction,
  applyAutoCompactionToSession,
  promptPlanSession,
  abortPlanSession,
  touchSession,
  maybeAssignTextNameFromPrompt,
  maybeTriggerAutoName,
  requireSession,
  requireDurableSession,
  createSession,
} from './host-runtime-session-index.js';
import {
  ensureTranscriptRecorder,
  handleBackendRunInterventionEvent,
  recordUserPrompt,
  nextModelRequestOrdinal,
  loadTranscriptMessages,
  requireAvailableSessionBody,
  getTranscriptStore,
  withTranscriptStore,
  resetSessionEventState,
} from './host-runtime-transcript.js';
import {
  activateSessionRuntime,
  doActivateSessionRuntime,
  pendingColdStartGenerationId,
  refreshWorkerRssSample,
  publishWaitingResourceWhileQueued,
  isSessionRuntimeProtected,
  suspendSessionRuntime,
  doSuspendSessionRuntime,
  ensureLiveSession,
  prepareDelegationRuntime,
} from './session-runtime-lifecycle.js';
import { getRuntimeResources } from './session-runtime-resources.js';
import {
  recordUsageToLedger,
  enqueueUsageLedgerWrite,
  flushUsageLedgerWrites,
  loadSessionUsage,
  maybeEmitUsageOnMessageEnd,
} from './host-runtime-usage-ledger.js';
import {
  abortLiveSession,
  archiveSessionForMaintenance,
  tryArchiveLifecycleCandidate,
  deleteSessionForMaintenance,
  withSessionMaintenance,
  waitForSessionActivation,
  isSessionLifecycleHardBusy,
  suspendIdleSessionForLifecycleArchive,
  hasForeignRuntimeLease,
  releaseRuntimeLease,
  heartbeatRuntimeLease,
} from './host-runtime-maintenance.js';
import {
  disposeLiveSession,
  quarantineSessionRuntime,
  releaseQuarantinedRuntime,
} from './session-runtime-dispose.js';
import {
  createAdmittedForegroundRun,
  replaceRuntimeForModel,
  compileRuntimeCandidate,
  disposeRuntimeGeneration,
  createRuntimeGeneration,
  rollbackRuntimeGeneration,
  abortRuntimeGeneration,
} from './session-runtime-generation.js';
import type { SessionLineage } from './host-runtime-types.js';
import { HostRuntimeOrchestrationSurface } from './host-runtime-orchestration-surface.js';

export class HostRuntimeSessionSurface extends HostRuntimeOrchestrationSurface {


  async bindSession(
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: SessionLineage,
    bindingGenerationId?: string,
  ): Promise<void> {
    return bindSession(
      this.asKernel(),
      session,
      projectPath,
      sessionName,
      lineage,
      bindingGenerationId,
    );
  }


  async resolveAutoCompaction(sessionId: string): Promise<{
    enabled: boolean;
    source: 'session' | 'global' | 'unknown';
    globalDefault: boolean;
  }> {
    return resolveAutoCompaction(this.asKernel(), sessionId);
  }


  async applyAutoCompactionToSession(session: SessionHandle): Promise<void> {
    return applyAutoCompactionToSession(this.asKernel(), session);
  }


  async promptPlanSession(
    sessionId: string,
    text: string,
    parentRunId?: string,
  ): Promise<{ runId: string; finalAssistantMessageId: string }> {
    return promptPlanSession(this.asKernel(), sessionId, text, parentRunId);
  }


  async abortPlanSession(sessionId: string): Promise<void> {
    return abortPlanSession(this.asKernel(), sessionId);
  }


  async ensureTranscriptRecorder(
    sessionId: string,
    projectPath: string,
    runtimeGenerationId: string,
  ): Promise<void> {
    return ensureTranscriptRecorder(this.asKernel(), sessionId, projectPath, runtimeGenerationId);
  }


  async handleBackendRunInterventionEvent(
    sessionId: string,
    event: BackendRunInterventionEvent,
  ): Promise<BackendRunInterventionEventResult> {
    return handleBackendRunInterventionEvent(this.asKernel(), sessionId, event);
  }


  async recordUserPrompt(sessionId: string, input: PromptInput): Promise<void> {
    return recordUserPrompt(this.asKernel(), sessionId, input);
  }


  async nextModelRequestOrdinal(sessionId: string): Promise<number> {
    return nextModelRequestOrdinal(this.asKernel(), sessionId);
  }


  async loadTranscriptMessages(sessionId: string): Promise<SessionTranscriptMessage[]> {
    return loadTranscriptMessages(this.asKernel(), sessionId);
  }


  async requireAvailableSessionBody(sessionId: string) {
    return requireAvailableSessionBody(this.asKernel(), sessionId);
  }


  async getTranscriptStore(
    sessionId: string,
    projectPathOverride?: string,
  ): Promise<SessionTranscriptStore> {
    return getTranscriptStore(this.asKernel(), sessionId, projectPathOverride);
  }


  async withTranscriptStore<T>(
    sessionId: string,
    operation: (store: SessionTranscriptStore) => Promise<T>,
    projectPathOverride?: string,
  ): Promise<T> {
    return withTranscriptStore(this.asKernel(), sessionId, operation);
  }


  async touchSession(sessionId: string, preview: string): Promise<void> {
    return touchSession(this.asKernel(), sessionId, preview);
  }


  resetSessionEventState(sessionId: string): void {
    return resetSessionEventState(this.asKernel(), sessionId);
  }


  async maybeAssignTextNameFromPrompt(sessionId: string, text: string): Promise<void> {
    return maybeAssignTextNameFromPrompt(this.asKernel(), sessionId, text);
  }


  async maybeTriggerAutoName(sessionId: string): Promise<void> {
    return maybeTriggerAutoName(this.asKernel(), sessionId);
  }


  activateSessionRuntime(
    sessionId: string,
    runId?: string,
    signal?: AbortSignal,
    excludeSeedMessageId?: string,
  ): Promise<SessionHandle> {
    return activateSessionRuntime(this.asKernel(), sessionId, runId, signal, excludeSeedMessageId);
  }


  async doActivateSessionRuntime(
    sessionId: string,
    runId?: string,
    signal?: AbortSignal,
    excludeSeedMessageId?: string,
  ): Promise<SessionHandle> {
    return doActivateSessionRuntime(
      this.asKernel(),
      sessionId,
      runId,
      signal,
      excludeSeedMessageId,
    );
  }


  pendingColdStartGenerationId(sessionId: string): string | undefined {
    return pendingColdStartGenerationId(this.asKernel(), sessionId);
  }


  async refreshWorkerRssSample(force = false): Promise<void> {
    return refreshWorkerRssSample(this.asKernel(), force);
  }


  async publishWaitingResourceWhileQueued(runId: string): Promise<void> {
    return publishWaitingResourceWhileQueued(this.asKernel(), runId);
  }


  getRuntimeResources(): import('@piwin/contracts').HostRuntimeResourcesData {
    return getRuntimeResources(this.asKernel());
  }


  isSessionRuntimeProtected(sessionId: string): boolean {
    return isSessionRuntimeProtected(this.asKernel(), sessionId);
  }


  suspendSessionRuntime(
    sessionId: string,
    runtimeGenerationId: string,
    reason: import('@piwin/contracts').SessionRuntimeEvictionReason,
  ): Promise<boolean> {
    return suspendSessionRuntime(this.asKernel(), sessionId, runtimeGenerationId, reason);
  }


  async doSuspendSessionRuntime(
    sessionId: string,
    runtimeGenerationId: string,
    reason: import('@piwin/contracts').SessionRuntimeEvictionReason,
  ): Promise<boolean> {
    return doSuspendSessionRuntime(this.asKernel(), sessionId, runtimeGenerationId, reason);
  }


  async ensureLiveSession(sessionId: string): Promise<SessionHandle> {
    return ensureLiveSession(this.asKernel(), sessionId);
  }


  async prepareDelegationRuntime(sessionId: string, mode: 'auto' | 'disabled'): Promise<void> {
    return prepareDelegationRuntime(this.asKernel(), sessionId, mode);
  }


  async recordUsageToLedger(sessionId: string, usage: ContextUsageSnapshot): Promise<void> {
    return recordUsageToLedger(this.asKernel(), sessionId, usage);
  }


  enqueueUsageLedgerWrite(sessionId: string, usage: ContextUsageSnapshot): void {
    return enqueueUsageLedgerWrite(this.asKernel(), sessionId, usage);
  }


  async flushUsageLedgerWrites(): Promise<void> {
    return flushUsageLedgerWrites(this.asKernel());
  }


  async loadSessionUsage(sessionId: string): Promise<ContextUsageSnapshot | null> {
    return loadSessionUsage(this.asKernel(), sessionId);
  }


  async maybeEmitUsageOnMessageEnd(sessionId: string, messageId: string): Promise<void> {
    return maybeEmitUsageOnMessageEnd(this.asKernel(), sessionId, messageId);
  }


  async abortLiveSession(sessionId: string): Promise<void> {
    return abortLiveSession(this.asKernel(), sessionId);
  }


  async archiveSessionForMaintenance(sessionId: string): Promise<SessionIndexRecord | undefined> {
    return archiveSessionForMaintenance(this.asKernel(), sessionId);
  }


  async tryArchiveLifecycleCandidate(input: {
    sessionId: string;
    expectedUpdatedAt: string;
  }): Promise<
    | { status: 'archived'; record: SessionIndexRecord }
    | { status: 'busy' | 'missing' | 'already-archived' | 'changed' | 'protected' }
  > {
    return tryArchiveLifecycleCandidate(this.asKernel(), input);
  }


  async deleteSessionForMaintenance(
    sessionId: string,
  ): Promise<{ removed: SessionIndexRecord; cleanupWarning?: string } | undefined> {
    return deleteSessionForMaintenance(this.asKernel(), sessionId);
  }


  async withSessionMaintenance<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    return withSessionMaintenance(this.asKernel(), sessionId, operation);
  }


  async waitForSessionActivation(sessionId: string): Promise<void> {
    return waitForSessionActivation(this.asKernel(), sessionId);
  }


  isSessionLifecycleHardBusy(sessionId: string): boolean {
    return isSessionLifecycleHardBusy(this.asKernel(), sessionId);
  }


  async suspendIdleSessionForLifecycleArchive(
    sessionId: string,
  ): Promise<{ ok: true } | { ok: false; status: 'busy' }> {
    return suspendIdleSessionForLifecycleArchive(this.asKernel(), sessionId);
  }


  hasForeignRuntimeLease(sessionId: string): Promise<boolean> {
    return hasForeignRuntimeLease(this.asKernel(), sessionId);
  }


  releaseRuntimeLease(sessionId: string): Promise<void> {
    return releaseRuntimeLease(this.asKernel(), sessionId);
  }


  async heartbeatRuntimeLease(sessionId: string): Promise<void> {
    return heartbeatRuntimeLease(this.asKernel(), sessionId);
  }


  async disposeLiveSession(
    sessionId: string,
    reason: import('@piwin/contracts').SessionRuntimeEvictionReason = 'host-dispose',
  ): Promise<void> {
    return disposeLiveSession(this.asKernel(), sessionId, reason);
  }


  quarantineSessionRuntime(sessionId: string, runId: string): void {
    return quarantineSessionRuntime(this.asKernel(), sessionId, runId);
  }


  async releaseQuarantinedRuntime(sessionId: string, runtimeGenerationId: string): Promise<void> {
    return releaseQuarantinedRuntime(this.asKernel(), sessionId, runtimeGenerationId);
  }


  createAdmittedForegroundRun(
    sessionId: string,
    resumeCheckpointId?: string,
    replaceRunId?: string,
    options?: { deferRuntimeGeneration?: boolean },
  ): ExecutionRunRecord {
    return createAdmittedForegroundRun(
      this.asKernel(),
      sessionId,
      resumeCheckpointId,
      replaceRunId,
      options,
    );
  }


  requireSession(sessionId: string): SessionHandle {
    return requireSession(this.asKernel(), sessionId);
  }


  async requireDurableSession(sessionId: string): Promise<void> {
    return requireDurableSession(this.asKernel(), sessionId);
  }


  async createSession(
    input: CreateSessionInput,
    options: CreateSessionOptions = {},
  ): Promise<SessionHandle> {
    return createSession(this.asKernel(), input, options);
  }


  async replaceRuntimeForModel(sessionId: string, excludeSeedMessageId?: string): Promise<void> {
    return replaceRuntimeForModel(this.asKernel(), sessionId, excludeSeedMessageId);
  }


  async compileRuntimeCandidate(
    sessionId: string,
    generationId: string,
    expectedSettingsRevision: string,
    excludeSeedMessageId?: string,
  ): Promise<RuntimeReplacementCandidate> {
    return compileRuntimeCandidate(
      this.asKernel(),
      sessionId,
      generationId,
      expectedSettingsRevision,
      excludeSeedMessageId,
    );
  }


  async disposeRuntimeGeneration(sessionId: string, generationId: string): Promise<void> {
    return disposeRuntimeGeneration(this.asKernel(), sessionId, generationId);
  }


  async createRuntimeGeneration(
    sessionId: string,
    candidate: RuntimeReplacementCandidate,
  ): Promise<void> {
    return createRuntimeGeneration(this.asKernel(), sessionId, candidate);
  }


  async rollbackRuntimeGeneration(sessionId: string, generationId: string): Promise<void> {
    return rollbackRuntimeGeneration(this.asKernel(), sessionId, generationId);
  }


  async abortRuntimeGeneration(sessionId: string, generationId: string): Promise<void> {
    return abortRuntimeGeneration(this.asKernel(), sessionId, generationId);
  }

}
