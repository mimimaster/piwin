import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentPromptOutcome,
  BackendSessionBlueprint,
  HostToolExecutionPort,
  SessionCapabilitySnapshot,
} from '@piwin/contracts';
import { createBackendSdkSession } from './backends/sdk-backend-session.js';
import type { PiModelRuntime } from './pi-model-runtime.js';
import { loadModelStreamFixture } from './fixtures/model-stream/load-model-stream-fixture.js';
import { WorkerSessionRuntime, type WorkerPiSessionLike } from './rpc/worker-session-runtime.js';
import type { WorkerFrame, WorkerFrameContext } from './rpc-sdk-worker-protocol.js';
import type { SerializableBlueprint } from './rpc/serializable-blueprint.js';
import { canCarryAgentEventRunId } from './agent-event-run-id.js';

const RUN_ID = 'run-fixture';

const expectedOutcomes: Record<string, AgentPromptOutcome> = {
  'thinking-only-stop.json': { status: 'completed', stopReason: 'stop' },
  'text-stop.json': { status: 'completed', stopReason: 'stop' },
  'tool-then-stop.json': { status: 'completed', stopReason: 'stop' },
  'missing-finish.json': {
    status: 'failed',
    stopReason: 'error',
    failure: {
      code: 'model-stream-missing-finish',
      origin: 'protocol',
      message: 'Stream ended without finish_reason',
      retriable: true,
    },
  },
  'provider-error.json': {
    status: 'failed',
    stopReason: 'error',
    failure: {
      code: 'provider-authentication',
      origin: 'provider',
      message: '401: Invalid Authentication',
      retriable: false,
      httpStatus: 401,
    },
  },
  'aborted.json': {
    status: 'aborted',
    stopReason: 'aborted',
    message: 'Request was aborted',
  },
};

const fixtureNames = Object.keys(expectedOutcomes);

const snapshot: SessionCapabilitySnapshot = {
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
    hostTools: [],
    piBuiltinToolNames: ['read'],
    enabledMcpServerIds: [],
    enabledFamilies: [],
  },
};

const blueprint: BackendSessionBlueprint = {
  version: 1,
  sessionId: 'session-1',
  runtimeGenerationId: 'generation-1',
  capabilitySnapshot: snapshot,
};

const hostToolExecution: HostToolExecutionPort = {
  execute: async () => ({ ok: true, output: 'unused' }),
};

const modelRuntime: PiModelRuntime = {
  registerProvider: vi.fn(),
  getModel: vi.fn(),
  refresh: vi.fn(async () => undefined),
};

const workerBlueprint: SerializableBlueprint = {
  protocolVersion: 1,
  snapshotId: 'snap-1',
  settingsRevision: 'r1',
  workingDirectory: '/tmp/work',
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

const workerContext: WorkerFrameContext = {
  sessionId: 'ps-1',
  runtimeGenerationId: 'gen-1',
  runId: RUN_ID,
};

function createPiModule(events: readonly unknown[]): Record<string, unknown> {
  const listeners = new Set<(event: unknown) => void>();
  const fakeSession = {
    prompt: async (): Promise<void> => {
      for (const event of events) {
        for (const listener of listeners) {
          listener(event);
        }
      }
    },
    abort: async (): Promise<void> => undefined,
    subscribe: (listener: (event: unknown) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    DefaultResourceLoader: class {
      async reload(): Promise<void> {
        return undefined;
      }
    },
    createAgentSession: async () => ({ session: fakeSession }),
    ModelRuntime: { create: vi.fn(async () => modelRuntime) },
    SettingsManager: {
      create: vi.fn(() => ({
        getRetryEnabled: () => true,
        getRetrySettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }),
        getHttpIdleTimeoutMs: () => 0,
      })),
    },
  };
}

function createWorkerSession(events: readonly unknown[]): WorkerPiSessionLike {
  const listeners = new Set<(raw: unknown) => void>();
  return {
    id: 'pi-s1',
    prompt: async () => {
      for (const event of events) {
        for (const listener of listeners) {
          listener(event);
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function assertForegroundEventsCarryRunId(events: readonly AgentEvent[], runId: string): void {
  for (const event of events) {
    if (!canCarryAgentEventRunId(event)) {
      expect(event).not.toHaveProperty('runId');
      continue;
    }
    expect(event).toMatchObject({ runId });
  }
}

describe('SDK/RPC prompt outcome parity', () => {
  it.each(fixtureNames)('returns the same outcome from SDK and worker for %s', async (name) => {
    const events = loadModelStreamFixture(name);
    const expected = expectedOutcomes[name];
    if (!expected) {
      throw new Error(`missing expected outcome for ${name}`);
    }

    const sdkEvents: AgentEvent[] = [];
    const sdk = await createBackendSdkSession(
      {
        blueprint,
        providers: [],
        hostToolExecution,
      },
      {
        piModule: createPiModule(events),
        modelRuntime,
      },
    );
    const unsubscribeSdk = sdk.subscribe((event) => {
      sdkEvents.push(event);
    });
    const sdkOutcome = await sdk.prompt({ text: 'go', runId: RUN_ID });
    unsubscribeSdk();

    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createWorkerSession(events),
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'create',
      method: 'session/create',
      context: workerContext,
      payload: {
        method: 'session/create',
        productSessionId: 'ps-1',
        blueprint: workerBlueprint,
      },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'prompt',
      method: 'session/prompt',
      context: workerContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'go' },
    });
    const workerResponse = frames.find(
      (frame) => frame.type === 'response' && frame.id === 'prompt',
    );
    if (workerResponse?.type !== 'response') {
      throw new Error('worker prompt response was not sent');
    }
    const workerEvents = frames
      .filter((frame): frame is Extract<WorkerFrame, { type: 'event' }> => frame.type === 'event')
      .map((frame) => frame.event);

    expect(sdkOutcome).toEqual(expected);
    expect(workerResponse.data).toEqual(expected);
    assertForegroundEventsCarryRunId(sdkEvents, RUN_ID);
    assertForegroundEventsCarryRunId(workerEvents, RUN_ID);
  });
});
