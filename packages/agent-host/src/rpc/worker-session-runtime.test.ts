import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from '@piwin/contracts';
import type { PiBackendCustomToolDefinition } from '../backends/pi-backend-tool-adapter.js';
import type {
  WorkerEvent,
  WorkerFrame,
  WorkerFrameContext,
  WorkerRequest,
} from '../rpc-sdk-worker-protocol.js';
import { WorkerSessionRuntime, type WorkerPiSessionLike } from './worker-session-runtime.js';
import { normalizeGenerationMessageId } from '../generation-identity.js';
import type { SerializableBlueprint } from './serializable-blueprint.js';

const minimalBlueprint: SerializableBlueprint = {
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

const frameContext: WorkerFrameContext = {
  sessionId: 'ps-1',
  runtimeGenerationId: 'gen-1',
};
const normalizedMessageId = normalizeGenerationMessageId(frameContext, 'm1');

function fakeMapper() {
  return {
    map: (raw: unknown): Array<{ event: AgentEvent; envelope: AgentEventEnvelope }> => [
      {
        // The mock Pi session emits `{ type: 'text', text: '...' }`; map it to
        // a valid AgentEvent (message/text_snapshot) with the extracted text.
        event: {
          type: 'message/text_snapshot',
          messageId: 'm1',
          text: (raw as { text?: string } | null)?.text ?? String(raw),
        },
        envelope: { eventId: 'evt-1', sequence: 1 },
      },
    ],
  };
}

function createMockPiSession(sessionId = 'pi-s1', unsubscribe = vi.fn()): WorkerPiSessionLike {
  let listener: ((raw: unknown) => void) | null = null;
  return {
    id: sessionId,
    prompt: vi.fn(async () => {
      listener?.({ type: 'text', text: 'mock reply' });
    }),
    steer: vi.fn(async () => {
      listener?.({ type: 'text', text: 'steered' });
    }),
    followUp: vi.fn(async () => {
      listener?.({ type: 'text', text: 'followed' });
    }),
    abort: vi.fn(async () => undefined),
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = null;
        unsubscribe();
      };
    },
  };
}

function createRequest(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
  return {
    type: 'request',
    id: 'req-1',
    method: 'session/create',
    context: frameContext,
    payload: {
      method: 'session/create',
      productSessionId: 'ps-1',
      blueprint: minimalBlueprint,
    },
    ...overrides,
  };
}

