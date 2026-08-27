import type {
  AgentEvent,
  CreateSessionInput,
  CreateSessionOptions,
  ExecutionRunRecord,
  ExtensionDeploymentRecord,
  HostCommand,
  HostPush,
  HostResponse,
  HostStatusData,
  HostToolRegistration,
  JobController,
  McpConfigDocument,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  PromptInput,
  PushSink,
  RemoteSinkId,
  SessionHandle,
  SessionIndexRecord,
  SessionPlan,
  SessionTranscriptMessage,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
  ContextUsageSnapshot,
  SessionRuntimeRetentionConfig,
  SubagentBatchRequest,
  SubagentTaskResult,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import type { JobRegistryEvent } from '@piwin/process';
import type { PetStateStore } from './pet-state-store.js';
import type { AgentWorkerSupervisor } from '@piwin/agent-host';
import type { McpLifecycleManager } from '@piwin/mcp';
import type { SessionAllowlist } from './session-allowlist.js';
import type {
  PreparedSubagentTask,
  SubagentOrchestrator,
  SubagentTaskPreparationInput,
  SubagentTaskPreflightContext,
} from './subagent-orchestrator.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import type { createSubagentRunStore, SessionTranscriptStore } from '@piwin/session';
import type { RuntimeReplacementCandidate } from './session-runtime-replacement.js';
import type { ProductAgentHostToolRegistrationMode } from './product-agent-host.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import type { SessionLiveContext } from './commands/session-live-commands.js';
import type { WalkthroughCommandContext } from './commands/walkthrough-commands.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type {
  ComposedSessionHostTools,
  ExtensionApplyCommand,
  ExtensionDeploymentPatch,
  HostForegroundRunSnapshot,
  HostPendingPermissionSnapshot,
  HostRuntimeOptions,
  SessionLineage,
} from './host-runtime-types.js';
export type {
  HostRuntimeOptions,
  HostRuntimeTestFixture,
  HostForegroundRunSnapshot,
  HostPendingPermissionSnapshot,
} from './host-runtime-types.js';
import { initializeHostRuntime } from './host-runtime-init.js';
import { disposeHostRuntime } from './host-runtime-dispose.js';
import {
  handleCommand,
  handleCommandWithTranscriptLease,
} from './host-runtime-command-dispatch.js';
import {
  recoverInterruptedExtensionDeployments,
  blockUntilExtensionRecoverySettled,
  executeExtensionApply,
  activateExtensionApply,
  finishExtensionApplyInBackground,
  writeExtensionDeployment,
  updateExtensionDeployment,
} from './host-runtime-extension-apply.js';
import {
  trustProject,
  requestPermission,
  getOrCreateSessionAllowlist,
  rememberSessionPermission,
  clearSessionAllowlist,
  setSessionPermissionOverride,
  clearSessionPermissionOverride,
  getSessionPermissionOverride,
  waitForPermission,
  requestExtensionUi,
  settlePendingExtensionUiForSession,
  rememberProjectPermission,
} from './host-runtime-permissions.js';
import { validatePromptAttachments, buildModelPromptInput } from './host-runtime-prompt.js';
import {
  getNotesServices,
  getCardStore,
  getFolderRag,
  dispatchHooksForAgentEvent,
  runCronJob,
  createAgentWorkerSupervisor,
  cleanupAfterWorkerCrash,
  getJobController,
  emitJobEvent,
  stopProcessesForSession,
  getMcpManager,
  ensureBrowserSession,
  isRpcWorkerMode,
  ensurePetStateStore,
} from './host-runtime-services.js';
import {
  composeSubagentOrchestrator,
  whenSubagentStartupRecoveryReady,
  persistSubagentSessionStart,
  persistSubagentTaskResult,
  reconcilePersistedSubagentSessions,
  persistSubagentMerge,
  preflightSubagentTask,
} from './host-runtime-subagent.js';
import { prepareSubagentTask } from './host-runtime-subagent-prepare.js';
import {
  getSubagentSeam,
  prepareSubagentBatch,
  continueSubagentChild,
  resolveRetainedSubagentWorktreeLease,
  actOnSubagentWorktree,
} from './host-runtime-subagent-tasks.js';
import {
  buildSessionHostToolsForSession,
  composeSessionHostToolsForSession,
  clearGenerationToolSurfaces,
  clearGenerationToolSurface,
  releaseGenerationToolSurface,
  releaseGenerationToolSurfaces,
  getGenerationMcpConfig,
  getGenerationMcpCapabilityBrief,
} from './host-runtime-tool-surfaces.js';
import { createSessionLiveContext } from './host-runtime-live-context.js';
import {
  buildWalkthroughContext,
  loadSessionPlanForWalkthrough,
  buildDomainContext,
} from './host-runtime-domain-context.js';
import {
  ensureColdStorageRecovered,
  ensureRuntimeRetentionLoaded,
  applyRuntimeRetention,
  getStatus,
  hasUsableJobController,
  pushStatus,
  listForegroundRuns,
  listPendingPermissionRequests,
} from './host-runtime-status.js';
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
  getRuntimeResources,
  isSessionRuntimeProtected,
  suspendSessionRuntime,
  doSuspendSessionRuntime,
  ensureLiveSession,
  prepareDelegationRuntime,
} from './session-runtime-lifecycle.js';
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
import {
  publishHostPush,
  attachHostPushSink,
  countHostProductionPushSinks,
  detachHostPushSink,
} from './host-push-publisher.js';

