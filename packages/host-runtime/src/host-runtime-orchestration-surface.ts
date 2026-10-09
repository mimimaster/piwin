import type {
  HostStatusData,
  HostToolRegistration,
  JobController,
  McpConfigDocument,
  ModelRef,
  SessionPlan,
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
import type {
  PreparedSubagentTask,
  SubagentOrchestrator,
  SubagentTaskPreparationInput,
  SubagentTaskPreflightContext,
} from './subagent-orchestrator.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import type { SubagentDeliveryPolicySource } from './subagent-delivery-policy.js';
import type { createSubagentRunStore } from '@piwin/session';
import type { ProductAgentHostToolRegistrationMode } from './product-agent-host.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import type { SessionLiveContext } from './commands/session-live-commands.js';
import type { WalkthroughCommandContext } from './commands/walkthrough-commands.js';
import type {
  ComposedSessionHostTools,
  SessionLineage,
} from './host-runtime-types.js';
import {
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
} from './host-runtime-subagent-tasks.js';
import {
  resolveRetainedSubagentWorktreeLease,
  resolveSubagentContinuationRestore,
  actOnSubagentWorktree,
  discardSubagentResult,
} from './host-runtime-subagent-worktree-results.js';
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
} from './host-runtime-status.js';
import { applyWorkerPoolSize } from './worker-pool-policy.js';
import { HostRuntimeCommandSurface } from './host-runtime-command-surface.js';

export class HostRuntimeOrchestrationSurface extends HostRuntimeCommandSurface {


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
    batchRunId: string;
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
    projectPath?: string,
  ): Promise<HostToolRegistration[]> {
    return buildSessionHostToolsForSession(
      this.asKernel(),
      sessionId,
      runtimeGenerationId,
      model,
      mode,
      projectPath,
    );
  }


  async composeSessionHostToolsForSession(
    sessionId: string,
    runtimeGenerationId: string,
    model?: ModelRef,
    projectPath?: string,
  ): Promise<ComposedSessionHostTools> {
    return composeSessionHostToolsForSession(
      this.asKernel(),
      sessionId,
      runtimeGenerationId,
      model,
      projectPath,
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


  async prepareSubagentBatch(
    request: SubagentBatchRequest,
    source: SubagentDeliveryPolicySource = 'batch',
  ): Promise<SubagentBatchRequest> {
    return prepareSubagentBatch(this.asKernel(), request, source);
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


  async resolveSubagentContinuationRestore(
    child: import('@piwin/contracts').SessionIndexRecord,
  ): Promise<{ baseCommit: string; tree: string } | undefined> {
    return resolveSubagentContinuationRestore(this.asKernel(), child);
  }


  async actOnSubagentWorktree(
    childSessionId: string,
    action: 'apply' | 'retain' | 'discard',
    signal?: AbortSignal,
    target?: { runId: string; taskId: string },
  ): Promise<import('./host-runtime-subagent-worktree-results.js').SubagentWorktreeActionResult> {
    return actOnSubagentWorktree(this.asKernel(), childSessionId, action, signal, target);
  }


  async discardSubagentResult(entry: {
    childSessionId: string;
    runId: string;
    taskId: string;
  }): Promise<import('./host-runtime-subagent-worktree-results.js').SubagentWorktreeActionResult> {
    return discardSubagentResult(this.asKernel(), entry);
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


  applyWorkerPoolSize(maxConcurrency: number | undefined): void {
    return applyWorkerPoolSize(this.asKernel(), maxConcurrency);
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

}