describe('WorkerSessionRuntime', () => {
  it('creates a blueprint session and attaches the product session id', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn(async () => createMockPiSession());
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
    });

    await runtime.handleRequest(createRequest());
    expect(createPiSession).toHaveBeenCalledWith(
      expect.objectContaining({ productSessionId: 'ps-1', blueprint: minimalBlueprint }),
    );
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-1',
      context: frameContext,
      success: true,
      data: { sessionId: 'pi-s1' },
    });
  });

  it('rejects a forged inline provider before creating a Pi session', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn(async () => createMockPiSession());
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
    });
    const request = {
      type: 'request',
      id: 'req-inline',
      method: 'session/create',
      context: frameContext,
      payload: {
        method: 'session/create',
        productSessionId: 'ps-1',
        blueprint: minimalBlueprint,
        providers: [
          {
            providerId: 'forged-provider',
            protocol: 'openai-compatible',
            baseUrl: 'https://example.invalid/v1',
            models: [{ id: 'forged-model' }],
            auth: { kind: 'inline', apiKey: 'must-not-cross-jsonl' },
          },
        ],
      },
    } as unknown as WorkerRequest;

    await runtime.handleRequest(request);

    expect(createPiSession).not.toHaveBeenCalled();
    expect(frames).toContainEqual(
      expect.objectContaining({
        type: 'response',
        id: 'req-inline',
        success: false,
        error: expect.stringContaining('SDK-only inline auth at the worker boundary'),
      }),
    );
  });

  it('round-trips the complete ToolResult through the proxy frame', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn(
      async (_options: { proxyTools?: PiBackendCustomToolDefinition[] }) => createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });
    const blueprint: SerializableBlueprint = {
      ...minimalBlueprint,
      tools: {
        ...minimalBlueprint.tools,
        hostTools: [
          {
            name: 'web_search',
            description: 'Search the web',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    };

    await runtime.handleRequest(
      createRequest({
        payload: {
          method: 'session/create',
          productSessionId: 'ps-1',
          blueprint,
        },
      }),
    );

    const proxyTool = createPiSession.mock.calls[0]?.[0]?.proxyTools?.[0];
    if (!proxyTool) {
      throw new Error('worker proxy tool was not created');
    }
    const resultPromise = proxyTool.execute(
      'tool-call-1',
      {},
      new AbortController().signal,
      undefined,
      undefined,
    );
    const toolCall = frames.find(
      (frame): frame is Extract<WorkerFrame, { type: 'tool-call' }> => frame.type === 'tool-call',
    );
    if (!toolCall) {
      throw new Error('worker tool-call frame was not emitted');
    }
    expect(toolCall.context.toolCallId).toMatch(/^piw-t-/);
    expect(toolCall.id).toBe(toolCall.context.toolCallId);

    runtime.handleToolResult({
      type: 'tool-result',
      id: toolCall.id,
      context: toolCall.context,
      ok: true,
      result: {
        ok: true,
        output: 'parent output',
        details: { runId: 'run-1' },
      },
    });

    await expect(resultPromise).resolves.toMatchObject({
      content: [{ type: 'text', text: 'parent output' }],
      details: expect.objectContaining({ runId: 'run-1' }),
    });
  });

  it('prompts a session and streams normalized events', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());

    await runtime.handleRequest({
      type: 'request',
      id: 'req-2',
      method: 'session/prompt',
      context: frameContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });

    expect(frames).toContainEqual({
      type: 'event',
      context: frameContext,
      event: { type: 'message/text_snapshot', messageId: normalizedMessageId, text: 'mock reply' },
    } satisfies WorkerEvent);
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-2',
      context: frameContext,
      success: true,
      data: {},
    });
  });

  it('supports distinct product and worker ids across the session lifecycle', async () => {
    const frames: WorkerFrame[] = [];
    const unsubscribe = vi.fn();
    const piSession = createMockPiSession('worker-s1', unsubscribe);
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => piSession,
      eventMapper: fakeMapper(),
    });

    await runtime.handleRequest(createRequest());
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-1',
      context: frameContext,
      success: true,
      data: { sessionId: 'worker-s1' },
    });

    await runtime.handleRequest({
      type: 'request',
      id: 'prompt-product',
      method: 'session/prompt',
      context: frameContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'product prompt' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'prompt-worker',
      method: 'session/prompt',
      context: frameContext,
      payload: { method: 'session/prompt', sessionId: 'worker-s1', text: 'worker prompt' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'abort-worker',
      method: 'session/abort',
      context: frameContext,
      payload: { method: 'session/abort', sessionId: 'worker-s1' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'drop-product',
      method: 'session/drop',
      context: frameContext,
      payload: { method: 'session/drop', sessionId: 'ps-1' },
    });

    expect(piSession.prompt).toHaveBeenCalledTimes(2);
    expect(piSession.abort).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(frames).toContainEqual({
      type: 'event',
      context: frameContext,
      event: { type: 'message/text_snapshot', messageId: normalizedMessageId, text: 'mock reply' },
    } satisfies WorkerEvent);

    await runtime.handleRequest({
      type: 'request',
      id: 'prompt-after-drop',
      method: 'session/prompt',
      context: frameContext,
      payload: { method: 'session/prompt', sessionId: 'worker-s1', text: 'late' },
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'prompt-after-drop',
      context: frameContext,
      success: false,
      error: 'unknown session: worker-s1',
    });
  });

  it('prompting an unknown session fails loudly', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'req-x',
      method: 'session/prompt',
      context: frameContext,
      payload: { method: 'session/prompt', sessionId: 'nope', text: 'hi' },
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-x',
      context: frameContext,
      success: false,
      error: 'unknown session: nope',
    });
  });

  it('rejects a malformed blueprint before creating a Pi session', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn(async () => createMockPiSession());
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
    });
    const malformedBlueprint = {
      ...minimalBlueprint,
      protocolVersion: 2,
    } as unknown as typeof minimalBlueprint;

    await runtime.handleRequest({
      type: 'request',
      id: 'malformed-1',
      method: 'session/create',
      context: { sessionId: 'ps-malformed', runtimeGenerationId: 'gen-1' },
      payload: {
        method: 'session/create',
        productSessionId: 'ps-malformed',
        blueprint: malformedBlueprint,
      },
    });

    expect(createPiSession).not.toHaveBeenCalled();
    expect(frames).toContainEqual({
      type: 'response',
      id: 'malformed-1',
      context: { sessionId: 'ps-malformed', runtimeGenerationId: 'gen-1' },
      success: false,
      error: 'malformed SerializableBlueprint',
    });
  });

  it('routes steer and follow-up to the session', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession('worker-s1'),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());

    await runtime.handleRequest({
      type: 'request',
      id: 'r1',
      method: 'session/steer',
      context: frameContext,
      payload: { method: 'session/steer', sessionId: 'worker-s1', message: 'go on' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'r2',
      method: 'session/follow-up',
      context: frameContext,
      payload: { method: 'session/follow-up', sessionId: 'worker-s1', message: 'thanks' },
    });

    expect(frames).toContainEqual({
      type: 'event',
      context: frameContext,
      event: { type: 'message/text_snapshot', messageId: normalizedMessageId, text: 'steered' },
    } satisfies WorkerEvent);
    expect(frames).toContainEqual({
      type: 'event',
      context: frameContext,
      event: { type: 'message/text_snapshot', messageId: normalizedMessageId, text: 'followed' },
    } satisfies WorkerEvent);
  });

  it('aborts a session and then drop removes it', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());

    await runtime.handleRequest({
      type: 'request',
      id: 'r3',
      method: 'session/abort',
      context: frameContext,
      payload: { method: 'session/abort', sessionId: 'ps-1' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'r4',
      method: 'session/drop',
      context: frameContext,
      payload: { method: 'session/drop', sessionId: 'ps-1' },
    });
    // After drop, prompt fails.
    await runtime.handleRequest({
      type: 'request',
      id: 'r5',
      method: 'session/prompt',
      context: frameContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'late' },
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'r3',
      context: frameContext,
      success: true,
      data: {},
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'r4',
      context: frameContext,
      success: true,
      data: {},
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'r5',
      context: frameContext,
      success: false,
      error: 'unknown session: ps-1',
    });
  });
});
