/**
 * Phase 7: Compile a real SerializableBlueprint + SerializableProviderRuntime[]
 * from live PiwinConfig + session location + resource discovery.
 *
 * This bridges the gap between the HostRuntime's CreateSessionInput and the
 * worker backend's need for a complete blueprint. The parent adapter
 * calls this before delegating to the worker backend.
 *
 * Authority: parent owns config, trust, resource discovery, and secret
 * resolution. The worker receives only the serializable projection.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type {
  CreateSessionInput,
  ModelProviderConfig,
  PiwinConfig,
  ResourceCatalog,
  ResourceInstance,
  ResourceManifest,
  ResolvedSearchRoute,
  ResolvedSessionLocation,
  SessionCapabilitySnapshot,
  SessionScope,
  SessionToolFamily,
  SessionToolPolicy,
  ContextPolicy,
  ContextManifest,
  BackendSessionBlueprint,
  HostToolDescriptor,
  McpConfigDocument,
  EphemeralProviderSecret,
} from '@piwin/contracts';
import { modelSupportsCapability, normalizeResourceId } from '@piwin/contracts';
import { DEFAULT_AGENT_MODE_SYSTEM_PROMPT } from '@piwin/contracts';
import { listEnabledServers, loadMcpConfig } from '@piwin/mcp';
import { resolveWebConfig } from '@piwin/tools-web';
import { loadPiwinConfig } from './config-store.js';
import {
  isConversationChatSession,
  resolveSessionLocation,
  resolveAgentCwd,
} from './session-scope.js';
import { buildResourceShadowDiagnostics, createPiResourceLoader } from './pi-resource-loader.js';
import { createSecretResolver, type SecretResolver } from './secret-resolver.js';
import { getEnabledProviders, resolveDefaultModelRef } from './provider-helpers.js';
import {
  compileSessionCapabilitySnapshot,
  type CompileSnapshotInput,
} from './capabilities/session-capability-resolver.js';
import {
  projectBlueprintForWorker,
  type SerializableBlueprint,
  type SerializableProviderRuntime,
} from '@piwin/agent-host';
import { getPiAgentDir, getPiwinRoot } from './paths.js';
import { buildMcpCapabilityBrief, type McpCapabilityBrief } from './mcp-capability-brief.js';
import { formatCatalogSystemPrompt } from './tool-catalog/catalog-brief.js';
import { buildHostToolboxDescriptor } from './tool-catalog/catalog-tool.js';
import type { SessionBlueprint } from './session-blueprint.js';
import { resolveResourceActivations } from './capabilities/resource-policy-resolver.js';
import { resolveToolPolicyDetails } from './capabilities/tool-policy-resolver.js';
import {
  findReadyWebSearchDelegate,
  findConfiguredModel,
  formatSearchRouteCapabilityBrief,
  resolveNativeSearchAdapterSupport,
  resolveSearchRoute,
  shouldExposeExternalWebSearch,
} from './capabilities/search-route-resolver.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { computePermissionRulesRevision } from './permission-rule-revision.js';
import { createSettingsSnapshot } from './settings/settings-service.js';
import { discoverContextManifest } from './context-manifest-discovery.js';
import { formatResidentArtifactPrompt } from './artifact-instructions-tool.js';
import { HOST_TOOLBOX_NAME, isHostToolboxTargetFamily } from './host-toolbox.js';

export type CompiledBlueprint = {
  /** Host-owned exact decision set; never sent over the worker boundary. */
  sessionBlueprint: SessionBlueprint;
  /** Wire-oriented projection retained for diagnostics and existing callers. */
  blueprint: SerializableBlueprint;
  backendBlueprint: BackendSessionBlueprint;
  providers: SerializableProviderRuntime[];
  /** Raw provider secrets kept in memory for the isolated worker bootstrap. */
  providerSecrets?: EphemeralProviderSecret[];
  productSessionId: string;
  settingsRevision?: string;
};

export const PROVIDER_SECRET_COMPILE_ERROR_CODE =
  'provider-secret-worker-channel-required' as const;

/** Stable failure raised when a provider secret cannot cross the worker boundary safely. */
export class ProviderSecretCompileError extends Error {
  readonly code = PROVIDER_SECRET_COMPILE_ERROR_CODE;
  readonly providerId: string;

  constructor(providerId: string) {
    super(
      `Provider "${providerId}" uses apiKeyRef, but no safe worker secret channel was enabled; apiKeyRef secrets cannot cross worker JSONL.`,
    );
    this.name = 'ProviderSecretCompileError';
    this.providerId = providerId;
  }
}

export type CompileBlueprintOptions = {
  piwinRoot?: string;
  sessionId?: string;
  runtimeGenerationId?: string;
  /**
   * Permit apiKeyRef resolution into inline auth. ProductAgentHost enables
   * this only for the in-process SDK path; worker/RPC compilation leaves it
   * disabled because inline secrets must not cross worker JSONL.
   */
  allowInlineProviderSecrets?: boolean;
  /**
   * Resolve apiKeyRef through the one-shot worker bootstrap channel. The raw
   * secret is returned separately from the JSON-safe provider envelope.
   */
  allowWorkerProviderSecretBootstrap?: boolean;
  /**
   * Compile only these provider ids. This prevents unrelated configured
   * providers from failing a session that never selects them.
   */
  requiredProviderIds?: readonly string[];
  /** Override config load (tests). */
  config?: PiwinConfig;
  /** Override resource discovery (tests). */
  discoverResources?: (options: DiscoverResourcesOptions) => Promise<DiscoveredResources>;
  /** Override secret resolution for focused compiler tests. */
  secretResolver?: Pick<SecretResolver, 'resolveProviderSecret'>;
  /**
   * Concrete Host tool descriptors compiled from real executors by the
   * HostRuntime. When provided, the blueprint uses these exact descriptors
   * instead of name-only placeholders. When omitted, an empty descriptor
   * set is used (no host tools advertised).
   */
  hostToolDescriptors?: HostToolDescriptor[];
  /** Override MCP config for deterministic compilation/tests. */
  mcpConfig?: McpConfigDocument;
  /** Capability brief captured from the same frozen Host tool surface. */
  mcpCapabilityBrief?: McpCapabilityBrief;
  /** Host-local family index derived from the concrete registrations. */
  hostToolFamilyIndex?: ReadonlyMap<SessionToolFamily, readonly string[]>;
  /** Revision of the exact permission rules frozen for this generation. */
  rulesRevision?: string;
  /**
   * Resolve whether a project scope is trusted. When omitted, the compiler
   * assumes the parent has already validated trust (backward compat with
   * tests that don't exercise trust enforcement).
   */
  trustResolver?: (projectPath: string) => Promise<boolean>;
};

