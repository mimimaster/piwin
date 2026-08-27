/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import type { HostPush, AgentEventEnvelope, PushSink, RemoteSinkId } from '@piwin/contracts';
import { createEventEnvelopeGenerator } from '@piwin/agent-host';
import { formatError, LEGACY_LOCAL_SINK_ID } from '@piwin/contracts';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { readEventRunId } from './session-agent-event-router.js';

export function publishHostPush(deps: HostRuntimeKernel, message: HostPush): void {
  let outgoing: HostPush = message;
  if (message.type === 'event') {
    const generator =
      deps.eventEnvelopeGenerators.get(message.sessionId) ?? createEventEnvelopeGenerator();
    deps.eventEnvelopeGenerators.set(message.sessionId, generator);
    const envelope: AgentEventEnvelope = generator.next(readEventRunId(message.event));
    outgoing = { ...message, envelope };
  } else if (message.type === 'subagent/stream') {
    const generator =
      deps.eventEnvelopeGenerators.get(message.childSessionId) ?? createEventEnvelopeGenerator();
    deps.eventEnvelopeGenerators.set(message.childSessionId, generator);
    const envelope: AgentEventEnvelope = generator.next(readEventRunId(message.event));
    outgoing = { ...message, envelope };
  }
  // ADR 0027: fan out to every attached sink. The legacy onPush sink is just
  // another entry in pushSinks, so the single-sink path is unchanged when no
  // remote sink is attached. Sink errors are isolated so one bad sink cannot
  // starve the local sidecar.
  for (const sink of deps.pushSinks.values()) {
    try {
      sink.push(outgoing);
    } catch (error) {
      const detail = formatError(error);
      // Log to the legacy sink only, not back through the fan-out (avoid recursion).
      deps.options.onPush?.({
        type: 'host/log',
        level: 'error',
        message: `push sink ${sink.id} threw: ${detail}`,
      });
    }
  }
}

export function attachHostPushSink(deps: HostRuntimeKernel, sink: PushSink): () => void {
  deps.pushSinks.set(sink.id, sink);
  return () => {
    deps.pushSinks.delete(sink.id);
  };
}

export function detachHostPushSink(deps: HostRuntimeKernel, id: RemoteSinkId): void {
  if (id === LEGACY_LOCAL_SINK_ID) {
    return;
  }
  deps.pushSinks.delete(id);
}

export function countHostProductionPushSinks(deps: HostRuntimeKernel): number {
  let count = 0;
  for (const id of deps.pushSinks.keys()) {
    if (id !== LEGACY_LOCAL_SINK_ID) {
      count += 1;
    }
  }
  return count;
}
