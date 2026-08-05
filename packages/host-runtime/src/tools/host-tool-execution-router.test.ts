import { describe, expect, it } from 'vitest';
import type { HostToolExecutionContext, HostToolRegistration, ToolResult } from '@piwin/contracts';
import { HostToolExecutionRouter } from './host-tool-execution-router.js';

function executionContext(toolName: string): HostToolExecutionContext {
  return {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName,
  };
}

function tool(name: string, execute?: HostToolRegistration['execute']): HostToolRegistration {
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
    execute:
      execute ??
      (async (args): Promise<ToolResult> => {
        const value = typeof args.value === 'string' ? args.value : 'ok';
        return { ok: true, output: `${name}:${value}` };
      }),
  };
}

async function runTool(
  router: HostToolExecutionRouter,
  toolName: string,
  args: Record<string, unknown>,
  signal = new AbortController().signal,
): Promise<ToolResult> {
  return router.execute(toolName, args, signal, executionContext(toolName));
}

describe('HostToolExecutionRouter', () => {
  it('executes a known tool by name', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      permissionGate: async () => ({ allowed: true }),
    });
    const result = await runTool(router, 'web_search', { query: 'piwin' });
    expect(result).toEqual({ ok: true, output: 'web_search:ok' });
  });

  it('reports tool-not-available for unknown names', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      permissionGate: async () => ({ allowed: true }),
    });
    const result = await runTool(router, 'process_start', {});
    expect(result).toEqual({
      ok: false,
      code: 'tool-not-available',
      message: 'tool not available: process_start',
    });
  });

  it('blocks disabled families via the immediate gate', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('process_start'), tool('web_search')],
      isToolDisabled: (registration) =>
        registration.descriptor.name.startsWith('process')
          ? { domain: 'process', message: 'process family disabled' }
          : null,
      permissionGate: async () => ({ allowed: true }),
    });
    const disabled = await runTool(router, 'process_start', {});
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) {
      expect(disabled.code).toBe('tool-disabled');
      expect(disabled.message).toBe('process family disabled');
    }
    const allowed = await runTool(router, 'web_search', {});
    expect(allowed.ok).toBe(true);
  });

  it('permission gate denies un-gated tools', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      permissionGate: async ({ args }) =>
        args.query === 'blocked'
          ? {
              allowed: false,
              result: { ok: false, code: 'permission-denied', message: 'query blocked' },
            }
          : { allowed: true },
    });
    const denied = await runTool(router, 'web_search', { query: 'blocked' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe('permission-denied');
      expect(denied.message).toBe('query blocked');
    }
    const allowed = await runTool(router, 'web_search', { query: 'ok' });
    expect(allowed.ok).toBe(true);
  });

  it('permission gate allowing a call falls through to execution', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      permissionGate: async () => ({ allowed: true }),
    });
    const result = await runTool(router, 'web_search', {});
    expect(result.ok).toBe(true);
  });

  it('returns aborted when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      permissionGate: async () => ({ allowed: true }),
    });
    const result = await runTool(router, 'web_search', {}, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('aborted');
    }
  });

  it('maps executor throw to execution-failed unless aborted', async () => {
    const router = new HostToolExecutionRouter({
      tools: [
        tool('fragile', async () => {
          throw new Error('boom');
        }),
      ],
      permissionGate: async () => ({ allowed: true }),
    });
    const result = await runTool(router, 'fragile', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('execution-failed');
      expect(result.message).toContain('boom');
    }
  });

  it('reports aborted when the signal aborts during execution', async () => {
    const controller = new AbortController();
    const router = new HostToolExecutionRouter({
      tools: [
        tool('slow', async (_args, signal) => {
          await new Promise<void>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            setTimeout(resolve, 500);
          });
          return { ok: true, output: 'never' };
        }),
      ],
      permissionGate: async () => ({ allowed: true }),
    });
    const promise = runTool(router, 'slow', {}, controller.signal);
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('aborted');
    }
  });
});
