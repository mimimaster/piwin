/**
 * Worker-side Pi session factory (Phase 7 plan §5, §6, WP3).
 *
 * Creates a real Pi session inside the worker process from an exact
 * `SerializableBlueprint` + `SerializableProviderRuntime[]` envelope. The
 * factory does NOT load `~/.piwin/config.json`, does NOT scan for resources,
 * and does NOT resolve secrets from keychain — the parent compiled the
 * blueprint and injected only the paths/providers the worker may use.
 *
 * Custom tools are NOT registered here. WP4 registers proxy tools whose
 * executors call back to the parent over JSONL. Until WP4 lands, the worker
 * session runs with Pi built-in tools only (gated by the blueprint's
 * `piBuiltinToolNames` when present).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ExtensionUiPort, SessionSeedMessage, ThinkingLevel } from '@piwin/contracts';
import { bindExtensionUiToPiSession, createExtensionUiContext } from '../extension-ui-bridge.js';
import { buildThinkingLevelMap, mapThinkingLevelToPi } from '../map-thinking-level.js';
import {
  buildPiProviderRegistration,
  resolvePiModelCompat,
  type PiModelRuntime,
  type PiModelRegistration,
  type PiProviderApi,
} from '../pi-model-runtime.js';

import {
  providerNeedsNativeSearchWrapper,
  wrapStreamSimpleForNativeSearch,
  type NativeSearchStreamSimple,
} from '../native-web-search.js';
import { resolvePiNativeSearchStream } from '../pi-native-search-stream.js';
import type { PiBackendCustomToolDefinition } from '../backends/pi-backend-tool-adapter.js';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
  SerializableWorkerProviderRuntime,
} from './serializable-blueprint.js';
import type { WorkerPiSessionLike } from './worker-session-runtime.js';
import {
  createSeededPiSessionManager,
  createSeededPiSettingsManager,
} from '../seeded-pi-session.js';
import { createPiwinSettingsManager } from '../pi-settings-manager.js';
import { mapPiCompactionResult, type PiCompactionResult } from '../pi-compaction-result.js';
import { buildPiSessionToolAllowlist } from '../pi-session-tool-allowlist.js';
import {
  createRunInterventionStager,
  type PiRunInterventionSession,
} from '../run-intervention-stager.js';

/** Input passed to the factory's `createPiSession` callback. */
export type WorkerPiSessionFactoryInput = {
  productSessionId: string;
  runtimeGenerationId: string;
  blueprint: SerializableBlueprint;
  providers?: SerializableWorkerProviderRuntime[];
  /** Opaque bootstrap ids resolved inside the worker, never from JSONL. */
  bootstrapSecrets?: ReadonlyMap<string, string>;
  seedMessages?: readonly SessionSeedMessage[];
  /** `compaction` (default) forces whole-history compaction; `replay` keeps seeds intact. */
  seedMode?: 'compaction' | 'replay';
  extensionUi?: ExtensionUiPort;
  /** Proxy tools to register as Pi customTools (WP4). */
  proxyTools?: PiBackendCustomToolDefinition[];
};

/** Options for the factory builder. */
export type WorkerPiSessionFactoryOptions = {
  /**
   * Pi agent directory (`~/.pi/agent`). Defaults to the standard location.
   * The worker shares Pi native auth/models files but does NOT read piwin config.
   */
  agentDir?: string;
  /**
   * Override the Pi module import (test seam). When omitted, the factory
   * dynamically imports `@earendil-works/pi-coding-agent`.
   */
  piModule?: Record<string, unknown>;
  /**
   * Inject a custom model runtime (test seam). When omitted, the factory
   * creates one from the Pi module + provider envelope.
   */
  modelRuntime?: PiModelRuntime;
};

/**
 * Build a `DefaultResourceLoader` from the blueprint's exact path lists.
 * No discovery, no scanning — the worker loads only what the parent compiled.
 */