import { HostRuntimeFields } from './host-runtime-fields.js';

export class HostRuntime extends HostRuntimeFields {
  constructor(options: HostRuntimeOptions) {
    super();
    initializeHostRuntime(this.asKernel(), options);
  }

  asKernel(): HostRuntimeKernel {
    return this;
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.hostClosing = true;
    this.disposePromise = disposeHostRuntime(this.asKernel());
    return this.disposePromise;
  }

  async disposeInternal(): Promise<void> {
    return disposeHostRuntime(this.asKernel());
  }

  async handleCommand(command: HostCommand): Promise<HostResponse> {
    return handleCommand(this.asKernel(), command);
  }

  async handleCommandWithTranscriptLease(command: HostCommand): Promise<HostResponse> {
    return handleCommandWithTranscriptLease(this.asKernel(), command);
  }

  async recoverInterruptedExtensionDeployments(): Promise<void> {
    return recoverInterruptedExtensionDeployments(this.asKernel());
  }

  async blockUntilExtensionRecoverySettled(
    requestId: string | undefined,
    commandType: HostCommand['type'],
  ): Promise<HostResponse | null> {
    return blockUntilExtensionRecoverySettled(this.asKernel(), requestId, commandType);
  }

  async executeExtensionApply(
    command: ExtensionApplyCommand,
    requestId: string | undefined,
  ): Promise<HostResponse> {
    return executeExtensionApply(this.asKernel(), command, requestId);
  }

  async activateExtensionApply(
    command: ExtensionApplyCommand,
    requestId: string | undefined,
    deployment: ExtensionDeploymentRecord,
    expectedSettingsRevision: string,
  ): Promise<HostResponse> {
    return activateExtensionApply(
      this.asKernel(),
      command,
      requestId,
      deployment,
      expectedSettingsRevision,
    );
  }

  async finishExtensionApplyInBackground(
    command: ExtensionApplyCommand,
    deployment: ExtensionDeploymentRecord,
    expectedSettingsRevision: string,
  ): Promise<void> {
    return finishExtensionApplyInBackground(
      this.asKernel(),
      command,
      deployment,
      expectedSettingsRevision,
    );
  }

  async writeExtensionDeployment(record: ExtensionDeploymentRecord): Promise<void> {
    return writeExtensionDeployment(this.asKernel(), record);
  }

  async updateExtensionDeployment(
    record: ExtensionDeploymentRecord,
    patch: ExtensionDeploymentPatch,
  ): Promise<ExtensionDeploymentRecord> {
    return updateExtensionDeployment(this.asKernel(), record, patch);
  }

