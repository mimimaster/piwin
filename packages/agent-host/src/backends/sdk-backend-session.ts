/** Backend-only Pi SDK session creation from exact contracts and ports. */

import { join } from 'node:path';
import type { AgentEvent, BackendPreparedPrompt } from '@piwin/contracts';
import {
  assertValidBackendSessionBlueprint,
  type BackendSessionHandle,
  type CreateBackendSessionInput,
} from './pi-session-backend.js';
import {
  projectBackendBlueprintForWorker,
  type SerializableProviderRuntime,
} from '../rpc/serializable-blueprint.js';
import {
  buildWorkerProviderRegistration,
  createBlueprintResourceLoader,
} from '../rpc/worker-pi-session-factory.js';
import { createPiSessionEventMapper } from '../event-map.js';
import { bindExtensionUiToPiSession, createExtensionUiContext } from '../extension-ui-bridge.js';
import { mapThinkingLevelToPi } from '../map-thinking-level.js';
import { toPiBackendCustomTools } from './pi-backend-tool-adapter.js';
import type { PiModelRuntime } from '../pi-model-runtime.js';
import {
  createSeededPiSessionManager,
  createSeededPiSettingsManager,
} from '../seeded-pi-session.js';
import { createPiwinSettingsManager } from '../pi-settings-manager.js';
import { mapPiCompactionResult, type PiCompactionResult } from '../pi-compaction-result.js';
import {
  readPiAutoCompactionEnabled,
  setPiAutoCompactionEnabled,
  type PiCompactionSettingsManager,
} from '../pi-compaction-settings.js';
import { buildPiSessionToolAllowlist } from '../pi-session-tool-allowlist.js';
import {
  createPiContextSampler,
  type PiCompactionTimingState,
  occupancyModelIdentityFromRef,
  publishSampledPiSessionEvents,
  readPiContextUsageSample,
  sameOccupancyModelIdentity,
  type OccupancyModelIdentity,
} from '../pi-context-sampler.js';
import {
  isOpenAiCompletionsStreamProtocol,
  readPiHttpIdleTimeoutMs,
  runTrackedGuardedPiPrompt,
} from '../pi-parsed-stream-guard.js';
import {
  createRunInterventionStager,
  type PiRunInterventionSession,
} from '../run-intervention-stager.js';
import { resolvePiRuntimeAgentDir } from '../pi-runtime-agent-dir.js';
import { registerClaudeCodeOauthProvider } from '../anthropic-oauth/register-claude-code-provider.js';

/** Options for backend-only SDK session creation. */
export type PiSdkBackendOptions = {
  /** Test seam for the Pi module; production dynamically imports Pi. */
  piModule?: Record<string, unknown>;
  /** Host-owned Pi runtime dir (`{PIWIN_ROOT}/pi-agent`). Inventory stays at ~/.pi/agent. */
  agentDir?: string;
  /** Test seam for a pre-constructed provider runtime. */
  modelRuntime?: PiModelRuntime;
};

/**
 * Create a Pi session from the backend-neutral contract.
 *
 * This factory never reads product Settings, trust, resource scanners, media,
 * or product tool builders. Every model-visible capability comes from the
 * compiled Blueprint and every side effect goes through an injected port.
 */
