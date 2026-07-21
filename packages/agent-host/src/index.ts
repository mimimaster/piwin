export { createAgentHost } from './create-host.js';
export type { CreateAgentHostOptions } from './create-host.js';
export { PiSdkAdapter } from './sdk-adapter.js';
export { PiRpcAdapter } from './rpc-adapter.js';
export type { PiRpcAdapterOptions } from './rpc-adapter.js';
export { mapPiSessionEvent } from './event-map.js';
export {
  evaluateBashPermission,
  evaluateWebPermission,
  resolveNonInteractiveDecision,
} from './permission-policy.js';
export type { PermissionEvaluation, WebPermissionAction } from './permission-policy.js';
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
} from './paths.js';
export { buildSessionTools, attachToolsToPiSession } from './session-tools.js';
export type {
  SessionToolRegistration,
  ToolPermissionGate,
  BuildSessionToolsOptions,
} from './session-tools.js';
export { createMockSessionHandle } from './mock-session.js';
export { HostRuntime } from './host-runtime.js';
export type { HostRuntimeOptions } from './host-runtime.js';

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
export {
  createExtensionUiContext,
  bindExtensionUiToPiSession,
} from './extension-ui-bridge.js';
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