export async function createBlueprintResourceLoader(
  blueprint: SerializableBlueprint,
  agentDir: string,
  piModule: Record<string, unknown>,
): Promise<unknown> {
  const DefaultResourceLoader = (piModule as { DefaultResourceLoader?: unknown })
    .DefaultResourceLoader;
  if (typeof DefaultResourceLoader !== 'function') {
    throw new Error('DefaultResourceLoader missing from @earendil-works/pi-coding-agent');
  }

  const LoaderCtor = DefaultResourceLoader as new (options: Record<string, unknown>) => {
    reload: () => Promise<void>;
  };

  const agentsFiles = await Promise.all(
    blueprint.contextManifest.agentsFiles.map(async (file) => ({
      path: file.absolutePath,
      content: await readCompiledContextFile(file.absolutePath),
    })),
  );
  const systemPrompt = blueprint.contextManifest.systemPrompt
    ? await readCompiledContextFile(blueprint.contextManifest.systemPrompt.absolutePath)
    : undefined;
  const appendSystemPrompts: string[] = [];
  if (blueprint.contextManifest.appendSystemPrompt) {
    appendSystemPrompts.push(
      await readCompiledContextFile(blueprint.contextManifest.appendSystemPrompt.absolutePath),
    );
  }
  const productAppendPrompt = blueprint.appendSystemPrompt?.trim();
  if (productAppendPrompt) {
    appendSystemPrompts.push(productAppendPrompt);
  }

  const loaderOptions: Record<string, unknown> = {
    cwd: blueprint.workingDirectory,
    agentDir,
    // SCR-16: the parent-compiled manifests are authoritative. These flags
    // prevent Pi from rediscovering cwd/global resources behind the Host.
    noContextFiles: true,
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalSkillPaths: [...blueprint.activeSkillPaths],
    additionalExtensionPaths: [...blueprint.activeExtensionPaths],
    additionalPromptTemplatePaths: [...blueprint.activePromptPaths],
    // Empty explicit sources suppress Pi's SYSTEM/APPEND_SYSTEM discovery;
    // overrides inject only content from the frozen manifest.
    systemPrompt: '',
    appendSystemPrompt: [],
    agentsFilesOverride: () => ({ agentsFiles }),
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => appendSystemPrompts,
  };

  const loader = new LoaderCtor(loaderOptions);
  await loader.reload();
  return loader;
}

async function readCompiledContextFile(absolutePath: string): Promise<string> {
  try {
    return await readFile(absolutePath, 'utf8');
  } catch (error) {
    throw new CompiledContextFileReadError(absolutePath, error);
  }
}

class CompiledContextFileReadError extends Error {
  constructor(absolutePath: string, cause: unknown) {
    super(`Failed to read compiled context file: ${absolutePath}`, { cause });
    this.name = 'CompiledContextFileReadError';
  }
}

/**
 * Register provider runtimes from the serializable envelope into a Pi
 * `ModelRuntime`. The worker must not resolve secrets itself — the envelope
 * carries only a worker-safe auth mode (env name already in worker env,
 * one-shot bootstrap id, or none). Inline keys cannot enter this type.
 */
export function registerWorkerProviders(
  modelRuntime: PiModelRuntime,
  providers: SerializableWorkerProviderRuntime[],
  searchRoute?: import('@piwin/contracts').ResolvedSearchRoute | null | undefined,
  bootstrapSecrets?: ReadonlyMap<string, string>,
): void {
  const referencedBootstrapIds = new Set<string>();
  for (const provider of providers) {
    if (provider.auth.kind === 'bootstrap') {
      referencedBootstrapIds.add(provider.auth.secretId);
    }
    const apiKey = resolveWorkerProviderApiKey(provider, bootstrapSecrets);
    modelRuntime.registerProvider(
      provider.providerId,
      buildWorkerProviderRegistration(provider, apiKey, searchRoute),
    );
  }
  if (bootstrapSecrets) {
    for (const secretId of bootstrapSecrets.keys()) {
      if (!referencedBootstrapIds.has(secretId)) {
        throw new Error('worker secret bootstrap contains an unreferenced entry');
      }
    }
  }
}

function resolveWorkerProviderApiKey(
  provider: SerializableWorkerProviderRuntime,
  bootstrapSecrets?: ReadonlyMap<string, string>,
): string | undefined {
  switch (provider.auth.kind) {
    case 'env':
      return process.env[provider.auth.envName];
    case 'bootstrap': {
      const apiKey = bootstrapSecrets?.get(provider.auth.secretId);
      if (!apiKey) {
        throw new Error(`Provider "${provider.providerId}" bootstrap secret is unavailable`);
      }
      return apiKey;
    }
    case 'none':
      return undefined;
  }
}

