import { describe, expect, it, vi } from 'vitest';
import type {
  BackendSessionBlueprint,
  HostToolDescriptor,
  HostToolExecutionPort,
  SessionCapabilitySnapshot,
} from '@piwin/contracts';
import type { PiModelRegistration, PiModelRuntime } from '../pi-model-runtime.js';
import type { PiBackendCustomToolDefinition } from './pi-backend-tool-adapter.js';
import { createBackendSdkSession } from './sdk-backend-session.js';
import { WorkerSessionBackend } from './worker-rpc-session-backend.js';
import { AgentWorkerSupervisor } from '../agent-worker-supervisor.js';
import { buildWorkerProxyTools } from '../rpc/worker-proxy-tool-factory.js';
import {
  projectBackendBlueprintForWorker,
  type SerializableBlueprint,
} from '../rpc/serializable-blueprint.js';

const registeredModel: PiModelRegistration = {
  id: 'model-1',
  name: 'Model 1',
  api: 'openai-completions',
  baseUrl: 'https://models.invalid',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

function createSnapshot(hostTools: HostToolDescriptor[]): SessionCapabilitySnapshot {
  return {
    version: 1,
    snapshotId: 'snapshot-1',
    inputs: {
      rulesRevision: 'rules-1',
      settingsRevision: 'settings-1',
      projectRevision: 'project-1',
      mcpRevision: 'mcp-1',
      resourceCatalogRevision: 'resources-1',
    },
    scope: { kind: 'general' },
    workingDirectory: '/tmp/backend-workspace',
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
      hostTools,
      piBuiltinToolNames: ['read'],
      enabledMcpServerIds: [],
      enabledFamilies: [],
    },
  };
}

function createBackendBlueprint(hostTools: HostToolDescriptor[]): BackendSessionBlueprint {
  return {
    version: 1,
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    capabilitySnapshot: createSnapshot(hostTools),
  };
}

function createHostToolExecutionPort(
  onInput: (input: Parameters<HostToolExecutionPort['execute']>[0]) => void,
): HostToolExecutionPort {
  return {
    execute: async (input) => {
      onInput(input);
      return { ok: true, output: 'tool output' };
    },
  };
}

function createPiModuleForTest(): {
  piModule: Record<string, unknown>;
  createAgentSession: ReturnType<typeof vi.fn>;
  getSessionOptions: () => Record<string, unknown>;
  getPromptCalls: () => Array<[string, unknown?]>;
  emit: (event: unknown) => void;
} {
  let resourceLoaderOptions: Record<string, unknown> | undefined;
  let sessionOptions: Record<string, unknown> | undefined;
  const promptCalls: Array<[string, unknown?]> = [];
  let eventListener: ((event: unknown) => void) | undefined;
  const fakeSession = {
    prompt: async (text: string, options?: unknown): Promise<void> => {
      promptCalls.push([text, options]);
    },
    abort: async (): Promise<void> => undefined,
    subscribe: (listener: (event: unknown) => void): (() => void) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    },
  };
  const createAgentSession = vi.fn(
    async (options: Record<string, unknown>): Promise<{ session: typeof fakeSession }> => {
      sessionOptions = options;
      return { session: fakeSession };
    },
  );
  class FakeResourceLoader {
    constructor(options: Record<string, unknown>) {
      resourceLoaderOptions = options;
    }

    async reload(): Promise<void> {
      return undefined;
    }
  }
  const modelRuntime: PiModelRuntime = {
    registerProvider: vi.fn(),
    getModel: vi.fn(() => registeredModel),
    refresh: vi.fn(async () => undefined),
  };
  return {
    piModule: {
      DefaultResourceLoader: FakeResourceLoader,
      createAgentSession,
      ModelRuntime: { create: vi.fn(async () => modelRuntime) },
    },
    createAgentSession,
    getSessionOptions: () => ({
      ...(sessionOptions ?? {}),
      ...(resourceLoaderOptions ? { resourceLoaderOptions } : {}),
    }),
    getPromptCalls: () => promptCalls,
    emit: (event) => eventListener?.(event),
  };
}

