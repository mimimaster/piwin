import type { AgentEvent, AgentEventEnvelope } from '@piwin/contracts';
import type { ChatUiAction } from './chat-reducer';

export type StreamEventBuffer = {
  push: (sessionId: string, event: AgentEvent, envelope?: AgentEventEnvelope) => void;
  flush: () => void;
  dispose: () => void;
};

export type StreamEventBufferOptions = {
  dispatch: (action: ChatUiAction) => void;
  frameScheduler?: (callback: () => void) => number;
  frameCanceller?: (handle: number) => void;
};

const IMMEDIATE_EVENT_TYPES = new Set<AgentEvent['type']>([
  'message/start',
  'message/end',
  'tool/start',
  'tool/end',
  'permission/request',
  'permission/resolved',
  'error',
  'run/phase',
  'run/terminal',
  'session/aborted',
]);

export function createStreamEventBuffer(
  options: StreamEventBufferOptions,
): StreamEventBuffer {
  const scheduleFrame =
    options.frameScheduler ?? ((callback: () => void) => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.frameCanceller ?? ((handle: number) => window.cancelAnimationFrame(handle));
  let pendingEvents: Array<{
    sessionId: string;
    event: AgentEvent;
    envelope?: AgentEventEnvelope;
  }> = [];
  let frameHandle: number | null = null;

  function flush(): void {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (pendingEvents.length === 0) {
      return;
    }
    const events = pendingEvents;
    pendingEvents = [];
    const sessionId = events[0]?.sessionId;
    if (!sessionId || events.some((item) => item.sessionId !== sessionId)) {
      for (const item of events) {
        options.dispatch({
          type: 'event',
          sessionId: item.sessionId,
          event: item.event,
          ...(item.envelope ? { envelope: item.envelope } : {}),
        });
      }
      return;
    }
    options.dispatch({
      type: 'event/batch',
      sessionId,
      events: events.map((item) => item.event),
      ...(events.some((item) => item.envelope)
        ? {
            envelopes: events.map((item) => item.envelope),
          }
        : {}),
    });
  }

  function push(sessionId: string, event: AgentEvent, envelope?: AgentEventEnvelope): void {
    if (IMMEDIATE_EVENT_TYPES.has(event.type)) {
      flush();
      options.dispatch({
        type: 'event',
        sessionId,
        event,
        ...(envelope ? { envelope } : {}),
      });
      return;
    }
    pendingEvents.push({
      sessionId,
      event,
      ...(envelope ? { envelope } : {}),
    });
    if (frameHandle === null) {
      frameHandle = scheduleFrame(() => {
        frameHandle = null;
        flush();
      });
    }
  }

  function dispose(): void {
    flush();
  }

  return { push, flush, dispose };
}
