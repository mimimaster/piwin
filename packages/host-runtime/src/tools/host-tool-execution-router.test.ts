import { describe, expect, it } from 'vitest';
import type { HostToolDefinition } from '@piwin/tools-web';
import { HostToolExecutionRouter } from './host-tool-execution-router.js';

function tool(name: string, execute?: HostToolDefinition['execute']): HostToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    execute:
      execute ??
      (async (args) => {
        const value = typeof args.value === 'string' ? args.value : 'ok';
        return `${name}:${value}`;
      }),
  };
}

describe('HostToolExecutionRouter', () => {
  it('executes a known tool by name', async () => {
    const router = new HostToolExecutionRouter({ tools: [tool('web_search')] });
    const result = await router.execute('web_search', { query: 'piwin' });
    expect(result).toEqual({ ok: true, output: 'web_search:ok' });
  });

  it('reports tool-not-available for unknown names', async () => {
    const router = new HostToolExecutionRouter({ tools: [tool('web_search')] });
    const result = await router.execute('process_start', {});
    expect(result).toEqual({
      ok: false,
      code: 'tool-not-available',
      message: 'tool not available: process_start',
    });
  });

  it('blocks disabled families via the immediate gate', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('process_start'), tool('web_search')],
      isToolDisabled: (name) => (name.startsWith('process') ? 'process family disabled' : null),
    });
    const disabled = await router.execute('process_start', {});
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) {
      expect(disabled.code).toBe('tool-disabled');
      expect(disabled.message).toBe('process family disabled');
    }
    const allowed = await router.execute('web_search', {});
    expect(allowed.ok).toBe(true);
  });

  it('permission gate denies un-gated tools', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      permissionGate: async (name, args) =>
        args.query === 'blocked' ? { allowed: false, message: 'query blocked' } : { allowed: true },
    });
    const denied = await router.execute('web_search', { query: 'blocked' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe('permission-denied');
      expect(denied.message).toBe('query blocked');
    }
    const allowed = await router.execute('web_search', { query: 'ok' });
    expect(allowed.ok).toBe(true);
  });

  it('permission gate returning undefined falls through to execution', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      permissionGate: async () => undefined,
    });
    const result = await router.execute('web_search', {});
    expect(result.ok).toBe(true);
  });

  it('returns aborted when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const router = new HostToolExecutionRouter({ tools: [tool('web_search')] });
    const result = await router.execute('web_search', {}, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('aborted');
    }
  });

  it('maps executor throw to tool-not-available unless aborted', async () => {
    const router = new HostToolExecutionRouter({
      tools: [
        tool('fragile', async () => {
          throw new Error('boom');
        }),
      ],
    });
    const result = await router.execute('fragile', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-not-available');
      expect(result.message).toContain('boom');
    }
  });

  it('reports aborted when the signal aborts during execution', async () => {
    const controller = new AbortController();
    const router = new HostToolExecutionRouter({
      tools: [
        tool('slow', async (_args, signal) => {
          await new Promise<void>((resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
            setTimeout(resolve, 500);
          });
          return 'never';
        }),
      ],
    });
    const promise = router.execute('slow', {}, controller.signal);
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('aborted');
    }
  });
});