  async trustProject(projectPath: string): Promise<unknown> {
    return trustProject(this.asKernel(), projectPath);
  }

  requestPermission(input: {
    sessionId: string;
    projectPath?: string;
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
    signal?: AbortSignal;
  }): Promise<PermissionDecision> {
    return requestPermission(this.asKernel(), input);
  }

  getOrCreateSessionAllowlist(sessionId: string): SessionAllowlist {
    return getOrCreateSessionAllowlist(this.asKernel(), sessionId);
  }

  rememberSessionPermission(sessionId: string, action: string, detail: string): void {
    return rememberSessionPermission(this.asKernel(), sessionId, action, detail);
  }

  clearSessionAllowlist(sessionId: string): void {
    return clearSessionAllowlist(this.asKernel(), sessionId);
  }

  setSessionPermissionOverride(sessionId: string, mode: PermissionMode): void {
    return setSessionPermissionOverride(this.asKernel(), sessionId, mode);
  }

  clearSessionPermissionOverride(sessionId: string): void {
    return clearSessionPermissionOverride(this.asKernel(), sessionId);
  }

  getSessionPermissionOverride(sessionId: string): PermissionMode | undefined {
    return getSessionPermissionOverride(this.asKernel(), sessionId);
  }

  waitForPermission(requestId: string): Promise<PermissionDecision> {
    return waitForPermission(this.asKernel(), requestId);
  }

  requestExtensionUi(
    input: import('@piwin/agent-host').ExtensionUiRequest & { sessionId: string },
  ): Promise<import('@piwin/agent-host').ExtensionUiResponse> {
    return requestExtensionUi(this.asKernel(), input);
  }

  settlePendingExtensionUiForSession(sessionId: string): void {
    return settlePendingExtensionUiForSession(this.asKernel(), sessionId);
  }

  async rememberProjectPermission(
    sessionId: string,
    action: string,
    detail: string,
    scope: 'project' = 'project',
    pendingProjectPath?: string,
  ): Promise<void> {
    return rememberProjectPermission(
      this.asKernel(),
      sessionId,
      action,
      detail,
      scope,
      pendingProjectPath,
    );
  }

  validatePromptAttachments(input: PromptInput): void {
    return validatePromptAttachments(this.asKernel(), input);
  }

  async buildModelPromptInput(input: PromptInput, signal?: AbortSignal): Promise<PromptInput> {
    return buildModelPromptInput(this.asKernel(), input, signal);
  }

  async getNotesServices(): Promise<{
    store: import('@piwin/notes').NoteStore;
    index: import('@piwin/notes').NoteIndex;
    searchOptions: import('@piwin/notes').SearchNotesOptions;
  }> {
    return getNotesServices(this.asKernel());
  }

  async getCardStore(): Promise<import('@piwin/flashcards').CardStore> {
    return getCardStore(this.asKernel());
  }

  async getFolderRag(): Promise<import('@piwin/doc-rag').FolderRag> {
    return getFolderRag(this.asKernel());
  }

  async dispatchHooksForAgentEvent(sessionId: string, event: AgentEvent): Promise<void> {
    return dispatchHooksForAgentEvent(this.asKernel(), sessionId, event);
  }

  async runCronJob(job: import('@piwin/contracts').CronJob): Promise<{
    ok: boolean;
    message?: string;
  }> {
    return runCronJob(this.asKernel(), job);
  }

  composeSubagentOrchestrator(): void {
    return composeSubagentOrchestrator(this.asKernel());
  }

  whenSubagentStartupRecoveryReady(): Promise<void> {
    return whenSubagentStartupRecoveryReady(this.asKernel());
  }

  createAgentWorkerSupervisor(): AgentWorkerSupervisor {
    return createAgentWorkerSupervisor(this.asKernel());
  }

  async cleanupAfterWorkerCrash(runId: string, message: string): Promise<void> {
    return cleanupAfterWorkerCrash(this.asKernel(), runId, message);
  }