function resolveWorkerApi(protocol: SerializableProviderRuntime['protocol']): PiProviderApi {
  switch (protocol) {
    case 'anthropic-compatible':
      return 'anthropic-messages';
    case 'google-gemini':
      return 'google-generative-ai';
    case 'openai-compatible':
      return 'openai-completions';
  }
}

/**
 * Build a `PiProviderRegistration` from the serializable envelope (not from
 * `ModelProviderConfig`, which the worker does not load).
 */
export function buildWorkerProviderRegistration(
  provider: SerializableProviderRuntime,
  apiKey: string | undefined,
  searchRoute?: import('@piwin/contracts').ResolvedSearchRoute | null | undefined,
  streamSimple?: NativeSearchStreamSimple,
): ReturnType<typeof buildPiProviderRegistration> {
  const api = resolveWorkerApi(provider.protocol);
  const models = provider.models.map((model) => {
    const thinkingLevelMap =
      model.reasoning === false
        ? undefined
        : buildThinkingLevelMap(model.thinkingLevels, provider.protocol);
    const compat = resolvePiModelCompat(api, model.id);
    return {
      id: model.id,
      name: model.label?.trim() || model.id,
      api,
      baseUrl: provider.baseUrl,
      reasoning: model.reasoning ?? true,
      ...(compat ? { compat } : {}),
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      input: model.input ? [...model.input] : (['text'] as Array<'text' | 'image'>),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow ?? 128_000,
      maxTokens: model.maxOutputTokens ?? 8_192,
      ...(provider.headers ? { headers: provider.headers } : {}),
      ...(model.capabilities ? { capabilities: [...model.capabilities] } : {}),
      ...(model.nativeSearchAdapter ? { nativeSearchAdapter: model.nativeSearchAdapter } : {}),
    };
  });
  const registration: ReturnType<typeof buildPiProviderRegistration> = {
    name: provider.providerId,
    baseUrl: provider.baseUrl,
    api,
    authHeader: Boolean(apiKey || provider.auth.kind !== 'none'),
    models,
  };
  if (apiKey) {
    registration.apiKey = apiKey;
  }
  if (provider.headers) {
    registration.headers = provider.headers;
  }
  const nativeFlags = models.map((model) => ({
    id: model.id,
    ...(model.capabilities ? { capabilities: model.capabilities } : {}),
    ...(model.nativeSearchAdapter ? { nativeSearchAdapter: model.nativeSearchAdapter } : {}),
  }));
  if (providerNeedsNativeSearchWrapper(nativeFlags, searchRoute)) {
    const wrapped = wrapStreamSimpleForNativeSearch(streamSimple, {
      models: nativeFlags,
      searchRoute: searchRoute ?? null,
      fallbackStreamSimple: resolvePiNativeSearchStream(api),
    });
    if (wrapped) {
      registration.streamSimple = wrapped;
    }
  } else if (streamSimple) {
    registration.streamSimple = streamSimple;
  }
  return registration;
}

/**
 * Create a `createPiSession` function for the `WorkerSessionRuntime`.
 *
 * The returned function builds a Pi session from the blueprint + provider
 * envelope, applies thinking level / model overrides, and returns a
 * `WorkerPiSessionLike` handle that the runtime drives.
 */
