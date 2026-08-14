import { describe, expect, it } from 'vitest';
import {
  ToolInvocationLedger,
  fingerprintToolInvocation,
} from './tool-invocation-ledger.js';
import { stableCanonicalJson } from './stable-canonical-json.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('stableCanonicalJson', () => {
  it('sorts object keys by UTF-16 code unit, not insertion order', () => {
    expect(stableCanonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableCanonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
});

describe('ToolInvocationLedger', () => {
  it('coalesces identical in-flight invocations and replays the settled result', async () => {
    const ledger = new ToolInvocationLedger();
    let runs = 0;
    const start = async (signal: AbortSignal) => {
      const first = ledger.run(
        {
          runId: 'run-1',
          toolCallId: 'call-1',
          toolName: 'write_file',
          fingerprint: 'fp-a',
          callerSignal: signal,
        },
        async () => {
          runs += 1;
          await delay(20);
          return { ok: true, output: 'wrote' };
        },
      );
      const second = ledger.run(
        {
          runId: 'run-1',
          toolCallId: 'call-1',
          toolName: 'write_file',
          fingerprint: 'fp-a',
          callerSignal: signal,
        },
        async () => {
          runs += 1;
          return { ok: true, output: 'should-not-run' };
        },
      );
      await expect(Promise.all([first, second])).resolves.toEqual([
        { ok: true, output: 'wrote' },
        { ok: true, output: 'wrote' },
      ]);
      expect(runs).toBe(1);
      await expect(
        ledger.run(
          {
            runId: 'run-1',
            toolCallId: 'call-1',
            toolName: 'write_file',
            fingerprint: 'fp-a',
            callerSignal: signal,
          },
          async () => ({ ok: true, output: 'replay-miss' }),
        ),
      ).resolves.toEqual({ ok: true, output: 'wrote' });
      expect(runs).toBe(1);
    };
    await start(new AbortController().signal);
  });

  it('rejects the same toolCallId when the fingerprint differs', async () => {
    const ledger = new ToolInvocationLedger();
    const signal = new AbortController().signal;
    const first = ledger.run(
      {
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'write_file',
        fingerprint: 'fp-a',
        callerSignal: signal,
      },
      async () => {
        await delay(20);
        return { ok: true, output: 'a' };
      },
    );
    await expect(
      ledger.run(
        {
          runId: 'run-1',
          toolCallId: 'call-1',
          toolName: 'write_file',
          fingerprint: 'fp-b',
          callerSignal: signal,
        },
        async () => ({ ok: true, output: 'b' }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'tool-not-available',
      message: 'tool call argument mismatch for toolCallId',
    });
    await first;
  });

  it('allows re-entry after every waiter aborts before the runner starts', async () => {
    const ledger = new ToolInvocationLedger();
    const firstController = new AbortController();
    let started = 0;
    const first = ledger.run(
      {
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        fingerprint: 'fp',
        callerSignal: firstController.signal,
      },
      async (attempt) => {
        started += 1;
        await delay(30);
        if (attempt.signal.aborted) {
          return { ok: false, code: 'aborted', message: 'tool execution aborted' };
        }
        attempt.markRunnerStarted();
        return { ok: true, output: 'late' };
      },
    );
    firstController.abort();
    await expect(first).resolves.toMatchObject({ ok: false, code: 'aborted' });
    await expect(
      ledger.run(
        {
          runId: 'run-1',
          toolCallId: 'call-1',
          toolName: 'bash',
          fingerprint: 'fp',
          callerSignal: new AbortController().signal,
        },
        async (attempt) => {
          started += 1;
          attempt.markRunnerStarted();
          return { ok: true, output: 'retry' };
        },
      ),
    ).resolves.toEqual({ ok: true, output: 'retry' });
    expect(started).toBe(2);
  });

  it('does not re-enter after the runner has started, even if callers abort', async () => {
    const ledger = new ToolInvocationLedger();
    const controller = new AbortController();
    let runs = 0;
    const first = ledger.run(
      {
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        fingerprint: 'fp',
        callerSignal: controller.signal,
      },
      async (attempt) => {
        runs += 1;
        attempt.markRunnerStarted();
        await delay(30);
        return { ok: true, output: 'done' };
      },
    );
    await delay(5);
    controller.abort();
    await expect(first).resolves.toMatchObject({ ok: false, code: 'aborted' });
    await expect(
      ledger.run(
        {
          runId: 'run-1',
          toolCallId: 'call-1',
          toolName: 'bash',
          fingerprint: 'fp',
          callerSignal: new AbortController().signal,
        },
        async () => {
          runs += 1;
          return { ok: true, output: 'again' };
        },
      ),
    ).resolves.toMatchObject({ ok: true, output: 'done' });
    expect(runs).toBe(1);
  });

  it('aborts the shared runner signal when the last waiter leaves after start', async () => {
    const ledger = new ToolInvocationLedger();
    const controller = new AbortController();
    let sawSharedAbort = false;
    const first = ledger.run(
      {
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        fingerprint: 'fp',
        callerSignal: controller.signal,
      },
      async (attempt) => {
        attempt.markRunnerStarted();
        await new Promise<void>((resolve) => {
          if (attempt.signal.aborted) {
            sawSharedAbort = true;
            resolve();
            return;
          }
          attempt.signal.addEventListener(
            'abort',
            () => {
              sawSharedAbort = true;
              resolve();
            },
            { once: true },
          );
        });
        return { ok: false, code: 'aborted', message: 'tool execution aborted' };
      },
    );
    await delay(5);
    controller.abort();
    await expect(first).resolves.toMatchObject({ ok: false, code: 'aborted' });
    expect(sawSharedAbort).toBe(true);
  });

  it('fail-closes new keys once the per-run ceiling is reached', async () => {
    const ledger = new ToolInvocationLedger({ maxKeysPerRun: 1 });
    const signal = new AbortController().signal;
    await ledger.run(
      {
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        fingerprint: 'fp',
        callerSignal: signal,
      },
      async (attempt) => {
        attempt.markRunnerStarted();
        return { ok: true, output: 'one' };
      },
    );
    await expect(
      ledger.run(
        {
          runId: 'run-1',
          toolCallId: 'call-2',
          toolName: 'bash',
          fingerprint: 'fp',
          callerSignal: signal,
        },
        async () => ({ ok: true, output: 'two' }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      message: 'tool invocation ledger capacity exceeded',
    });
  });

  it('evicts replay results but keeps the tombstone', async () => {
    const ledger = new ToolInvocationLedger({ maxReplayEntries: 1, maxReplayBytes: 1024 });
    const signal = new AbortController().signal;
    await ledger.run(
      {
        runId: 'run-1',
        toolCallId: 'old',
        toolName: 'bash',
        fingerprint: 'fp-old',
        callerSignal: signal,
      },
      async (attempt) => {
        attempt.markRunnerStarted();
        return { ok: true, output: 'old' };
      },
    );
    await ledger.run(
      {
        runId: 'run-1',
        toolCallId: 'new',
        toolName: 'bash',
        fingerprint: 'fp-new',
        callerSignal: signal,
      },
      async (attempt) => {
        attempt.markRunnerStarted();
        return { ok: true, output: 'new' };
      },
    );
    await expect(
      ledger.run(
        {
          runId: 'run-1',
          toolCallId: 'old',
          toolName: 'bash',
          fingerprint: 'fp-old',
          callerSignal: signal,
        },
        async () => ({ ok: true, output: 'must-not-rerun' }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      message: 'tool call already settled; replay result unavailable',
    });
  });

  it('fingerprints tool name plus sorted canonical args', () => {
    const left = fingerprintToolInvocation('write_file', { path: '/a', content: 'x' });
    const right = fingerprintToolInvocation('write_file', { content: 'x', path: '/a' });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });
});