  async persistSubagentSessionStart(input: {
    childSessionId: string;
    parentSessionId: string;
    runtimeGenerationId: string;
    workingDirectory: string;
    task: SubagentTaskSpec;
    workspaceLease: SubagentWorkspaceLease;
  }): Promise<void> {
    return persistSubagentSessionStart(this.asKernel(), input);
  }

  async persistSubagentTaskResult(
    parentSessionId: string,
    result: SubagentTaskResult,
  ): Promise<void> {
    return persistSubagentTaskResult(this.asKernel(), parentSessionId, result);
  }

  async reconcilePersistedSubagentSessions(
    runStore: ReturnType<typeof createSubagentRunStore>,
  ): Promise<void> {
    return reconcilePersistedSubagentSessions(this.asKernel(), runStore);
  }

  async persistSubagentMerge(
    parentSessionId: string,
    childSessionId: string,
    result: SubagentTaskResult,
    messageId: string,
  ): Promise<boolean> {
    return persistSubagentMerge(
      this.asKernel(),
      parentSessionId,
      childSessionId,
      result,
      messageId,
    );
  }

  async preflightSubagentTask(task: SubagentTaskSpec): Promise<SubagentTaskPreflightContext> {
    return preflightSubagentTask(this.asKernel(), task);
  }

  async prepareSubagentTask(input: SubagentTaskPreparationInput): Promise<PreparedSubagentTask> {
    return prepareSubagentTask(this.asKernel(), input);
  }

  getSubagentSeam(sessionId: string): SubagentRunSeam | undefined {
    return getSubagentSeam(this.asKernel(), sessionId);
  }

  async buildSessionHostToolsForSession(
    sessionId: string,
    runtimeGenerationId: string,
    model?: ModelRef,
    mode: ProductAgentHostToolRegistrationMode = 'active',
  ): Promise<HostToolRegistration[]> {
    return buildSessionHostToolsForSession(
      this.asKernel(),
      sessionId,
      runtimeGenerationId,
      model,
      mode,
    );
  }

  async composeSessionHostToolsForSession(
    sessionId: string,
    runtimeGenerationId: string,
    model?: ModelRef,
  ): Promise<ComposedSessionHostTools> {
    return composeSessionHostToolsForSession(
      this.asKernel(),
      sessionId,
      runtimeGenerationId,
      model,
    );
  }

  clearGenerationToolSurfaces(sessionId: string): void {
    return clearGenerationToolSurfaces(this.asKernel(), sessionId);
  }

  clearGenerationToolSurface(sessionId: string, runtimeGenerationId: string): void {
    return clearGenerationToolSurface(this.asKernel(), sessionId, runtimeGenerationId);
  }

  async releaseGenerationToolSurface(
    sessionId: string,
    runtimeGenerationId: string,
  ): Promise<void> {
    return releaseGenerationToolSurface(this.asKernel(), sessionId, runtimeGenerationId);
  }

  async releaseGenerationToolSurfaces(sessionId: string): Promise<void> {
    return releaseGenerationToolSurfaces(this.asKernel(), sessionId);
  }

  getGenerationMcpConfig(sessionId: string, runtimeGenerationId: string): McpConfigDocument {
    return getGenerationMcpConfig(this.asKernel(), sessionId, runtimeGenerationId);
  }

  async getGenerationMcpCapabilityBrief(
    sessionId: string,
    runtimeGenerationId: string,
  ): Promise<McpCapabilityBrief> {
    return getGenerationMcpCapabilityBrief(this.asKernel(), sessionId, runtimeGenerationId);
  }

  async prepareSubagentBatch(request: SubagentBatchRequest): Promise<SubagentBatchRequest> {
    return prepareSubagentBatch(this.asKernel(), request);
  }

  async continueSubagentChild(
    orchestrator: SubagentOrchestrator,
    childSessionId: string,
    text: string,
  ): Promise<{ runId: string }> {
    return continueSubagentChild(this.asKernel(), orchestrator, childSessionId, text);
  }

