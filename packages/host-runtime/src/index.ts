export type { SubagentTaskRunner } from '@piwin/contracts';
export {
  buildToolPresentation,
  classifyToolKind,
  boundToolOutput,
  redactToolText,
  estimateMockUsage,
} from '@piwin/agent-host';
export {
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
export { loadMergedPermissionRules } from './permission-rule-loader.js';
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
export {
  getPiwinRoot,
  getPiwinConfigPath,
  getPiwinMediaDir,
  getPiwinSessionMediaDir,
  getPiwinGeneralWorkspacePath,
  getPiwinLogsDir,
  getPiwinProjectsPath,
  getPiwinSessionIndexPath,
  getPiwinMcpConfigPath,
  getPiwinSkillsDir,
  getPiwinExtensionsDir,
  getPiwinPromptsDir,
  getPiwinSessionsDir,
  getPiwinSessionDir,
  getPiwinSessionTranscriptPath,
  getPiwinSessionWalkthroughDir,
  getPiwinSessionWalkthroughPath,
  getPiwinSessionWalkthroughMdPath,
} from './paths.js';
export {
  listWalkthroughs,
  loadWalkthrough,
  saveWalkthrough,
  deleteWalkthrough,
  deleteSessionWalkthroughs,
} from './walkthrough-store.js';
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
export type { HostRuntimeOptions, HostRuntimeTestFixture } from './host-runtime.js';

export {
  collectSkillPaths,
  createPiResourceLoader,
  extensionIdFromPath,
  promptIdFromPath,
} from './pi-resource-loader.js';
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
export { resolveNotesEmbeddingApiKey } from './notes-embedding-secret.js';
export { buildFlashcardTools } from './flashcard-tools.js';
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
  transitionExecutionStatus,
  transitionSummaryStatus,
  transitionIntegrationStatus,
} from './subagent-lifecycle-service.js';
export type { SubagentSpawnRequest, SubagentSpawnPlan } from './subagent-lifecycle-service.js';
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
} from './tools/host-tool-execution-router.js';
export { HostToolRegistrationError, toolFamilyIndex } from './tools/tool-family-index.js';

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
  WorktreeIntegrationInput,
  WorktreeIntegrationResult,
} from './subagent-integration-coordinator.js';
