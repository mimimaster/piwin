/**
 * Public Pi/backend boundary.
 *
 * Product composition, settings, permissions, application services, and
 * HostRuntime live in @piwin/host-runtime. This package exposes only the
 * backend contracts and Pi/worker adapters needed by that composition root.
 */
export { mapPiSessionEvent } from './event-map.js';
export {
  assistantUsageMeasurementId,
  normalizeGenerationMessageId,
  normalizeGenerationToolCallId,
  normalizeGenerationPermissionRequestId,
  normalizeAgentEventIds,
  LEGACY_IMPORT_GENERATION,
  USER_AUTHORED_GENERATION,
} from './generation-identity.js';
export type { GenerationIdentityContext } from './generation-identity.js';
export {
  buildToolPresentation,
  classifyToolKind,
  resolvePresentedToolInvocation,
  boundToolOutput,
  redactToolText,
} from './tool-presentation.js';
export { attachPlanPresentation } from './plan-presentation.js';
export { estimateMockUsage, mapUsageSnapshot } from './usage-map.js';
export {
  enrichFromCatalog,
  getModelCatalogStatus,
  installModelCatalogSnapshot,
  lookupCatalogByModelId,
  resetModelCatalogSnapshot,
  searchPiCatalog,
  searchPiImagesCatalog,
} from './model-catalog-reader.js';
export type { ModelCatalogSnapshot } from './model-catalog-reader.js';

export { createExtensionUiContext, bindExtensionUiToPiSession } from './extension-ui-bridge.js';
export type {
  ExtensionUiBridge,
  ExtensionUiKind,
  ExtensionUiRequest,
  ExtensionUiResponse,
} from './extension-ui-bridge.js';

export {
  buildThinkingLevelMap,
  mapThinkingLevelToApi,
  mapThinkingLevelToPi,
} from './map-thinking-level.js';
export type { PiThinkingLevel, PiThinkingLevelMap } from './map-thinking-level.js';
export {
  buildPiProviderRegistration,
  resolvePiApiForProvider,
  resolvePiModelCompat,
} from './pi-model-runtime.js';
export {
  activatePiBuiltinTools,
  buildPiSessionExcludedToolNames,
  PI_NATIVE_TOOL_NAMES,
} from './pi-session-tool-selection.js';
export type { PiSessionToolSelectionInput } from './pi-session-tool-selection.js';
export type {
  PiModelRegistration,
  PiModelCompat,
  PiModelRuntime,
  PiProviderApi,
  PiProviderRegistration,
} from './pi-model-runtime.js';
export {
  createSubscriptionAuthPort,
  defaultPiAuthPaths,
  isOauthProviderAuth,
  shouldRegisterCompiledProvider,
  SUBSCRIPTION_RUNTIME_CREATE_OPTIONS,
  LIVE_CATALOG_REFRESH_TIMEOUT_MS,
} from './subscription-auth.js';
export {
  copyOauthCredential,
  deleteOauthCredential,
  hasOauthCredential,
  readOauthAccessToken,
  readAuthFileRoot,
  materializeClaudeCodeCredentialFromAnthropic,
  writeClaudeCodeApiKeyCredential,
} from './subscription-auth-credentials.js';
export {
  PIWIN_PI_AGENT_DIR_ENV,
  PIWIN_PI_AGENT_DIRNAME,
  resolvePiRuntimeAgentDir,
} from './pi-runtime-agent-dir.js';
export { installPiPackage } from './pi-package-installer.js';
export type {
  InstallPiPackageOptions,
  InstallPiPackageResult,
} from './pi-package-installer.js';
export {
  fetchSubscriptionQuota,
  resetSubscriptionQuota,
  normalizeCodexUsagePayload,
  normalizeGrokUsagePayload,
  normalizeClaudeUsagePayload,
  normalizeCopilotUsagePayload,
  normalizeKimiUsagePayload,
  readOAuthMaterialFromAuthFile,
  formatFriendlyTimeAgoOrUntil,
  deriveColorTone,
} from './subscription-quota-fetcher.js';
export type {
  HostAuthEvent,
  HostAuthInteraction,
  HostAuthPrompt,
  SubscriptionAuthPort,
  SubscriptionCatalogModel,
  SubscriptionCredentialInfo,
  SubscriptionLoginOutcome,
  SubscriptionLogoutOutcome,
} from './subscription-auth.js';
export type {
  StoredOAuthMaterial,
  FetchSubscriptionQuotaOptions,
  ResetSubscriptionQuotaOptions,
} from './subscription-quota-fetcher.js';

