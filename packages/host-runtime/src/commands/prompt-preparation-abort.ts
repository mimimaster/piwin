import type { SessionLiveContext } from './session-live-context.js';

/**
 * Abort guard shared by prompt preparation and the Agent prompt-context
 * builder: preparation runs inside a journaled run and must stop the moment
 * that run is aborted, before any model-facing text is committed.
 */

/** Cancellation raised out of prompt preparation; never reaches the wire. */
class PromptPreparationCancelledError extends Error {
  constructor() {
    super('prompt preparation cancelled');
    this.name = 'PromptPreparationCancelledError';
  }
}

export function throwIfPromptPreparationAborted(context: SessionLiveContext, runId: string): void {
  if (context.getRunSignal(runId)?.aborted) {
    throw new PromptPreparationCancelledError();
  }
}
