import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, BackendRunInterventionEvent } from '@piwin/contracts';
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
const promptContext: WorkerFrameContext = {
  ...frameContext,
  runId: 'run-1',
};
const handledPromptOutcome = { status: 'completed', stopReason: 'handled' } as const;
const normalizedMessageId = normalizeGenerationMessageId(frameContext, 'm1');

function fakeMapper() {
  return {
    map: (raw: unknown): AgentEvent[] => [
      {
        // The mock Pi session emits `{ type: 'text', text: '...' }`; map it to
        // a valid AgentEvent (message/text_snapshot) with the extracted text.
        type: 'message/text_snapshot',
        messageId: 'm1',
        text: (raw as { text?: string } | null)?.text ?? String(raw),
      },
    ],
  };
}

function createMockPiSession(
  sessionId = 'pi-s1',
  unsubscribe = vi.fn(),
  promptEvents?: readonly unknown[],
): WorkerPiSessionLike & { emit(raw: unknown): void } {
  const listeners = new Set<(raw: unknown) => void>();
  const emit = (raw: unknown): void => {
    for (const listener of listeners) {
      listener(raw);
    }
  };
  return {
    id: sessionId,
    prompt: vi.fn(async () => {
      if (promptEvents) {
        for (const event of promptEvents) {
          emit(event);
        }
        return;
      }
      emit({ type: 'text', text: 'mock reply' });
    }),
    steer: vi.fn(async () => {
      emit({ type: 'text', text: 'steered' });
    }),
    followUp: vi.fn(async () => {
      emit({ type: 'text', text: 'followed' });
    }),
    abort: vi.fn(async () => undefined),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) {
          unsubscribe();
        }
      };
    },
    emit,
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

  it('round-trips the per-session auto-compaction setting', async () => {
    const frames: WorkerFrame[] = [];
    let enabled = true;
    const session = createMockPiSession();
    session.getAutoCompactionEnabled = () => enabled;
    session.setAutoCompactionEnabled = (next) => {
      enabled = next;
    };
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => session,
      eventMapper: fakeMapper(),
    });

    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-get-auto',
      method: 'session/get-auto-compaction',
      context: frameContext,
      payload: { method: 'session/get-auto-compaction', sessionId: 'ps-1' },
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-get-auto',
      context: frameContext,
      success: true,
      data: { enabled: true },
    });

    await runtime.handleRequest({
      type: 'request',
      id: 'req-set-auto',
      method: 'session/set-auto-compaction',
      context: frameContext,
      payload: { method: 'session/set-auto-compaction', sessionId: 'ps-1', enabled: false },
    });
    expect(enabled).toBe(false);
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-set-auto',
      context: frameContext,
      success: true,
      data: { enabled: false },
    });
  });

  it('waits for a parent permit before accepting a worker intervention claim', async () => {
    const frames: WorkerFrame[] = [];
    let interventionListener:
      ((event: BackendRunInterventionEvent) => Promise<{ accepted: boolean }>) | undefined;
    const session: WorkerPiSessionLike = {
      ...createMockPiSession(),
      armRunIntervention: vi.fn(async () => undefined),
      cancelRunIntervention: vi.fn(async () => true),
      subscribeRunInterventions(listener) {
        interventionListener = listener;
        return () => {
          interventionListener = undefined;
        };
      },
    };
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => session,
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-arm',
      method: 'session/intervention-arm',
      context: { ...frameContext, runId: 'run-1' },
      payload: {
        method: 'session/intervention-arm',
        sessionId: 'ps-1',
        intervention: {
          interventionId: 'intervention-1',
          revision: 1,
          sessionId: 'ps-1',
          runId: 'run-1',
          runtimeGenerationId: 'gen-1',
          sequence: 1,
          text: 'change direction',
        },
      },
    });

    const claimPromise = interventionListener?.({
      type: 'claim',
      interventionId: 'intervention-1',
      revision: 1,
      runId: 'run-1',
      runtimeGenerationId: 'gen-1',
    });
    const claim = frames.find(
      (frame): frame is Extract<WorkerFrame, { type: 'intervention-claim' }> =>
        frame.type === 'intervention-claim',
    );
    if (!claim || !claimPromise) throw new Error('worker intervention claim was not emitted');
    runtime.handleInterventionPermit({
      type: 'intervention-permit',
      id: claim.id,
      context: claim.context,
      accepted: true,
    });
    await expect(claimPromise).resolves.toEqual({ accepted: true });
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
      context: promptContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });

    expect(frames).toContainEqual({
      type: 'event',
      context: promptContext,
      event: {
        type: 'message/text_snapshot',
        messageId: normalizedMessageId,
        text: 'mock reply',
        runId: 'run-1',
      },
    } satisfies WorkerEvent);
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-2',
      context: promptContext,
      success: true,
      data: handledPromptOutcome,
    });
  });

  it('emits context/measurement and usage/finalized from mapped worker events', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () =>
        createMockPiSession('pi-s1', vi.fn(), [
          { type: 'message_start', messageId: 'm1', role: 'assistant' },
          {
            type: 'message_update',
            messageId: 'm1',
            assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
          },
          {
            type: 'message_end',
            messageId: 'm1',
            message: {
              role: 'assistant',
              id: 'm1',
              usage: { input: 80, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 90 },
              stopReason: 'stop',
            },
          },
        ]),
    });
    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-usage',
      method: 'session/prompt',
      context: promptContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });
    const events = frames.flatMap((frame) => (frame.type === 'event' ? [frame.event] : []));
    expect(events.some((event) => event.type === 'context/measurement')).toBe(true);
    expect(events.some((event) => event.type === 'usage/finalized')).toBe(true);
    const known = events.flatMap((event) =>
      event.type === 'context/measurement' && event.measurement.occupancy.kind === 'known'
        ? [event.measurement.occupancy.tokensUsed]
        : [],
    );
    expect(known.at(-1)).toBe(90);
    const finalized = events.find((event) => event.type === 'usage/finalized');
    expect(finalized?.type === 'usage/finalized' ? finalized.measurement.totalTokens : undefined).toBe(
      90,
    );
  });

  it('keeps occupancy when a worker prompt repeats the same model', async () => {
    const frames: WorkerFrame[] = [];
    let prompts = 0;
    const session = createMockPiSession();
    session.prompt = vi.fn(async () => {
      prompts += 1;
      if (prompts === 1) {
        session.emit({ type: 'message_start', messageId: 'm1', role: 'assistant' });
        session.emit({
          type: 'message_end',
          messageId: 'm1',
          message: {
            role: 'assistant',
            id: 'm1',
            usage: { input: 80, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 90 },
            stopReason: 'stop',
          },
        });
      }
    });
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => session,
    });
    await runtime.handleRequest(createRequest());
    const model = { providerId: 'p1', modelId: 'm1' };
    await runtime.handleRequest({
      type: 'request',
      id: 'req-first',
      method: 'session/prompt',
      context: promptContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello', model },
    });
    expect(
      frames.flatMap((frame) =>
        frame.type === 'event' &&
        frame.event.type === 'context/measurement' &&
        frame.event.measurement.occupancy.kind === 'known'
          ? [frame.event.measurement.occupancy.tokensUsed]
          : [],
      ).at(-1),
    ).toBe(90);
    await runtime.handleRequest({
      type: 'request',
      id: 'req-same',
      method: 'session/prompt',
      context: promptContext,
      payload: {
        method: 'session/prompt',
        sessionId: 'ps-1',
        text: 'again',
        model,
      },
    });
    const lastOccupancy = frames
      .flatMap((frame) =>
        frame.type === 'event' && frame.event.type === 'context/measurement'
          ? [frame.event.measurement.occupancy]
          : [],
      )
      .at(-1);
    expect(lastOccupancy).toMatchObject({ kind: 'known', tokensUsed: 90 });
  });

  it('invalidates occupancy when a worker prompt selects a different model', async () => {
    const frames: WorkerFrame[] = [];
    let prompts = 0;
    const session = createMockPiSession();
    session.prompt = vi.fn(async () => {
      prompts += 1;
      if (prompts === 1) {
        session.emit({ type: 'message_start', messageId: 'm1', role: 'assistant' });
        session.emit({
          type: 'message_end',
          messageId: 'm1',
          message: {
            role: 'assistant',
            id: 'm1',
            usage: { input: 80, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 90 },
            stopReason: 'stop',
          },
        });
      }
    });
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => session,
    });
    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-first',
      method: 'session/prompt',
      context: promptContext,
      payload: {
        method: 'session/prompt',
        sessionId: 'ps-1',
        text: 'hello',
        model: { providerId: 'p1', modelId: 'm1' },
      },
    });
    expect(
      frames.flatMap((frame) =>
        frame.type === 'event' &&
        frame.event.type === 'context/measurement' &&
        frame.event.measurement.occupancy.kind === 'known'
          ? [frame.event.measurement.occupancy.tokensUsed]
          : [],
      ).at(-1),
    ).toBe(90);
    await runtime.handleRequest({
      type: 'request',
      id: 'req-model',
      method: 'session/prompt',
      context: promptContext,
      payload: {
        method: 'session/prompt',
        sessionId: 'ps-1',
        text: 'switch',
        model: { providerId: 'p1', modelId: 'm2' },
      },
    });
    const lastOccupancy = frames
      .flatMap((frame) =>
        frame.type === 'event' && frame.event.type === 'context/measurement'
          ? [frame.event.measurement.occupancy]
          : [],
      )
      .at(-1);
    expect(lastOccupancy).toEqual({ kind: 'unknown', reason: 'no-measurement' });
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
      context: promptContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'product prompt' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'prompt-worker',
      method: 'session/prompt',
      context: promptContext,
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
      context: promptContext,
      event: {
        type: 'message/text_snapshot',
        messageId: normalizedMessageId,
        text: 'mock reply',
        runId: 'run-1',
      },
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

  it('returns a protocol failure when a foreground prompt omits runId', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-missing-run',
      method: 'session/prompt',
      context: frameContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-missing-run',
      context: frameContext,
      success: true,
      data: {
        status: 'failed',
        stopReason: 'error',
        failure: expect.objectContaining({
          code: 'backend-protocol-error',
          message: 'foreground worker prompt requires runId',
        }),
      },
    });
  });

  it('drops a worker event whose runId disagrees with the frame', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: {
        map: (): AgentEvent[] => [
          {
            type: 'message/text_snapshot',
            messageId: 'm1',
            text: 'mismatch',
            runId: 'other-run',
          },
        ],
      },
    });
    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-mismatch',
      method: 'session/prompt',
      context: promptContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });
    expect(frames.filter((frame) => frame.type === 'event')).toEqual([]);
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-mismatch',
      context: promptContext,
      success: true,
      data: handledPromptOutcome,
    });
  });

  it('keeps trailing abort events on the settled Run', async () => {
    const frames: WorkerFrame[] = [];
    const session = createMockPiSession();
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => session,
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-trail',
      method: 'session/prompt',
      context: promptContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });
    session.emit({ type: 'text', text: 'late abort' });
    expect(frames).toContainEqual({
      type: 'event',
      context: promptContext,
      event: {
        type: 'message/text_snapshot',
        messageId: normalizedMessageId,
        text: 'late abort',
        runId: 'run-1',
      },
    } satisfies WorkerEvent);
  });

  it('prefers a parsed-stream stall over the native abort outcome', async () => {
    const frames: WorkerFrame[] = [];
    const session = createMockPiSession();
    session.consumeParsedStreamStall = () => ({
      code: 'model-stream-stalled',
      origin: 'transport',
      message:
        'Model stream stalled: no model progress was received for 1 seconds while the connection remained open.',
      retriable: true,
    });
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => session,
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());
    await runtime.handleRequest({
      type: 'request',
      id: 'req-stall',
      method: 'session/prompt',
      context: promptContext,
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-stall',
      context: promptContext,
      success: true,
      data: {
        status: 'failed',
        stopReason: 'error',
        failure: expect.objectContaining({ code: 'model-stream-stalled' }),
      },
    });
  });
});
