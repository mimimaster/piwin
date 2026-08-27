import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import { canCarryAgentEventRunId } from './agent-event-run-id.js';
import { startOpenAiSseFixture } from './fixtures/model-stream/openai-sse-fixture.js';
import {
  createTurnAuthorityLocalHome,
  FIXTURE_MODEL_ID,
  FIXTURE_PROVIDER_ID,
  type TurnAuthorityLocalHome,
} from './pi-turn-authority-local-home.js';
import {
  openTurnAuthorityBackend,
  type TurnAuthorityBackend,
  type TurnAuthorityBackendMode,
} from './pi-turn-authority-local-backend.js';

const modes: TurnAuthorityBackendMode[] = ['sdk', 'rpc'];
const MODEL = {
  protocol: 'openai-compatible' as const,
  providerId: FIXTURE_PROVIDER_ID,
  modelId: FIXTURE_MODEL_ID,
};

describe.each(modes)('Pi turn authority local SSE (%s)', (mode) => {
  let home: TurnAuthorityLocalHome | undefined;
  let backend: TurnAuthorityBackend | undefined;

  afterEach(async () => {
    await backend?.close();
    backend = undefined;
    await home?.close();
    home = undefined;
  });

  it(
    'completes a thinking-only stop with explicit run identity',
    async () => {
      const fixture = await startOpenAiSseFixture('thinking-only-stop');
      try {
        home = await createTurnAuthorityLocalHome();
        backend = await openTurnAuthorityBackend({
          mode,
          home,
          baseUrl: fixture.baseUrl,
          sessionId: `think-${mode}`,
        });
        const events: AgentEvent[] = [];
        const unsubscribe = backend.handle.subscribe((event) => {
          events.push(event);
        });
        const outcome = await backend.handle.prompt({
          text: 'fixture',
          runId: 'run-think',
          model: MODEL,
        });
        unsubscribe();

        expect(outcome).toEqual({ status: 'completed', stopReason: 'stop' });
        expect(events.some((event) => event.type === 'error')).toBe(false);
        expect(events.some((event) => event.type === 'message/thinking_delta')).toBe(true);
        assertForegroundEventsCarryRunId(events, 'run-think');
      } finally {
        await fixture.close();
      }
    },
    60_000,
  );

  it(
    'retries a missing finish once, then completes',
    async () => {
      const fixture = await startOpenAiSseFixture('missing-finish-then-stop');
      try {
        home = await createTurnAuthorityLocalHome();
        backend = await openTurnAuthorityBackend({
          mode,
          home,
          baseUrl: fixture.baseUrl,
          sessionId: `retry-${mode}`,
        });
        const events: AgentEvent[] = [];
        const unsubscribe = backend.handle.subscribe((event) => {
          events.push(event);
        });
        const outcome = await backend.handle.prompt({
          text: 'fixture',
          runId: 'run-retry',
          model: MODEL,
        });
        unsubscribe();

        expect(fixture.requestCount()).toBe(2);
        expect(outcome).toEqual({ status: 'completed', stopReason: 'stop' });
        expect(events.some((event) => event.type === 'model/retry')).toBe(true);
        // Intermediate missing-finish evidence may appear before the successful
        // retry. It must stay on this Run and cannot become the prompt outcome.
        for (const event of events.filter((item) => item.type === 'error')) {
          expect(event).toMatchObject({ runId: 'run-retry' });
        }
        assertForegroundEventsCarryRunId(events, 'run-retry');
      } finally {
        await fixture.close();
      }
    },
    60_000,
  );

  it(
    'fails after native retry is exhausted on missing finish',
    async () => {
      const fixture = await startOpenAiSseFixture('missing-finish');
      try {
        home = await createTurnAuthorityLocalHome();
        backend = await openTurnAuthorityBackend({
          mode,
          home,
          baseUrl: fixture.baseUrl,
          sessionId: `miss-${mode}`,
        });
        const outcome = await backend.handle.prompt({
          text: 'fixture',
          runId: 'run-miss',
          model: MODEL,
        });
        expect(fixture.requestCount()).toBe(2);
        expect(outcome.status).toBe('failed');
        if (outcome.status !== 'failed') {
          throw new Error('expected failed missing-finish outcome');
        }
        expect(outcome.failure.code).toBe('model-stream-missing-finish');
      } finally {
        await fixture.close();
      }
    },
    60_000,
  );

  it(
    'settles a keep-alive stall before a second prompt starts',
    async () => {
      const fixture = await startOpenAiSseFixture('keep-alive-stall');
      try {
        home = await createTurnAuthorityLocalHome();
        backend = await openTurnAuthorityBackend({
          mode,
          home,
          baseUrl: fixture.baseUrl,
          sessionId: `stall-${mode}`,
        });
        const first = backend.handle.prompt({
          text: 'fixture',
          runId: 'run-stall',
          model: MODEL,
        });
        const outcome = await first;
        expect(outcome.status).toBe('failed');
        if (outcome.status !== 'failed') {
          throw new Error('expected stalled outcome');
        }
        expect(outcome.failure.code).toBe('model-stream-stalled');
        expect(outcome.failure.origin).toBe('transport');

        const secondStarted = Date.now();
        await expect(
          backend.handle.prompt({
            text: 'fixture-two',
            runId: 'run-stall-2',
            model: MODEL,
          }),
        ).resolves.toMatchObject({ status: 'failed', failure: { code: 'model-stream-stalled' } });
        expect(Date.now() - secondStarted).toBeLessThan(8_000);
      } finally {
        await fixture.close();
      }
    },
    60_000,
  );
});

function assertForegroundEventsCarryRunId(events: readonly AgentEvent[], runId: string): void {
  for (const event of events) {
    if (!canCarryAgentEventRunId(event)) {
      expect(event).not.toHaveProperty('runId');
      continue;
    }
    expect(event).toMatchObject({ runId });
  }
}
