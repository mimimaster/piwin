import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import { createDelayedSessionHandle } from './delayed-session-fixture.js';

function collectEvents(handle: ReturnType<typeof createDelayedSessionHandle>): AgentEvent[] {
  const events: AgentEvent[] = [];
  handle.subscribe((event) => events.push(event));
  return events;
}

describe('createDelayedSessionHandle', () => {
  it('emits a complete stream without delays', async () => {
    const handle = createDelayedSessionHandle({ chunkCount: 3 });
    const events = collectEvents(handle);

    await handle.prompt({ text: 'hello' });

    const types = events.map((event) => event.type);
    expect(types).toContain('message/start');
    expect(types).toContain('message/text_delta');
    expect(types).toContain('message/end');
    expect(handle.emittedDeltaCount).toBe(3);
  });

  it('hangs until abort when hangUntilAbort is set', async () => {
    const handle = createDelayedSessionHandle({
      delays: { hangUntilAbort: true },
      chunkCount: 2,
    });
    const events = collectEvents(handle);

    const promptPromise = handle.prompt({ text: 'will hang' });

    // Wait for deltas to arrive, then abort.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(handle.emittedDeltaCount).toBe(2);
    expect(handle.abortRequested).toBe(false);

    await handle.abort();
    await promptPromise;

    expect(handle.abortRequested).toBe(true);
    const aborted = events.filter((event) => event.type === 'session/aborted');
    expect(aborted).toHaveLength(1);
  });

  it('respects firstTokenMs delay', async () => {
    let elapsed = 0;
    const handle = createDelayedSessionHandle({
      delays: { firstTokenMs: 100 },
      delayFn: (ms) => {
        elapsed += ms;
        return Promise.resolve();
      },
      chunkCount: 1,
    });

    await handle.prompt({ text: 'slow start' });

    // The interruptible delay polls in 10ms increments, so elapsed >= 100.
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(handle.emittedDeltaCount).toBe(1);
  });

  it('abort interrupts a long firstTokenMs delay', async () => {
    const handle = createDelayedSessionHandle({
      delays: { firstTokenMs: 60_000 },
      chunkCount: 1,
    });
    const events = collectEvents(handle);

    const promptPromise = handle.prompt({ text: 'will be aborted' });

    // Abort while waiting for first token.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await handle.abort();
    await promptPromise;

    expect(handle.emittedDeltaCount).toBe(0);
    const aborted = events.filter((event) => event.type === 'session/aborted');
    expect(aborted).toHaveLength(1);
  });

  it('emits tool events when tool delays are configured', async () => {
    const handle = createDelayedSessionHandle({
      delays: { toolStartMs: 10, toolDurationMs: 20 },
      chunkCount: 1,
    });
    const events = collectEvents(handle);

    await handle.prompt({ text: 'with tool' });

    const toolStart = events.filter((event) => event.type === 'tool/start');
    const toolEnd = events.filter((event) => event.type === 'tool/end');
    expect(toolStart).toHaveLength(1);
    expect(toolEnd).toHaveLength(1);
    if (toolEnd[0]?.type === 'tool/end') {
      expect(toolEnd[0].isError).toBe(false);
    }
  });

  it('emits configured high-rate tool output in bounded chunks', async () => {
    const handle = createDelayedSessionHandle({
      chunkCount: 0,
      toolOutputBytes: 256,
      toolOutputChunkBytes: 64,
    });
    const events = collectEvents(handle);

    await handle.prompt({ text: 'high-rate tool output' });

    const updates = events.filter(
      (event): event is Extract<AgentEvent, { type: 'tool/update' }> =>
        event.type === 'tool/update',
    );
    expect(updates).toHaveLength(4);
    expect(updates.map((event) => event.delta.length)).toEqual([64, 64, 64, 64]);
  });

  it('cancellationAckMs delays abort resolution', async () => {
    let delayCalls: number[] = [];
    const handle = createDelayedSessionHandle({
      delays: { hangUntilAbort: true, cancellationAckMs: 50 },
      delayFn: (ms) => {
        delayCalls.push(ms);
        return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
      },
      chunkCount: 1,
    });

    const promptPromise = handle.prompt({ text: 'slow cancel' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    delayCalls = [];
    await handle.abort();
    await promptPromise;

    // The abort() call should have invoked delay with cancellationAckMs.
    expect(delayCalls).toContain(50);
  });

  it('promptSettled resolves after normal completion', async () => {
    const handle = createDelayedSessionHandle({ chunkCount: 2 });
    const promptPromise = handle.prompt({ text: 'settle test' });
    await promptPromise;
    // promptSettled should already be resolved.
    await handle.promptSettled;
    expect(handle.emittedDeltaCount).toBe(2);
  });
});
