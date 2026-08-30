import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  BackendSessionBlueprint,
  HostToolExecutionPort,
  SessionCapabilitySnapshot,
} from '@piwin/contracts';
import type { PiModelRegistration, PiModelRuntime } from './pi-model-runtime.js';
import { createBackendSdkSession } from './backends/sdk-backend-session.js';
import { WorkerSessionRuntime, type WorkerPiSessionLike } from './rpc/worker-session-runtime.js';
import type { WorkerFrame, WorkerFrameContext, WorkerRequest } from './rpc-sdk-worker-protocol.js';
import type { SerializableBlueprint } from './rpc/serializable-blueprint.js';
import {
  assistantUsageMeasurementId,
  normalizeGenerationMessageId,
} from './generation-identity.js';

const identity = {
  sessionId: 'session-parity',
  runtimeGenerationId: 'gen-parity',
};
const messageId = 'm-1';
const normalizedMessageId = normalizeGenerationMessageId(identity, messageId);
const expectedMeasurementId = assistantUsageMeasurementId({
  sessionId: identity.sessionId,
  runtimeGenerationId: identity.runtimeGenerationId,
  messageId: normalizedMessageId,
});

const occupancyFixture: unknown[] = [
  { type: 'message_start', messageId, role: 'assistant' },
  {
    type: 'message_update',
    messageId,
    assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
  },
  {
    type: 'message_end',
    messageId,
    message: {
      role: 'assistant',
      id: messageId,
      usage: { input: 80_000, output: 10_000, cacheRead: 0, cacheWrite: 0, totalTokens: 90_000 },
      stopReason: 'stop',
    },
  },
];

const registeredModel: PiModelRegistration = {
  id: 'model-1',
  name: 'Model 1',
  api: 'openai-completions',
  baseUrl: 'https://models.invalid',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

function snapshot(): SessionCapabilitySnapshot {
  return {
    version: 1,
    snapshotId: 'snapshot-parity',
    inputs: {
      rulesRevision: 'rules-1',
      settingsRevision: 'settings-1',
      projectRevision: 'project-1',
      mcpRevision: 'mcp-1',
      resourceCatalogRevision: 'resources-1',
    },
    scope: { kind: 'general' },
    workingDirectory: '/tmp/occupancy-workspace',
    trust: { kind: 'general' },
    resources: {
      skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
      extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
      prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
    },
    resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
    context: {
      allowPiNativeInstructions: true,
      allowProjectAgentsFiles: true,
      allowProjectSystemPrompts: true,
    },
    contextManifest: { agentsFiles: [] },
    tools: {
      hostTools: [],
      piBuiltinToolNames: ['read'],
      enabledMcpServerIds: [],
      enabledFamilies: [],
    },
  };
}

function blueprint(): BackendSessionBlueprint {
  return {
    version: 1,
    sessionId: identity.sessionId,
    runtimeGenerationId: identity.runtimeGenerationId,
    capabilitySnapshot: snapshot(),
  };
}

function hostToolExecution(): HostToolExecutionPort {
  return {
    execute: async () => ({ ok: true, output: 'tool output' }),
  };
}

function lastKnownTokens(events: AgentEvent[]): number | undefined {
  const tokens = events.flatMap((event) =>
    event.type === 'context/measurement' && event.measurement.occupancy.kind === 'known'
      ? [event.measurement.occupancy.tokensUsed]
      : [],
  );
  return tokens.at(-1);
}

function lastMeasurementId(events: AgentEvent[]): string | undefined {
  const ids = events.flatMap((event) =>
    event.type === 'usage/finalized' ? [event.measurement.measurementId] : [],
  );
  return ids.at(-1);
}

describe('SDK vs worker occupancy parity', () => {
  it('same fixture events produce the same occupancy tokensUsed and measurementId', async () => {
    const sdkEvents = await collectSdkEvents(occupancyFixture);
    const workerEvents = await collectWorkerEvents(occupancyFixture);
    expect(lastKnownTokens(sdkEvents)).toBe(90_000);
    expect(lastKnownTokens(workerEvents)).toBe(90_000);
    expect(lastMeasurementId(sdkEvents)).toBe(expectedMeasurementId);
    expect(lastMeasurementId(workerEvents)).toBe(expectedMeasurementId);
  });

  it('SDK setModel invalidates the previous measured occupancy', async () => {
    const listeners = new Set<(event: unknown) => void>();
    const emit = (event: unknown): void => {
      for (const listener of listeners) listener(event);
    };
    const setModel = vi.fn(async () => undefined);
    const fakeSession = {
      prompt: async (): Promise<void> => undefined,
      setModel,
      abort: async (): Promise<void> => undefined,
      subscribe: (listener: (event: unknown) => void): (() => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const createAgentSession = vi.fn(async () => ({ session: fakeSession }));
    const modelRuntime: PiModelRuntime = {
      registerProvider: vi.fn(),
      getModel: vi.fn(() => registeredModel),
      refresh: vi.fn(async () => undefined),
    };
    const handle = await createBackendSdkSession(
      { blueprint: blueprint(), providers: [], hostToolExecution: hostToolExecution() },
      {
        piModule: {
          DefaultResourceLoader: class {
            async reload(): Promise<void> {
              return undefined;
            }
          },
          createAgentSession,
          ModelRuntime: { create: vi.fn(async () => modelRuntime) },
          SettingsManager: {
            create: vi.fn(() => ({
              getRetryEnabled: () => true,
              getRetrySettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }),
              getProviderRetrySettings: () => ({ maxRetries: 2, timeoutMs: 5000 }),
            })),
          },
        },
        modelRuntime,
      },
    );
    const events: AgentEvent[] = [];
    handle.subscribe((event) => events.push(event));
    for (const raw of occupancyFixture) {
      emit(raw);
    }
    expect(lastKnownTokens(events)).toBe(90_000);
    await handle.prompt({
      text: 'switch',
      runId: 'run-switch',
      model: { providerId: 'p1', modelId: 'model-1' },
    });
    expect(setModel).toHaveBeenCalled();
    emit({
      type: 'message_start',
      messageId: 'm-2',
      role: 'assistant',
    });
    emit({
      type: 'message_update',
      messageId: 'm-2',
      assistantMessageEvent: { type: 'text_delta', delta: 'after switch' },
    });
    const afterSwitch = events.filter((event) => event.type === 'context/measurement').at(-1);
    expect(afterSwitch?.type === 'context/measurement' ? afterSwitch.measurement.occupancy.kind : undefined).toBe(
      'unknown',
    );
  });
});

async function collectSdkEvents(rawEvents: readonly unknown[]): Promise<AgentEvent[]> {
  let eventListener: ((event: unknown) => void) | undefined;
  const fakeSession = {
    prompt: async (): Promise<void> => undefined,
    abort: async (): Promise<void> => undefined,
    subscribe: (listener: (event: unknown) => void): (() => void) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    },
  };
  const createAgentSession = vi.fn(async () => ({ session: fakeSession }));
  const modelRuntime: PiModelRuntime = {
    registerProvider: vi.fn(),
    getModel: vi.fn(() => registeredModel),
    refresh: vi.fn(async () => undefined),
  };
  const handle = await createBackendSdkSession(
    { blueprint: blueprint(), providers: [], hostToolExecution: hostToolExecution() },
    {
      piModule: {
        DefaultResourceLoader: class {
          async reload(): Promise<void> {
            return undefined;
          }
        },
        createAgentSession,
        ModelRuntime: { create: vi.fn(async () => modelRuntime) },
        SettingsManager: {
          create: vi.fn(() => ({
            getRetryEnabled: () => true,
            getRetrySettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }),
            getProviderRetrySettings: () => ({ maxRetries: 2, timeoutMs: 5000 }),
          })),
        },
      },
      modelRuntime,
    },
  );
  const events: AgentEvent[] = [];
  handle.subscribe((event) => events.push(event));
  for (const raw of rawEvents) {
    eventListener?.(raw);
  }
  return events;
}

