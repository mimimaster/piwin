import type { AgentEvent, AgentEventEnvelope } from '@piwin/contracts';
import type { ChatUiAction } from './chat-reducer';

export type StreamEventBuffer = {
  push: (sessionId: string, event: AgentEvent, envelope?: AgentEventEnvelope) => void;
  pushAction: (sessionId: string, action: ChatUiAction) => void;
  flush: () => void;
  dispose: () => void;
  reset: () => void;
};

export type StreamEventBufferOptions = {
  dispatch: (action: ChatUiAction) => void;
  /**
   * Legacy test hooks retained while callers migrate. Stream delivery no
   * longer depends on a frame or timer scheduler.
   */
  frameScheduler?: (callback: () => void) => number;
  frameCanceller?: (handle: number) => void;
};

/**
 * Preserve the Host's canonical sequence at the Desktop reducer boundary.
 *
 * The Host already coalesces native Pi deltas into bounded wire frames. A
 * second requestAnimationFrame/timer queue here made delivery depend on
 * window visibility and could leave lifecycle controls behind queued text.
 * Dispatching synchronously lets React batch one wire frame while ensuring
 * later Host pushes (especially message/end and run/terminal) never overtake
 * an earlier delta and no client-generated character slicing is introduced.
 */
export function createStreamEventBuffer(options: StreamEventBufferOptions): StreamEventBuffer {
  function push(sessionId: string, event: AgentEvent, envelope?: AgentEventEnvelope): void {
    options.dispatch({
      type: 'event',
      sessionId,
      event,
      ...(envelope ? { envelope } : {}),
    });
  }

  function pushAction(_sessionId: string, action: ChatUiAction): void {
    options.dispatch(action);
  }

  // Kept as compatibility no-ops for effect cleanup and hydration call sites.
  function flush(): void {}
  function dispose(): void {}
  function reset(): void {}

  return { push, pushAction, flush, dispose, reset };
}
