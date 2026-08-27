import { describe, expect, it } from 'vitest';
import { createPauseRequestedAbortReason, createUserStopAbortReason } from './run-abort-reason.js';
import { shouldSuppressControlledAbortError } from './run-agent-event-policy.js';

describe('shouldSuppressControlledAbortError', () => {
  it('suppresses Agent errors after a Host pause request', () => {
    const controller = new AbortController();
    controller.abort(createPauseRequestedAbortReason());

    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'Request was aborted', runId: 'run-1' },
        { signal: controller.signal, pauseRequested: true, runStatus: 'cancelling' },
      ),
    ).toBe(true);
  });

  it('suppresses Agent errors after an irreversible Stop', () => {
    const controller = new AbortController();
    controller.abort(createUserStopAbortReason());

    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'stream closed', runId: 'run-1' },
        { signal: controller.signal, runStatus: 'cancelling' },
      ),
    ).toBe(true);
  });

  it('suppresses errors after the Run already terminalized without a live signal', () => {
    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'The operation was aborted' },
        { runStatus: 'interrupted' },
      ),
    ).toBe(true);
  });

  it('keeps errors when the Host did not control the abort', () => {
    const controller = new AbortController();
    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'upstream timeout', runId: 'run-1' },
        { signal: controller.signal },
      ),
    ).toBe(false);

    controller.abort(new DOMException('The operation was aborted', 'AbortError'));
    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'The operation was aborted', runId: 'run-1' },
        { signal: controller.signal },
      ),
    ).toBe(false);
  });

  it('never suppresses non-error lifecycle events', () => {
    const controller = new AbortController();
    controller.abort(createPauseRequestedAbortReason());
    expect(
      shouldSuppressControlledAbortError(
        { type: 'message/end', messageId: 'assistant-1', runId: 'run-1' },
        { signal: controller.signal, pauseRequested: true },
      ),
    ).toBe(false);
  });
});
