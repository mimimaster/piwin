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
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import type {
  CreateSessionInput,
  ModelProviderConfig,
  PiwinConfig,
  ResourceCatalog,
  ResourceInstance,
  ResourceManifest,
  SessionCapabilitySnapshot,
  SessionScope,
  SessionToolFamily,
  SessionToolPolicy,
  ContextPolicy,
  ContextManifest,
  BackendSessionBlueprint,
  HostToolDescriptor,
  McpConfigDocument,
} from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';
import { listEnabledServers, loadMcpConfig } from '@piwin/mcp';
import { resolveWebConfig } from '@piwin/tools-web';
import { loadPiwinConfig } from './config-store.js';
import { resolveSessionLocation, resolveAgentCwd } from './session-scope.js';
import { buildResourceShadowDiagnostics, createPiResourceLoader } from './pi-resource-loader.js';
import { createSecretResolver, type SecretResolver } from './secret-resolver.js';
import { getEnabledProviders } from './provider-helpers.js';
import {
  compileSessionCapabilitySnapshot,
  type CompileSnapshotInput,
} from './capabilities/session-capability-resolver.js';
import {
  projectBlueprintForWorker,
  type SerializableBlueprint,
  type SerializableProviderRuntime,
} from '@piwin/agent-host';
import { getPiwinRoot } from './paths.js';
import type { SessionBlueprint } from './session-blueprint.js';
import { resolveContextManifest } from './capabilities/context-policy-resolver.js';
import { resolveResourceActivations } from './capabilities/resource-policy-resolver.js';
import { resolveToolPolicyDetails } from './capabilities/tool-policy-resolver.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { computePermissionRulesRevision } from './permission-rule-revision.js';