export async function createBackendSdkSession(
  input: CreateBackendSessionInput,
  options: PiSdkBackendOptions = {},
): Promise<BackendSessionHandle> {
  assertValidBackendSessionBlueprint(input.blueprint);
  const serializableBlueprint = projectBackendBlueprintForWorker(input.blueprint);
  const piModule = options.piModule ?? (await import('@earendil-works/pi-coding-agent'));
  const createAgentSession = (piModule as { createAgentSession?: unknown }).createAgentSession;
  if (typeof createAgentSession !== 'function') {
    throw new Error('createAgentSession export missing from @earendil-works/pi-coding-agent');
  }

  const agentDir = resolvePiRuntimeAgentDir(options.agentDir);
  const resourceLoader = await createBlueprintResourceLoader(
    serializableBlueprint,
    agentDir,
    piModule,
  );
  const modelRuntime =
    options.modelRuntime ??
    (await createBackendModelRuntime(
      piModule,
      agentDir,
      input.providers,
      input.blueprint.capabilitySnapshot.searchRoute,
    ));
  const capabilitySnapshot = input.blueprint.capabilitySnapshot;
  let activeRunId: string | undefined;
  const customTools = toPiBackendCustomTools(
    capabilitySnapshot.tools.hostTools,
    input.hostToolExecution,
    {
      sessionId: input.blueprint.sessionId,
      runtimeGenerationId: input.blueprint.runtimeGenerationId,
      getRunId: () => activeRunId,
    },
  );
  // Pi's `tools` option is a global allowlist for built-ins AND customTools.
  // Host tools are customTools only; omitting them here drops bash/MCP/web/…
  // before the model ever sees them (see buildPiSessionToolAllowlist).
  const toolAllowlist = buildPiSessionToolAllowlist({
    piBuiltinToolNames: capabilitySnapshot.tools.piBuiltinToolNames,
    hostTools: capabilitySnapshot.tools.hostTools,
  });
  let settingsManager = createPiwinSettingsManager(
    piModule,
    capabilitySnapshot.workingDirectory,
    agentDir,
  );
  // Keep the transport idle policy from the normal settings manager even when
  // a disposable seed later swaps in its compact-only in-memory manager.
  const streamProgressTimeoutMs = readPiHttpIdleTimeoutMs(settingsManager);
  const sessionOptions: Record<string, unknown> = {
    cwd: capabilitySnapshot.workingDirectory,
    agentDir,
    resourceLoader,
    modelRuntime,
    // Empty allowlist is intentional when both sides are empty: no Pi defaults.
    tools: toolAllowlist,
    customTools,
    settingsManager,
  };
  const hasSeededHistory =
    input.compactionSeed !== undefined || (input.seedMessages?.length ?? 0) > 0;
  if (hasSeededHistory) {
    sessionOptions.sessionManager = createSeededPiSessionManager(
      piModule,
      capabilitySnapshot.workingDirectory,
      input.seedMessages ?? [],
      input.compactionSeed,
    );
    if (input.seedMode !== 'replay') {
      // Compaction/subagent snapshots want Pi to compact the whole seeded
      // history; full-fidelity replay must keep it intact.
      settingsManager = createSeededPiSettingsManager(piModule) as object;
      sessionOptions.settingsManager = settingsManager;
    }
  }
  const compactionSettingsManager = settingsManager as PiCompactionSettingsManager;

  if (input.blueprint.model) {
    const selectedModel = modelRuntime.getModel(
      input.blueprint.model.providerId,
      input.blueprint.model.modelId,
    );
    if (!selectedModel) {
      throw new Error(
        `Configured model is unavailable: ${input.blueprint.model.providerId}/${input.blueprint.model.modelId}`,
      );
    }
    sessionOptions.model = selectedModel;
  }
  if (input.blueprint.thinkingLevel) {
    sessionOptions.thinkingLevel = mapThinkingLevelToPi(
      input.blueprint.thinkingLevel,
      input.blueprint.model?.protocol,
    );
  }

  const result = (await (
    createAgentSession as (sessionOptions: Record<string, unknown>) => Promise<unknown>
  )(sessionOptions)) as { session?: PiLikeSession };
  if (!result.session) {
    throw new Error('createAgentSession returned no session');
  }

  if (input.extensionUi) {
    const extensionUiPort = input.extensionUi;
    const bridgedContext = createExtensionUiContext(
      input.blueprint.sessionId,
      {
        request: (request) => extensionUiPort.request(request, new AbortController().signal),
      },
      createRequestId,
    );
    await bindExtensionUiToPiSession(result.session, bridgedContext);
  }

  return wrapBackendPiSession(
    result.session,
    input,
    modelRuntime,
    (runId) => {
      activeRunId = runId;
    },
    () => activeRunId,
    streamProgressTimeoutMs,
    compactionSettingsManager,
  );
}

async function createBackendModelRuntime(
  piModule: Record<string, unknown>,
  agentDir: string,
  providers: SerializableProviderRuntime[],
  searchRoute?: import('@piwin/contracts').ResolvedSearchRoute | null,
): Promise<PiModelRuntime> {
  const runtimeConstructor = piModule.ModelRuntime as
    | {
        create: (options: { authPath: string; modelsPath: string }) => Promise<PiModelRuntime>;
      }
    | undefined;
  if (!runtimeConstructor?.create) {
    throw new Error('Pi ModelRuntime export missing from @earendil-works/pi-coding-agent');
  }
  const modelRuntime = await runtimeConstructor.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  });
  for (const provider of providers) {
    if (provider.auth.kind === 'oauth') {
      if (provider.providerId === 'anthropic-claude-code') {
        await registerClaudeCodeOauthProvider(modelRuntime, agentDir, provider);
      }
      continue;
    }
    modelRuntime.registerProvider(
      provider.providerId,
      buildWorkerProviderRegistration(
        provider,
        resolveBackendProviderApiKey(provider),
        searchRoute,
      ),
    );
  }
  await modelRuntime.refresh({ allowNetwork: false });
  return modelRuntime;
}

