import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionRunRecord, HostProblem, HostPush } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import { fail } from '../response-helpers.js';
import { evaluatePromptForegroundAdmission } from './session-prompt-admission.js';

/**
 * Use HostRuntime's hang-until-abort fixture. `__PIWIN_HANG__` is not a
 * prompt magic string in this tree.
 */
async function createIsolatedRuntime(options?: {
  hang?: boolean;
}): Promise<{ runtime: HostRuntime; pushes: HostPush[] }> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-admission-'));
  const pushes: HostPush[] = [];
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: rootDir,
    ...(options?.hang === false ? {} : { testFixture: 'hang-until-abort' }),
    onPush: (message) => {
      pushes.push(message);
    },
  });
  return { runtime, pushes };
}

async function createSession(runtime: HostRuntime, sessionName = 'admission'): Promise<string> {
  const created = await runtime.handleCommand({
    type: 'session/create',
    input: { scope: { kind: 'general' }, sessionName },
  });
  expect(created.success).toBe(true);
  if (!created.success) throw new Error(created.error);
  return (created.data as { sessionId: string }).sessionId;
}

describe('session/prompt foreground admission', () => {
  const runtimes: HostRuntime[] = [];

  afterEach(async () => {
    const pending = runtimes.splice(0);
    await Promise.all(pending.map((runtime) => runtime.dispose()));
  });

  it('rejects if-idle while a foreground run is live and does not cancel it', async () => {
    const { runtime } = await createIsolatedRuntime();
    runtimes.push(runtime);
    const sessionId = await createSession(runtime);

    const first = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'first' },
      foreground: { kind: 'if-idle' },
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);
    const firstRunId = (first.data as { runId: string }).runId;

    const busy = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'second' },
      foreground: { kind: 'if-idle' },
    });
    expect(busy.success).toBe(false);
    if (!busy.success) {
      expect(busy.problem).toMatchObject({
        code: 'foreground-run-mismatch',
        data: { reason: 'active' },
      });
    }

    const stillBusy = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'third' },
      foreground: { kind: 'if-idle' },
    });
    expect(stillBusy.success).toBe(false);
    if (!stillBusy.success) {
      expect(stillBusy.problem).toMatchObject({
        code: 'foreground-run-mismatch',
        data: { reason: 'active', actualRun: { runId: firstRunId } },
      });
    }
  });

  it('replace-run acks a new runId without requiring the old run to finish first', async () => {
    const { runtime, pushes } = await createIsolatedRuntime();
    runtimes.push(runtime);

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'general' }, sessionName: 'admission' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const first = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hang-until-fixture-abort' },
      foreground: { kind: 'if-idle' },
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);
    const oldRunId = (first.data as { runId: string }).runId;
    const startedAt = Date.now();
    const replaced = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'take over' },
      foreground: { kind: 'replace-run', runId: oldRunId },
    });
    // hang-until-abort acknowledges cancel after 200ms. Ack must not join that wait.
    expect(Date.now() - startedAt).toBeLessThan(150);
    expect(replaced.success).toBe(true);
    if (!replaced.success) throw new Error(replaced.error);
    const newRunId = (replaced.data as { runId: string }).runId;
    expect(newRunId).not.toBe(oldRunId);

    const stillNew = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'if-idle after replace' },
      foreground: { kind: 'if-idle' },
    });
    expect(stillNew.success).toBe(false);
    if (!stillNew.success) {
      expect(stillNew.problem).toMatchObject({
        code: 'foreground-run-mismatch',
        data: { reason: 'active', actualRun: { runId: newRunId } },
      });
    }

    await vi.waitFor(() => {
      const terminal = pushes.filter(
        (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
          push.type === 'run/terminal' && push.run.runId === oldRunId,
      );
      expect(terminal.at(-1)?.run.terminalCode).toBe('superseded-by-new-prompt');
    });
  });

  it('does not markIdle the runtime when terminating the superseded run', async () => {
    const { runtime, pushes } = await createIsolatedRuntime();
    runtimes.push(runtime);
    const sessionId = await createSession(runtime, 'mark-idle');
    const residency = (
      runtime as unknown as {
        residencyController: { markIdle: (sessionId: string, generationId: string) => void };
      }
    ).residencyController;
    const markIdle = vi.spyOn(residency, 'markIdle');

    const first = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'live' },
      foreground: { kind: 'if-idle' },
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);
    const oldRunId = (first.data as { runId: string }).runId;
    markIdle.mockClear();

    const replaced = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'take over' },
      foreground: { kind: 'replace-run', runId: oldRunId },
    });
    expect(replaced.success).toBe(true);
    if (!replaced.success) throw new Error(replaced.error);
    const newRunId = (replaced.data as { runId: string }).runId;

    await vi.waitFor(() => {
      const terminal = pushes.filter(
        (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
          push.type === 'run/terminal' && push.run.runId === oldRunId,
      );
      expect(terminal.at(-1)?.run.terminalCode).toBe('superseded-by-new-prompt');
    });
    expect(markIdle).not.toHaveBeenCalled();
    const registry = (
      runtime as unknown as {
        runRegistry: { getForegroundRun: (id: string) => { runId: string } | undefined };
      }
    ).runRegistry;
    expect(registry.getForegroundRun(sessionId)?.runId).toBe(newRunId);
  });

  it('lists the live foreground run for hydration ports', async () => {
    const { runtime } = await createIsolatedRuntime();
    runtimes.push(runtime);
    const sessionId = await createSession(runtime, 'list-foreground');
    expect(runtime.listForegroundRuns()).toEqual([]);

    const first = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'live' },
      foreground: { kind: 'if-idle' },
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);
    const runId = (first.data as { runId: string }).runId;
    expect(runtime.listForegroundRuns()).toEqual([
      expect.objectContaining({
        sessionId,
        runId,
        status: expect.stringMatching(/queued|running/),
      }),
    ]);
    expect(runtime.listPendingPermissionRequests()).toEqual([]);
  });

  it('returns a structured problem instead of a bare run-active on concurrent if-idle', async () => {
    const { runtime } = await createIsolatedRuntime();
    runtimes.push(runtime);
    const sessionId = await createSession(runtime, 'concurrent-if-idle');
    const [first, second] = await Promise.all([
      runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'a' },
        foreground: { kind: 'if-idle' },
      }),
      runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'b' },
        foreground: { kind: 'if-idle' },
      }),
    ]);
    const responses = [first, second];
    const accepted = responses.filter((response) => response.success);
    const rejected = responses.filter((response) => !response.success);
    expect(accepted.length + rejected.length).toBe(2);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    for (const response of rejected) {
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.problem?.code).toBe('foreground-run-mismatch');
        expect(response.error).not.toMatch(/^run-active:/);
      }
    }
  });

  it('replace-run against a different live run is changed and does not mutate', async () => {
    const { runtime } = await createIsolatedRuntime();
    runtimes.push(runtime);
    const sessionId = await createSession(runtime, 'changed');
    const first = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'live' },
      foreground: { kind: 'if-idle' },
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);
    const liveRunId = (first.data as { runId: string }).runId;

    const changed = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'stale replace' },
      foreground: { kind: 'replace-run', runId: 'run-other' },
    });
    expect(changed.success).toBe(false);
    if (!changed.success) {
      expect(changed.problem).toMatchObject({
        code: 'foreground-run-mismatch',
        data: { reason: 'changed', actualRun: { runId: liveRunId } },
      });
    }

    const stillLive = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'still idle check' },
      foreground: { kind: 'if-idle' },
    });
    expect(stillLive.success).toBe(false);
    if (!stillLive.success) {
      expect(stillLive.problem).toMatchObject({
        data: { reason: 'active', actualRun: { runId: liveRunId } },
      });
    }
  });

  it('replace-run with no live run is already-finished and does not auto-send', async () => {
    const { runtime } = await createIsolatedRuntime({ hang: false });
    runtimes.push(runtime);
    const sessionId = await createSession(runtime, 'already-finished');

    const finished = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'replace missing' },
      foreground: { kind: 'replace-run', runId: 'run-A' },
    });
    expect(finished.success).toBe(false);
    if (!finished.success) {
      expect(finished.problem).toMatchObject({
        code: 'foreground-run-mismatch',
        data: { reason: 'already-finished' },
      });
    }
  });

  it('omitted foreground still supersedes a live run (local JSONL path)', async () => {
    const { runtime, pushes } = await createIsolatedRuntime();
    runtimes.push(runtime);
    const sessionId = await createSession(runtime, 'omit-supersede');
    const first = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'original' },
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);
    const oldRunId = (first.data as { runId: string }).runId;

    const superseded = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'newer omitted prompt' },
    });
    expect(superseded.success).toBe(true);
    if (!superseded.success) throw new Error(superseded.error);
    expect((superseded.data as { runId: string }).runId).not.toBe(oldRunId);

    await vi.waitFor(() => {
      const terminal = pushes.filter(
        (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
          push.type === 'run/terminal' && push.run.runId === oldRunId,
      );
      expect(terminal.at(-1)?.run.terminalCode).toBe('superseded-by-new-prompt');
    });
  });
});