export function createWorkerPiSessionFactory(
  options: WorkerPiSessionFactoryOptions = {},
): (input: WorkerPiSessionFactoryInput) => Promise<WorkerPiSessionLike> {
  const agentDir = options.agentDir ?? join(homedir(), '.pi', 'agent');

  return async (input) => {
    const piModule = options.piModule ?? (await import('@earendil-works/pi-coding-agent'));
    const createAgentSession = (piModule as { createAgentSession?: unknown }).createAgentSession;
    if (typeof createAgentSession !== 'function') {
      throw new Error('createAgentSession export missing from @earendil-works/pi-coding-agent');
    }

    const { blueprint, providers } = input;

    const resourceLoader = await createBlueprintResourceLoader(
      blueprint,
      agentDir,
      piModule as Record<string, unknown>,
    );

    const modelRuntime =
      options.modelRuntime ??
      (await createWorkerModelRuntime(piModule as Record<string, unknown>, agentDir));
    if (providers && providers.length > 0) {
      registerWorkerProviders(
        modelRuntime,
        providers,
        input.blueprint.searchRoute,
        input.bootstrapSecrets,
      );
    }
    await modelRuntime.refresh({ allowNetwork: false });

    const sessionOptions: Record<string, unknown> = {
      cwd: blueprint.workingDirectory,
      agentDir,
      resourceLoader,
      modelRuntime,
      settingsManager: createPiwinSettingsManager(
        piModule,
        blueprint.workingDirectory,
        agentDir,
      ),
    };
    if (input.seedMessages) {
      sessionOptions.sessionManager = createSeededPiSessionManager(
        piModule as Record<string, unknown>,
        blueprint.workingDirectory,
        input.seedMessages,
      );
      if (input.seedMode !== 'replay') {
        // Compaction/subagent snapshots want Pi to compact the whole seeded
        // history; full-fidelity replay must keep it intact.
        sessionOptions.settingsManager = createSeededPiSettingsManager(
          piModule as Record<string, unknown>,
        );
      }
    }

    // Inject proxy tools as Pi customTools (WP4). The worker does NOT
    // import tool executors — proxy tools call back to the parent.
    if (input.proxyTools && input.proxyTools.length > 0) {
      sessionOptions.customTools = input.proxyTools;
    }

    // Apply model override from the blueprint (parent-compiled).
    if (blueprint.model) {
      const selectedModel = modelRuntime.getModel(
        blueprint.model.providerId,
        blueprint.model.modelId,
      );
      if (!selectedModel) {
        throw new Error(
          `Configured model is unavailable: ${blueprint.model.providerId}/${blueprint.model.modelId}`,
        );
      }
      sessionOptions.model = selectedModel;
    }

    // Apply thinking level override from the blueprint.
    if (blueprint.thinkingLevel) {
      const protocol = blueprint.model
        ? inferProtocolFromProviderId(providers, blueprint.model.providerId)
        : undefined;
      sessionOptions.thinkingLevel = mapThinkingLevelToPi(
        blueprint.thinkingLevel as ThinkingLevel,
        protocol,
      );
    }

    // Pi's `tools` is a global allowlist (built-ins + customTools/proxy tools).
    // Host proxy tools must be named here or Pi drops them before the model.
    sessionOptions.tools = buildPiSessionToolAllowlist({
      piBuiltinToolNames: blueprint.tools.piBuiltinToolNames,
      hostTools: blueprint.tools.hostTools,
    });

    const result = (await (
      createAgentSession as (options: Record<string, unknown>) => Promise<unknown>
    )(sessionOptions)) as { session?: WorkerPiSessionHandle };

    const piSession = result.session;
    if (!piSession) {
      throw new Error('createAgentSession returned no session');
    }

    const extensionUiPort = input.extensionUi;
    if (extensionUiPort) {
      const uiContext = createExtensionUiContext(
        input.productSessionId,
        {
          request: (request) => extensionUiPort.request(request, new AbortController().signal),
        },
        () => createWorkerRequestId(),
      );
      await bindExtensionUiToPiSession(piSession, uiContext);
    }

    return adaptPiSessionForWorker(
      piSession,
      input.productSessionId,
      input.runtimeGenerationId,
      modelRuntime,
      providers,
    );
  };
}

