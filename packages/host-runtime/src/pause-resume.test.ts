import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';
import type { RunRegistry } from './run-registry.js';

async function waitFor<T>(read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for Host state');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function runRegistry(runtime: HostRuntime): RunRegistry {
  return (runtime as unknown as { runRegistry: RunRegistry }).runRegistry;
}

describe('HostRuntime pause/resume', () => {
  it.each(['sdk', 'rpc'] as const)(
    'pauses a foreground turn into a durable checkpoint and resumes it (%s)',
    async (mode) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-pause-resume-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode,
      mock: true,
      piwinRoot: rootDir,
      onPush: (push) => pushes.push(push),
    });

    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath: '/tmp/pause-resume' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      const prompt = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'Please produce a fairly long reply so I can pause mid way.' },
      });
      expect(prompt.success).toBe(true);
      if (!prompt.success) throw new Error(prompt.error);
      const runId = (prompt.data as { runId: string }).runId;

      await waitFor(() => runRegistry(runtime).getForegroundRun(sessionId));
      const pause = await runtime.handleCommand({
        type: 'session/pause',
        sessionId,
        runId,
      });
      expect(pause).toMatchObject({ success: true, data: { state: 'pausing', runId } });

      const pausedTerminal = await waitFor(() =>
        pushes.find(
          (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
            push.type === 'run/terminal' && push.run.runId === runId,
        ),
      );
      expect(pausedTerminal.run.status).toBe('interrupted');
      expect(pausedTerminal.run.terminalCode).toBe('paused');
      expect(pausedTerminal.run.resumeCheckpointId).toBeTruthy();

      const resumedView = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resumedView).toMatchObject({
        success: true,
        data: { pauseCheckpoint: { status: 'active' } },
      });
      if (!resumedView.success) throw new Error(resumedView.error);
      const checkpointId = (
        resumedView.data as { pauseCheckpoint: { checkpointId: string } }
      ).pauseCheckpoint.checkpointId;

      const resume = await runtime.handleCommand({
        type: 'session/resume-run',
        sessionId,
        checkpointId,
      });
      expect(resume.success).toBe(true);
      if (!resume.success) throw new Error(resume.error);
      const resumedRunId = (resume.data as { runId: string }).runId;
      expect(resumedRunId).not.toBe(runId);

      const resumedTerminal = await waitFor(() =>
        pushes.find(
          (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
            push.type === 'run/terminal' && push.run.runId === resumedRunId,
        ),
      );
      expect(resumedTerminal.run.status).toBe('completed');

      const finalView = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(finalView).toMatchObject({ success: true });
      if (!finalView.success) throw new Error(finalView.error);
      expect((finalView.data as { pauseCheckpoint?: unknown }).pauseCheckpoint).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
    },
  );
});
