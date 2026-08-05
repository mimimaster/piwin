/**
 * Phase 7: Compile a real SerializableBlueprint + SerializableProviderRuntime[]
 * from live PiwinConfig + session location + resource discovery.
 *
 * This bridges the gap between the HostRuntime's CreateSessionInput and the
 * WorkerRpcSessionBackend's need for a complete blueprint. The parent adapter
 * calls this before delegating to the worker backend.
 *
 * Authority: parent owns config, trust, resource discovery, and secret
 * resolution. The worker receives only the serializable projection.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
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
} from '@piwin/contracts';
import { isProviderEnabled } from '@piwin/contracts';
import { resolveArtifactDecisionPrompt } from '@piwin/contracts';
import { ARTIFACT_RUNTIME_CONTRACT } from './artifact-runtime-contract.js';
import { loadPiwinConfig } from './config-store.js';
import { resolveSessionLocation, resolveAgentCwd } from './session-scope.js';
import { createPiResourceLoader } from './pi-resource-loader.js';
import { createSecretResolver } from './secret-resolver.js';
import { getEnabledProviders } from './provider-helpers.js';
import {
  compileSessionCapabilitySnapshot,
  type CompileSnapshotInput,
} from './capabilities/session-capability-resolver.js';
import {
  projectBlueprintForWorker,
  type SerializableBlueprint,
  type SerializableProviderRuntime,
} from './rpc/serializable-blueprint.js';

/**
 * Build the artifact system prompt (decision + runtime contract) for the
 * worker blueprint. Returns undefined when artifacts are disabled.
 */
function buildArtifactAppendPrompt(config: PiwinConfig): string | undefined {
  if (!config.artifact.enabled) {
    return undefined;
  }
  const decisionPrompt = resolveArtifactDecisionPrompt(config.artifact);
  return `${decisionPrompt}\n\n${ARTIFACT_RUNTIME_CONTRACT}`;
}

export type CompiledBlueprint = {
  blueprint: SerializableBlueprint;
  providers: SerializableProviderRuntime[];
  productSessionId: string;
};

export type CompileBlueprintOptions = {
  piwinRoot?: string;
  /** Override config load (tests). */
  config?: PiwinConfig;
  /** Override resource discovery (tests). */
  discoverResources?: (options: DiscoverResourcesOptions) => Promise<DiscoveredResources>;
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

  // Build tool policy from config + scope.
  const tools = buildToolPolicy(config, location.scope, input);

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
  const contextManifest: ContextManifest = {
    agentsFiles: [],
  };

  // Build trust from scope. The parent enforces trust before calling
  // createSession; the snapshot records it as trusted: true.
  const trust: SessionCapabilitySnapshot['trust'] =
    location.scope.kind === 'project'
      ? { kind: 'project', projectPath: location.scope.projectPath, trusted: true }
      : { kind: 'general' };

  const compileInput: CompileSnapshotInput = {
    inputs: {
      settingsRevision: 'live',
      projectRevision: 'live',
      mcpRevision: 'live',
      resourceCatalogRevision: 'live',
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
  // ADR 0029: resolve artifact system prompt (decision + runtime contract).
  const artifactAppendPrompt = buildArtifactAppendPrompt(config);
  const blueprint = projectBlueprintForWorker(snapshot, {
    ...(input.model
      ? { model: { providerId: input.model.providerId, modelId: input.model.modelId } }
      : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    // ADR 0029: inject artifact decision + runtime contract.
    ...(artifactAppendPrompt ? { appendSystemPrompt: artifactAppendPrompt } : {}),
  });

  // Build provider envelope from live config.
  const providers = await buildProviderEnvelope(config);

  const productSessionId =
    location.scope.kind === 'project' ? location.scope.projectPath : 'general';

  return { blueprint, providers, productSessionId };
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
): SessionToolPolicy {
  const enabledFamilies: SessionToolFamily[] = [];
  const customToolNames: string[] = [];

  // Web tools (web_search, web_fetch).
  if (config.web) {
    enabledFamilies.push('web-search', 'web-fetch');
    customToolNames.push('web_search', 'web_fetch');
  }

  // Shell (gated bash).
  if (input.subagent?.mode !== 'readonly') {
    enabledFamilies.push('shell');
    customToolNames.push('bash');
  }

  // Filesystem (gated file tools).
  enabledFamilies.push('filesystem-read', 'filesystem-write');
  customToolNames.push('read_file', 'write_file', 'list_directory');

  // MCP tools.
  enabledFamilies.push('mcp');

  // Process tools (CE-PROC).
  if (input.subagent?.mode !== 'readonly') {
    enabledFamilies.push('process');
    customToolNames.push('process_start', 'process_list', 'process_logs', 'process_stop');
  }

  // Browser tools.
  enabledFamilies.push('browser');
  customToolNames.push('browser_navigate', 'browser_screenshot', 'browser_click', 'browser_eval');

  // Planning tools.
  enabledFamilies.push('planning');
  customToolNames.push('plan_step', 'plan_create');

  // Notes tools.
  if (config.notes?.enabled !== false) {
    enabledFamilies.push('notes-read', 'notes-write');
    customToolNames.push('notes_search', 'notes_create', 'notes_update');
  }

  // Flashcards tools.
  if (config.flashcards?.enabled !== false) {
    enabledFamilies.push('flashcards-read', 'flashcards-write');
    customToolNames.push('flashcards_review', 'flashcards_create');
  }

  // Image generation.
  const imagegenDisabled = config.skills?.disabledIds?.includes('imagegen') ?? false;
  if (!imagegenDisabled) {
    enabledFamilies.push('image-generation');
    customToolNames.push('image_gen');
  }

  // Delegate (subagent run).
  if (input.subagent?.mode !== 'readonly') {
    enabledFamilies.push('delegate');
    customToolNames.push('subagent_run');
  }

  // Pi built-in tool names (Pi's own tools that are always available).
  const piBuiltinToolNames: string[] = ['read', 'grep', 'ls', 'edit', 'write'];

  // MCP server IDs from config (empty for now — MCP lifecycle is parent-owned).
  const enabledMcpServerIds: string[] = [];

  return {
    enabledFamilies,
    piBuiltinToolNames,
    customToolNames,
    enabledMcpServerIds,
  };
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
 * The parent resolves secrets and passes them to the worker via the envelope.
 * Prefer env-ref auth (worker inherits env); fall back to inline for
 * providers that only have apiKeyRef (keychain-resolved by parent).
 */
async function buildProviderEnvelope(config: PiwinConfig): Promise<SerializableProviderRuntime[]> {
  const secretResolver = createSecretResolver();
  const envelope: SerializableProviderRuntime[] = [];

  for (const provider of getEnabledProviders(config)) {
    const runtime = await buildSingleProviderRuntime(provider, secretResolver);
    envelope.push(runtime);
  }

  return envelope;
}

async function buildSingleProviderRuntime(
  provider: ModelProviderConfig,
  secretResolver: ReturnType<typeof createSecretResolver>,
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

  // Fall back to inline: resolve the secret from keychain/env and pass
  // it to the worker over stdio. The worker must never log this.
  if (provider.apiKeyRef?.trim()) {
    try {
      const apiKey = await secretResolver.resolveProviderSecret(provider);
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
