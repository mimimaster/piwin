import { describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { MockHostBackend } from './host-client-mock';

describe('MockHostBackend run lifecycle', () => {
  it('keeps stale aborts from cancelling the active run and emits one terminal event', async () => {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => {
        if (message.type !== 'response') {
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

    await waitForPush(
      pushes,
      (push) => push.type === 'run/updated' && push.run.phase === 'streaming',
    );
    const staleAbort = await backend.handle(
      { type: 'session/abort', sessionId, runId: 'stale-run' },
      'stale-abort',
    );
    expect(staleAbort).toMatchObject({
      success: true,
      data: { cancelled: false, reason: 'run-mismatch', activeRunId: runId },
    });
    expect(
      pushes.some((push) => push.type === 'run/terminal'),
    ).toBe(false);

    const abortResponse = await backend.handle(
      { type: 'session/abort', sessionId, runId },
      'abort',
    );
    expect(abortResponse).toMatchObject({ success: true, data: { cancelled: true, runId } });
    await waitForPush(pushes, (push) => push.type === 'run/terminal');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const terminalEvents = pushes.filter(
      (push) => push.type === 'run/terminal' && push.run.runId === runId,
    );
    expect(terminalEvents).toHaveLength(1);
    const terminalEvent = terminalEvents[0];
    expect(terminalEvent?.type).toBe('run/terminal');
    if (terminalEvent?.type === 'run/terminal') {
      expect(terminalEvent.run).toMatchObject({ status: 'cancelled', terminalCode: 'cancelled' });
    }
  });
});

async function waitForPush(
  pushes: HostPush[],
  predicate: (push: HostPush) => boolean,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const matchingPush = pushes.find(predicate);
    if (matchingPush) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for mock host event');
}