  async resolveRetainedSubagentWorktreeLease(
    child: import('@piwin/contracts').SessionIndexRecord,
  ): Promise<Extract<SubagentWorkspaceLease, { mode: 'worktree' }>> {
    return resolveRetainedSubagentWorktreeLease(this.asKernel(), child);
  }

  async actOnSubagentWorktree(
    childSessionId: string,
    action: 'apply' | 'retain' | 'discard',
  ): Promise<{ integrationStatus: import('@piwin/contracts').SubagentIntegrationStatus }> {
    return actOnSubagentWorktree(this.asKernel(), childSessionId, action);
  }

  getJobController(): JobController {
    return getJobController(this.asKernel());
  }

  emitJobEvent(event: JobRegistryEvent): void {
    return emitJobEvent(this.asKernel(), event);
  }

  async stopProcessesForSession(sessionId: string): Promise<void> {
    return stopProcessesForSession(this.asKernel(), sessionId);
  }

  getMcpManager(): McpLifecycleManager {
    return getMcpManager(this.asKernel());
  }

  async ensureBrowserSession(): Promise<import('@piwin/browser').BrowserSession> {
    return ensureBrowserSession(this.asKernel());
  }

  isRpcWorkerMode(): boolean {
    return isRpcWorkerMode(this.asKernel());
  }

  buildSessionLiveContext(): SessionLiveContext {
    return createSessionLiveContext(this.asKernel());
  }

  ensurePetStateStore(): Promise<PetStateStore> {
    return ensurePetStateStore(this.asKernel());
  }

  buildWalkthroughContext(): WalkthroughCommandContext {
    return buildWalkthroughContext(this.asKernel());
  }

  async loadSessionPlanForWalkthrough(sessionId: string): Promise<SessionPlan | null> {
    return loadSessionPlanForWalkthrough(this.asKernel(), sessionId);
  }

  async buildDomainContext(): Promise<
    import('./commands/domain-command-dispatch.js').DomainDispatchContext
  > {
    return buildDomainContext(this.asKernel());
  }

  async ensureColdStorageRecovered(): Promise<void> {
    return ensureColdStorageRecovered(this.asKernel());
  }

  async ensureRuntimeRetentionLoaded(): Promise<void> {
    return ensureRuntimeRetentionLoaded(this.asKernel());
  }

  applyRuntimeRetention(input: Partial<SessionRuntimeRetentionConfig> | undefined): void {
    return applyRuntimeRetention(this.asKernel(), input);
  }

  getStatus(): HostStatusData {
    return getStatus(this.asKernel());
  }

  hasUsableJobController(): boolean {
    return hasUsableJobController(this.asKernel());
  }

  pushStatus(): void {
    return pushStatus(this.asKernel());
  }

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

  async replaceRuntimeForModel(sessionId: string): Promise<void> {
    return replaceRuntimeForModel(this.asKernel(), sessionId);
  }

  async compileRuntimeCandidate(
    sessionId: string,
    generationId: string,
    expectedSettingsRevision: string,
  ): Promise<RuntimeReplacementCandidate> {
    return compileRuntimeCandidate(
      this.asKernel(),
      sessionId,
      generationId,
      expectedSettingsRevision,
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

  push(message: HostPush): void {
    return publishHostPush(this.asKernel(), message);
  }

  listForegroundRuns(): HostForegroundRunSnapshot[] {
    return listForegroundRuns(this.asKernel());
  }

  listPendingPermissionRequests(): HostPendingPermissionSnapshot[] {
    return listPendingPermissionRequests(this.asKernel());
  }

  attachPushSink(sink: PushSink): () => void {
    return attachHostPushSink(this.asKernel(), sink);
  }

  countProductionPushSinks(): number {
    return countHostProductionPushSinks(this.asKernel());
  }

  detachPushSink(id: RemoteSinkId): void {
    return detachHostPushSink(this.asKernel(), id);
  }
}