export type DiscoverResourcesOptions = {
  cwd: string;
  piwinRoot: string;
  scope: SessionScope;
  config: PiwinConfig;
};

export type DiscoveredResources = {
  skillPaths: string[];
  extensionPaths: string[];
  promptPaths: string[];
  catalog?: ResourceCatalog;
};

/**
 * Compile a complete SerializableBlueprint + provider envelope for the worker.
 * This is the real product path — not a transitional shim.
 */
export async function compileBlueprintForWorker(
  input: CreateSessionInput,
  options: CompileBlueprintOptions = {},
): Promise<CompiledBlueprint> {
  const config = options.config ?? (await loadPiwinConfig(options.piwinRoot));
  const mcpConfig =
    options.mcpConfig ??
    (options.config === undefined || options.piwinRoot !== undefined
      ? await loadMcpConfig(getPiwinRoot(options.piwinRoot))
      : { mcpServers: {} });
  const mcpEnabledServerIds = listEnabledServers(mcpConfig)
    .map((server) => server.id)
    .sort((left, right) => left.localeCompare(right));
  const location = await resolveSessionLocation(input, options.piwinRoot);
  const agentCwd = resolveAgentCwd(location, input.cwd);

  // Conversation fast path: pure-chat sessions split before any resource or
  // context discovery so they never pay agent preparation costs and never
  // receive implicit workspace context (Pure Chat spec §5.2).
  const plan = isConversationChatSession(input, location.scope)
    ? compileConversationPlan(input, options, { config, location })
    : await compileAgentCapabilityPlan(input, options, {
        config,
        mcpConfig,
        mcpEnabledServerIds,
        location,
        agentCwd,
      });

  return assembleCompiledBlueprint(input, options, { config, location, plan });
}

// Session classification lives in session-scope.ts so the compile path and
// the prompt path share one rule; re-exported here for existing callers.
export { isConversationChatSession };

/** Capability decisions shared by both compile paths. */
type CapabilityCompilePlan = {
  snapshot: SessionCapabilitySnapshot;
  resourceManifest: ResourceManifest;
  contextManifest: ContextManifest;
  hostToolboxTargetNames: string[];
  appendSystemPrompt?: string;
};

type AgentCompileContext = {
  config: PiwinConfig;
  mcpConfig: McpConfigDocument;
  mcpEnabledServerIds: string[];
  location: ResolvedSessionLocation;
  agentCwd: string;
};

