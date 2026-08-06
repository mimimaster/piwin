/** Backend-only Pi SDK session creation from exact contracts and ports. */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BackendPreparedPrompt } from '@piwin/contracts';
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
import { mapThinkingLevelToApi } from '../map-thinking-level.js';
import { toPiBackendCustomTools } from './pi-backend-tool-adapter.js';
import type { PiModelRuntime } from '../pi-model-runtime.js';
import {
  createSeededPiSessionManager,
  createSeededPiSettingsManager,
} from '../seeded-pi-session.js';
import { mapPiCompactionResult, type PiCompactionResult } from '../pi-compaction-result.js';

/** Options for backend-only SDK session creation. */
export type PiSdkBackendOptions = {
  /** Test seam for the Pi module; production dynamically imports Pi. */
  piModule?: Record<string, unknown>;
  /** Pi-native agent directory. Product config is deliberately not read here. */
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

  const agentDir = options.agentDir ?? join(homedir(), '.pi', 'agent');
  const resourceLoader = await createBlueprintResourceLoader(
    serializableBlueprint,
    agentDir,
    piModule,
  );
  const modelRuntime =
    options.modelRuntime ?? (await createBackendModelRuntime(piModule, agentDir, input.providers));
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
  const sessionOptions: Record<string, unknown> = {
    cwd: capabilitySnapshot.workingDirectory,
    agentDir,
    resourceLoader,
    modelRuntime,
    // An empty array is intentional: it means no built-ins, not defaults.
    tools: [...capabilitySnapshot.tools.piBuiltinToolNames],
    customTools,
  };
  if (input.seedMessages) {
    sessionOptions.sessionManager = createSeededPiSessionManager(
      piModule,
      capabilitySnapshot.workingDirectory,
      input.seedMessages,
    );
    sessionOptions.settingsManager = createSeededPiSettingsManager(piModule);
  }

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
    sessionOptions.thinkingLevel = mapThinkingLevelToApi(
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
        request: (request) =>
          extensionUiPort.request(request, new AbortController().signal),
      },
      createRequestId,
    );
    await bindExtensionUiToPiSession(result.session, bridgedContext);
  }

  return wrapBackendPiSession(result.session, input, modelRuntime, (runId) => {
    activeRunId = runId;
  });
}

async function createBackendModelRuntime(
  piModule: Record<string, unknown>,
  agentDir: string,
  providers: SerializableProviderRuntime[],
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
    modelRuntime.registerProvider(
      provider.providerId,
      buildWorkerProviderRegistration(provider, resolveBackendProviderApiKey(provider)),
    );
  }
  await modelRuntime.refresh({ allowNetwork: false });
  return modelRuntime;
}

function resolveBackendProviderApiKey(
  provider: SerializableProviderRuntime,
): string | undefined {
  switch (provider.auth.kind) {
    case 'env':
      return process.env[provider.auth.envName];
    case 'inline':
      return provider.auth.apiKey;
    case 'none':
      return undefined;
  }
}

function wrapBackendPiSession(
  piSession: PiLikeSession,
  input: CreateBackendSessionInput,
  modelRuntime: PiModelRuntime,
  setActiveRunId: (runId: string | undefined) => void,
): BackendSessionHandle {
  const eventMapper = createPiSessionEventMapper();
  return {
    id: input.blueprint.sessionId,
    async prompt(preparedPrompt: BackendPreparedPrompt) {
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
      }
      if (preparedPrompt.thinkingLevel && piSession.setThinkingLevel) {
        await piSession.setThinkingLevel(
          mapThinkingLevelToApi(preparedPrompt.thinkingLevel, preparedPrompt.model?.protocol),
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
        if (Object.keys(promptOptions).length > 0) {
          await piSession.prompt(preparedPrompt.text, promptOptions);
        } else {
          await piSession.prompt(preparedPrompt.text);
        }
      } finally {
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
    async abort() {
      await piSession.abort?.();
    },
    ...(piSession.compact
      ? {
          async compact(customInstructions?: string) {
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
    ...(piSession.abortCompaction
      ? { abortCompaction: () => piSession.abortCompaction?.() }
      : {}),
    ...(piSession.getAutoCompactionEnabled
      ? { getAutoCompactionEnabled: () => piSession.getAutoCompactionEnabled?.() ?? true }
      : {}),
    ...(piSession.setAutoCompactionEnabled
      ? { setAutoCompactionEnabled: (enabled: boolean) => piSession.setAutoCompactionEnabled?.(enabled) }
      : {}),
    subscribe(listener) {
      return piSession.subscribe((rawEvent) => {
        for (const mappedEvent of eventMapper.map(rawEvent)) {
          listener(mappedEvent.event);
        }
      });
    },
  };
}

type PiLikeSession = {
  prompt: (
    text: string,
    options?: { images?: Array<{ data: string; mimeType: string }>; streamingBehavior?: 'steer' | 'followUp' },
  ) => Promise<void>;
  steer?: (message: string) => Promise<void>;
  followUp?: (message: string) => Promise<void>;
  abort?: () => Promise<void>;
  compact?: (customInstructions?: string) => Promise<PiCompactionResult>;
  abortCompaction?: () => void;
  getAutoCompactionEnabled?: () => boolean;
  setAutoCompactionEnabled?: (enabled: boolean) => void;
  setModel?: (model: NonNullable<ReturnType<PiModelRuntime['getModel']>>) => Promise<void> | void;
  setThinkingLevel?: (level: string) => Promise<void> | void;
  bindExtensions?: (bindings: Record<string, unknown>) => Promise<void>;
  subscribe: (listener: (raw: unknown) => void) => () => void;
};

function createRequestId(): string {
  return `sdk-backend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