export {
  BLUEPRINT_PROTOCOL_VERSION,
  projectBlueprintForWorker,
  projectBackendBlueprintForWorker,
  isSerializableBlueprint,
} from './rpc/serializable-blueprint.js';
export type {
  SerializableBlueprint,
  SerializableProviderRuntime,
  SerializableWorkerProviderRuntime,
} from './rpc/serializable-blueprint.js';

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
export { buildWorkerProxyTools, buildSingleProxyTool } from './rpc/worker-proxy-tool-factory.js';
export type { ToolProxyCall } from './rpc/worker-proxy-tool-factory.js';
export {
  createPiBashToolDefinition,
  createPiLocalBashOperations,
  createPiFileToolDefinitions,
} from './pi-tool-factories.js';
export type {
  PiFileEditOperations,
  PiLocalBashOperations,
  PiFileWriteOperations,
  PiShellExecOptions,
} from './pi-tool-factories.js';

export { ARTIFACT_RUNTIME_CONTRACT, formatArtifactProtocol } from './artifact-runtime-contract.js';

export type {
  PiSessionBackend,
  BackendSessionHandle,
  CreateBackendSessionInput,
} from './backends/pi-session-backend.js';
export {
  isValidBackendSessionBlueprint,
  assertValidBackendSessionBlueprint,
} from './backends/pi-session-backend.js';
export { InProcessSdkSessionBackend } from './backends/in-process-sdk-session-backend.js';
export type { InProcessSdkSessionBackendOptions } from './backends/in-process-sdk-session-backend.js';
export { createBackendSdkSession } from './backends/sdk-backend-session.js';
export type { PiSdkBackendOptions } from './backends/sdk-backend-session.js';
export { WorkerSessionBackend } from './backends/worker-rpc-session-backend.js';
export type { WorkerSessionBackendOptions } from './backends/worker-rpc-session-backend.js';

export {
  AgentWorkerSupervisor,
  computeDefaultWorkerSettings,
  WorkerCapacityExhaustedError,
} from './agent-worker-supervisor.js';
export type {
  AgentWorkerRuntimeSettings,
  AgentWorkerSupervisorOptions,
  WorkerSupervisorStatus,
} from './agent-worker-supervisor.js';
export { WorkerTaskRunner } from './worker-task-runner.js';
export type { WorkerTaskRunnerOptions } from './worker-task-runner.js';
export type { WorkerAdmission, WorkerAdmissionPort } from './worker-admission-port.js';

export { RpcSdkWorkerClient } from './rpc-sdk-worker-client.js';
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

export {
  applyGeminiOpenAiSessionIsolation,
  geminiOpenAiPromptCacheKey,
  isGeminiOpenAiCompatModelId,
  sanitizeGeminiOpenAiMessages,
  wrapStreamSimpleForGeminiOpenAiSession,
} from './gemini-openai-session-isolation.js';
export {
  applyNativeSearchToPayload,
  normalizeNativeSearchCitations,
  providerNeedsNativeSearchWrapper,
  resolveNativeSearchEnabledForModel,
  wrapStreamSimpleForNativeSearch,
} from './native-web-search.js';
export type {
  NativeSearchModelFlags,
  NativeSearchStreamOptions,
  NativeSearchStreamSimple,
} from './native-web-search.js';
export {
  completeNativeModelWebSearch,
  NativeModelWebSearchError,
} from './native-model-web-search.js';
export type {
  NativeModelWebSearchDependencies,
  NativeModelWebSearchRequest,
} from './native-model-web-search.js';
export { completeModelText, ModelTextCompletionError } from './model-text-completion.js';
export {
  completeModelTools,
  isHttpBaseUrl,
  ModelToolsCompletionError,
} from './model-tools-completion.js';
export type {
  ModelToolsCompletionInput,
  ModelToolsCompletionResult,
} from './model-tools-completion.js';