async function compileAgentCapabilityPlan(
  input: CreateSessionInput,
  options: CompileBlueprintOptions,
  ctx: AgentCompileContext,
): Promise<CapabilityCompilePlan> {
  const { config, mcpConfig, mcpEnabledServerIds, location, agentCwd } = ctx;

  // Discover resource paths (same logic as SDK adapter).
  const resources = options.discoverResources
    ? await options.discoverResources({
        cwd: agentCwd,
        piwinRoot: options.piwinRoot ?? '',
        scope: location.scope,
        config,
      })
    : await discoverResourcesDefault({
        cwd: agentCwd,
        piwinRoot: options.piwinRoot ?? '',
        scope: location.scope,
        config,
      });

  // Resolve trust from the project store when a resolver is provided.
  // When no resolver is given, assume trusted (backward compat — tests
  // that don't exercise trust enforcement get the old behavior).
  let projectTrusted = true;
  if (location.scope.kind === 'project' && options.trustResolver) {
    projectTrusted = await options.trustResolver(location.scope.projectPath);
  }
  const trust: SessionCapabilitySnapshot['trust'] =
    location.scope.kind === 'project'
      ? {
          kind: 'project',
          projectPath: location.scope.projectPath,
          trusted: projectTrusted,
        }
      : { kind: 'general' };

  // Resolve tool policy from config + scope. When the parent provides
  // concrete descriptors, pass their names so the compiler can intersect
  // intersect customToolNames with the actual composed executor names.
  const composedToolNames = options.hostToolDescriptors
    ? options.hostToolDescriptors.map((d) => d.name)
    : undefined;

  // Resolve tool policy from config + scope. Pass the resolved trust so
  // untrusted projects cannot compile write/process/bash/delegate tools.
  const compiledTools = compileToolPolicy(
    config,
    input,
    options.hostToolDescriptors,
    composedToolNames,
    projectTrusted,
    mcpEnabledServerIds,
    options.hostToolFamilyIndex,
    options.mcpCapabilityBrief,
  );
  const tools = compiledTools.tools;
  const searchRoute = compiledTools.searchRoute;
  const hostToolboxTargetNames = compiledTools.hostToolboxTargetNames;

  const resourceResolution = resolveResourceActivations({
    catalog: resources.catalog ?? buildFallbackResourceCatalog(resources),
    disabledIdsByKind: {
      skill: normalizeDisabledResourceIds(config.skills?.disabledIds ?? []),
      extension: normalizeDisabledResourceIds(config.extensions?.disabledIds ?? []),
      prompt: normalizeDisabledResourceIds(config.prompts?.disabledIds ?? []),
    },
    familyDisabled: {},
    projectTrusted: location.scope.kind === 'project' && projectTrusted,
  });
  const resourceManifest = buildResourceManifest(
    resourceResolution.activeEntries,
    resourceResolution.catalog,
  );
  const resourcePolicy = resourceResolution.policy;

  // Build context policy + manifest.
  const contextPolicy: ContextPolicy = {
    allowPiNativeInstructions: true,
    allowProjectAgentsFiles: location.scope.kind === 'project' && projectTrusted,
    allowProjectSystemPrompts: location.scope.kind === 'project' && projectTrusted,
  };
  const contextManifest = await discoverContextManifest({
    scope: location.scope,
    workingDirectory: agentCwd,
    agentDir: getPiAgentDir(),
    policy: contextPolicy,
  });

  // Compute content-based revisions from actual config rather than
  // placeholder 'live' strings. This makes the snapshot id deterministic
  // and enables stale-generation detection after settings changes.
  const settingsRevision = createSettingsSnapshot(config).runtimeRevision;
  const rulesRevision =
    options.rulesRevision ?? computePermissionRulesRevision(createBundledRuleSet());
  const projectRevision = computeProjectRevision(location.scope);
  const mcpRevision = computeMcpRevision(mcpConfig);
  const resourceCatalogRevision = computeResourceRevision(resourceResolution.catalog);
  const extensionSetRevision = computeExtensionSetRevision(resourceResolution.activeEntries);

  const compileInput: CompileSnapshotInput = {
    inputs: {
      rulesRevision,
      settingsRevision,
      projectRevision,
      mcpRevision,
      resourceCatalogRevision,
      extensionSetRevision,
    },
    scope: location.scope,
    workingDirectory: location.workingDirectory,
    trust,
    resources: resourcePolicy,
    resourceManifest,
    context: contextPolicy,
    contextManifest,
    tools,
    searchRoute,
  };

  const snapshot = compileSessionCapabilitySnapshot(compileInput);

  // Keep only a compact routing hint resident. The full configurable decision
  // policy + runtime contract is loaded through artifact_instructions on demand.
  const artifactAppendPrompt = formatResidentArtifactPrompt(
    config.artifact,
    snapshot.tools.hostTools,
  );

  // MCP guidance is part of the model-visible contract only when the compiled
  // Host surface includes the catalog shell and the MCP family is enabled.
  const hasMcpCatalog =
    snapshot.tools.enabledFamilies.includes('mcp') &&
    snapshot.tools.hostTools.some((tool) => tool.name === HOST_TOOLBOX_NAME);
  const mcpAppendPrompt = hasMcpCatalog
    ? formatCatalogSystemPrompt(
        options.mcpCapabilityBrief ??
          buildMcpCapabilityBrief({
            config: mcpConfig,
            cachedToolsByServer: {},
            directExposedNames: snapshot.tools.hostTools
              .filter((tool) => tool.name.startsWith('mcp__'))
              .map((tool) => tool.name),
          }),
      )
    : undefined;
  const searchRouteAppendPrompt = formatSearchRouteCapabilityBrief(searchRoute);

  const appendSystemPromptParts = [
    DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    artifactAppendPrompt,
    mcpAppendPrompt,
    searchRouteAppendPrompt,
  ].filter((prompt): prompt is string => prompt !== undefined && prompt.trim().length > 0);
  const appendSystemPrompt =
    appendSystemPromptParts.length > 0 ? appendSystemPromptParts.join('\n\n') : undefined;

  return {
    snapshot,
    resourceManifest,
    contextManifest,
    hostToolboxTargetNames,
    ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
  };
}

/**
 * Shared tail for both compile paths: provider envelope + wire projections.
 * Conversation and Agent sessions differ only in their capability plan, never
 * in session identity, provider handling, or backend blueprint structure.
 */
