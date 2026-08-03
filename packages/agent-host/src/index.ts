export { createAgentHost } from './create-host.js';
export type { CreateAgentHostOptions } from './create-host.js';
export { PiSdkAdapter } from './sdk-adapter.js';
export { PiRpcAdapter } from './rpc-adapter.js';
export type { PiRpcAdapterOptions } from './rpc-adapter.js';
export {
  mapPiSessionEvent,
  createEventEnvelopeGenerator,
  wrapEvent,
  wrapEvents,
} from './event-map.js';
export type { WrappedAgentEvent } from './event-map.js';
export {
  buildToolPresentation,
  classifyToolKind,
  boundToolOutput,
  redactToolText,
} from './tool-presentation.js';
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
  matchSelectorGlob,
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
export { buildProcessTools } from './process-tools.js';
export type { BuildProcessToolsOptions, ProcessToolPermissionGate } from './process-tools.js';
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
export { buildSessionTools, attachToolsToPiSession } from './session-tools.js';
export type {
  SessionToolRegistration,
  ToolPermissionGate,
  BuildSessionToolsOptions,
} from './session-tools.js';
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

export { toPiCustomTool, toPiCustomTools } from './pi-tool-adapter.js';
export type { PiCustomToolDefinition } from './pi-tool-adapter.js';
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
export { createExtensionUiContext, bindExtensionUiToPiSession } from './extension-ui-bridge.js';
export type {
  ExtensionUiBridge,
  ExtensionUiRequest,
  ExtensionUiResponse,
  ExtensionUiKind,
} from './extension-ui-bridge.js';
export { createMcpSessionBridge } from './mcp-session-bridge.js';
export type { McpSessionBridge } from './mcp-session-bridge.js';

export { buildGatedBashToolDefinition } from './gated-bash-tool.js';
export type { BuildGatedBashToolOptions } from './gated-bash-tool.js';
export { buildGatedFileToolsDefinition } from './gated-file-tools.js';
export type { BuildGatedFileToolsOptions } from './gated-file-tools.js';

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
export type { CreateBrowserToolsOptions, BrowserToolPermissionGate } from './browser-tools.js';
export {
  handleBrowserCommand,
  isBrowserCommand,
  wireBrowserSessionPushes,
} from './commands/browser-commands.js';

export { createDelayedSessionHandle } from './delayed-session-fixture.js';
export type {
  DelayedSessionDelays,
  DelayedSessionOptions,
  DelayFn,
} from './delayed-session-fixture.js';
export { createTransportTimingBuffer } from './transport-timing.js';
export type {
  TransportTimingBuffer,
  TransportTimingRecord,
  TransportTimingBufferOptions,
} from './transport-timing.js';

export {
  createActiveRunRegistry,
  buildRunPhaseEvent,
  buildRunTerminalEvent,
} from './active-run.js';
export type { ActiveRun, ActiveRunRegistry } from './active-run.js';

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
  resolveSubagentCapabilitiesToTools,
  isPiToolAllowed,
  isCustomToolAllowed,
} from './subagent-capability-resolver.js';
export type { SubagentToolAllowlist } from './subagent-capability-resolver.js';
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
  SubagentTaskRunner,
  SubagentWorkspaceService,
  SubagentIntegrationPort,
  SubagentRunStorePort,
  SubagentOrchestratorOptions,
  ActiveRun as SubagentOrchestratorActiveRun,
} from './subagent-orchestrator.js';
export { createSubagentWorkspaceService } from './subagent-workspace-service.js';
export type { SubagentWorkspaceServiceOptions } from './subagent-workspace-service.js';
export { RpcSdkWorkerClient, createWorkerTaskRunner } from './rpc-sdk-worker-client.js';
export type { WorkerClientOptions } from './rpc-sdk-worker-client.js';
export { parseWorkerFrame, serializeWorkerRequest } from './rpc-sdk-worker-protocol.js';
export type {
  WorkerRequest,
  WorkerResponse,
  WorkerEvent,
  WorkerFrame,
  WorkerRequestMethod,
  WorkerRequestPayload,
  WorkerToolCallFrame,
  WorkerToolResultFrame,
  WorkerHelloFrame,
} from './rpc-sdk-worker-protocol.js';

// Phase 7 WP1: serializable blueprint + provider runtime envelope.
export {
  BLUEPRINT_PROTOCOL_VERSION,
  projectBlueprintForWorker,
  isSerializableBlueprint,
} from './rpc/serializable-blueprint.js';
export type {
  SerializableBlueprint,
  SerializableProviderRuntime,
} from './rpc/serializable-blueprint.js';

// Phase 7 WP2: parent-owned tool execution router.
export { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';
export type {
  HostToolErrorCode,
  ToolExecutionResult,
  ToolDisablePredicate,
  HostToolExecutionRouterOptions,
} from './tools/host-tool-execution-router.js';

// Phase 7 WP3: worker-side session runtime + Pi session factory.
export { WorkerSessionRuntime } from './rpc/worker-session-runtime.js';
export type {
  WorkerPiSessionLike,
  CreateWorkerPiSessionInput,
  WorkerSessionRuntimeOptions,
} from './rpc/worker-session-runtime.js';
export {
  createWorkerPiSessionFactory,
  createBlueprintResourceLoader,
  registerWorkerProviders,
  buildWorkerProviderRegistration,
} from './rpc/worker-pi-session-factory.js';
export type {
  WorkerPiSessionFactoryInput,
  WorkerPiSessionFactoryOptions,
} from './rpc/worker-pi-session-factory.js';
