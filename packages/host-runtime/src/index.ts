export type { SubagentTaskRunner } from '@piwin/contracts';
export {
  buildToolPresentation,
  classifyToolKind,
  resolvePresentedToolInvocation,
  boundToolOutput,
  redactToolText,
  estimateMockUsage,
} from '@piwin/agent-host';
export {
  actionSpawnsSubprocesses,
  createAvailableMemoryReader,
  createSystemMemoryMonitor,
  createToolResourceGate,
  evaluateShellMemoryAdmission,
  getSharedSystemMemoryMonitor,
  resetSharedSystemMemoryMonitor,
  DEFAULT_MEMORY_SAMPLE_INTERVAL_MS,
} from './system-memory.js';
export type {
  AvailableMemoryReading,
  AvailableMemorySource,
  ReadAvailableMemory,
  ShellMemoryAdmission,
  SystemMemoryMonitor,
  SystemMemoryMonitorOptions,
  ToolResourceGate,
  ToolResourceRefusal,
} from './system-memory.js';
export {
  applyModeToMatchedRule,
  evaluateBashPermission,
  evaluateFileWritePermission,
  evaluateWebPermission,
  evaluateNotesPermission,
  evaluateProcessPermission,
  resolveNonInteractiveDecision,
} from './permission-policy.js';
export type {
  PermissionEvaluation,
  WebPermissionAction,
  NotesPermissionAction,
  ProcessPermissionAction,
} from './permission-policy.js';
export {
  evaluateRules,
  findMatchingRule,
  matchBashGlob,
  matchPathGlob,
  matchHostGlob,
} from './permission-rule-engine.js';
export {
  BUNDLED_DENY,
  BUNDLED_ASK_BASH,
  BUNDLED_ASK_FILE_WRITE,
  BUNDLED_ALLOW,
  createBundledRuleSet,
} from './permission-defaults.js';
export {
  loadMergedPermissionRules,
  readUserPermissionRulesFile,
  writeUserPermissionRulesFile,
} from './permission-rule-loader.js';
export type { LoadMergedPermissionRulesInput } from './permission-rule-loader.js';
export { computePermissionRulesRevision } from './permission-rule-revision.js';
export { buildProcessTools } from './process-tools.js';
export type { BuildProcessToolsOptions } from './process-tools.js';
export {
  createDefaultPiwinConfig,
  initPiwinConfig,
  loadPiwinConfig,
  savePiwinConfig,
} from './config-store.js';
export { installExtension } from '@piwin/extensions';
export type { InstallExtensionOptions, InstallExtensionResult } from '@piwin/extensions';
export { installSkill, gitFetchCommands } from '@piwin/skills';
export type { InstallSkillOptions, InstallSkillResult } from '@piwin/skills';

export {
  getPiAgentDir,
  getPiwinPiAgentDir,
  getDefaultPiwinRoot,
  isDefaultPiwinRoot,
  getPiwinRoot,
  getPiwinConfigPath,
  getPiwinPlaywrightDir,
  applyPiwinPlaywrightBrowsersPath,
  getPiwinMediaDir,
  getPiwinSessionMediaDir,
  getPiwinGeneralWorkspacePath,
  getPiwinLogsDir,
  getPiwinProjectsPath,
  getPiwinSessionIndexPath,
  getPiwinMcpConfigPath,
  getPiwinKnowledgeDir,
  getPiwinKnowledgeBasesPath,
  getPiwinWikiDir,
  getPiwinSkillsDir,
  getPiwinExtensionsDir,
  getPiwinPromptsDir,
  getPiwinSessionsDir,
  getPiwinSessionDir,
  getPiwinSessionTranscriptPath,
  getPiwinSessionModelContextDatabasePath,
  getPiwinSessionWalkthroughDir,
  getPiwinSessionPendingBranchCalibrationPath,
  getPiwinSessionWalkthroughPath,
  getPiwinSessionWalkthroughMdPath,
} from './paths.js';
export { createRemoteProjectId, isRemoteProjectId } from './remote-project-id.js';
export {
  listInterruptedTranscriptMigrations,
  repairInterruptedTranscriptMigration,
} from './session-transcript-store-registry.js';
export type { InterruptedTranscriptMigration } from './session-transcript-store-registry.js';
export {
  listWalkthroughs,
  loadWalkthrough,
  saveWalkthrough,
  deleteWalkthrough,
  deleteSessionWalkthroughs,
} from './walkthrough-store.js';
export type { ListWalkthroughsOptions } from './walkthrough-store.js';
export { buildSessionTools } from './session-tools.js';
export type { SessionToolRegistration, BuildSessionToolsOptions } from './session-tools.js';
export { ensureGeneralWorkspace } from './general-workspace.js';
export {
  resolveSessionLocation,
  resolveSessionScopeFromInput,
  resolveListFilter,
  indexProjectPathForScope,
  scopeFromIndexRecord,
} from './session-scope.js';
export { createMockSessionHandle } from './mock-session.js';
export { HostRuntime } from './host-runtime.js';
export type {
  HostRuntimeOptions,
  HostRuntimeTestFixture,
  HostForegroundRunSnapshot,
  HostPendingPermissionSnapshot,
} from './host-runtime.js';