function resolveBackendProviderApiKey(provider: SerializableProviderRuntime): string | undefined {
  switch (provider.auth.kind) {
    case 'env':
      return process.env[provider.auth.envName];
    case 'inline':
      return provider.auth.apiKey;
    case 'bootstrap':
      throw new Error(
        `Provider "${provider.providerId}" uses worker-only bootstrap auth in the SDK backend`,
      );
    case 'none':
    case 'oauth':
      return undefined;
  }
}

function wrapBackendPiSession(
  piSession: PiLikeSession,
  input: CreateBackendSessionInput,
  modelRuntime: PiModelRuntime,
  setActiveRunId: (runId: string | undefined) => void,
  getActiveRunId: () => string | undefined,
  streamProgressTimeoutMs: number,
  compactionSettingsManager: PiCompactionSettingsManager,
): BackendSessionHandle {
  const eventMapper = createPiSessionEventMapper();
  const sampler = createPiContextSampler({
    sessionId: input.blueprint.sessionId,
    runtimeGenerationId: input.blueprint.runtimeGenerationId,
    getRunId: getActiveRunId,
    ...(typeof piSession.getContextUsage === 'function'
      ? {
          getContextUsage: () => readPiContextUsageSample(piSession.getContextUsage?.()),
        }
      : {}),
  });
  const occupancyListeners = new Set<(event: AgentEvent) => void>();
  let appliedModel: OccupancyModelIdentity | undefined = input.blueprint.model
    ? occupancyModelIdentityFromRef(input.blueprint.model)
    : undefined;
  let trailingRunId: string | undefined;
  const interventionStager = piSession.agent
    ? createRunInterventionStager({
        session: piSession as PiRunInterventionSession,
        sessionId: input.blueprint.sessionId,
        runtimeGenerationId: input.blueprint.runtimeGenerationId,
        getActiveRunId,
      })
    : undefined;
  return {
    id: input.blueprint.sessionId,
    async prompt(preparedPrompt: BackendPreparedPrompt) {
      trailingRunId = preparedPrompt.runId;
      setActiveRunId(preparedPrompt.runId);
      if (preparedPrompt.model && piSession.setModel) {
        const model = modelRuntime.getModel(
          preparedPrompt.model.providerId,
          preparedPrompt.model.modelId,
        );
        if (!model) {
          throw new Error(
            `Configured model is unavailable: ${preparedPrompt.model.providerId}/${preparedPrompt.model.modelId}`,
          );
        }
        await piSession.setModel(model);
        const nextModel = occupancyModelIdentityFromRef(preparedPrompt.model);
        if (appliedModel !== undefined && !sameOccupancyModelIdentity(appliedModel, nextModel)) {
          for (const extra of sampler.invalidateBaseline()) {
            for (const listener of occupancyListeners) {
              listener(extra);
            }
          }
        }
        appliedModel = nextModel;
      }
      if (preparedPrompt.thinkingLevel && piSession.setThinkingLevel) {
        await piSession.setThinkingLevel(
          mapThinkingLevelToPi(preparedPrompt.thinkingLevel, preparedPrompt.model?.protocol),
        );
      }
      const promptOptions: {
        images?: Array<{ data: string; mimeType: string }>;
        streamingBehavior?: 'steer' | 'followUp';
      } = {};
      if (preparedPrompt.images && preparedPrompt.images.length > 0) {
        promptOptions.images = preparedPrompt.images.map((image) => ({
          data: image.dataBase64,
          mimeType: image.mimeType,
        }));
      }
      if (preparedPrompt.streamingBehavior) {
        promptOptions.streamingBehavior = preparedPrompt.streamingBehavior;
      }
      try {
        const selectedModel = preparedPrompt.model
          ? modelRuntime.getModel(preparedPrompt.model.providerId, preparedPrompt.model.modelId)
          : undefined;
        return await runTrackedGuardedPiPrompt({
          enabled: isOpenAiCompletionsStreamProtocol(
            selectedModel?.api ?? preparedPrompt.model?.protocol,
          ),
          timeoutMs: streamProgressTimeoutMs,
          subscribe: (listener) => piSession.subscribe(listener),
          prompt: () =>
            Object.keys(promptOptions).length > 0
              ? piSession.prompt(preparedPrompt.text, promptOptions)
              : piSession.prompt(preparedPrompt.text),
          abort: () => piSession.abort?.() ?? Promise.resolve(),
        });
      } finally {
        await interventionStager?.settleRun(preparedPrompt.runId);
        setActiveRunId(undefined);
      }
    },
    async steer(message) {
      if (!piSession.steer) {
        throw new Error('Pi session does not support steer');
      }
      await piSession.steer(message);
    },
    async followUp(message) {
      if (piSession.followUp) {
        await piSession.followUp(message);
        return;
      }
      await piSession.prompt(message);
    },
    ...(interventionStager
      ? {
          armRunIntervention: (intervention) => interventionStager.arm(intervention),
          cancelRunIntervention: (interventionId, expectedRevision) =>
            interventionStager.cancel(interventionId, expectedRevision),
          subscribeRunInterventions: (listener) => interventionStager.subscribe(listener),
        }
      : {}),
    async abort() {
      try {
        await piSession.abort?.();
      } finally {
        eventMapper.reset?.();
      }
    },
    ...(piSession.compact
      ? {
          async compact(customInstructions?: string) {
            // A manual compact is not a late event from the previous
            // foreground Run. Automatic compact remains owned by activeRunId.
            trailingRunId = undefined;
            try {
              const result = customInstructions
                ? await piSession.compact?.(customInstructions)
                : await piSession.compact?.();
              if (!result) {
                throw new Error('Pi session compact returned no result');
              }
              return mapPiCompactionResult(result);
            } finally {
              trailingRunId = undefined;
            }
          },
        }
      : {}),
    ...(piSession.abortCompaction ? { abortCompaction: () => piSession.abortCompaction?.() } : {}),
    ...(readPiAutoCompactionEnabled(piSession, compactionSettingsManager) !== undefined
      ? {
          getAutoCompactionEnabled: () =>
            readPiAutoCompactionEnabled(piSession, compactionSettingsManager) ?? true,
          setAutoCompactionEnabled: (enabled: boolean) =>
            setPiAutoCompactionEnabled(piSession, compactionSettingsManager, enabled),
        }
      : {}),
    subscribe(listener) {
      occupancyListeners.add(listener);
      const compactionTiming: PiCompactionTimingState = {};
      const unsubscribe = piSession.subscribe((rawEvent) => {
        publishSampledPiSessionEvents({
          mapper: eventMapper,
          sampler,
          raw: rawEvent,
          identity: {
            sessionId: input.blueprint.sessionId,
            runtimeGenerationId: input.blueprint.runtimeGenerationId,
          },
          runId: getActiveRunId() ?? trailingRunId,
          compactionTiming,
          emit: listener,
        });
      });
      return () => {
        occupancyListeners.delete(listener);
        unsubscribe();
      };
    },
  };
}