function createWorkerRequestId(): string {
  return `worker-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pi session shape we need from `createAgentSession` inside the worker. */
type WorkerPiSessionHandle = {
  agent?: PiRunInterventionSession['agent'];
  readonly isStreaming?: boolean;
  sessionId?: string;
  prompt: (
    text: string,
    options?: {
      images?: Array<{ data: string; mimeType: string }>;
      streamingBehavior?: 'steer' | 'followUp';
      thinkingLevel?: string;
      model?: { providerId: string; modelId: string };
    },
  ) => Promise<void>;
  steer?: (message: string) => Promise<void>;
  followUp?: (message: string) => Promise<void>;
  abort?: () => Promise<void>;
  compact?: (customInstructions?: string) => Promise<PiCompactionResult>;
  abortCompaction?: () => void;
  getAutoCompactionEnabled?: () => boolean;
  setAutoCompactionEnabled?: (enabled: boolean) => void;
  setModel?: (model: PiModelRegistration) => Promise<void> | void;
  setThinkingLevel?: (level: string) => Promise<void> | void;
  bindExtensions?: (bindings: Record<string, unknown>) => Promise<void>;
  subscribe: (listener: (raw: unknown) => void) => () => void;
};

/** Adapt the raw Pi session to the `WorkerPiSessionLike` interface. */
function adaptPiSessionForWorker(
  piSession: WorkerPiSessionHandle,
  productSessionId: string,
  runtimeGenerationId: string,
  modelRuntime: PiModelRuntime,
  providers: SerializableWorkerProviderRuntime[] | undefined,
): WorkerPiSessionLike {
  let activeRunId: string | undefined;
  const interventionStager = piSession.agent
    ? createRunInterventionStager({
        session: piSession as PiRunInterventionSession,
        sessionId: productSessionId,
        runtimeGenerationId,
        getActiveRunId: () => activeRunId,
      })
    : undefined;
  return {
    id: piSession.sessionId ?? productSessionId,
    setActiveRunId(runId) {
      activeRunId = runId;
    },
    prompt: async (text, options) => {
      if (options?.model && piSession.setModel) {
        const selectedModel = modelRuntime.getModel(
          options.model.providerId,
          options.model.modelId,
        );
        if (!selectedModel) {
          throw new Error(
            `Configured model is unavailable: ${options.model.providerId}/${options.model.modelId}`,
          );
        }
        await piSession.setModel(selectedModel);
      }
      if (options?.thinkingLevel && piSession.setThinkingLevel) {
        const protocol = options.model
          ? inferProtocolFromProviderId(providers, options.model.providerId)
          : undefined;
        await piSession.setThinkingLevel(
          mapThinkingLevelToPi(options.thinkingLevel as ThinkingLevel, protocol),
        );
      }
      await piSession.prompt(text, options);
    },
    ...(piSession.steer ? { steer: (message) => piSession.steer!(message) } : {}),
    ...(piSession.followUp ? { followUp: (message) => piSession.followUp!(message) } : {}),
    ...(interventionStager
      ? {
          armRunIntervention: (intervention) => interventionStager.arm(intervention),
          cancelRunIntervention: (interventionId, expectedRevision) =>
            interventionStager.cancel(interventionId, expectedRevision),
          subscribeRunInterventions: (listener) => interventionStager.subscribe(listener),
          settleRunInterventions: (runId) => interventionStager.settleRun(runId),
        }
      : {}),
    ...(piSession.abort ? { abort: () => piSession.abort!() } : {}),
    ...(piSession.compact
      ? {
          compact: async (customInstructions?: string) => {
            const result = customInstructions
              ? await piSession.compact?.(customInstructions)
              : await piSession.compact?.();
            if (!result) {
              throw new Error('Pi session compact returned no result');
            }
            return mapPiCompactionResult(result);
          },
        }
      : {}),
    ...(piSession.abortCompaction ? { abortCompaction: () => piSession.abortCompaction?.() } : {}),
    ...(piSession.getAutoCompactionEnabled
      ? { getAutoCompactionEnabled: () => piSession.getAutoCompactionEnabled?.() ?? true }
      : {}),
    ...(piSession.setAutoCompactionEnabled
      ? {
          setAutoCompactionEnabled: (enabled: boolean) =>
            piSession.setAutoCompactionEnabled?.(enabled),
        }
      : {}),
    subscribe: (listener) => piSession.subscribe(listener),
  };
}

/** Create a Pi `ModelRuntime` from the agent dir (auth.json + models.json). */
async function createWorkerModelRuntime(
  piModule: Record<string, unknown>,
  agentDir: string,
): Promise<PiModelRuntime> {
  const runtimeConstructor = piModule.ModelRuntime as
    | {
        create: (options: { authPath: string; modelsPath: string }) => Promise<PiModelRuntime>;
      }
    | undefined;
  if (!runtimeConstructor?.create) {
    throw new Error('Pi ModelRuntime export missing from @earendil-works/pi-coding-agent');
  }
  return runtimeConstructor.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  });
}

/** Infer the model protocol from the provider envelope for thinking-level mapping. */
function inferProtocolFromProviderId(
  providers: SerializableWorkerProviderRuntime[] | undefined,
  providerId: string,
): SerializableWorkerProviderRuntime['protocol'] | undefined {
  return providers?.find((provider) => provider.providerId === providerId)?.protocol;
}
