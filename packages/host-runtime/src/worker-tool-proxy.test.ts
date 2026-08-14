/**
 * WP4 tests: tool proxy end-to-end (worker runtime + parent client routing).
 *
 * Tests that:
 * - enabled family executes in parent (spy on HostToolExecutionRouter)
 * - disabled family never registers (empty hostTools → no proxy tools)
 * - abort cancels outstanding tool proxy
 * - permission deny returns structured tool error to model path
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentEventEnvelope,
  HostToolExecutionContext,
  HostToolRegistration,
  ToolResult,
} from '@piwin/contracts';
import type {
  WorkerFrame,
  WorkerRequest,
  WorkerToolResultFrame,
  SerializableBlueprint,
  WorkerPiSessionLike,
} from '@piwin/agent-host';
import { WorkerSessionRuntime, RpcSdkWorkerClient } from '@piwin/agent-host';
import { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';

function fakeHostTool(
  name: string,
  execute: HostToolRegistration['execute'],
): HostToolRegistration {
  const permissionSpec =
    name === 'bash'
      ? {
          action: 'bash',
          risk: 'command' as const,
          rememberable: false,
          subjectBuilder: (args: Record<string, unknown>) => ({
            kind: 'bash' as const,
            command: String(args.command ?? ''),
          }),
        }
      : {
          action: 'filesystem:read',
          risk: 'unknown' as const,
          rememberable: false,
          readOnly: true,
        };
  return {
    descriptor: { name, description: `${name} tool`, parameters: {} },
    family: name === 'bash' ? 'shell' : 'web-search',
    permissionSpec,
    execute,
  };
}

function executionContext(toolName: string): HostToolExecutionContext {
  return {
    sessionId: 'ps-1',
    runtimeGenerationId: 'gen-1',
    runId: 'run-1',
    toolName,
  };
}

function blueprintWithTools(toolNames: string[]): SerializableBlueprint {
  return {
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
      hostTools: toolNames.map((name) => ({ name, description: '', parameters: {} })),
      enabledMcpServerIds: [],
    },
    activeSkillPaths: [],
    activeExtensionPaths: [],
    activePromptPaths: [],
  };
}

function fakeMapper() {
  return {
    map: (): Array<{ event: AgentEvent; envelope: AgentEventEnvelope }> => [],
  };
}

function createMockPiSession(): WorkerPiSessionLike {
  return {
    id: 'pi-s1',
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    subscribe: () => () => undefined,
  };
}

function createCreateRequest(blueprint: SerializableBlueprint): WorkerRequest {
  return {
    type: 'request',
    id: 'req-1',
    method: 'session/create',
    context: { sessionId: 'ps-1', runtimeGenerationId: 'gen-1' },
    payload: {
      method: 'session/create',
      productSessionId: 'ps-1',
      blueprint,
    },
  };
}

describe('WorkerSessionRuntime tool proxy', () => {
  it('builds no proxy tools when hostTools is empty (P7-08)', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () =>
      createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools([])));

    // createPiSession should not receive proxyTools when the list is empty.
    const call = createPiSession.mock.calls[0]?.[0] as unknown as { proxyTools?: unknown };
    expect(call?.proxyTools).toBeUndefined();
  });

  it('builds proxy tools when hostTools is non-empty and toolProxy enabled', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () =>
      createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools(['web_search', 'bash'])));

    const call = createPiSession.mock.calls[0]?.[0] as unknown as {
      proxyTools?: Array<{ name: string }>;
    };
    expect(call?.proxyTools).toBeDefined();
    expect(call?.proxyTools?.map((t) => t.name).sort()).toEqual(['bash', 'web_search']);
  });

  it('does not build proxy tools when enableToolProxy is false', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () =>
      createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      // enableToolProxy not set → defaults to false
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools(['web_search'])));

    const call = createPiSession.mock.calls[0]?.[0] as unknown as { proxyTools?: unknown };
    expect(call?.proxyTools).toBeUndefined();
  });

  it('emits a tool-call frame when a proxy tool executes', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () =>
      createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools(['web_search'])));

    // Get the proxy tools that were built.
    const call = createPiSession.mock.calls[0]?.[0] as unknown as {
      proxyTools?: Array<{
        name: string;
        execute: (
          id: string,
          params: Record<string, unknown>,
          signal?: AbortSignal,
        ) => Promise<unknown>;
      }>;
    };
    const proxyTool = call?.proxyTools?.[0];
    expect(proxyTool).toBeDefined();

    // Execute the proxy tool — it should emit a tool-call frame.
    const executePromise = proxyTool!.execute('ps-1|tc-1', { query: 'test' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const toolCallFrame = frames.find((f) => f.type === 'tool-call');
    expect(toolCallFrame).toBeDefined();
    expect(toolCallFrame).toMatchObject({
      type: 'tool-call',
      context: { sessionId: 'ps-1', runtimeGenerationId: 'gen-1' },
      toolName: 'web_search',
      args: { query: 'test' },
    });

    // Simulate parent sending a tool-result back.
    const tcFrame = toolCallFrame as Extract<WorkerFrame, { type: 'tool-call' }>;
    runtime.handleToolResult({
      type: 'tool-result',
      id: tcFrame.id,
      context: tcFrame.context,
      ok: true,
      result: { ok: true, output: 'search results', details: { source: 'fixture' } },
    });

    const result = await executePromise;
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'search results' }],
    });
  });

  it('rejects proxy tool when parent denies permission', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () =>
      createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools(['bash'])));

    const call = createPiSession.mock.calls[0]?.[0] as unknown as {
      proxyTools?: Array<{
        execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
      }>;
    };
    const proxyTool = call?.proxyTools?.[0];

    const executePromise = proxyTool!.execute('ps-1|tc-1', { command: 'rm -rf /' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const toolCallFrame = frames.find((f) => f.type === 'tool-call') as Extract<
      WorkerFrame,
      { type: 'tool-call' }
    >;
    runtime.handleToolResult({
      type: 'tool-result',
      id: toolCallFrame.id,
      context: toolCallFrame.context,
      ok: false,
      result: {
        ok: false,
        code: 'permission-denied',
        message: 'user denied bash execution',
        details: { rule: 'fixture' },
      },
    });

    await expect(executePromise).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      code: 'permission-denied',
      message: 'Permission denied: user denied bash execution',
    });
  });

  it('rejects pending tool calls when session is dropped', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () =>
      createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools(['web_search'])));

    const call = createPiSession.mock.calls[0]?.[0] as unknown as {
      proxyTools?: Array<{
        execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
      }>;
    };
    const proxyTool = call?.proxyTools?.[0];
    expect(proxyTool).toBeDefined();

    const executePromise = proxyTool!.execute('ps-1|tc-1', { query: 'test' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Drop the session — pending tool calls should reject.
    await runtime.handleRequest({
      type: 'request',
      id: 'drop-1',
      method: 'session/drop',
      context: { sessionId: 'ps-1', runtimeGenerationId: 'gen-1' },
      payload: { method: 'session/drop', sessionId: 'ps-1' },
    });

    await expect(executePromise).rejects.toThrow(/session dropped/);
  });

  it('aborts pending tool calls when the session is aborted', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () =>
      createMockPiSession(),
    );
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools(['web_search'])));

    const call = createPiSession.mock.calls[0]?.[0] as unknown as {
      proxyTools?: Array<{
        execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
      }>;
    };
    const executePromise = call.proxyTools?.[0]?.execute('ps-1|tc-1', { query: 'test' });
    if (!executePromise) throw new Error('proxy tool was not created');
    await new Promise((resolve) => setTimeout(resolve, 10));

    await runtime.handleRequest({
      type: 'request',
      id: 'abort-1',
      method: 'session/abort',
      context: { sessionId: 'ps-1', runtimeGenerationId: 'gen-1' },
      payload: { method: 'session/abort', sessionId: 'ps-1' },
    });

    await expect(executePromise).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      code: 'aborted',
      message: 'Tool execution aborted',
    });
  });
});

describe('HostToolExecutionRouter integration with worker client', () => {
  it('passes an AbortSignal from worker tool calls to the host router', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fakeTool = fakeHostTool(
      'web_search',
      vi.fn(async (_args, signal): Promise<ToolResult> => {
        receivedSignal = signal;
        return { ok: true, output: 'search results from parent' };
      }),
    );
    const router = new HostToolExecutionRouter({
      tools: [fakeTool],
      permissionGate: async () => ({ allowed: true }),
    });
    const client = new RpcSdkWorkerClient({
      context: { sessionId: 'ps-1', runtimeGenerationId: 'gen-1' },
      onToolCall: async (frame, signal) =>
        router.execute(
          frame.toolName,
          frame.args && typeof frame.args === 'object' && !Array.isArray(frame.args)
            ? (frame.args as Record<string, unknown>)
            : {},
          signal,
          {
            sessionId: frame.context.sessionId,
            runtimeGenerationId: frame.context.runtimeGenerationId,
            runId: frame.context.runId ?? 'run-1',
            toolName: frame.toolName,
          },
        ),
    });
    const routeToolCall = Reflect.get(client, 'handleToolCall');
    if (typeof routeToolCall !== 'function') throw new Error('worker tool handler is unavailable');

    await (routeToolCall as (this: RpcSdkWorkerClient, frame: WorkerFrame) => Promise<void>).call(
      client,
      {
        type: 'tool-call',
        id: 'ps-1|tc-1',
        context: {
          sessionId: 'ps-1',
          runtimeGenerationId: 'gen-1',
          runId: 'run-1',
          toolCallId: 'ps-1|tc-1',
        },
        toolName: 'web_search',
        args: { query: 'test' },
      },
    );

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(fakeTool.execute).toHaveBeenCalledWith(
      { query: 'test' },
      expect.any(AbortSignal),
      executionContext('web_search'),
    );
  });

  it('routes tool-call to the router and returns the result', async () => {
    const fakeTool = fakeHostTool(
      'web_search',
      vi.fn(async (): Promise<ToolResult> => ({ ok: true, output: 'search results from parent' })),
    );
    const router = new HostToolExecutionRouter({
      tools: [fakeTool],
      permissionGate: async () => ({ allowed: true }),
    });

    // Simulate the client's handleToolCall logic.
    const result = await router.execute(
      'web_search',
      { query: 'test' },
      new AbortController().signal,
      executionContext('web_search'),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('search results from parent');
    }
    expect(fakeTool.execute).toHaveBeenCalledWith(
      { query: 'test' },
      expect.any(AbortSignal),
      executionContext('web_search'),
    );
  });

  it('returns tool-not-available when the tool is not in the router', async () => {
    const router = new HostToolExecutionRouter({
      tools: [],
      permissionGate: async () => ({ allowed: true }),
    });
    const result = await router.execute(
      'missing_tool',
      {},
      new AbortController().signal,
      executionContext('missing_tool'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-not-available');
    }
  });

  it('returns tool-disabled when the disable predicate fires', async () => {
    const fakeTool = fakeHostTool(
      'web_search',
      vi.fn(async (): Promise<ToolResult> => ({ ok: true, output: 'should not reach' })),
    );
    const router = new HostToolExecutionRouter({
      tools: [fakeTool],
      isToolDisabled: (registration) =>
        registration.descriptor.name === 'web_search'
          ? { domain: 'web', message: 'web tools family disabled' }
          : null,
      permissionGate: async () => ({ allowed: true }),
    });
    const result = await router.execute(
      'web_search',
      {},
      new AbortController().signal,
      executionContext('web_search'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-disabled');
      expect(result.message).toContain('web tools family disabled');
    }
  });

  it('returns permission-denied when the permission gate rejects', async () => {
    const fakeTool = fakeHostTool(
      'bash',
      vi.fn(async (): Promise<ToolResult> => ({ ok: true, output: 'should not reach' })),
    );
    const router = new HostToolExecutionRouter({
      tools: [fakeTool],
      permissionGate: async () => ({
        allowed: false,
        result: { ok: false, code: 'permission-denied', message: 'user denied' },
      }),
    });
    const result = await router.execute(
      'bash',
      { command: 'rm -rf /' },
      new AbortController().signal,
      executionContext('bash'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('permission-denied');
    }
  });
});
