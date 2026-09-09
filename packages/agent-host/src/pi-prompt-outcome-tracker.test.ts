import { describe, expect, it } from 'vitest';
import { createPiPromptOutcomeTracker, runTrackedPiPrompt } from './pi-prompt-outcome-tracker.js';
import { loadModelStreamFixture } from './fixtures/model-stream/load-model-stream-fixture.js';

function finalizeFixture(name: string) {
  const tracker = createPiPromptOutcomeTracker();
  for (const raw of loadModelStreamFixture(name)) {
    tracker.observe(raw);
  }
  return tracker.finalize();
}

describe('pi-prompt-outcome-tracker', () => {
  it('maps thinking-only stop as a successful empty turn', () => {
    expect(finalizeFixture('thinking-only-stop.json')).toEqual({
      status: 'completed',
      stopReason: 'stop',
    });
  });

  it('maps a clean text stop as completed', () => {
    expect(finalizeFixture('text-stop.json')).toEqual({
      status: 'completed',
      stopReason: 'stop',
    });
  });

  it('keeps a tool loop inside one completed stop', () => {
    expect(finalizeFixture('tool-then-stop.json')).toEqual({
      status: 'completed',
      stopReason: 'stop',
    });
  });

  it('maps missing finish to a structured protocol failure', () => {
    expect(finalizeFixture('missing-finish.json')).toMatchObject({
      status: 'failed',
      stopReason: 'error',
      failure: {
        code: 'model-stream-missing-finish',
        origin: 'protocol',
        message: 'Stream ended without finish_reason',
        retriable: true,
      },
    });
  });

  it('maps Pi finish_reason max_tokens wrapping to completed length', () => {
    expect(finalizeFixture('max-tokens-truncation.json')).toEqual({
      status: 'completed',
      stopReason: 'length',
    });
  });

  it('maps uppercase MAX_TOKENS wrapping to completed length', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    tracker.observe({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'Provider finish_reason: MAX_TOKENS',
      },
    });
    expect(tracker.finalize()).toEqual({ status: 'completed', stopReason: 'length' });
  });

  it('maps a native max_tokens stopReason to completed length', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    tracker.observe({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'max_tokens' },
    });
    expect(tracker.finalize()).toEqual({ status: 'completed', stopReason: 'length' });
  });

  it('maps a native length stop as completed truncation', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    tracker.observe({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'length' },
    });
    expect(tracker.finalize()).toEqual({ status: 'completed', stopReason: 'length' });
  });

  it('maps a 401 provider stop to authentication failure', () => {
    expect(finalizeFixture('provider-error.json')).toMatchObject({
      status: 'failed',
      stopReason: 'error',
      failure: {
        code: 'provider-authentication',
        origin: 'provider',
        message: '401: Invalid Authentication',
        retriable: false,
        httpStatus: 401,
      },
    });
  });

  it('maps a native abort stop as aborted', () => {
    expect(finalizeFixture('aborted.json')).toEqual({
      status: 'aborted',
      stopReason: 'aborted',
      message: 'Request was aborted',
    });
  });

  it('does not change the outcome when message_end and agent_end repeat the same error', () => {
    const once = createPiPromptOutcomeTracker();
    once.observe({
      type: 'agent_start',
    });
    once.observe({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'Stream ended without finish_reason',
      },
    });
    const afterMessageEnd = once.finalize();
    once.observe({
      type: 'agent_end',
      messages: [
        {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Stream ended without finish_reason',
        },
      ],
    });
    expect(once.finalize()).toEqual(afterMessageEnd);
    expect(once.finalize()).toEqual(finalizeFixture('missing-finish.json'));
  });

  it('ignores an intermediate retry failure and returns the last settled stop', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    tracker.observe({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'Stream ended without finish_reason',
      },
    });
    tracker.observe({ type: 'auto_retry_start' });
    tracker.observe({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'stop' },
    });
    tracker.observe({
      type: 'agent_end',
      messages: [{ role: 'assistant', stopReason: 'stop' }],
    });
    expect(tracker.finalize()).toEqual({ status: 'completed', stopReason: 'stop' });
  });

  it('returns handled when an extension consumes input without agent_start', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'turn_end' });
    expect(tracker.finalize()).toEqual({ status: 'completed', stopReason: 'handled' });
  });

  it('returns the last failed attempt when native retry budget is exhausted', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    tracker.observe({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'Stream ended without finish_reason',
      },
    });
    tracker.observe({ type: 'auto_retry_start', attempt: 1 });
    tracker.observe({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'Stream ended without finish_reason',
      },
    });
    tracker.observe({ type: 'auto_retry_end', attempt: 1, success: false });
    tracker.observe({
      type: 'agent_end',
      messages: [
        {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Stream ended without finish_reason',
        },
      ],
    });
    expect(tracker.finalize()).toMatchObject({
      status: 'failed',
      failure: { code: 'model-stream-missing-finish' },
    });
  });

  it('returns a terminating toolUse stop as completed', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    tracker.observe({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'toolUse' },
    });
    tracker.observe({
      type: 'agent_end',
      messages: [{ role: 'assistant', stopReason: 'toolUse' }],
    });
    expect(tracker.finalize()).toEqual({ status: 'completed', stopReason: 'toolUse' });
  });

  it('returns backend-protocol-error for an unexpected native stop reason', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    tracker.observe({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'nonsense' },
    });
    expect(tracker.finalize()).toMatchObject({
      status: 'failed',
      stopReason: 'error',
      failure: { code: 'backend-protocol-error', origin: 'protocol', retriable: false },
    });
  });

  it('returns backend-protocol-error when agent_start never produces a stopReason', () => {
    const tracker = createPiPromptOutcomeTracker();
    tracker.observe({ type: 'agent_start' });
    expect(tracker.finalize()).toMatchObject({
      status: 'failed',
      failure: {
        code: 'backend-protocol-error',
        message: 'Pi prompt settled without a native stopReason',
      },
    });
  });

  it('subscribes before prompt and unsubscribes after settlement', async () => {
    const seen: unknown[] = [];
    let subscribed = false;
    let unsubscribed = false;
    const outcome = await runTrackedPiPrompt({
      subscribe: (listener) => {
        subscribed = true;
        listener({ type: 'agent_start' });
        listener({
          type: 'message_end',
          message: { role: 'assistant', stopReason: 'stop' },
        });
        return () => {
          unsubscribed = true;
        };
      },
      prompt: async () => {
        expect(subscribed).toBe(true);
        seen.push('prompted');
      },
    });
    expect(seen).toEqual(['prompted']);
    expect(unsubscribed).toBe(true);
    expect(outcome).toEqual({ status: 'completed', stopReason: 'stop' });
  });
});
