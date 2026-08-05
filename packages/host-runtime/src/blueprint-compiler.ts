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
  ResourceManifest,
  ResourcePolicy,
  SessionCapabilitySnapshot,
  SessionScope,
  SessionToolFamily,
  SessionToolPolicy,
  ContextPolicy,
  ContextManifest,
  BackendSessionBlueprint,
  HostToolDescriptor,
} from '@piwin/contracts';
import { loadMcpConfig } from '@piwin/mcp';
import { loadPiwinConfig } from './config-store.js';
import { resolveSessionLocation, resolveAgentCwd } from './session-scope.js';
import { createPiResourceLoader } from './pi-resource-loader.js';
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

  // Build tool policy from config + scope. When the parent provides
  // concrete descriptors, also pass their names so buildToolPolicy can
  // intersect customToolNames with the actual composed executor names.
  const composedToolNames = options.hostToolDescriptors
    ? options.hostToolDescriptors.map((d) => d.name)
    : undefined;

  // Build tool policy from config + scope. Pass the resolved trust so
  // untrusted projects cannot compile write/process/bash/delegate tools.
  const tools = buildToolPolicy(
    config,
    location.scope,
    input,
    options.hostToolDescriptors,
    composedToolNames,
    projectTrusted,
  );

  // Build resource manifest from discovered paths.
  const resourceManifest = buildResourceManifest(resources);

  // Build resource policy (disabled IDs from config).
  const resourcePolicy = buildResourcePolicy(config);

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
  const projectRevision = computeProjectRevision(location.scope);
  const mcpRevision = await computeMcpRevision(options.piwinRoot);
  const resourceCatalogRevision = computeResourceRevision(resources);



  const compileInput: CompileSnapshotInput = {
    inputs: {
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
    hostToolRegistrations: [...snapshot.tools.hostTools],
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
    providers: config.providers?.map((provider) => ({
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
async function computeMcpRevision(piwinRootOverride?: string): Promise<string> {
  const rootDir = getPiwinRoot(piwinRootOverride);
  const document = await loadMcpConfig(rootDir);
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

/** Compute a revision from discovered resource paths. */
function computeResourceRevision(resources: DiscoveredResources): string {
  const payload = JSON.stringify({
    skills: [...resources.skillPaths].sort(),
    extensions: [...resources.extensionPaths].sort(),
    prompts: [...resources.promptPaths].sort(),
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

  const { skillPaths, extensionPaths, promptPaths } = await createPiResourceLoader({
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
  });

  return { skillPaths, extensionPaths, promptPaths };
}

/**
 * Build tool policy from config + scope.
 * Maps product capability exposure to exact tool families + custom tool names.
 */
function buildToolPolicy(
  config: PiwinConfig,
  scope: SessionScope,
  input: CreateSessionInput,
  hostToolDescriptors?: readonly HostToolDescriptor[],
  toolNamesFromComposed?: readonly string[],
  trusted?: boolean,
): SessionToolPolicy {
  // SIDE §6.1: Side Chat compiles a fixed read-only tool profile. It is a
  // product-level session kind, not a subagent capability ceiling, and can
  // never gain write/execute/planning/delegate tools even under a yolo
  // permission preset.
  if (input.sessionKind === 'side-chat') {
    return buildSideChatToolPolicy(config, hostToolDescriptors, toolNamesFromComposed);
  }
  const enabledFamilies: SessionToolFamily[] = [];
  const customToolNames: string[] = [];
  const capabilityCeiling = input.subagent?.capabilities;
  const hasCapability = (capability: import('@piwin/contracts').SubagentCapability): boolean =>
    capabilityCeiling === undefined || capabilityCeiling.includes(capability);
  const hasRead = hasCapability('read');
  const hasWrite = hasCapability('write');
  const hasExecute = hasCapability('execute');
  const hasNetwork = hasCapability('network');
  const hasBrowser = hasCapability('browser');
  const hasPlanning = hasCapability('planning');
  const hasDelegate = hasCapability('delegate');
  const hasMcp = hasCapability('mcp');

  // Web tools (web_search, web_fetch).
  if (config.web && hasNetwork) {
    enabledFamilies.push('web-search', 'web-fetch');
    customToolNames.push('web_search', 'web_fetch');
  }

  // Shell (gated bash) — only for trusted projects.
  if (input.subagent?.mode !== 'readonly' && hasExecute && trusted !== false) {
    enabledFamilies.push('shell');
    customToolNames.push('bash', 'run_bash');
  }

  // Filesystem tools — read is always available; write requires trust.
  if (hasRead) {
    enabledFamilies.push('filesystem-read');
    customToolNames.push('read_file', 'list_directory');
  }
  if (hasWrite && input.subagent?.mode !== 'readonly' && trusted !== false) {
    enabledFamilies.push('filesystem-write');
    customToolNames.push('write_file');
  }

  // MCP tools.
  if (hasMcp) {
    enabledFamilies.push('mcp');
  }

  // Process tools (CE-PROC) — only for trusted projects.
  if (input.subagent?.mode !== 'readonly' && hasExecute && trusted !== false) {
    enabledFamilies.push('process');
    customToolNames.push('process_start', 'process_list', 'process_logs', 'process_stop');
  }

  // Browser tools.
  if (input.subagent?.mode !== 'readonly' && hasBrowser) {
    enabledFamilies.push('browser');
    customToolNames.push(
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_fill_form',
      'browser_scroll',
      'browser_screenshot',
      'browser_find',
      'browser_back',
      'browser_forward',
    );
  }

  // Planning tools.
  if (hasPlanning) {
    enabledFamilies.push('planning');
    customToolNames.push('piwin_plan_create', 'piwin_plan_set_step');
  }

  // Notes tools.
  if (capabilityCeiling === undefined && config.notes?.enabled !== false) {
    enabledFamilies.push('notes-read', 'notes-write');
    customToolNames.push(
      'note_search',
      'note_list',
      'note_read',
      'note_write',
      'note_update',
      'note_delete',
    );
  }

  // Flashcards tools.
  if (capabilityCeiling === undefined && config.flashcards?.enabled !== false) {
    enabledFamilies.push('flashcards-read', 'flashcards-write');
    customToolNames.push(
      'flashcard_create',
      'flashcard_batch_create',
      'flashcard_list',
      'flashcard_delete',
    );
  }

  // Image generation.
  const imagegenDisabled = config.skills?.disabledIds?.includes('imagegen') ?? false;
  if (capabilityCeiling === undefined && !imagegenDisabled) {
    enabledFamilies.push('image-generation');
    customToolNames.push('image_gen');
  }

  // Delegate (subagent run) — only for trusted projects.
  if (input.subagent?.mode !== 'readonly' && hasDelegate && trusted !== false) {
    enabledFamilies.push('delegate');
    customToolNames.push('piwin_subagent_run');
  }

  // MCP gateway tool — advertised when MCP is enabled. The actual executor
  // is only present when mcpManager is wired in buildSessionHostTools; the
  // descriptor filter below removes it if no executor exists.
  if (hasMcp) {
    customToolNames.push('mcp_gateway');
  }

  // Only expose Pi's non-mutating inspection tools to the worker. Product
  // filesystem writes are Host-owned tools and must never use Pi-native edit
  // or write capabilities in the worker.
  const piBuiltinToolNames: string[] = hasRead ? ['read', 'grep', 'ls'] : [];

  // MCP server IDs from config (empty for now — MCP lifecycle is parent-owned).
  const enabledMcpServerIds: string[] = [];

  // When the parent provides the composed tool names (the single source of
  // truth from buildSessionHostTools), intersect customToolNames with them.
  // This ensures the blueprint never advertises a tool without a concrete
  // executor (invariant 5). When not provided (test/legacy path), the
  // descriptor filter in buildHostToolsForPolicy still removes names without
  // a matching descriptor.
  const effectiveToolNames = toolNamesFromComposed
    ? customToolNames.filter((name) => toolNamesFromComposed.includes(name))
    : customToolNames;

  return {
    enabledFamilies,
    piBuiltinToolNames,
    hostTools: buildHostToolsForPolicy(effectiveToolNames, hostToolDescriptors),
    enabledMcpServerIds,
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
  const descriptorByName = new Map(hostToolDescriptors.map((descriptor) => [descriptor.name, descriptor]));
  return customToolNames
    .filter((name) => descriptorByName.has(name))
    .map((name) => descriptorByName.get(name)!)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Build a minimal ResourceManifest from discovered paths.
 * The worker uses activeSkillPaths/activeExtensionPaths/activePromptPaths
 * for loading; the manifest is for diagnostics only.
 */
function buildResourceManifest(resources: DiscoveredResources): ResourceManifest {
  return {
    skills: resources.skillPaths.map((path) => ({
      resourceId: path,
      kind: 'skill' as const,
      name: path,
      path,
      source: 'user' as const,
    })),
    extensions: resources.extensionPaths.map((path) => ({
      resourceId: path,
      kind: 'extension' as const,
      name: path,
      path,
      source: 'user' as const,
    })),
    prompts: resources.promptPaths.map((path) => ({
      resourceId: path,
      kind: 'prompt' as const,
      name: path,
      path,
      source: 'user' as const,
    })),
    diagnostics: [],
  };
}

/**
 * Build resource policy from config (disabled IDs).
 */
function buildResourcePolicy(config: PiwinConfig): ResourcePolicy {
  return {
    skills: {
      disabledIds: config.skills?.disabledIds ?? [],
      allowedSources: ['user'],
      allowlistedIds: null,
    },
    extensions: {
      disabledIds: config.extensions?.disabledIds ?? [],
      allowedSources: ['user'],
      allowlistedIds: null,
    },
    prompts: {
      disabledIds: config.prompts?.disabledIds ?? [],
      allowedSources: ['user'],
      allowlistedIds: null,
    },
  };
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