async function collectWorkerEvents(rawEvents: readonly unknown[]): Promise<AgentEvent[]> {
  const frames: WorkerFrame[] = [];
  const frameContext: WorkerFrameContext = {
    sessionId: identity.sessionId,
    runtimeGenerationId: identity.runtimeGenerationId,
  };
  const listeners = new Set<(raw: unknown) => void>();
  const handle: WorkerPiSessionLike = {
    id: identity.sessionId,
    prompt: async () => {
      for (const raw of rawEvents) {
        for (const listener of listeners) listener(raw);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const runtime = new WorkerSessionRuntime({
    sendFrame: (frame) => frames.push(frame),
    createPiSession: async () => handle,
  });
  const blueprintForWorker: SerializableBlueprint = {
    protocolVersion: 1,
    snapshotId: 'snap-parity',
    settingsRevision: 'r1',
    workingDirectory: '/tmp/occupancy-workspace',
    scope: { kind: 'general' },
    resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
    contextManifest: { agentsFiles: [] },
    tools: {
      enabledFamilies: [],
      piBuiltinToolNames: [],
      hostTools: [],
      enabledMcpServerIds: [],
    },
    activeSkillPaths: [],
    activeExtensionPaths: [],
    activePromptPaths: [],
  };
  const createRequest = (overrides: Partial<WorkerRequest>): WorkerRequest => ({
    type: 'request',
    id: 'req-create',
    method: 'session/create',
    context: frameContext,
    payload: {
      method: 'session/create',
      productSessionId: identity.sessionId,
      blueprint: blueprintForWorker,
    },
    ...overrides,
  });
  await runtime.handleRequest(createRequest({}));
  await runtime.handleRequest({
    type: 'request',
    id: 'req-prompt',
    method: 'session/prompt',
    context: { ...frameContext, runId: 'run-1' },
    payload: {
      method: 'session/prompt',
      sessionId: identity.sessionId,
      text: 'hello',
    },
  });
  return frames.flatMap((frame) => (frame.type === 'event' ? [frame.event] : []));
}
