import { describe, expect, it } from 'vitest';
import { createPauseRequestedAbortReason, createUserStopAbortReason } from './run-abort-reason.js';
import {
  looksLikeProviderAbortMessage,
  shouldSuppressControlledAbortError,
} from './run-agent-event-policy.js';

describe('shouldSuppressControlledAbortError', () => {
  it('suppresses the provider abort error after a Host pause request', () => {
    const controller = new AbortController();
    controller.abort(createPauseRequestedAbortReason());

    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'Request was aborted', runId: 'run-1' },
        { signal: controller.signal, pauseRequested: true, runStatus: 'cancelling' },
      ),
    ).toBe(true);
  });

  it('suppresses the provider abort error after an irreversible Stop', () => {
    const controller = new AbortController();
    controller.abort(createUserStopAbortReason());

    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'stream closed', runId: 'run-1' },
        { signal: controller.signal, runStatus: 'cancelling' },
      ),
    ).toBe(true);
  });

  it('suppresses the generic DOMException abort text while the Run is cancelling', () => {
    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'The operation was aborted', runId: 'run-1' },
        { runStatus: 'cancelling', pauseRequested: true },
      ),
    ).toBe(true);
  });

  it('suppresses abort text after the Run already terminalized without a live signal', () => {
    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'The operation was aborted' },
        { runStatus: 'interrupted' },
      ),
    ).toBe(true);
  });

  it('suppresses when the Host signal is aborted with a generic AbortError reason', () => {
    const controller = new AbortController();
    controller.abort(new DOMException('The operation was aborted', 'AbortError'));

    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'The operation was aborted', runId: 'run-1' },
        { signal: controller.signal },
      ),
    ).toBe(true);
  });

  it('keeps upstream errors when the Host did not control the abort', () => {
    const controller = new AbortController();
    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'upstream timeout', runId: 'run-1' },
        { signal: controller.signal },
      ),
    ).toBe(false);

    controller.abort(new Error('The operation was aborted'));
    expect(
      shouldSuppressControlledAbortError(
        { type: 'error', message: 'upstream timeout', runId: 'run-1' },
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

describe('looksLikeProviderAbortMessage', () => {
  it('matches the WKWebView / fetch abort toast text', () => {
    expect(looksLikeProviderAbortMessage('The operation was aborted')).toBe(true);
    expect(looksLikeProviderAbortMessage('upstream timeout')).toBe(false);
  });
});