async function assembleCompiledBlueprint(
  input: CreateSessionInput,
  options: CompileBlueprintOptions,
  ctx: {
    config: PiwinConfig;
    location: ResolvedSessionLocation;
    plan: CapabilityCompilePlan;
  },
): Promise<CompiledBlueprint> {
  const { config, location, plan } = ctx;
  const settingsRevision = createSettingsSnapshot(config).runtimeRevision;
  const model = input.model
    ? { providerId: input.model.providerId, modelId: input.model.modelId }
    : undefined;

  const blueprint = projectBlueprintForWorker(plan.snapshot, {
    ...(input.model
      ? { model: { providerId: input.model.providerId, modelId: input.model.modelId } }
      : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(plan.appendSystemPrompt ? { appendSystemPrompt: plan.appendSystemPrompt } : {}),
  });

  // Build provider envelope from live config.
  const defaultModel = resolveDefaultModelRef(config);
  const requiredProviderIds =
    options.requiredProviderIds ??
    (input.model ? [input.model.providerId] : defaultModel ? [defaultModel.providerId] : undefined);
  const providerEnvelope = await buildProviderEnvelope(config, {
    allowInlineProviderSecrets: options.allowInlineProviderSecrets === true,
    allowWorkerProviderSecretBootstrap: options.allowWorkerProviderSecretBootstrap === true,
    ...(requiredProviderIds ? { requiredProviderIds } : {}),
    ...(options.secretResolver ? { secretResolver: options.secretResolver } : {}),
  });
  const providers = providerEnvelope.providers;

  const productSessionId = options.sessionId ?? randomUUID();
  const backendBlueprint: BackendSessionBlueprint = {
    version: 1,
    sessionId: productSessionId,
    runtimeGenerationId: options.runtimeGenerationId ?? `generation-${randomUUID()}`,
    capabilitySnapshot: plan.snapshot,
    ...(model ? { model: input.model } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(plan.appendSystemPrompt ? { appendSystemPrompt: plan.appendSystemPrompt } : {}),
  };

  const sessionBlueprint: SessionBlueprint = {
    sessionId: productSessionId,
    runtimeGenerationId: backendBlueprint.runtimeGenerationId,
    scope: location.scope,
    workingDirectory: location.workingDirectory,
    capabilitySnapshot: plan.snapshot,
    resourceManifest: plan.resourceManifest,
    contextManifest: plan.contextManifest,
    hostToolDescriptors: [...plan.snapshot.tools.hostTools],
    hostToolboxTargetNames: plan.hostToolboxTargetNames,
    backendBlueprint,
  };

  return {
    sessionBlueprint,
    blueprint,
    backendBlueprint,
    providers,
    ...(providerEnvelope.providerSecrets.length > 0
      ? { providerSecrets: providerEnvelope.providerSecrets }
      : {}),
    productSessionId,
    ...(settingsRevision ? { settingsRevision } : {}),
  };
}

/** Compute a revision from MCP server configuration. */
function computeMcpRevision(document: McpConfigDocument): string {
  const payload = JSON.stringify(document);
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** Toolbox target families a pure-chat session may route to (spec §7.1). */
const CONVERSATION_TOOLBOX_FAMILIES: ReadonlySet<SessionToolFamily> = new Set([
  'flashcards-read',
  'flashcards-write',
  'image-generation',
  'video-generation',
]);

const CONVERSATION_CHAT_SYSTEM_PROMPT = `## Piwin Chat operating contract

You are Piwin Chat, a general-purpose conversational assistant. Answer the user directly.
Do not assume access to project or workspace files or state. Treat only content the user explicitly attached, referenced, or provided as external context.
Use the available web or creation capabilities when they genuinely help, and present the result to the user rather than the internal tool mechanics.`;

/** Resident system contract for pure-chat sessions: identity + boundary + routing. */
export function formatConversationSystemPrompt(): string {
  return CONVERSATION_CHAT_SYSTEM_PROMPT;
}

/**
 * Pure-chat compile path (spec §5). Runs no resource or context discovery and
 * builds an explicitly empty resource/context surface instead of scanning and
 * filtering results.
 */
function compileConversationPlan(
  input: CreateSessionInput,
  options: CompileBlueprintOptions,
  ctx: {
    config: PiwinConfig;
    location: ResolvedSessionLocation;
  },
): CapabilityCompilePlan {
  const { config, location } = ctx;

  const contextPolicy: ContextPolicy = {
    allowPiNativeInstructions: false,
    allowProjectAgentsFiles: false,
    allowProjectSystemPrompts: false,
  };
  const resourceManifest: ResourceManifest = {
    skills: [],
    extensions: [],
    prompts: [],
    diagnostics: [],
  };
  const contextManifest: ContextManifest = { agentsFiles: [] };

  // Resolve the resource policy from an explicitly empty catalog. The
  // resolver is pure — no scanner runs — and yields a coherent empty policy.
  const emptyCatalog: ResourceCatalog = { version: 1, entries: [], diagnostics: [] };
  const resourcePolicy = resolveResourceActivations({
    catalog: emptyCatalog,
    disabledIdsByKind: { skill: [], extension: [], prompt: [] },
    familyDisabled: {},
    projectTrusted: false,
  }).policy;

  const compiledTools = compileConversationToolPolicy(config, input, options);
  const tools = compiledTools.tools;
  const searchRoute = compiledTools.searchRoute;
  const hostToolboxTargetNames = compiledTools.hostToolboxTargetNames;

  // Snapshot identity stays deterministic: MCP and resource revisions are
  // stable hashes of empty inputs because those surfaces cannot change a
  // conversation's capabilities.
  const settingsRevision = createSettingsSnapshot(config).runtimeRevision;
  const rulesRevision =
    options.rulesRevision ?? computePermissionRulesRevision(createBundledRuleSet());
  const snapshot = compileSessionCapabilitySnapshot({
    inputs: {
      rulesRevision,
      settingsRevision,
      projectRevision: computeProjectRevision(location.scope),
      mcpRevision: computeMcpRevision({ mcpServers: {} }),
      resourceCatalogRevision: computeResourceRevision(emptyCatalog),
      extensionSetRevision: computeExtensionSetRevision([]),
    },
    scope: location.scope,
    workingDirectory: location.workingDirectory,
    trust: { kind: 'general' },
    resources: resourcePolicy,
    resourceManifest,
    context: contextPolicy,
    contextManifest,
    tools,
    searchRoute,
  });

  // Keep only a compact routing hint resident. The full configurable decision
  // policy + runtime contract is loaded through artifact_instructions on demand.
  const artifactAppendPrompt = formatResidentArtifactPrompt(
    config.artifact,
    snapshot.tools.hostTools,
  );
  const searchRouteAppendPrompt = formatSearchRouteCapabilityBrief(searchRoute);

  const appendSystemPromptParts = [
    formatConversationSystemPrompt(),
    artifactAppendPrompt,
    searchRouteAppendPrompt,
  ].filter((prompt): prompt is string => prompt !== undefined && prompt.trim().length > 0);
  const appendSystemPrompt =
    appendSystemPromptParts.length > 0 ? appendSystemPromptParts.join('\n\n') : undefined;

  return {
    snapshot,
    resourceManifest,
    contextManifest,
    hostToolboxTargetNames,
    ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
  };
}

/**
 * Conversation tool policy: web/artifact/toolbox-routable creation families
 * only. Availability still flows through the shared resolver intersected with
 * the concrete registration index, so no second availability rule exists.
 */
function projectModelHostTools(
  effectiveToolNames: readonly string[],
  hostToolDescriptors: readonly HostToolDescriptor[] | undefined,
  hostToolboxTargetNames: readonly string[],
  mcpBrief?: McpCapabilityBrief,
): HostToolDescriptor[] {
  const toolboxPresent = effectiveToolNames.includes(HOST_TOOLBOX_NAME);
  const hiddenBehindToolbox = toolboxPresent ? new Set(hostToolboxTargetNames) : new Set<string>();
  const modelVisibleToolNames = effectiveToolNames.filter((name) => !hiddenBehindToolbox.has(name));
  return buildHostToolsForPolicy(modelVisibleToolNames, hostToolDescriptors).map((descriptor) =>
    descriptor.name === HOST_TOOLBOX_NAME
      ? buildHostToolboxDescriptor(hostToolboxTargetNames, mcpBrief)
      : descriptor,
  );
}

function compileConversationToolPolicy(
  config: PiwinConfig,
  input: CreateSessionInput,
  options: CompileBlueprintOptions,
): {
  tools: SessionToolPolicy;
  searchRoute: ResolvedSearchRoute;
  hostToolboxTargetNames: string[];
} {
  const resolvedWebConfig = config.web ? resolveWebConfig(config.web) : undefined;
  const configuredModel = findConfiguredModel(config, input.model);
  const searchRoute = resolveSearchRoute({
    model: configuredModel?.model ?? null,
    web: resolvedWebConfig ?? config.web,
    adapter: resolveNativeSearchAdapterSupport(
      configuredModel?.provider.protocol,
      configuredModel?.model.nativeSearchAdapter,
    ),
    externalDelegateReady: Boolean(findReadyWebSearchDelegate(config)),
  });
  const webSearchReady = shouldExposeExternalWebSearch(searchRoute);
  const webFetchReady = resolvedWebConfig !== undefined;
  const imagegenDisabled = config.skills?.disabledIds?.includes('imagegen') ?? false;
  const videogenDisabled = config.skills?.disabledIds?.includes('videogen') ?? false;
  const flashcardsEnabled = config.flashcards?.enabled !== false;
  const flashcardsAccess =
    input.presentation?.kind === 'doccard-sequence'
      ? 'agent-read'
      : flashcardsEnabled
        ? 'agent-create'
        : 'off';

  const resolvedToolPolicy = resolveToolPolicyDetails({
    webSearch: webSearchReady,
    webFetch: webFetchReady,
    mcp: false,
    imageGeneration: !imagegenDisabled,
    videoGeneration: !videogenDisabled,
    process: 'off',
    browser: 'off',
    subagents: 'off',
    notes: 'off',
    flashcards: flashcardsAccess,
    artifact: config.artifact.enabled,
    availability: {
      webSearchReady,
      webFetchReady,
      mcpEnabledServerIds: [],
      processReady: false,
      browserReady: false,
      imageGenerationReady: true,
      videoGenerationReady: true,
    },
    filesystemRead: false,
    filesystemWrite: false,
    shell: false,
    planning: false,
    delegate: false,
    notesEnabled: false,
    flashcardsEnabled: flashcardsEnabled && flashcardsAccess !== 'off',
    imageGenerationEnabled: !imagegenDisabled,
    videoGenerationEnabled: !videogenDisabled,
    ...(options.hostToolFamilyIndex
      ? { availableFamilies: new Set(options.hostToolFamilyIndex.keys()) }
      : {}),
  });

  const resolvedPolicy = resolvedToolPolicy.policy;
  const hostToolFamilyIndex = options.hostToolFamilyIndex;
  const customToolNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies.flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
    : resolvedToolPolicy.customToolNames;
  const composedToolNames = options.hostToolDescriptors?.map((descriptor) => descriptor.name);
  const effectiveToolNames = composedToolNames
    ? customToolNames.filter((name) => composedToolNames.includes(name))
    : customToolNames;

  const hostToolboxTargetNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies
        .filter((family) => CONVERSATION_TOOLBOX_FAMILIES.has(family))
        .flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
        .sort()
    : [];
  const modelHostTools = projectModelHostTools(
    effectiveToolNames,
    options.hostToolDescriptors,
    hostToolboxTargetNames,
  );

  return {
    tools: {
      enabledFamilies: resolvedPolicy.enabledFamilies,
      piBuiltinToolNames: resolvedPolicy.piBuiltinToolNames,
      hostTools: modelHostTools,
      enabledMcpServerIds: [],
    },
    searchRoute,
    hostToolboxTargetNames,
  };
}

function computeProjectRevision(scope: SessionScope): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0, 12);
}

/** Compute a revision from the resource catalog before activation filtering. */
function computeResourceRevision(catalog: ResourceCatalog): string {
  const payload = JSON.stringify({
    entries: [...catalog.entries].sort((left, right) =>
      `${left.kind}:${left.resourceId}:${left.path}:${left.contentRevision ?? ''}`.localeCompare(
        `${right.kind}:${right.resourceId}:${right.path}:${right.contentRevision ?? ''}`,
      ),
    ),
    diagnostics: catalog.diagnostics,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** Compute the exact active Pi Extension revision set identity. */
function computeExtensionSetRevision(
  entries: readonly ResourceCatalog['entries'][number][],
): string {
  const payload = entries
    .filter((entry) => entry.kind === 'extension')
    .map((entry) => ({
      resourceId: entry.resourceId,
      path: entry.path,
      contentRevision: entry.contentRevision ?? null,
    }))
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

/**
 * Discover skill/extension/prompt paths using the same logic as the SDK adapter.
 * Returns only the paths (not the Pi ResourceLoader) for the worker.
 */
async function discoverResourcesDefault(
  options: DiscoverResourcesOptions,
): Promise<DiscoveredResources> {
  const extraSkillPaths = options.config.skills?.extraPaths ?? [];
  const disabledSkillIds = options.config.skills?.disabledIds ?? [];
  const extraExtensionPaths = options.config.extensions?.extraPaths ?? [];
  const disabledExtensionIds = options.config.extensions?.disabledIds ?? [];
  const extraPromptPaths = options.config.prompts?.extraPaths ?? [];
  const disabledPromptIds = options.config.prompts?.disabledIds ?? [];

  const { skillPaths, extensionPaths, promptPaths, resourceCatalog } = await createPiResourceLoader(
    {
      cwd: options.cwd,
      agentDir: getPiAgentDir(),
      piwinRoot: options.piwinRoot,
      scope: options.scope,
      ...(options.scope.kind === 'project' ? { projectPath: options.scope.projectPath } : {}),
      ...(extraSkillPaths.length > 0 ? { extraSkillPaths } : {}),
      ...(disabledSkillIds.length > 0 ? { disabledSkillIds } : {}),
      ...(extraExtensionPaths.length > 0 ? { extraExtensionPaths } : {}),
      ...(disabledExtensionIds.length > 0 ? { disabledExtensionIds } : {}),
      ...(extraPromptPaths.length > 0 ? { extraPromptPaths } : {}),
      ...(disabledPromptIds.length > 0 ? { disabledPromptIds } : {}),
    },
  );

  return { skillPaths, extensionPaths, promptPaths, catalog: resourceCatalog };
}

/**
 * Build tool policy from config + scope.
 * Maps product capability exposure to exact tool families + custom tool names.
 */
function compileToolPolicy(
  config: PiwinConfig,
  input: CreateSessionInput,
  hostToolDescriptors?: readonly HostToolDescriptor[],
  toolNamesFromComposed?: readonly string[],
  trusted?: boolean,
  mcpEnabledServerIds: readonly string[] = [],
  hostToolFamilyIndex?: ReadonlyMap<SessionToolFamily, readonly string[]>,
  mcpBrief?: McpCapabilityBrief,
): {
  tools: SessionToolPolicy;
  searchRoute: import('@piwin/contracts').ResolvedSearchRoute;
  hostToolboxTargetNames: string[];
} {
  // SIDE §6.1: Side Chat compiles a fixed read-only tool profile. It is a
  // product-level session kind, not a subagent capability ceiling, and can
  // never gain write/execute/planning/delegate tools even under a yolo
  // permission preset.
  if (input.sessionKind === 'side-chat') {
    const sideChatTools = buildSideChatToolPolicy(
      config,
      hostToolDescriptors,
      toolNamesFromComposed,
    );
    const configured = findConfiguredModel(config, input.model);
    const searchRoute = resolveSearchRoute({
      model: configured?.model ?? null,
      web: config.web,
      adapter: resolveNativeSearchAdapterSupport(
        configured?.provider.protocol,
        configured?.model.nativeSearchAdapter,
      ),
      externalDelegateReady: Boolean(findReadyWebSearchDelegate(config)),
      // Side chat follows the explicit external-only policy.
      policy: 'external-only',
    });
    const tools = shouldExposeExternalWebSearch(searchRoute)
      ? sideChatTools
      : omitExternalWebSearch(sideChatTools);
    return { tools, searchRoute, hostToolboxTargetNames: [] };
  }
  const capabilityCeiling = input.subagent?.capabilities;

  const resolvedWebConfig = config.web ? resolveWebConfig(config.web) : undefined;
  const configuredModel = findConfiguredModel(config, input.model);
  const searchRoute = resolveSearchRoute({
    model: configuredModel?.model ?? null,
    web: resolvedWebConfig ?? config.web,
    adapter: resolveNativeSearchAdapterSupport(
      configuredModel?.provider.protocol,
      configuredModel?.model.nativeSearchAdapter,
    ),
    externalDelegateReady: Boolean(findReadyWebSearchDelegate(config)),
  });
  // External Host web_search is ready only when the resolved route selected it.
  // Native-selected generations must not advertise the competing tool family.
  const webSearchReady = shouldExposeExternalWebSearch(searchRoute);
  const webFetchReady = resolvedWebConfig !== undefined;
  const imagegenDisabled = config.skills?.disabledIds?.includes('imagegen') ?? false;
  const videogenDisabled = config.skills?.disabledIds?.includes('videogen') ?? false;

  const resolvedToolPolicy = resolveToolPolicyDetails({
    webSearch: webSearchReady,
    webFetch: resolvedWebConfig !== undefined,
    mcp: true,
    imageGeneration: !imagegenDisabled,
    process: 'agent',
    browser: 'agent',
    subagents: 'agent',
    notes: config.notes?.enabled === false ? 'off' : 'agent-read-write',
    flashcards:
      input.presentation?.kind === 'doccard-sequence'
        ? 'agent-read'
        : config.flashcards?.enabled === false
          ? 'off'
          : 'agent-create',
    artifact: config.artifact.enabled,
    availability: {
      webSearchReady,
      webFetchReady,
      mcpEnabledServerIds: [...mcpEnabledServerIds],
      processReady: config.process?.enabled !== false,
      // Browser and image generation readiness are intersected with the
      // concrete registration index below. The resolver remains pure and
      // does not instantiate either backend.
      browserReady: true,
      imageGenerationReady: true,
      videoGenerationReady: true,
    },
    readonly: input.subagent?.mode === 'readonly',
    ...(capabilityCeiling ? { capabilities: capabilityCeiling } : {}),
    ...(trusted !== undefined ? { trusted } : {}),
    ...(hostToolFamilyIndex ? { availableFamilies: new Set(hostToolFamilyIndex.keys()) } : {}),
    filesystemRead: capabilityCeiling === undefined || capabilityCeiling.includes('read'),
    filesystemWrite: capabilityCeiling === undefined || capabilityCeiling.includes('write'),
    shell: true,
    planning: true,
    delegate: true,
    notesEnabled: capabilityCeiling === undefined && config.notes?.enabled !== false,
    flashcardsEnabled: capabilityCeiling === undefined && config.flashcards?.enabled !== false,
    imageGenerationEnabled: capabilityCeiling === undefined && !imagegenDisabled,
    videoGeneration: !videogenDisabled,
    videoGenerationEnabled: capabilityCeiling === undefined && !videogenDisabled,
  });

  const resolvedPolicy = resolvedToolPolicy.policy;
  const customToolNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies.flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
    : resolvedToolPolicy.customToolNames;

  // Only expose Pi's non-mutating inspection tools to the worker. Product
  // filesystem writes are Host-owned tools and must never use Pi-native edit
  // or write capabilities in the worker.
  const piBuiltinToolNames = resolvedPolicy.piBuiltinToolNames;

  // When the parent provides the composed tool names (the single source of
  // truth from buildSessionHostTools), intersect customToolNames with them.
  // This ensures the blueprint never advertises a tool without a concrete
  // executor (invariant 5). When not provided (test/legacy path), the
  // descriptor filter in buildHostToolsForPolicy still removes names without
  // a matching descriptor.
  const familyDerivedToolNames = customToolNames;
  const effectiveToolNames = toolNamesFromComposed
    ? familyDerivedToolNames.filter((name) => toolNamesFromComposed.includes(name))
    : familyDerivedToolNames;
  const hostToolboxTargetNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies
        .filter(isHostToolboxTargetFamily)
        .flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
        .sort()
    : [];
  const modelHostTools = projectModelHostTools(
    effectiveToolNames,
    hostToolDescriptors,
    hostToolboxTargetNames,
    resolvedPolicy.enabledFamilies.includes('mcp') ? mcpBrief : undefined,
  );

  return {
    tools: {
      enabledFamilies: resolvedPolicy.enabledFamilies,
      piBuiltinToolNames,
      hostTools: modelHostTools,
      enabledMcpServerIds: [...mcpEnabledServerIds],
    },
    searchRoute,
    hostToolboxTargetNames,
  };
}

function omitExternalWebSearch(policy: SessionToolPolicy): SessionToolPolicy {
  return {
    ...policy,
    enabledFamilies: policy.enabledFamilies.filter((family) => family !== 'web-search'),
    hostTools: policy.hostTools.filter((tool) => tool.name !== 'web_search'),
  };
}

/**
 * SIDE §6.1: exact read-only tool profile for Side Chat sessions.
 *
 * The manifest carries only the Pi built-in read family plus the product
 * filesystem-read host tools. Optional web-search/web-fetch are enabled only
 * when the product web config is on. Write, shell, process, browser, MCP,
 * planning, delegate, notes/flashcard writes, and image generation are
 * explicitly absent — no permission preset can widen this set.
 */
function buildSideChatToolPolicy(
  config: PiwinConfig,
  hostToolDescriptors?: readonly HostToolDescriptor[],
  toolNamesFromComposed?: readonly string[],
): SessionToolPolicy {
  const enabledFamilies: SessionToolFamily[] = ['filesystem-read'];
  const customToolNames: string[] = ['read_file', 'list_directory'];

  // Optional P1: web search/fetch gated by the product web config.
  if (config.web) {
    enabledFamilies.push('web-search', 'web-fetch');
    customToolNames.push('web_search', 'web_fetch');
  }

  const effectiveToolNames = toolNamesFromComposed
    ? customToolNames.filter((name) => toolNamesFromComposed.includes(name))
    : customToolNames;

  return {
    enabledFamilies,
    piBuiltinToolNames: ['read', 'grep', 'find', 'ls'],
    hostTools: buildHostToolsForPolicy(effectiveToolNames, hostToolDescriptors),
    enabledMcpServerIds: [],
  };
}

/**
 * Produce the final HostToolDescriptor[] for the tool policy.
 *
 * When concrete descriptors are provided (from buildSessionHostTools),
 * filter to only those that have a matching executor — a tool name without
 * an executor must not appear in the manifest.
 *
 * When no concrete descriptors are provided (test/legacy path), return an
 * empty array. This is fail-closed: no host tools are advertised until the
 * parent composition provides real executors.
 */
function buildHostToolsForPolicy(
  customToolNames: readonly string[],
  hostToolDescriptors?: readonly HostToolDescriptor[],
): HostToolDescriptor[] {
  if (!hostToolDescriptors || hostToolDescriptors.length === 0) {
    // Fail-closed: no concrete executors → no host tools advertised.
    return [];
  }
  const descriptorByName = new Map(
    hostToolDescriptors.map((descriptor) => [descriptor.name, descriptor]),
  );
  const selected: HostToolDescriptor[] = [];
  for (const name of customToolNames) {
    const descriptor = descriptorByName.get(name);
    if (descriptor) selected.push(descriptor);
  }
  return selected.sort((left, right) => left.name.localeCompare(right.name));
}

/** Project the resolver's active catalog entries into the worker manifest. */
function buildResourceManifest(
  activeEntries: ResourceCatalog['entries'],
  catalog: ResourceCatalog,
): ResourceManifest {
  const instances: ResourceInstance[] = activeEntries.map((entry) => ({
    resourceId: entry.resourceId,
    kind: entry.kind,
    name: entry.name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    path: entry.path,
    source: entry.source,
    ...(entry.contentRevision ? { contentRevision: entry.contentRevision } : {}),
    ...(entry.piNativeRoot !== undefined ? { piNativeRoot: entry.piNativeRoot } : {}),
  }));
  return {
    skills: instances.filter((entry) => entry.kind === 'skill'),
    extensions: instances.filter((entry) => entry.kind === 'extension'),
    prompts: instances.filter((entry) => entry.kind === 'prompt'),
    diagnostics: catalog.diagnostics,
  };
}

function buildFallbackResourceCatalog(resources: DiscoveredResources): ResourceCatalog {
  const entries = [
    ...resources.skillPaths.map((path) => fallbackResourceEntry(path, 'skill')),
    ...resources.extensionPaths.map((path) => fallbackResourceEntry(path, 'extension')),
    ...resources.promptPaths.map((path) => fallbackResourceEntry(path, 'prompt')),
  ];
  return { version: 1, entries, diagnostics: buildResourceShadowDiagnostics(entries) };
}

function fallbackResourceEntry(
  path: string,
  kind: 'skill' | 'extension' | 'prompt',
): ResourceCatalog['entries'][number] {
  return {
    resourceId: normalizeResourceId(path),
    kind,
    name: path,
    path,
    source: 'user',
  };
}

function normalizeDisabledResourceIds(ids: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const id of ids) {
    try {
      normalized.add(normalizeResourceId(id));
    } catch {
      // Invalid ids are ignored at the compiler edge; config validation owns
      // the user-facing diagnostic and the resolver remains fail-closed.
    }
  }
  return [...normalized].sort((left, right) => left.localeCompare(right));
}

/**
 * Build SerializableProviderRuntime[] from live config.
 * Env-ref auth is safe for worker mode because only the environment variable
 * name crosses the boundary. Keychain auth either stays inline for the
 * in-process SDK or is paired with an opaque id for the worker bootstrap.
 */
async function buildProviderEnvelope(
  config: PiwinConfig,
  options: {
    allowInlineProviderSecrets: boolean;
    allowWorkerProviderSecretBootstrap: boolean;
    requiredProviderIds?: readonly string[];
    secretResolver?: Pick<SecretResolver, 'resolveProviderSecret'>;
  },
): Promise<{
  providers: SerializableProviderRuntime[];
  providerSecrets: EphemeralProviderSecret[];
}> {
  const resolveProviderSecret =
    options.allowInlineProviderSecrets || options.allowWorkerProviderSecretBootstrap
      ? (options.secretResolver?.resolveProviderSecret ??
        createSecretResolver().resolveProviderSecret)
      : undefined;
  const envelope: SerializableProviderRuntime[] = [];
  const providerSecrets: EphemeralProviderSecret[] = [];

  for (const provider of selectProvidersForCompilation(config, options.requiredProviderIds)) {
    const built = await buildSingleProviderRuntime(
      provider,
      options.allowInlineProviderSecrets,
      options.allowWorkerProviderSecretBootstrap,
      resolveProviderSecret,
    );
    envelope.push(built.runtime);
    if (built.secret) {
      providerSecrets.push(built.secret);
    }
  }

  return { providers: envelope, providerSecrets };
}

function selectProvidersForCompilation(
  config: PiwinConfig,
  requiredProviderIds: readonly string[] | undefined,
): ModelProviderConfig[] {
  const enabledProviders = getEnabledProviders(config);
  if (requiredProviderIds === undefined) {
    return enabledProviders;
  }

  const uniqueIds = [...new Set(requiredProviderIds.map((providerId) => providerId.trim()))].filter(
    (providerId) => providerId.length > 0,
  );
  const providersById = new Map(enabledProviders.map((provider) => [provider.id, provider]));
  const missingProviderId = uniqueIds.find((providerId) => !providersById.has(providerId));
  if (missingProviderId) {
    throw new Error(`Configured provider is unavailable: ${missingProviderId}`);
  }
  return uniqueIds.flatMap((providerId) => {
    const provider = providersById.get(providerId);
    return provider ? [provider] : [];
  });
}

type BuiltProviderRuntime = {
  runtime: SerializableProviderRuntime;
  secret?: EphemeralProviderSecret;
};

async function buildSingleProviderRuntime(
  provider: ModelProviderConfig,
  allowInlineProviderSecrets: boolean,
  allowWorkerProviderSecretBootstrap: boolean,
  resolveProviderSecret: ((provider: ModelProviderConfig) => Promise<string>) | undefined,
): Promise<BuiltProviderRuntime> {
  // SDK compilation may resolve the parent-owned keychain reference inline.
  // When both legacy fields are present, this keeps the explicit SDK choice
  // authoritative without changing the worker's serialized envelope.
  if (allowInlineProviderSecrets && provider.apiKeyRef?.trim()) {
    if (!resolveProviderSecret) {
      throw new Error('Provider secret resolver is unavailable for provider auth');
    }
    const apiKey = await resolveProviderSecret(provider);
    if (!apiKey) {
      throw new Error(`Provider ${provider.id}: resolved API key is empty`);
    }
    return {
      runtime: buildProviderRuntime(provider, { kind: 'inline', apiKey }),
    };
  }

  // Worker compilation prefers env-ref auth: the parent injects the env var
  // into the worker process environment, so the worker never sees the raw key.
  if (provider.apiKeyEnv?.trim()) {
    return {
      runtime: buildProviderRuntime(provider, {
        kind: 'env',
        envName: provider.apiKeyEnv.trim(),
      }),
    };
  }

  // apiKeyRef is parent-owned keychain state. Resolve it only when the caller
  // explicitly selected either the in-process SDK path or the one-shot worker
  // bootstrap path; never put the raw value in the provider envelope.
  if (provider.apiKeyRef?.trim()) {
    if (!allowInlineProviderSecrets && !allowWorkerProviderSecretBootstrap) {
      throw new ProviderSecretCompileError(provider.id);
    }
    if (!resolveProviderSecret) {
      throw new Error('Provider secret resolver is unavailable for provider auth');
    }
    let apiKey: string;
    try {
      apiKey = await resolveProviderSecret(provider);
    } catch (error) {
      if (allowWorkerProviderSecretBootstrap && !allowInlineProviderSecrets) {
        throw new Error(
          `Provider "${provider.id}" credentials are unavailable for worker bootstrap`,
        );
      }
      throw error;
    }
    if (!apiKey) {
      throw new Error(`Provider ${provider.id}: resolved API key is empty`);
    }
    if (allowWorkerProviderSecretBootstrap && !allowInlineProviderSecrets) {
      const secretId = `provider-secret-${randomUUID()}`;
      return {
        runtime: buildProviderRuntime(provider, { kind: 'bootstrap', secretId }),
        secret: { secretId, value: apiKey },
      };
    }
    if (allowInlineProviderSecrets) {
      return {
        runtime: buildProviderRuntime(provider, { kind: 'inline', apiKey }),
      };
    }
  }

  // No auth configured — provider may work without API key (e.g. local).
  return { runtime: buildProviderRuntime(provider, { kind: 'none' }) };
}

function buildProviderRuntime(
  provider: ModelProviderConfig,
  auth: SerializableProviderRuntime['auth'],
): SerializableProviderRuntime {
  return {
    providerId: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    ...(provider.headers ? { headers: provider.headers } : {}),
    models: provider.models
      .filter((model) => modelSupportsCapability(model, 'chat'))
      .map((model) => ({
        id: model.id,
        ...(model.label ? { label: model.label } : {}),
        ...(model.input ? { input: [...model.input] } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
        ...(model.thinkingLevels ? { thinkingLevels: [...model.thinkingLevels] } : {}),
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
        ...(model.nativeSearchAdapter ? { nativeSearchAdapter: model.nativeSearchAdapter } : {}),
      })),
    auth,
  };
}
