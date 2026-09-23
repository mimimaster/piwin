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
import {
  projectBlueprintForWorker,
  type SerializableBlueprint,
  type SerializableProviderRuntime,
} from '@piwin/agent-host';
import type {
  BackendSessionBlueprint,
  ContextManifest,
  ContextPolicy,
  CreateSessionInput,
  EphemeralProviderSecret,
  HostToolDescriptor,
  McpConfigDocument,
  PiwinConfig,
  ResourceCatalog,
  ResourceManifest,
  ResolvedSessionLocation,
  SessionCapabilitySnapshot,
  SessionToolFamily,
} from '@piwin/contracts';
import { DEFAULT_AGENT_MODE_SYSTEM_PROMPT, isSubscriptionOauthProviderId } from '@piwin/contracts';
import { listEnabledServers, loadMcpConfig } from '@piwin/mcp';
import { compileToolPolicy } from './blueprint-agent-tool-policy.js';
import { compileConversationToolPolicy } from './blueprint-conversation-tool-policy.js';
import { buildProviderEnvelope } from './blueprint-provider-runtime.js';
import {
  buildFallbackResourceCatalog,
  buildResourceManifest,
  computeExtensionSetRevision,
  computeProjectRevision,
  computeResourceRevision,
  discoverResourcesDefault,
  normalizeDisabledResourceIds,
} from './blueprint-resource-compiler.js';
import type {
  DiscoveredResources,
  DiscoverResourcesOptions,
} from './blueprint-resource-compiler.js';
import {
  agentArtifactCapability,
  conversationArtifactCapability,
} from './blueprint-tool-capability.js';
import { formatResidentArtifactPrompt } from './artifact-instructions-tool.js';
import { formatBrowserSystemPrompt } from './browser-system-prompt.js';
import { formatCodeSearchSystemPrompt } from './code-search/code-search-system-prompt.js';
import { resolveResourceActivations } from './capabilities/resource-policy-resolver.js';
import {
  compileSessionCapabilitySnapshot,
  type CompileSnapshotInput,
} from './capabilities/session-capability-resolver.js';
import { loadPiwinConfig } from './config-store.js';
import { discoverContextManifest } from './context-manifest-discovery.js';
import { HOST_TOOLBOX_NAME } from './host-toolbox.js';
import { formatMountedKnowledgeBasePrompt } from './knowledge-system-prompt.js';
import { buildMcpCapabilityBrief, type McpCapabilityBrief } from './mcp-capability-brief.js';
import { getPiAgentDir, getPiwinRoot } from './paths.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { computePermissionRulesRevision } from './permission-rule-revision.js';
import { resolveDefaultModelRef } from './provider-helpers.js';
import { resolveChatModel } from './resolve-chat-model.js';
import type { SecretResolver } from './secret-resolver.js';
import { createSettingsSnapshot } from './settings/settings-service.js';
import {
  isConversationChatSession,
  resolveAgentCwd,
  resolveSessionLocation,
} from './session-scope.js';
import type { SessionBlueprint } from './session-blueprint.js';
import { formatSkillDiscoveryPrompt } from './skills-system-prompt.js';
import { formatCatalogSystemPrompt } from './tool-catalog/catalog-brief.js';
import { windowsShellPrompt } from './tools/windows-shell-prompt.js';

// This module now orchestrates: resource discovery, provider envelopes, and
// tool-policy compilation live in their own modules. They are re-exported here
// so importers of this entry point keep the surface they already depend on.
export type { DiscoveredResources, DiscoverResourcesOptions };
export {
  PROVIDER_SECRET_COMPILE_ERROR_CODE,
  ProviderSecretCompileError,
} from './blueprint-provider-runtime.js';

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
  usableSubscriptionProviderIds?: readonly string[];
  subscriptionAccounts?: import('./resolve-chat-model.js').ResolveChatModelAccounts;
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
  /** Display names of knowledge bases mounted on this session. */
  mountedKnowledgeBaseNames?: string[];
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

  const artifactAppendPrompt = formatResidentArtifactPrompt(
    config.artifact,
    snapshot.tools.hostTools,
    agentArtifactCapability(config, input),
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

  const knowledgeAppendPrompt = formatMountedKnowledgeBasePrompt(
    options.mountedKnowledgeBaseNames ?? [],
  );
  const browserAppendPrompt = formatBrowserSystemPrompt(snapshot.tools.hostTools);
  const codeSearchAppendPrompt = formatCodeSearchSystemPrompt(snapshot.tools.hostTools);
  const skillAppendPrompt = formatSkillDiscoveryPrompt({
    skillCount: resourceManifest.skills.length,
    piBuiltinToolNames: snapshot.tools.piBuiltinToolNames,
  });
  const appendSystemPromptParts = [
    DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    windowsShellPrompt(),
    artifactAppendPrompt,
    mcpAppendPrompt,
    knowledgeAppendPrompt,
    browserAppendPrompt,
    codeSearchAppendPrompt,
    skillAppendPrompt,
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
  const defaultModel = resolveDefaultModelRef(config, options.subscriptionAccounts);
  if (input.model && options.subscriptionAccounts) {
    const resolved = resolveChatModel(config, input.model, options.subscriptionAccounts);
    if (
      !resolved &&
      isSubscriptionOauthProviderId(input.model.providerId) &&
      !config.providers.some((provider) => provider.id === input.model?.providerId)
    ) {
      throw Object.assign(
        new Error(`Subscription provider "${input.model.providerId}" is not signed in.`),
        { code: 'provider-authentication' },
      );
    }
  }
  const requiredProviderIds =
    options.requiredProviderIds ??
    (input.model ? [input.model.providerId] : defaultModel ? [defaultModel.providerId] : undefined);
  if (requiredProviderIds && options.usableSubscriptionProviderIds) {
    const usable = new Set(options.usableSubscriptionProviderIds);
    const blocked = requiredProviderIds.find(
      (providerId) =>
        isSubscriptionOauthProviderId(providerId) &&
        !config.providers.some((provider) => provider.id === providerId) &&
        !usable.has(providerId),
    );
    if (blocked) {
      throw Object.assign(new Error(`Subscription provider "${blocked}" is not signed in.`), {
        code: 'provider-authentication',
      });
    }
  }
  const providerEnvelope = await buildProviderEnvelope(config, {
    allowInlineProviderSecrets: options.allowInlineProviderSecrets === true,
    allowWorkerProviderSecretBootstrap: options.allowWorkerProviderSecretBootstrap === true,
    ...(requiredProviderIds ? { requiredProviderIds } : {}),
    ...(options.usableSubscriptionProviderIds
      ? { usableSubscriptionProviderIds: options.usableSubscriptionProviderIds }
      : {}),
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

const CONVERSATION_CHAT_SYSTEM_PROMPT = `<identity>
You are Piwin Chat, a general-purpose conversational assistant. Answer the user directly.
When you call a tool, emit no user-visible text; keep progress in thinking. Visible text is only for the final reply of the turn, or a question with no tool calls.
</identity>`;

/** Resident system contract for pure-chat sessions: identity. */
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

  const artifactAppendPrompt = formatResidentArtifactPrompt(
    config.artifact,
    snapshot.tools.hostTools,
    conversationArtifactCapability(config),
  );

  const knowledgeAppendPrompt = formatMountedKnowledgeBasePrompt(
    options.mountedKnowledgeBaseNames ?? [],
  );
  const appendSystemPromptParts = [
    formatConversationSystemPrompt(),
    artifactAppendPrompt,
    knowledgeAppendPrompt,
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
