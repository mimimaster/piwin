import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import { createMockSessionHandle } from './mock-session.js';

describe('createMockSessionHandle abort', () => {
  it('emits session/aborted and stops further deltas', async () => {
    const events: AgentEvent[] = [];
    const session = createMockSessionHandle({ projectPath: '/tmp/project' });
    session.subscribe((event) => {
      events.push(event);
    });

    const promptPromise = session.prompt({ text: 'long enough to stream across multiple chunks' });
    // Abort after the first few event-loop yields.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await session.abort();
    await promptPromise;

    const aborted = events.filter((event) => event.type === 'session/aborted');
    expect(aborted).toHaveLength(1);
    const afterAbort = events.slice(
      events.findIndex((event) => event.type === 'session/aborted') + 1,
    );
    // No normal assistant completion after abort (user message/end may still exist earlier).
    expect(afterAbort.some((event) => event.type === 'message/end')).toBe(false);

    const deltas = events.filter((event) => event.type === 'message/text_delta');
    const afterAbortIndex = events.findIndex((event) => event.type === 'session/aborted');
    const deltasAfterAbort = events
      .slice(afterAbortIndex + 1)
      .filter((event) => event.type === 'message/text_delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltasAfterAbort).toHaveLength(0);
  });

  it('completes normally when not aborted', async () => {
    const events: AgentEvent[] = [];
    const session = createMockSessionHandle({ projectPath: '/tmp/project' });
    session.subscribe((event) => {
      events.push(event);
    });
    await session.prompt({ text: 'hello' });
    expect(events.some((event) => event.type === 'message/end')).toBe(true);
    expect(events.some((event) => event.type === 'session/aborted')).toBe(false);
  });

  it('echoes only the supplied current prompt, not serialized product history', async () => {
    const events: AgentEvent[] = [];
    const session = createMockSessionHandle({ scope: { kind: 'general' } });
    session.subscribe((event) => events.push(event));

    await session.prompt({ text: 'current visible prompt' });

    const reply = events
      .filter((event): event is Extract<AgentEvent, { type: 'message/text_delta' }> =>
        event.type === 'message/text_delta',
      )
      .map((event) => event.delta)
      .join('');
    expect(reply).toContain('current visible prompt');
    expect(reply).not.toContain('[piwin-product-history]');
  });
});
