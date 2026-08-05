import { describe, expect, it } from 'vitest';
import type { HostToolRegistration } from '@piwin/contracts';
import {
  SessionHostToolExecutionPort,
  createSessionHostToolExecutionPort,
} from './session-host-tool-port.js';
import type { HostToolPermissionGate } from './host-tool-execution-router.js';

const allowPermission: HostToolPermissionGate = async () => ({ allowed: true });

function makeTool(name: string): HostToolRegistration {
  return {
    descriptor: {
      name,
      description: `${name} tool`,
      parameters: { type: 'object', properties: {} },
    },
    family: name.startsWith('process') ? 'process' : 'web-search',
    permissionSpec: {
      action: `${name}:execute`,
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute(args) {
      return {
        ok: true,
        output: `${name}:${typeof args.value === 'string' ? args.value : 'ok'}`,
      };
    },
  };
}

function makePort(
  overrides: Partial<{
    isSessionKnown: (sessionId: string) => boolean;
    getRuntimeGenerationId: (sessionId: string) => string | undefined;
    tools: readonly HostToolRegistration[];
  }> = {},
): SessionHostToolExecutionPort {
  const port = createSessionHostToolExecutionPort({
    isSessionKnown: overrides.isSessionKnown ?? ((sessionId) => sessionId === 'session-1'),
    getRuntimeGenerationId:
      overrides.getRuntimeGenerationId ??
      ((sessionId: string) => (sessionId === 'session-1' ? 'gen-1' : undefined)),
  });
  port.registerActiveGeneration(
    'session-1',
    'gen-1',
    overrides.tools ?? [makeTool('web_search'), makeTool('process_start')],
    allowPermission,
  );
  return port;
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

  it('fails closed when the session has no active runtime generation', async () => {
    const port = makePort({ getRuntimeGenerationId: () => undefined });
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
    expect(result).toEqual({
      ok: false,
      code: 'tool-not-available',
      message: 'stale runtime generation: expected none, got gen-1',
    });
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

  it('reads only the registered frozen surface for each generation', async () => {
    let activeGeneration = 'gen-1';
    const port = makePort({
      getRuntimeGenerationId: (sessionId) =>
        sessionId === 'session-1' ? activeGeneration : undefined,
      tools: [makeTool('web_search')],
    });

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

    const newGeneration = makeTool('web_fetch');
    activeGeneration = 'gen-2';
    port.registerPendingGeneration('session-1', 'gen-2', [newGeneration], allowPermission);
    expect(port.commitPendingGeneration('session-1', 'gen-2')).toBe(true);
    const newGenerationResult = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-2',
        runId: 'run-3',
        toolName: 'web_fetch',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(newGenerationResult).toEqual({ ok: true, output: 'web_fetch:ok' });
  });

  it('rejects a generation that has not registered its frozen surface', async () => {
    const port = createSessionHostToolExecutionPort({
      isSessionKnown: () => true,
      getRuntimeGenerationId: () => 'gen-1',
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
      expect(result.code).toBe('tool-not-available');
      expect(result.message).toContain('surface is not registered');
    }
  });

  it('rejects tools filtered out of the compiled manifest', async () => {
    const port = makePort();
    expect(port.restrictGeneration('session-1', 'gen-1', ['web_search'])).toBe(true);

    const filtered = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-filtered',
        toolName: 'process_start',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(filtered).toEqual({
      ok: false,
      code: 'tool-not-available',
      message: 'tool not in session manifest: process_start',
    });
  });

  it('restores the previous active surface when a promoted candidate is rolled back', async () => {
    let activeGeneration = 'gen-1';
    const port = makePort({
      getRuntimeGenerationId: () => activeGeneration,
      tools: [makeTool('web_search')],
    });
    port.registerPendingGeneration('session-1', 'gen-2', [makeTool('web_fetch')], allowPermission);
    expect(port.commitPendingGeneration('session-1', 'gen-2')).toBe(true);
    activeGeneration = 'gen-2';

    expect(port.rollbackCommittedGeneration('session-1', 'gen-2')).toBe(true);
    activeGeneration = 'gen-1';
    const result = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-1',
        runId: 'run-rollback',
        toolName: 'web_search',
        arguments: {},
      },
      new AbortController().signal,
    );

    expect(result).toEqual({ ok: true, output: 'web_search:ok' });
  });

  it('rejects a candidate prepared against an older active generation', async () => {
    let activeGeneration = 'gen-3';
    const port = makePort({
      getRuntimeGenerationId: () => activeGeneration,
      tools: [makeTool('web_search')],
    });
    port.registerPendingGeneration('session-1', 'gen-2', [makeTool('web_fetch')], allowPermission);
    port.registerActiveGeneration(
      'session-1',
      'gen-3',
      [makeTool('process_start')],
      allowPermission,
    );

    expect(port.commitPendingGeneration('session-1', 'gen-2')).toBe(false);
    activeGeneration = 'gen-3';
    const result = await port.execute(
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'gen-3',
        runId: 'run-current',
        toolName: 'process_start',
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: true, output: 'process_start:ok' });
  });
});