describe('evaluatePromptForegroundAdmission', () => {
  const liveRun = {
    runId: 'run-A',
    kind: 'session-turn',
    status: 'running',
    rootRunId: 'run-A',
    sessionId: 'sess-1',
    phase: 'streaming',
  } as ExecutionRunRecord;

  it('accepts if-idle when no run is live', () => {
    expect(
      evaluatePromptForegroundAdmission({
        admission: { kind: 'if-idle' },
        existingRun: undefined,
        reserved: false,
      }),
    ).toBeUndefined();
  });

  it('rejects if-idle against a live run as active', () => {
    expect(
      evaluatePromptForegroundAdmission({
        admission: { kind: 'if-idle' },
        existingRun: liveRun,
        reserved: false,
      }),
    ).toMatchObject({
      code: 'foreground-run-mismatch',
      data: { reason: 'active', actualRun: { runId: 'run-A', status: 'running' } },
    });
  });

  it('rejects replace-run against a different run as changed', () => {
    expect(
      evaluatePromptForegroundAdmission({
        admission: { kind: 'replace-run', runId: 'run-B' },
        existingRun: liveRun,
        reserved: false,
      }),
    ).toMatchObject({
      data: { reason: 'changed', actualRun: { runId: 'run-A' } },
    });
  });

  it('rejects replace-run with no run as already-finished', () => {
    expect(
      evaluatePromptForegroundAdmission({
        admission: { kind: 'replace-run', runId: 'run-A' },
        existingRun: undefined,
        reserved: false,
      }),
    ).toMatchObject({ data: { reason: 'already-finished' } });
  });

  it('rejects reserved or cancelling transitions as transitioning', () => {
    expect(
      evaluatePromptForegroundAdmission({
        admission: { kind: 'if-idle' },
        existingRun: liveRun,
        reserved: true,
      }),
    ).toMatchObject({ data: { reason: 'transitioning' } });
    expect(
      evaluatePromptForegroundAdmission({
        admission: { kind: 'replace-run', runId: 'run-A' },
        existingRun: { ...liveRun, status: 'cancelling' },
        reserved: false,
      }),
    ).toMatchObject({ data: { reason: 'transitioning' } });
  });
});

describe('fail() problem payload', () => {
  it('omits problem when not provided and attaches it when given', () => {
    const plain = fail(undefined, 'session/prompt', 'nope');
    expect(plain.success).toBe(false);
    if (!plain.success) {
      expect(plain.problem).toBeUndefined();
    }
    const problem: HostProblem = { code: 'foreground-run-mismatch' };
    const withProblem = fail('req-1', 'session/prompt', 'nope', problem);
    expect(withProblem).toMatchObject({
      id: 'req-1',
      success: false,
      error: 'nope',
      problem,
    });
  });
});