export type CompiledBlueprint = {
  /** Host-owned exact decision set; never sent over the worker boundary. */
  sessionBlueprint: SessionBlueprint;
  /** Wire-oriented projection retained for diagnostics and existing callers. */
  blueprint: SerializableBlueprint;
  backendBlueprint: BackendSessionBlueprint;
  providers: SerializableProviderRuntime[];
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
      `Provider "${providerId}" uses apiKeyRef, but worker mode requires apiKeyEnv or a future secret channel; apiKeyRef secrets cannot cross worker JSONL.`,
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
  const tools = compileToolPolicy(
    config,
    input,
    options.hostToolDescriptors,
    composedToolNames,
    projectTrusted,
    mcpEnabledServerIds,
    options.hostToolFamilyIndex,
  );

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
    allowProjectAgentsFiles: location.scope.kind === 'project',
    allowProjectSystemPrompts: location.scope.kind === 'project',
  };
  const contextManifest = await discoverContextManifest(location.scope, agentCwd);

  // Compute content-based revisions from actual config rather than
  // placeholder 'live' strings. This makes the snapshot id deterministic
  // and enables stale-generation detection after settings changes.
  const settingsRevision = computeConfigRevision(config);
  const rulesRevision =
    options.rulesRevision ?? computePermissionRulesRevision(createBundledRuleSet());
  const projectRevision = computeProjectRevision(location.scope);
  const mcpRevision = computeMcpRevision(mcpConfig);
  const resourceCatalogRevision = computeResourceRevision(resourceResolution.catalog);

  const compileInput: CompileSnapshotInput = {
    inputs: {
      rulesRevision,
      settingsRevision,
      projectRevision,
      mcpRevision,
      resourceCatalogRevision,
    },
    scope: location.scope,
    workingDirectory: location.workingDirectory,
    trust,
    resources: resourcePolicy,
    resourceManifest,
    context: contextPolicy,
    contextManifest,
    tools,
  };

  const snapshot = compileSessionCapabilitySnapshot(compileInput);
  const model = input.model
    ? { providerId: input.model.providerId, modelId: input.model.modelId }
    : undefined;
  const blueprint = projectBlueprintForWorker(snapshot, {
    ...(input.model
      ? { model: { providerId: input.model.providerId, modelId: input.model.modelId } }
      : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
  });

  // Build provider envelope from live config.
  const providers = await buildProviderEnvelope(config, {
    allowInlineProviderSecrets: options.allowInlineProviderSecrets === true,
    ...(options.secretResolver ? { secretResolver: options.secretResolver } : {}),
  });

  const productSessionId = options.sessionId ?? randomUUID();
  const backendBlueprint: BackendSessionBlueprint = {
    version: 1,
    sessionId: productSessionId,
    runtimeGenerationId: options.runtimeGenerationId ?? `generation-${randomUUID()}`,
    capabilitySnapshot: snapshot,
    ...(model ? { model: input.model } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
  };

  const sessionBlueprint: SessionBlueprint = {
    sessionId: productSessionId,
    runtimeGenerationId: backendBlueprint.runtimeGenerationId,
    scope: location.scope,
    workingDirectory: location.workingDirectory,
    capabilitySnapshot: snapshot,
    resourceManifest,
    contextManifest,
    hostToolDescriptors: [...snapshot.tools.hostTools],
    backendBlueprint,
  };

  return {
    sessionBlueprint,
    blueprint,
    backendBlueprint,
    providers,
    productSessionId,
    ...(settingsRevision ? { settingsRevision } : {}),
  };
}

/** Compute a stable revision string from the config content. */
function computeConfigRevision(config: PiwinConfig): string {
  // Hash the config fields that affect runtime behavior. We exclude
  // volatile fields (like timestamps) by hashing only the structural
  // config object. The hash is short (first 12 hex chars) for readability.
  const payload = JSON.stringify({
    providers:
      config.providers?.map((provider) => ({
        id: provider.id,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        models: provider.models?.map((model) => ({ id: model.id })),
      })) ?? [],
    permissions: config.permissions,
    web: config.web,
    notes: config.notes,
    flashcards: config.flashcards,
    imageGeneration: config.imageGeneration,
    skills: config.skills,
    extensions: config.extensions,
    prompts: config.prompts,
    subagents: config.subagents,
    automation: config.automation,
    thinking: config.thinking,
    visionDelegation: config.visionDelegation,
    process: config.process,
    session: config.session,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** Compute a revision from MCP server configuration. */
function computeMcpRevision(document: McpConfigDocument): string {
  const payload = JSON.stringify(document);
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

function computeProjectRevision(scope: SessionScope): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0, 12);
}

async function discoverContextManifest(
  scope: SessionScope,
  workingDirectory: string,
): Promise<ContextManifest> {
  const candidates: Array<{
    kind: 'agents' | 'claude' | 'system' | 'append-system';
    source: 'project' | 'pi-native';
    absolutePath: string;
  }> = [];
  const names = [
    ['AGENTS.md', 'agents'],
    ['CLAUDE.md', 'claude'],
    ['SYSTEM.md', 'system'],
    ['APPEND_SYSTEM.md', 'append-system'],
  ] as const;
  if (scope.kind === 'project') {
    for (const [name, kind] of names) {
      const absolutePath = join(workingDirectory, name);
      if (await fileExists(absolutePath)) {
        candidates.push({ kind, source: 'project', absolutePath });
      }
    }
  }
  return resolveContextManifest(
    {
      allowPiNativeInstructions: false,
      allowProjectAgentsFiles: scope.kind === 'project',
      allowProjectSystemPrompts: scope.kind === 'project',
    },
    {
      projectAgentsFiles: candidates.filter(
        (candidate) => candidate.kind === 'agents' || candidate.kind === 'claude',
      ),
      projectSystemPrompts: candidates.filter(
        (candidate) => candidate.kind === 'system' || candidate.kind === 'append-system',
      ),
      piNativeFiles: [],
    },
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Compute a revision from the resource catalog before activation filtering. */
function computeResourceRevision(catalog: ResourceCatalog): string {
  const payload = JSON.stringify({
    entries: [...catalog.entries].sort((left, right) =>
      `${left.kind}:${left.resourceId}:${left.path}`.localeCompare(
        `${right.kind}:${right.resourceId}:${right.path}`,
      ),
    ),
    diagnostics: catalog.diagnostics,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/**
 * Discover skill/extension/prompt paths using the same logic as the SDK adapter.
 * Returns only the paths (not the Pi ResourceLoader) for the worker.
 */
async function discoverResourcesDefault(
  options: DiscoverResourcesOptions,
): Promise<DiscoveredResources> {
  const agentDir = join(homedir(), '.pi', 'agent');
  const extraSkillPaths = options.config.skills?.extraPaths ?? [];
  const disabledSkillIds = options.config.skills?.disabledIds ?? [];
  const extraExtensionPaths = options.config.extensions?.extraPaths ?? [];
  const disabledExtensionIds = options.config.extensions?.disabledIds ?? [];
  const extraPromptPaths = options.config.prompts?.extraPaths ?? [];
  const disabledPromptIds = options.config.prompts?.disabledIds ?? [];

  const { skillPaths, extensionPaths, promptPaths, resourceCatalog } = await createPiResourceLoader(
    {
      cwd: options.cwd,
      agentDir,
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
): SessionToolPolicy {
  // SIDE §6.1: Side Chat compiles a fixed read-only tool profile. It is a
  // product-level session kind, not a subagent capability ceiling, and can
  // never gain write/execute/planning/delegate tools even under a yolo
  // permission preset.
  if (input.sessionKind === 'side-chat') {
    return buildSideChatToolPolicy(config, hostToolDescriptors, toolNamesFromComposed);
  }
  const capabilityCeiling = input.subagent?.capabilities;

  const resolvedWebConfig = config.web ? resolveWebConfig(config.web) : undefined;
  const webSearchReady = resolvedWebConfig?.searchSources.some((source) => source.enabled) ?? false;
  const webFetchReady = resolvedWebConfig !== undefined;
  const imagegenDisabled = config.skills?.disabledIds?.includes('imagegen') ?? false;

  const resolvedToolPolicy = resolveToolPolicyDetails({
    webSearch: resolvedWebConfig !== undefined,
    webFetch: resolvedWebConfig !== undefined,
    mcp: true,
    imageGeneration: !imagegenDisabled,
    process: 'agent',
    browser: 'agent',
    subagents: 'agent',
    notes: config.notes?.enabled === false ? 'off' : 'agent-read-write',
    flashcards: config.flashcards?.enabled === false ? 'off' : 'agent-create',
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

  return {
    enabledFamilies: resolvedPolicy.enabledFamilies,
    piBuiltinToolNames,
    hostTools: buildHostToolsForPolicy(effectiveToolNames, hostToolDescriptors),
    enabledMcpServerIds: [...mcpEnabledServerIds],
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
 * name crosses the boundary. Inline auth is an explicit SDK-only escape hatch;
 * worker/RPC compilation fails closed for apiKeyRef-only providers.
 */
async function buildProviderEnvelope(
  config: PiwinConfig,
  options: {
    allowInlineProviderSecrets: boolean;
    secretResolver?: Pick<SecretResolver, 'resolveProviderSecret'>;
  },
): Promise<SerializableProviderRuntime[]> {
  const resolveProviderSecret = options.allowInlineProviderSecrets
    ? (options.secretResolver?.resolveProviderSecret ??
      createSecretResolver().resolveProviderSecret)
    : undefined;
  const envelope: SerializableProviderRuntime[] = [];

  for (const provider of getEnabledProviders(config)) {
    const runtime = await buildSingleProviderRuntime(
      provider,
      options.allowInlineProviderSecrets,
      resolveProviderSecret,
    );
    envelope.push(runtime);
  }

  return envelope;
}

async function buildSingleProviderRuntime(
  provider: ModelProviderConfig,
  allowInlineProviderSecrets: boolean,
  resolveProviderSecret: ((provider: ModelProviderConfig) => Promise<string>) | undefined,
): Promise<SerializableProviderRuntime> {
  // Prefer env-ref auth: the parent injects the env var into the worker
  // process environment, so the worker never sees the raw key.
  if (provider.apiKeyEnv?.trim()) {
    return {
      providerId: provider.id,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      ...(provider.headers ? { headers: provider.headers } : {}),
      models: provider.models.map((model) => ({
        id: model.id,
        ...(model.label ? { label: model.label } : {}),
        ...(model.input ? { input: [...model.input] } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
      })),
      auth: { kind: 'env', envName: provider.apiKeyEnv.trim() },
    };
  }

  // apiKeyRef is parent-owned keychain state and has no safe worker channel.
  // Do not resolve it before this check: the raw key must never enter the RPC
  // request or serialized provider envelope.
  if (provider.apiKeyRef?.trim()) {
    if (!allowInlineProviderSecrets) {
      throw new ProviderSecretCompileError(provider.id);
    }
    if (!resolveProviderSecret) {
      throw new Error('Provider secret resolver is unavailable for inline SDK auth');
    }
    try {
      const apiKey = await resolveProviderSecret(provider);
      if (apiKey) {
        return {
          providerId: provider.id,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          ...(provider.headers ? { headers: provider.headers } : {}),
          models: provider.models.map((model) => ({
            id: model.id,
            ...(model.label ? { label: model.label } : {}),
            ...(model.input ? { input: [...model.input] } : {}),
            ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
            ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
            ...(model.maxOutputTokens !== undefined
              ? { maxOutputTokens: model.maxOutputTokens }
              : {}),
          })),
          auth: { kind: 'inline', apiKey },
        };
      }
    } catch {
      // Keep the provider registered with 'none' auth so the worker
      // can report a precise unavailable error.
    }
  }

  // No auth configured — provider may work without API key (e.g. local).
  return {
    providerId: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    ...(provider.headers ? { headers: provider.headers } : {}),
    models: provider.models.map((model) => ({
      id: model.id,
      ...(model.label ? { label: model.label } : {}),
      ...(model.input ? { input: [...model.input] } : {}),
      ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    })),
    auth: { kind: 'none' },
  };
}
