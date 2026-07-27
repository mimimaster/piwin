import { describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { MockHostBackend } from './host-client-mock';

describe('MockHostBackend run lifecycle', () => {
  it('keeps stale aborts from cancelling the active run and emits one terminal event', async () => {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => {
        if (message.type === 'event') {
          pushes.push(message);
        }
      },
      () => 'sdk',
    );
    const createResponse = await backend.handle(
      { type: 'session/create', input: { projectPath: '/tmp/mock' } },
      'create',
    );
    expect(createResponse.success).toBe(true);
    if (!createResponse.success) return;
    const sessionId = (createResponse.data as { sessionId: string }).sessionId;

    const promptResponse = await backend.handle(
      { type: 'session/prompt', sessionId, input: { text: '__PIWIN_RENDER_STRESS__' } },
      'prompt',
    );
    expect(promptResponse.success).toBe(true);
    if (!promptResponse.success) return;
    const runId = (promptResponse.data as { runId: string }).runId;

    await waitForPush(pushes, (push) => push.event.type === 'run/phase' && push.event.phase === 'streaming');
    const staleAbort = await backend.handle(
      { type: 'session/abort', sessionId, runId: 'stale-run' },
      'stale-abort',
    );
    expect(staleAbort).toMatchObject({
      success: true,
      data: { cancelled: false, reason: 'run-mismatch', activeRunId: runId },
    });
    expect(
      pushes.some((push) => push.type === 'event' && push.event.type === 'run/terminal'),
    ).toBe(false);

    const abortResponse = await backend.handle(
      { type: 'session/abort', sessionId, runId },
      'abort',
    );
    expect(abortResponse).toMatchObject({ success: true, data: { cancelled: true, runId } });
    await waitForPush(pushes, (push) => push.event.type === 'run/terminal');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const terminalEvents = pushes.filter(
      (push) =>
        push.type === 'event' && push.event.type === 'run/terminal' && push.event.runId === runId,
    );
    expect(terminalEvents).toHaveLength(1);
    const terminalEvent = terminalEvents[0];
    expect(terminalEvent?.type).toBe('event');
    if (terminalEvent?.type === 'event') {
      expect(terminalEvent.event).toMatchObject({ outcome: 'cancelled', code: 'cancelled' });
    }
  });
});

async function waitForPush(
  pushes: HostPush[],
  predicate: (push: Extract<HostPush, { type: 'event' }>) => boolean,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const matchingPush = pushes.find((push): push is Extract<HostPush, { type: 'event' }> =>
      push.type === 'event' && predicate(push),
    );
    if (matchingPush) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for mock host event');
}
