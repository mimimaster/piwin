import { describe, expect, it, vi } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { BackendUserInputPendingController } from './backend-user-input-pending.js';

const request = {
  title: 'Pick',
  questions: [
    {
      id: 'q1',
      prompt: 'Mode',
      type: 'select' as const,
      choices: [
        { id: 'fast', label: 'Fast' },
        { id: 'careful', label: 'Careful' },
      ],
    },
  ],
};

describe('BackendUserInputPendingController', () => {
  it('pushes a request, waits beyond 5s, and settles with verbatim option ids', async () => {
    vi.useFakeTimers();
    const pushes: HostPush[] = [];
    const controller = new BackendUserInputPendingController({
      push: (message) => pushes.push(message),
      getForegroundRunId: () => 'run-1',
      createRequestId: () => 'host-req-1',
    });

    const pending = controller.requestFromPlugin(
      { request, runId: 'run-1' },
      { sessionId: 's1', runtimeGenerationId: 'gen-1' },
    );

    await vi.advanceTimersByTimeAsync(6_000);
    expect(pushes[0]).toMatchObject({
      type: 'session/backend-input-request',
      requestId: 'host-req-1',
      generationId: 'gen-1',
      runId: 'run-1',
    });

    const settled = controller.respond({
      sessionId: 's1',
      requestId: 'host-req-1',
      generationId: 'gen-1',
      runId: 'run-1',
      result: { answers: [{ questionId: 'q1', optionIds: ['careful'] }] },
    });
    expect(settled).toEqual({ ok: true });
    await expect(pending).resolves.toEqual({
      answers: [{ questionId: 'q1', optionIds: ['careful'] }],
    });
    expect(pushes.at(-1)).toMatchObject({
      type: 'session/backend-input-settled',
      result: { answers: [{ questionId: 'q1', optionIds: ['careful'] }] },
    });
    vi.useRealTimers();
  });

  it('refuses foreign generation/run and cancels on lifecycle events', async () => {
    const controller = new BackendUserInputPendingController({
      push: () => undefined,
      getForegroundRunId: () => 'run-1',
      createRequestId: () => 'host-req-2',
    });
    const pending = controller.requestFromPlugin(
      { request, runId: 'run-1' },
      { sessionId: 's1', runtimeGenerationId: 'gen-1' },
    );
    expect(controller.respond({
      sessionId: 's1',
      requestId: 'host-req-2',
      generationId: 'gen-other',
      result: { cancelled: true },
    })).toEqual({ ok: false, error: 'input-scope-mismatch' });

    controller.cancelGeneration('s1', 'gen-1');
    await expect(pending).resolves.toEqual({ cancelled: true });

    await expect(controller.requestFromPlugin(
      { request, runId: 'run-stale' },
      { sessionId: 's1', runtimeGenerationId: 'gen-1' },
    )).rejects.toThrow(/foreign run/);
  });

  it('rejects invalid payloads and duplicate selected option ids at respond time', async () => {
    const controller = new BackendUserInputPendingController({
      push: () => undefined,
      getForegroundRunId: () => 'run-1',
      createRequestId: () => 'host-req-3',
    });
    const pending = controller.requestFromPlugin(
      { request, runId: 'run-1' },
      { sessionId: 's1', runtimeGenerationId: 'gen-1' },
    );
    expect(controller.respond({
      sessionId: 's1',
      requestId: 'host-req-3',
      generationId: 'gen-1',
      runId: 'run-1',
      result: { answers: [{ questionId: 'q1', optionIds: ['fast', 'fast'] }] },
    })).toEqual({ ok: false, error: 'invalid-input-result' });

    controller.cancelSession('s1');
    await expect(pending).resolves.toEqual({ cancelled: true });
  });

  it('requires an active foreground run even when params.runId is omitted', async () => {
    const pushes: HostPush[] = [];
    const idle = new BackendUserInputPendingController({
      push: (message) => pushes.push(message),
      getForegroundRunId: () => undefined,
      createRequestId: () => 'host-req-idle',
    });
    await expect(idle.requestFromPlugin(
      { request },
      { sessionId: 's1', runtimeGenerationId: 'gen-1' },
    )).rejects.toThrow(/no active run/);
    expect(idle.size).toBe(0);
    expect(pushes).toEqual([]);

    // Explicit foreign run still rejected; omitted runId attaches to the live foreground.
    const live = new BackendUserInputPendingController({
      push: (message) => pushes.push(message),
      getForegroundRunId: () => 'run-live',
      createRequestId: () => 'host-req-live',
    });
    await expect(live.requestFromPlugin(
      { request, runId: 'run-other' },
      { sessionId: 's1', runtimeGenerationId: 'gen-1' },
    )).rejects.toThrow(/foreign run/);
    expect(live.size).toBe(0);

    const pending = live.requestFromPlugin(
      { request },
      { sessionId: 's1', runtimeGenerationId: 'gen-1' },
    );
    expect(live.size).toBe(1);
    expect(pushes.at(-1)).toMatchObject({
      type: 'session/backend-input-request',
      requestId: 'host-req-live',
      runId: 'run-live',
    });
    live.cancelRun('s1', 'run-live');
    await expect(pending).resolves.toEqual({ cancelled: true });
  });
});
