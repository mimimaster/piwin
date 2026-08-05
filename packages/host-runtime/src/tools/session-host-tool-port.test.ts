import { describe, expect, it } from 'vitest';
import type { HostToolDefinition } from '@piwin/tools-web';
import {
  SessionHostToolExecutionPort,
  createSessionHostToolExecutionPort,
} from './session-host-tool-port.js';
import { HOST_TOOL_RUN_ID_ARGUMENT } from './host-tool-execution-context.js';

function makeTool(name: string): HostToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    async execute(args) {
      return `${name}:${typeof args.value === 'string' ? args.value : 'ok'}`;
    },
  };
}

function makePort(
  overrides: Partial<{
    isSessionKnown: (sessionId: string) => boolean;
    getRuntimeGenerationId: (sessionId: string) => string | undefined;
    buildToolsForSession: (sessionId: string) => Promise<HostToolDefinition[]>;
  }> = {},
): SessionHostToolExecutionPort {
  return createSessionHostToolExecutionPort({
    isSessionKnown: overrides.isSessionKnown ?? ((sessionId) => sessionId === 'session-1'),
    getRuntimeGenerationId:
      overrides.getRuntimeGenerationId ??
      ((sessionId: string) => (sessionId === 'session-1' ? 'gen-1' : undefined)),
    buildToolsForSession:
      overrides.buildToolsForSession ??
      (async () => [makeTool('web_search'), makeTool('process_start')]),
  });
}

describe('SessionHostToolExecutionPort', () => {
  it('executes a known tool with matching generation', async () => {
    const port = makePort();
    const result = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-1',
        toolName: 'web_search',
        arguments: { query: 'hello' },
      },
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: true, output: 'web_search:ok' });
  });

  it('rejects unknown session', async () => {
    const port = makePort();
    const result = await port.execute(
      {
        sessionId: 'unknown-session',
        runtimeGenerationId: 'gen-1',
        runId: 'run-1',
        toolName: 'web_search',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-not-available');
      expect(result.message).toContain('session not found');
    }
  });

  it('rejects stale runtime generation', async () => {
    const port = makePort();
    const result = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'old-gen',
        runId: 'run-1',
        toolName: 'web_search',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-not-available');
      expect(result.message).toContain('stale runtime generation');
    }
  });

  it('rejects tool not in session manifest', async () => {
    const port = makePort();
    const result = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-1',
        toolName: 'unknown_tool',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-not-available');
      expect(result.message).toContain('not in session manifest');
    }
  });

  it('rejects aborted signal before execution', async () => {
    const port = makePort();
    const controller = new AbortController();
    controller.abort();
    const result = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-1',
        toolName: 'web_search',
        arguments: {},
      },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('aborted');
    }
  });

  it('caches tools per session+generation and rebuilds on generation change', async () => {
    let buildCount = 0;
    const port = makePort({
      getRuntimeGenerationId: (sessionId) =>
        sessionId === 'session-1' ? 'gen-1' : undefined,
      buildToolsForSession: async () => {
        buildCount++;
        return [makeTool('web_search')];
      },
    });

    // First call builds tools.
    await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-1',
        toolName: 'web_search',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(buildCount).toBe(1);

    // Second call uses cached tools.
    await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-2',
        toolName: 'web_search',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(buildCount).toBe(1);

    // Generation change forces rebuild.
    port.clearSession('session-1');
    const port2 = makePort({
      getRuntimeGenerationId: (sessionId) =>
        sessionId === 'session-1' ? 'gen-2' : undefined,
      buildToolsForSession: async () => {
        buildCount++;
        return [makeTool('web_search')];
      },
    });
    await port2.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-2',
        runId: 'run-3',
        toolName: 'web_search',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(buildCount).toBe(2);
  });

  it('returns execution-failed when buildToolsForSession throws', async () => {
    const port = makePort({
      buildToolsForSession: async () => {
        throw new Error('config load failed');
      },
    });
    const result = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-1',
        toolName: 'web_search',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('execution-failed');
      expect(result.message).toContain('config load failed');
    }
  });
});
