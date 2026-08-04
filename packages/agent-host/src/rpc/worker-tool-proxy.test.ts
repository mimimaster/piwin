/**
 * WP4 tests: tool proxy end-to-end (worker runtime + parent client routing).
 *
 * Tests that:
 * - enabled family executes in parent (spy on HostToolExecutionRouter)
 * - disabled family never registers (empty customToolNames → no proxy tools)
 * - abort cancels outstanding tool proxy
 * - permission deny returns structured tool error to model path
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from '@piwin/contracts';
import type {
  WorkerFrame,
  WorkerRequest,
  WorkerToolResultFrame,
} from '../rpc-sdk-worker-protocol.js';
import { WorkerSessionRuntime, type WorkerPiSessionLike } from './worker-session-runtime.js';
import type { SerializableBlueprint } from './serializable-blueprint.js';
import { HostToolExecutionRouter } from '../tools/host-tool-execution-router.js';
import type { HostToolDefinition } from '@piwin/tools-web';

function blueprintWithTools(customToolNames: string[]): SerializableBlueprint {
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
      customToolNames,
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
    payload: {
      method: 'session/create',
      productSessionId: 'ps-1',
      blueprint,
    },
  };
}

describe('WorkerSessionRuntime tool proxy', () => {
  it('builds no proxy tools when customToolNames is empty (P7-08)', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () => createMockPiSession());
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

  it('builds proxy tools when customToolNames is non-empty and toolProxy enabled', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () => createMockPiSession());
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
      enableToolProxy: true,
    });

    await runtime.handleRequest(createCreateRequest(blueprintWithTools(['web_search', 'bash'])));

    const call = createPiSession.mock.calls[0]?.[0] as unknown as { proxyTools?: Array<{ name: string }> };
    expect(call?.proxyTools).toBeDefined();
    expect(call?.proxyTools?.map((t) => t.name).sort()).toEqual(['bash', 'web_search']);
  });

  it('does not build proxy tools when enableToolProxy is false', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () => createMockPiSession());
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
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () => createMockPiSession());
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
      sessionId: 'ps-1',
      toolName: 'web_search',
      args: { query: 'test' },
    });

    // Simulate parent sending a tool-result back.
    const tcFrame = toolCallFrame as { id: string };
    runtime.handleToolResult({
      type: 'tool-result',
      id: tcFrame.id,
      ok: true,
      result: 'search results',
    });

    const result = await executePromise;
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'search results' }],
    });
  });

  it('resolves proxy tool with error when parent denies permission', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () => createMockPiSession());
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

    const toolCallFrame = frames.find((f) => f.type === 'tool-call') as { id: string };
    runtime.handleToolResult({
      type: 'tool-result',
      id: toolCallFrame.id,
      ok: false,
      error: 'user denied bash execution',
      code: 'permission-denied',
    });

    const result = (await executePromise) as {
      content: Array<{ text: string }>;
      details: { error: string };
    };
    expect(result.content[0]?.text).toContain('Permission denied');
    expect(result.details.error).toBe('permission-denied');
  });

  it('rejects pending tool calls when session is dropped', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn<(input: unknown) => Promise<WorkerPiSessionLike>>(async () => createMockPiSession());
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
      payload: { method: 'session/drop', sessionId: 'ps-1' },
    });

    await expect(executePromise).rejects.toThrow(/session dropped/);
  });
});

describe('HostToolExecutionRouter integration with worker client', () => {
  it('routes tool-call to the router and returns the result', async () => {
    const fakeTool: HostToolDefinition = {
      name: 'web_search',
      description: 'Search the web',
      parameters: {},
      execute: vi.fn(async () => 'search results from parent'),
    };
    const router = new HostToolExecutionRouter({ tools: [fakeTool] });

    // Simulate the client's handleToolCall logic.
    const result = await router.execute('web_search', { query: 'test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('search results from parent');
    }
    expect(fakeTool.execute).toHaveBeenCalledWith({ query: 'test' }, undefined);
  });

  it('returns tool-not-available when the tool is not in the router', async () => {
    const router = new HostToolExecutionRouter({ tools: [] });
    const result = await router.execute('missing_tool', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-not-available');
    }
  });

  it('returns tool-disabled when the disable predicate fires', async () => {
    const fakeTool: HostToolDefinition = {
      name: 'web_search',
      description: 'Search the web',
      parameters: {},
      execute: vi.fn(async () => 'should not reach'),
    };
    const router = new HostToolExecutionRouter({
      tools: [fakeTool],
      isToolDisabled: (name) => (name === 'web_search' ? 'web tools family disabled' : null),
    });
    const result = await router.execute('web_search', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-disabled');
      expect(result.message).toContain('web tools family disabled');
    }
  });

  it('returns permission-denied when the permission gate rejects', async () => {
    const fakeTool: HostToolDefinition = {
      name: 'bash',
      description: 'Run bash',
      parameters: {},
      execute: vi.fn(async () => 'should not reach'),
    };
    const router = new HostToolExecutionRouter({
      tools: [fakeTool],
      permissionGate: async () => ({ allowed: false, message: 'user denied' }),
    });
    const result = await router.execute('bash', { command: 'rm -rf /' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('permission-denied');
    }
  });
});