type PiLikeSession = {
  agent?: PiRunInterventionSession['agent'];
  readonly isStreaming?: boolean;
  prompt: (
    text: string,
    options?: {
      images?: Array<{ data: string; mimeType: string }>;
      streamingBehavior?: 'steer' | 'followUp';
    },
  ) => Promise<void>;
  steer?: (message: string) => Promise<void>;
  followUp?: (message: string) => Promise<void>;
  abort?: () => Promise<void>;
  compact?: (customInstructions?: string) => Promise<PiCompactionResult>;
  abortCompaction?: () => void;
  readonly autoCompactionEnabled?: boolean;
  getAutoCompactionEnabled?: () => boolean;
  setAutoCompactionEnabled?: (enabled: boolean) => void | Promise<void>;
  setModel?: (model: NonNullable<ReturnType<PiModelRuntime['getModel']>>) => Promise<void> | void;
  setThinkingLevel?: (level: string) => Promise<void> | void;
  bindExtensions?: (bindings: Record<string, unknown>) => Promise<void>;
  subscribe: (listener: (raw: unknown) => void) => () => void;
  getContextUsage?: () =>
    | { tokens: number | null; contextWindow: number; percent?: number | null }
    | undefined;
};

function createRequestId(): string {
  return `sdk-backend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
