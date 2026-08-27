import type { AgentEvent } from '@piwin/contracts';
import { mapUsageSnapshot } from './usage-map.js';
import { asRecord, readString } from './pi-event-read.js';

export function mapPiUsageEvent(event: Record<string, unknown>): AgentEvent[] {
  const sessionId = readString(event.sessionId) ?? 'unknown';
  const snapshot = mapUsageSnapshot(sessionId, event, 'pi-contextUsage');
  if (!snapshot) {
    return [];
  }
  return [{ type: 'usage/update', sessionId, usage: snapshot }];
}

export function mapAgentEndMessageUsageEvents(event: Record<string, unknown>): AgentEvent[] {
  const sessionId = readString(event.sessionId) ?? 'unknown';
  const assistantUsageEvents: AgentEvent[] = [];
  if (!Array.isArray(event.messages)) {
    return [];
  }
  for (const message of event.messages) {
    const assistantMessage = asRecord(message);
    if (assistantMessage?.role !== 'assistant') {
      continue;
    }
    const snapshot = mapUsageSnapshot(sessionId, assistantMessage, 'assistant-usage');
    if (snapshot) {
      assistantUsageEvents.push({ type: 'usage/update', sessionId, usage: snapshot });
    }
  }
  return assistantUsageEvents;
}

export function mapAgentEndFallbackUsageEvent(event: Record<string, unknown>): AgentEvent[] {
  const sessionId = readString(event.sessionId) ?? 'unknown';
  const snapshot =
    mapUsageSnapshot(sessionId, event, 'assistant-usage') ??
    mapUsageSnapshot(sessionId, asRecord(event.usage) ?? {}, 'assistant-usage');
  if (!snapshot) {
    return [];
  }
  return [{ type: 'usage/update', sessionId, usage: snapshot }];
}
