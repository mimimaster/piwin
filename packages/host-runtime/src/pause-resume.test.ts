import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush, SessionTranscriptMessage } from '@piwin/contracts';
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

  it('resumes a paused Fusion turn with the same scheme', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-pause-resume-scheme-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (push) => pushes.push(push),
    });
    const orchestrationLabels = async (sessionId: string, runId: string): Promise<string[]> => {
      const response = await runtime.handleCommand({
        type: 'session/model-context-summary',
        sessionId,
      });
      if (!response.success) throw new Error(response.error);
      const summaries = (
        response.data as {
          summaries: Array<{ runId: string; contributions: Array<{ kind: string; label: string }> }>;
        }
      ).summaries;
      return summaries
        .filter((summary) => summary.runId === runId)
        .flatMap((summary) => summary.contributions)
        .filter((contribution) => contribution.kind === 'orchestration')
        .map((contribution) => contribution.label);
    };

    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath: '/tmp/pause-resume-scheme' },
      });
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      const prompt = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: {
          text: 'Please produce a fairly long reply so I can pause mid way.',
          orchestrationSchemeId: 'fusion',
        },
      });
      if (!prompt.success) throw new Error(prompt.error);
      const runId = (prompt.data as { runId: string }).runId;
      await waitFor(() => runRegistry(runtime).getForegroundRun(sessionId));

      await runtime.handleCommand({ type: 'session/pause', sessionId, runId });
      await waitFor(() =>
        pushes.find((push) => push.type === 'run/terminal' && push.run.runId === runId),
      );

      const view = await runtime.handleCommand({ type: 'session/resume', sessionId });
      if (!view.success) throw new Error(view.error);
      const checkpoint = (
        view.data as { pauseCheckpoint: { checkpointId: string; turnPolicy?: unknown } }
      ).pauseCheckpoint;
      expect(checkpoint.turnPolicy).toMatchObject({ orchestrationSchemeId: 'fusion' });

      const resume = await runtime.handleCommand({
        type: 'session/resume-run',
        sessionId,
        checkpointId: checkpoint.checkpointId,
      });
      if (!resume.success) throw new Error(resume.error);
      const resumedRunId = (resume.data as { runId: string }).runId;
      await waitFor(() =>
        pushes.find((push) => push.type === 'run/terminal' && push.run.runId === resumedRunId),
      );
      // Regression: the resume used to run freehand, so Fusion sidekicks lost
      // their pinned model and Lead-review authority.
      expect(await orchestrationLabels(sessionId, resumedRunId)).toEqual(['Fusion']);
    } finally {
      await runtime.dispose();
    }
  });

  it.each([
    { mode: 'sdk', text: '先别继续旧任务，解释刚才的错误' },
    { mode: 'rpc', text: '先别继续旧任务，解释刚才的错误' },
    { mode: 'sdk', text: '继续' },
    { mode: 'rpc', text: '继续' },
  ] as const)(
    'a new prompt after pause stays a user message ($mode, $text)',
    async ({ mode, text }) => {
      const rootDir = await mkdtemp(join(tmpdir(), 'piwin-pause-new-prompt-'));
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
          input: { projectPath: '/tmp/pause-new-prompt' },
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
        await waitFor(() =>
          pushes.find(
            (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
              push.type === 'run/terminal' && push.run.runId === runId,
          ),
        );

        const rejected = await runtime.handleCommand({
          type: 'session/prompt',
          sessionId,
          input: { text, orchestrationSchemeId: 'missing-pause-test-scheme' },
        });
        expect(rejected.success).toBe(false);
        const stillPaused = await runtime.handleCommand({ type: 'session/resume', sessionId });
        expect(stillPaused).toMatchObject({
          success: true,
          data: { pauseCheckpoint: { status: 'active' } },
        });

        const next = await runtime.handleCommand({
          type: 'session/prompt',
          sessionId,
          input: { text, clientMessageId: 'new-after-pause' },
        });
        expect(next.success).toBe(true);
        if (!next.success) throw new Error(next.error);
        const nextRunId = (next.data as { runId: string }).runId;
        expect(nextRunId).not.toBe(runId);
        expect(runRegistry(runtime).get(nextRunId)?.resumeCheckpointId).toBeUndefined();

        const resumedTerminal = await waitFor(() =>
          pushes.find(
            (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
              push.type === 'run/terminal' && push.run.runId === nextRunId,
          ),
        );
        expect(resumedTerminal.run.status).toBe('completed');

        const view = await runtime.handleCommand({ type: 'session/resume', sessionId });
        expect(view.success).toBe(true);
        if (!view.success) throw new Error(view.error);
        expect((view.data as { pauseCheckpoint?: unknown }).pauseCheckpoint).toBeUndefined();
        const messages = await runtime.handleCommand({ type: 'session/messages', sessionId });
        if (!messages.success) throw new Error(messages.error);
        const transcript = (messages.data as { messages: SessionTranscriptMessage[] }).messages;
        expect(transcript.filter((message) => message.id === 'new-after-pause')).toMatchObject([
          { role: 'user', text },
        ]);
        expect(transcript.some((message) =>
          message.role === 'assistant' && message.text.includes(text),
        )).toBe(true);
        expect(transcript.some((message) =>
          message.text.includes('Continue the interrupted task from the current transcript'),
        )).toBe(false);
      } finally {
        await runtime.dispose();
      }
    },
  );

  it.each(['sdk', 'rpc'] as const)(
    'abort after pause leaves the checkpoint so resume can continue (%s)',
    async (mode) => {
      const rootDir = await mkdtemp(join(tmpdir(), 'piwin-pause-abort-keeps-'));
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
          input: { projectPath: '/tmp/pause-abort-keeps' },
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
        await waitFor(() =>
          pushes.find(
            (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
              push.type === 'run/terminal' && push.run.runId === runId,
          ),
        );

        const abort = await runtime.handleCommand({ type: 'session/abort', sessionId });
        expect(abort.success).toBe(true);

        const view = await runtime.handleCommand({ type: 'session/resume', sessionId });
        expect(view.success).toBe(true);
        if (!view.success) throw new Error(view.error);
        expect(
          (view.data as { pauseCheckpoint?: { status?: string } }).pauseCheckpoint?.status,
        ).toBe('active');

        const resume = await runtime.handleCommand({
          type: 'session/resume-run',
          sessionId,
        });
        expect(resume.success).toBe(true);
      } finally {
        await runtime.dispose();
      }
    },
  );
});