describe('backend input conformance', () => {
  it('gives SDK and worker the same complete descriptor array', async () => {
    const descriptor: HostToolDescriptor = {
      name: 'mcp__server__dynamic',
      description: 'Dynamic MCP tool',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'array', items: { type: 'string' } },
        },
        required: ['filter'],
      },
    };
    const moduleFixture = createPiModuleForTest();
    const sdkHandle = await createBackendSdkSession(
      {
        blueprint: createBackendBlueprint([descriptor]),
        providers: [],
        hostToolExecution: createHostToolExecutionPort(() => undefined),
      },
      {
        piModule: moduleFixture.piModule,
        modelRuntime: {
          registerProvider: vi.fn(),
          getModel: vi.fn(() => registeredModel),
          refresh: vi.fn(async () => undefined),
        },
      },
    );
    const sdkOptions = moduleFixture.getSessionOptions();
    const sdkTools = sdkOptions.customTools as PiBackendCustomToolDefinition[];
    const serializableBlueprint = projectBackendBlueprintForWorker(
      createBackendBlueprint([descriptor]),
    );
    const workerTools = buildWorkerProxyTools(serializableBlueprint, vi.fn(), 'sess-test');

    expect(
      sdkTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    ).toEqual(
      workerTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    );

    // Pi filters customTools through the global `tools` allowlist. Host tool
    // names must appear there or bash/MCP/web never reach the model.
    expect(sdkOptions.tools).toEqual(expect.arrayContaining(['read', 'mcp__server__dynamic']));

    const sdkTool = sdkTools[0];
    if (!sdkTool) {
      throw new Error('SDK tool descriptor was not registered');
    }
    await sdkHandle.prompt({
      text: 'inspect image',
      images: [{ dataBase64: 'AAAA', mimeType: 'image/png' }],
    });
    expect(moduleFixture.getPromptCalls()).toEqual([
      ['inspect image', { images: [{ data: 'AAAA', mimeType: 'image/png' }] }],
    ]);

    const events: import('@piwin/contracts').AgentEvent[] = [];
    sdkHandle.subscribe((event) => events.push(event));
    moduleFixture.emit({
      type: 'message_update',
      messageId: 'backend-message-1',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message/text_delta',
      messageId: expect.stringMatching(/^piw-m-/),
      delta: 'hello',
    });
    expect(events[0]).not.toMatchObject({ messageId: 'backend-message-1' });
  });

  it('rejects malformed Blueprints before calling createAgentSession', async () => {
    const moduleFixture = createPiModuleForTest();
    const malformedBlueprint = {
      ...createBackendBlueprint([]),
      version: 2,
    } as unknown as BackendSessionBlueprint;

    await expect(
      createBackendSdkSession(
        {
          blueprint: malformedBlueprint,
          providers: [],
          hostToolExecution: createHostToolExecutionPort(() => undefined),
        },
        { piModule: moduleFixture.piModule },
      ),
    ).rejects.toThrow('malformed BackendSessionBlueprint');
    expect(moduleFixture.createAgentSession).not.toHaveBeenCalled();
  });

  it('rejects a capability snapshot with an incomplete revision set', async () => {
    const moduleFixture = createPiModuleForTest();
    const malformedBlueprint = structuredClone(
      createBackendBlueprint([]),
    ) as BackendSessionBlueprint;
    malformedBlueprint.capabilitySnapshot.inputs.rulesRevision = '';

    await expect(
      createBackendSdkSession(
        {
          blueprint: malformedBlueprint,
          providers: [],
          hostToolExecution: createHostToolExecutionPort(() => undefined),
        },
        { piModule: moduleFixture.piModule },
      ),
    ).rejects.toThrow('malformed BackendSessionBlueprint');
    expect(moduleFixture.createAgentSession).not.toHaveBeenCalled();
  });

  it('rejects non-canonical Host tool names at the backend boundary', async () => {
    const moduleFixture = createPiModuleForTest();
    const malformedBlueprint = createBackendBlueprint([
      {
        name: ' known_tool ',
        description: 'Known',
        parameters: { type: 'object', properties: {} },
      },
    ]);

    await expect(
      createBackendSdkSession(
        {
          blueprint: malformedBlueprint,
          providers: [],
          hostToolExecution: createHostToolExecutionPort(() => undefined),
        },
        { piModule: moduleFixture.piModule },
      ),
    ).rejects.toThrow('malformed BackendSessionBlueprint');
    expect(moduleFixture.createAgentSession).not.toHaveBeenCalled();
  });

  it('rejects worker tool names absent from the compiled descriptor array', async () => {
    const descriptor: HostToolDescriptor = {
      name: 'known_tool',
      description: 'Known',
      parameters: { type: 'object', properties: {} },
    };
    const blueprint: SerializableBlueprint = projectBackendBlueprintForWorker(
      createBackendBlueprint([descriptor]),
    );
    const executionInputs: string[] = [];
    const backend = new WorkerSessionBackend({
      supervisor: new AgentWorkerSupervisor({ worker: { workerScript: '/tmp/unused' } }),
    });
    type TestActiveSession = {
      blueprint: SerializableBlueprint;
      productSessionId: string;
      runtimeGenerationId: string;
      hostToolExecution: HostToolExecutionPort;
    };
    const sessions = Reflect.get(backend, 'sessions') as Map<string, TestActiveSession>;
    sessions.set('session-1\u0000generation-1', {
      blueprint,
      productSessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      hostToolExecution: createHostToolExecutionPort((input) =>
        executionInputs.push(input.toolName),
      ),
    });
    const executeHostTool = Reflect.get(backend, 'executeHostTool');
    if (typeof executeHostTool !== 'function') {
      throw new Error('worker tool executor is unavailable');
    }
    const result = await (
      executeHostTool as (
        frame: {
          context: { sessionId: string; runtimeGenerationId: string };
          toolName: string;
          id: string;
          args: unknown;
        },
        signal: AbortSignal,
      ) => Promise<{ ok: boolean; code?: string }>
    ).call(
      backend,
      {
        context: { sessionId: 'session-1', runtimeGenerationId: 'generation-1' },
        toolName: 'unknown_tool',
        id: 'call-1',
        args: {},
      },
      new AbortController().signal,
    );
    expect(result).toEqual({
      ok: false,
      code: 'tool-not-available',
      message: 'tool is not present in the compiled blueprint: unknown_tool',
    });
    expect(executionInputs).toEqual([]);
  });

  it('does not route a stale frame to the current generation fallback', async () => {
    const descriptor: HostToolDescriptor = {
      name: 'known_tool',
      description: 'Known',
      parameters: { type: 'object', properties: {} },
    };
    const blueprint: SerializableBlueprint = projectBackendBlueprintForWorker(
      createBackendBlueprint([descriptor]),
    );
    const executionInputs: string[] = [];
    const backend = new WorkerSessionBackend({
      supervisor: new AgentWorkerSupervisor({ worker: { workerScript: '/tmp/unused' } }),
    });
    type TestActiveSession = {
      blueprint: SerializableBlueprint;
      productSessionId: string;
      runtimeGenerationId: string;
      hostToolExecution: HostToolExecutionPort;
    };
    const sessions = Reflect.get(backend, 'sessions') as Map<string, TestActiveSession>;
    sessions.set('session-1\u0000generation-current', {
      blueprint,
      productSessionId: 'session-1',
      runtimeGenerationId: 'generation-current',
      hostToolExecution: createHostToolExecutionPort((input) =>
        executionInputs.push(input.runtimeGenerationId),
      ),
    });
    const executeHostTool = Reflect.get(backend, 'executeHostTool');
    if (typeof executeHostTool !== 'function') {
      throw new Error('worker tool executor is unavailable');
    }
    const result = await (
      executeHostTool as (
        frame: {
          context: { sessionId: string; runtimeGenerationId: string; runId: string };
          toolName: string;
          id: string;
          args: unknown;
        },
        signal: AbortSignal,
      ) => Promise<{ ok: boolean; code?: string; message?: string }>
    ).call(
      backend,
      {
        context: {
          sessionId: 'session-1',
          runtimeGenerationId: 'generation-stale',
          runId: 'run-1',
        },
        toolName: 'known_tool',
        id: 'call-1',
        args: {},
      },
      new AbortController().signal,
    );
    expect(result).toEqual({
      ok: false,
      code: 'tool-not-available',
      message: 'unknown worker session: session-1',
    });
    expect(executionInputs).toEqual([]);
  });
});