export {
  collectSkillPaths,
  createPiResourceLoader,
  extensionIdFromPath,
  promptIdFromPath,
} from './pi-resource-loader.js';
export { loadDiscoveredResources } from './discovered-resources.js';
export { loadPiNativeInventory } from './pi-package-inventory.js';
export { scanExtensions, collectExtensionEntryPaths } from './extension-scanner.js';
export { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
export { scanPrompts, collectPromptEntryPaths } from './prompt-scanner.js';
export { ensureBundledPromptsInstalled } from './ensure-bundled-prompts.js';
export { createExtensionUiContext, bindExtensionUiToPiSession } from '@piwin/agent-host';
export type {
  ExtensionUiBridge,
  ExtensionUiRequest,
  ExtensionUiResponse,
  ExtensionUiKind,
} from '@piwin/agent-host';
export { createProductShellSession } from './product-shell-session.js';
export type { CreateMockSessionOptions } from './mock-session.js';

export {
  validateProviders,
  validatePiwinConfig,
  sanitizeProvidersForSave,
  looksLikeRawApiKey,
} from './provider-validation.js';
export type { ProviderValidationIssue } from './provider-validation.js';
export { createSecretResolver } from './secret-resolver.js';
export type { SecretResolver, SecretResolveReport } from './secret-resolver.js';

export { buildNotesTools } from './notes-tools.js';
export type { BuildNotesToolsOptions } from './notes-tools.js';
export {
  writeNoteAndReindex,
  updateNoteAndReindex,
  deleteNoteAndReindex,
} from './notes-write-service.js';
export type { NotesWriteDeps } from './notes-write-service.js';
export { resolveNotesEmbeddingApiKey, resolveKnowledgeHttpApiKey } from './notes-embedding-secret.js';
export { buildFlashcardTools } from './flashcard-tools.js';
export { buildExtensionTools, type BuildExtensionToolsOptions } from './extension-tools.js';
export type { BuildFlashcardToolsOptions } from './flashcard-tools.js';

export {
  createBrowserToolDefinitions,
  evaluateBrowserNavigatePermission,
} from './browser-tools.js';
export type { BrowserToolDefinitionOptions } from './browser-tools.js';
export {
  handleBrowserCommand,
  isBrowserCommand,
  wireBrowserSessionPushes,
} from './commands/browser-commands.js';

export { createTransportTimingBuffer } from './transport-timing.js';
export type {
  TransportTimingBuffer,
  TransportTimingRecord,
  TransportTimingBufferOptions,
} from './transport-timing.js';

export {
  assembleSystemPrompt,
  assembleUserPrompt,
  collectWalkthroughEvidence,
  computeSourceHash,
  computeSourceHashFromBounded,
  EVIDENCE_DELIMITER_CLOSE,
  EVIDENCE_DELIMITER_OPEN,
  isMediaPathUnderMediaRoot,
  isWalkthroughEligibleMessage,
  isAutoWalkthroughEligible,
  redactAndBoundEvidence,
  WALKTHROUGH_SYSTEM_PROMPT,
} from './walkthrough-source.js';
export type {
  BoundedEvidence,
  CollectWalkthroughEvidenceOptions,
  WalkthroughEvidence,
} from './walkthrough-source.js';

export { completeWalkthrough, WalkthroughCompletionError } from './walkthrough-completion.js';
export type {
  WalkthroughCompletionDependencies,
  WalkthroughCompletionRequest,
  WalkthroughCompletionResult,
} from './walkthrough-completion.js';

export {
  handleWalkthroughList,
  handleWalkthroughGenerate,
  handleWalkthroughCancel,
  isWalkthroughCommand,
  WalkthroughGenerationRegistry,
} from './commands/walkthrough-commands.js';
export type { WalkthroughCommandContext } from './commands/walkthrough-commands.js';

// ORCH: orchestration scheme resolve helpers (contracts pure functions)
export {
  listOrchestrationSchemes,
  resolveOrchestrationScheme,
  mergeOrchestrationSchemeIntoPrompt,
  applySchemeToSubagentSpawnInput,
  BUILTIN_ULTRA_CODE_SCHEME,
  ORCHESTRATION_SCHEME_OFF_ID,
  ULTRA_CODE_SCHEME_ID,
} from '@piwin/contracts';

// ORCH: turn-scoped scheme concurrency gate
export {
  TurnScopedSchemeAdmissionGate,
  decideSchemeAdmission,
} from './orchestration-scheme-admission.js';
export type {
  SchemeAdmissionLimits,
  SchemeAdmissionSnapshot,
  SchemeAdmissionDecision,
} from './orchestration-scheme-admission.js';

// CE-SUB-PROF: subagent profile resolution
export {
  BUILTIN_SUBAGENT_PROFILES,
  BUILTIN_SUBAGENT_PROFILE_IDS,
} from './subagent-profile-defaults.js';
export {
  resolveSubagentProfiles,
  resolveSubagentProfile,
  resolveSubagentModel,
  resolveSubagentThinking,
  resolveSubagentIsolation,
  resolveSubagentCapabilities,
  resolveSubagentSkillIds,
  buildSubagentRuntimeSnapshot,
  validateProfileModel,
  validateProfileCapabilities,
} from './subagent-profile-resolver.js';
export type { ResolveProfileIssue, ResolveProfileResult } from './subagent-profile-resolver.js';
export {
  planSubagentSpawn,
  buildSubagentSeedPrompt,
  resolveSubagentChildPrompt,
  transitionExecutionStatus,
  transitionSummaryStatus,
  transitionIntegrationStatus,
} from './subagent-lifecycle-service.js';
export type { SubagentSpawnRequest, SubagentSpawnPlan } from './subagent-lifecycle-service.js';
export {
  resolveSubagentDeliveryPolicy,
  isSubagentDeliveryPolicyError,
  SUBAGENT_DELIVERY_POLICY_ERROR_CODES,
} from './subagent-delivery-policy.js';
export type {
  SubagentDeliveryPolicySource,
  ResolvedSubagentDeliveryPolicy,
  ResolveSubagentDeliveryPolicyInput,
  ResolveSubagentDeliveryPolicyResult,
} from './subagent-delivery-policy.js';
export {
  initSchedulerState,
  nextReadyBatch,
  markTaskRunning,
  markTaskSettled,
  cancelAll,
  isBatchSettled,
  deriveBatchStatus,
} from './subagent-scheduler.js';
export type { SchedulerState, SchedulerTaskStatus } from './subagent-scheduler.js';
export { SubagentOrchestrator } from './subagent-orchestrator.js';
export type {
  SubagentWorkspaceService,
  SubagentIntegrationPort,
  SubagentRunStorePort,
  SubagentOrchestratorOptions,
  SubagentTaskPreparationInput,
  PreparedSubagentTask,
  SubagentBatchHandle,
  SubagentBatchOwnerRecord,
} from './subagent-orchestrator.js';
export { createSubagentWorkspaceService } from './subagent-workspace-service.js';
export type { SubagentWorkspaceServiceOptions } from './subagent-workspace-service.js';
// Parent-owned tool execution router.
export { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';
export type {
  HostToolErrorCode,
  ToolExecutionResult,
  ToolDisablePredicate,
  HostToolExecutionRouterOptions,
  HostToolAdmissionDecision,
} from './tools/host-tool-execution-router.js';
export {
  createHostToolAdmission,
  createPermissiveToolAdmission,
  resolveHostToolAdmission,
} from './tools/tool-admission.js';
export type { HostToolAdmission, HostToolAdmissionOptions } from './tools/tool-admission.js';
export { evaluateHostToolPolicy, hostToolPolicyEvaluator } from './tools/tool-policy-evaluator.js';
export type {
  ToolPolicyDecision,
  ToolPolicyEvaluator,
  ToolPolicyOutcome,
} from './tools/tool-policy-evaluator.js';
export { createToolApprovalBroker } from './tools/tool-approval-broker.js';
export type {
  ToolApprovalBroker,
  ToolApprovalBrokerOptions,
  ToolApprovalOutcome,
} from './tools/tool-approval-broker.js';
export { HostToolRegistrationError, toolFamilyIndex } from './tools/tool-family-index.js';
export {
  ToolLoopProgressTracker,
  classifyToolLoopClass,
  createDefaultToolLoopLimits,
  fingerprintToolLoopCall,
  formatToolLoopStopMessage,
  DEFAULT_MAX_INSPECT_ONLY_TURNS,
  DEFAULT_MAX_INSPECT_STALL_ROUNDS,
  DEFAULT_MAX_TOOL_LOOP_TURNS,
} from './tools/tool-loop-progress.js';
export type {
  ToolLoopClass,
  ToolLoopDecision,
  ToolLoopLimits,
  ToolLoopObservation,
} from './tools/tool-loop-progress.js';
export { failRunForToolLoopStall } from './tools/tool-loop-breaker.js';
export { ToolInvocationLedger, fingerprintToolInvocation } from './tools/tool-invocation-ledger.js';
export { createExecutionTracker } from './turn-changes/execution-tracker.js';
export type { ExecutionTracker } from './turn-changes/execution-tracker.js';
export { createToolCapturePort, bindCaptureReceipts } from './turn-changes/tool-capture.js';
export type { ToolCapturePort } from './turn-changes/tool-capture.js';
export { createTurnChangeCoordinator, workspaceIdForRoot } from './turn-changes/coordinator.js';
export type {
  TurnChangeAttemptBinding,
  TurnChangeCoordinator,
  TurnChangeRunSource,
} from './turn-changes/coordinator.js';
export { createWorkspaceWriteGate } from './turn-changes/workspace-write-gate.js';
export type {
  WorkspaceWriteAcquireInput,
  WorkspaceWriteAcquireResult,
  WorkspaceWriteGate,
  WorkspaceWriteLease,
} from './turn-changes/workspace-write-gate.js';
export { openTurnChangeRuntime, resolveTurnChangeRuntimeRoot } from './turn-changes/runtime-wiring.js';
export type { TurnChangeRuntime } from './turn-changes/runtime-wiring.js';

// Phase 2: Structured Concurrency
export { RunRegistry } from './run-registry.js';
export type { CreateRunInput, RunRegistryOptions, CancelRunResult } from './run-registry.js';
export { createRuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
export type {
  RuntimeResourceCoordinator,
  ResourceLease,
  ResourceCoordinatorStatus,
  RuntimeResourceCoordinatorOptions,
} from './runtime-resource-coordinator.js';
export { createSubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
export type {
  SubagentIntegrationCoordinator,
  SubagentIntegrationCoordinatorOptions,
  SubagentIntegrationControl,
  WorktreeIntegrationInput,
  WorktreeIntegrationResult,
} from './subagent-integration-coordinator.js';
export type { SubagentApplyReservationPort } from './subagent-apply-reservation.js';
export {
  acquirePiwinRootLease,
  PiwinRootAlreadyOwnedError,
  PiwinRootLeaseCompromisedError,
  PiwinRootOwnershipUnknownError,
} from './piwin-root-lease.js';
export type {
  AcquirePiwinRootLeaseOptions,
  PiwinRootLease,
  PiwinRootOwner,
  PiwinRootOwnerKind,
} from './piwin-root-lease.js';
export {
  createPersistedFailure,
  HOST_INTERRUPTED_FAILURE,
  redactPersistedMessage,
} from './persisted-error-redaction.js';
export type { PersistedFailureContext } from './persisted-error-redaction.js';
export { SubscriptionQuotaService } from './subscription-quota-service.js';
export type { SubscriptionQuotaServiceOptions } from './subscription-quota-service.js';
export {
  ensureWikiInitialized,
  listWikiConcepts,
  readWikiIndex,
  appendWikiLog,
  WIKI_KNOWLEDGE_BASE_NAME,
} from './wiki-service.js';
export type { WikiConceptItem } from './wiki-service.js';
