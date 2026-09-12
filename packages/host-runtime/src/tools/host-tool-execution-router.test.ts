import { describe, expect, it } from 'vitest';
import type { HostToolExecutionContext, HostToolRegistration, ToolResult } from '@piwin/contracts';
import { createPermissiveToolAdmission, type HostToolAdmission } from './tool-admission.js';
import { HostToolExecutionRouter } from './host-tool-execution-router.js';
import type { ToolPolicyOutcome } from './tool-policy-evaluator.js';

function admissionWithEvaluate(
  evaluate: HostToolAdmission['policyEvaluator']['evaluate'],
): HostToolAdmission {
  return {
    ...createPermissiveToolAdmission(),
    policyEvaluator: { evaluate },
  };
}

function allowOutcome(): ToolPolicyOutcome {
  return {
    kind: 'decision',
    policy: {
      decision: 'allow',
      reason: 'test-allow',
      action: 'filesystem:read',
      rememberable: false,
    },
  };
}

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
      action: 'filesystem:read',
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
      admission: createPermissiveToolAdmission(),
    });
    const result = await runTool(router, 'web_search', { query: 'piwin' });
    expect(result).toEqual({ ok: true, output: 'web_search:ok' });
  });

  it('reports tool-not-available for unknown names', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      admission: createPermissiveToolAdmission(),
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
      admission: createPermissiveToolAdmission(),
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
      admission: admissionWithEvaluate(({ arguments: args }) =>
        args.query === 'blocked'
          ? {
              kind: 'decision',
              policy: {
                decision: 'deny',
                reason: 'query blocked',
                action: 'filesystem:read',
                rememberable: false,
              },
            }
          : allowOutcome(),
      ),
    });
    const denied = await runTool(router, 'web_search', { query: 'blocked' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe('permission-denied');
      expect(denied.message).toContain('query blocked');
    }
    const allowed = await runTool(router, 'web_search', { query: 'ok' });
    expect(allowed.ok).toBe(true);
  });

  it('permission gate allowing a call falls through to execution', async () => {
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      admission: createPermissiveToolAdmission(),
    });
    const result = await runTool(router, 'web_search', {});
    expect(result.ok).toBe(true);
  });

  it('returns aborted when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      admission: createPermissiveToolAdmission(),
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
      admission: createPermissiveToolAdmission(),
    });
    const result = await runTool(router, 'fragile', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('execution-failed');
      expect(result.message).toContain('boom');
    }
  });

  it('maps thrown browser runtime-gone errors onto the stable tool code', async () => {
    const router = new HostToolExecutionRouter({
      tools: [
        tool('fragile', async () => {
          const error = new Error('browser context is gone');
          error.name = 'BrowserRuntimeGoneError';
          throw error;
        }),
      ],
      admission: createPermissiveToolAdmission(),
    });
    const result = await runTool(router, 'fragile', {});
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-runtime-gone',
      retryable: true,
      message: 'browser context is gone',
    });
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
      admission: createPermissiveToolAdmission(),
    });
    const promise = runTool(router, 'slow', {}, controller.signal);
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('aborted');
    }
  });

  it('prepares arguments before the permission gate and executor', async () => {
    const seen: string[] = [];
    const prepared = tool('web_search');
    prepared.prepareArgs = (raw) => {
      seen.push(`prepare:${String(raw.path ?? '')}`);
      return { ok: true, arguments: { ...raw, path: '/abs/file.ts' } };
    };
    prepared.execute = async (args) => {
      seen.push(`execute:${String(args.path ?? '')}`);
      return { ok: true, output: String(args.path ?? '') };
    };
    const router = new HostToolExecutionRouter({
      tools: [prepared],
      admission: admissionWithEvaluate(({ arguments: args }) => {
        seen.push(`gate:${String(args.path ?? '')}`);
        return allowOutcome();
      }),
    });
    const result = await runTool(router, 'web_search', { path: './file.ts' });
    expect(result).toEqual({ ok: true, output: '/abs/file.ts' });
    expect(seen).toEqual(['prepare:./file.ts', 'gate:/abs/file.ts', 'execute:/abs/file.ts']);
  });

  it('returns invalid-input from prepareArgs before prompting', async () => {
    const prepared = tool('web_search');
    prepared.prepareArgs = async () => ({
      ok: false,
      result: { ok: false, code: 'invalid-input', message: 'path is required' },
    });
    let gateCalled = false;
    const router = new HostToolExecutionRouter({
      tools: [prepared],
      admission: admissionWithEvaluate(() => {
        gateCalled = true;
        return allowOutcome();
      }),
    });
    await expect(runTool(router, 'web_search', {})).resolves.toMatchObject({
      ok: false,
      code: 'invalid-input',
    });
    expect(gateCalled).toBe(false);
  });

  it('revalidates authority after the permission gate returns', async () => {
    let admitted = true;
    const router = new HostToolExecutionRouter({
      tools: [tool('web_search')],
      admission: admissionWithEvaluate(() => {
        admitted = false;
        return allowOutcome();
      }),
      revalidateAuthority: () =>
        admitted
          ? { allowed: true }
          : {
              allowed: false,
              code: 'tool-not-available',
              reason: 'run is not admitted for tool execution: run-1',
            },
    });
    await expect(runTool(router, 'web_search', {})).resolves.toMatchObject({
      ok: false,
      code: 'tool-not-available',
    });
  });

  it('does not begin capture when permission denies the call', async () => {
    let began = 0;
    const denied = tool('web_search');
    const router = new HostToolExecutionRouter({
      tools: [denied],
      admission: admissionWithEvaluate(() => ({
        kind: 'decision',
        policy: {
          decision: 'deny',
          reason: 'blocked',
          action: 'filesystem:read',
          rememberable: false,
        },
      })),
      capture: {
        beginCapture: () => {
          began += 1;
          return { captureId: 'cap-1' };
        },
        finishCapture: async () => undefined,
        recordReceipt: () => undefined,
      },
    });
    await expect(runTool(router, 'web_search', { query: 'x' })).resolves.toMatchObject({
      ok: false,
      code: 'permission-denied',
    });
    expect(began).toBe(0);
  });

  it('lets later tools run after plan_create without aborting siblings', async () => {
    let writeFinished = false;
    let writeStarted!: () => void;
    const writeBegan = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    const router = new HostToolExecutionRouter({
      tools: [
        tool('piwin_plan_create', async () => ({ ok: true, output: 'created' })),
        tool('write_file', async () => {
          writeStarted();
          await new Promise((resolve) => setTimeout(resolve, 20));
          writeFinished = true;
          return { ok: true, output: 'written' };
        }),
        tool('read_file'),
      ],
      admission: createPermissiveToolAdmission(),
    });

    const writePromise = runTool(router, 'write_file', {});
    await writeBegan;
    await expect(runTool(router, 'piwin_plan_create', {})).resolves.toMatchObject({ ok: true });
    await expect(writePromise).resolves.toMatchObject({ ok: true, output: 'written' });
    expect(writeFinished).toBe(true);
    await expect(runTool(router, 'read_file', {})).resolves.toMatchObject({ ok: true });
  });
});
