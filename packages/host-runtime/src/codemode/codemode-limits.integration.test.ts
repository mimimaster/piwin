import { describe, expect, it } from 'vitest';
import { createDefaultCodemodeConfig, type CodemodeConfig, type HostToolRegistration } from '@piwin/contracts';
import { buildCodemodeTool } from './codemode-tool.js';
import { createSessionHostToolExecutionPort } from '../tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from '../tools/tool-admission.js';

const SESSION = 'session-1';
const GENERATION = 'gen-1';

function limits(overrides: Partial<CodemodeConfig> = {}): CodemodeConfig {
  return { ...createDefaultCodemodeConfig(), enabled: true, ...overrides };
}

function holdTool(started: Array<string>, active: { count: number; max: number }): HostToolRegistration {
  return {
    descriptor: { name: 'hold', description: 'hold', parameters: { type: 'object', properties: { id: { type: 'string' } } } },
    family: 'filesystem-read',
    permissionSpec: { action: 'filesystem:read', risk: 'unknown', rememberable: false, readOnly: true },
    fileEffect: { kind: 'none' },
    async execute(args, signal) {
      const id = String(args.id ?? '');
      started.push(id);
      active.count += 1;
      active.max = Math.max(active.max, active.count);
      try {
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          const timer = setTimeout(resolve, 200);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
        return { ok: true, output: id };
      } finally {
        active.count -= 1;
      }
    },
  };
}

async function run(config: CodemodeConfig, tool: HostToolRegistration, code: string, signal = new AbortController().signal) {
  const port = createSessionHostToolExecutionPort({
    isSessionKnown: () => true,
    getRuntimeGenerationId: () => GENERATION,
    isRunAdmitted: () => true,
  });
  port.registerActiveGeneration(
    SESSION,
    GENERATION,
    [buildCodemodeTool({ config, port }), tool],
    createPermissiveToolAdmission(),
  );
  return port.execute(
    {
      sessionId: SESSION,
      runtimeGenerationId: GENERATION,
      runId: 'run-1',
      toolCallId: 'parent-limits',
      toolName: 'piwin_codemode',
      arguments: { code },
    },
    signal,
  );
}

describe('codemode hard limits', () => {
  it('bounds a spinning script without blocking the host', async () => {
    let hostMoved = false;
    const pending = run(
      limits({ timeoutMs: 400, memoryLimitBytes: 32 * 1024 * 1024 }),
      holdTool([], { count: 0, max: 0 }),
      'while (true) {}',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    hostMoved = true;
    const result = await pending;
    expect(hostMoved).toBe(true);
    expect(result.ok, result.ok ? '' : result.message).toBe(false);
    if (!result.ok) {
      expect(result.details?.reason ?? result.message).toMatch(/timeout/);
    }
  }, 15_000);

  it('enforces call budget, concurrency, output, abort, and invocation-local store', async () => {
    const started: string[] = [];
    const active = { count: 0, max: 0 };
    const budget = await run(
      limits({ maxCalls: 1 }),
      holdTool(started, active),
      `try { await tools.hold({ id: 'a' }); await tools.hold({ id: 'b' }); return 'both'; } catch (error) { return String(error && error.message); }`,
    );
    expect(budget.ok, budget.ok ? '' : budget.message).toBe(true);
    if (budget.ok) {
      expect(budget.output).toContain('call budget');
    }

    const overlap = await run(
      limits({ maxConcurrency: 1, timeoutMs: 5_000 }),
      holdTool(started, active),
      `await Promise.all([tools.hold({ id: '1' }), tools.hold({ id: '2' })]); return 'done';`,
    );
    expect(overlap.ok).toBe(true);
    expect(active.max).toBe(1);

    const huge = await run(
      limits({ maxOutputChars: 256 }),
      holdTool([], { count: 0, max: 0 }),
      'return "z".repeat(5000);',
    );
    expect(huge.ok).toBe(true);
    if (huge.ok) {
      expect(huge.output.length).toBeLessThanOrEqual(256);
      expect(huge.details?.truncated).toBe(true);
    }

    const controller = new AbortController();
    const hanging = run(
      limits({ timeoutMs: 10_000 }),
      holdTool([], { count: 0, max: 0 }),
      'await tools.hold({ id: "block" }); return "done";',
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    controller.abort();
    const aborted = await hanging;
    expect(aborted.ok).toBe(false);

    const first = await run(limits(), holdTool([], active), `store('k', 1); return load('k');`);
    const second = await run(limits(), holdTool([], active), `return load('k') === undefined ? 'empty' : 'leaked';`);
    expect(first.ok && first.output).toContain('1');
    expect(second.ok && second.output).toContain('empty');
  }, 20_000);

  it('does not start a queued call after abort', async () => {
    const started: string[] = [];
    const controller = new AbortController();
    const tool = holdTool(started, { count: 0, max: 0 });
    const pending = run(
      limits({ maxConcurrency: 1, timeoutMs: 10_000 }),
      tool,
      `await Promise.all([tools.hold({ id: 'first' }), tools.hold({ id: 'second' })]); return 'done';`,
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    controller.abort();
    await pending;
    expect(started).toContain('first');
    expect(started).not.toContain('second');
  }, 15_000);

  it('fails a memory-heavy script and still closes the worker', async () => {
    const result = await run(
      limits({ memoryLimitBytes: 1_048_576, timeoutMs: 10_000 }),
      holdTool([], { count: 0, max: 0 }),
      `return 'x'.repeat(8_000_000).length;`,
    );
    expect(result.ok, result.ok ? result.output : result.message).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/out of memory/);
    }
    const again = await run(limits({ timeoutMs: 5_000 }), holdTool([], { count: 0, max: 0 }), 'return 2;');
    expect(again.ok, again.ok ? '' : again.message).toBe(true);
    if (again.ok) {
      expect(again.output).toContain('2');
    }
  }, 20_000);
});
