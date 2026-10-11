/**
 * Authoritative per-invocation work counters (tool calls, tokens).
 *
 * The Host sees every child event before any client does, so it is the only
 * place a true count can live: the Desktop live tail is bounded and lost on
 * reload. Counters dedupe by tool call id and usage measurement id so a
 * replayed or duplicated event never double counts.
 */
import type { AgentEvent, SubagentInvocationUsage } from '@piwin/contracts';

export type SubagentUsageTracker = {
  readonly toolCallIds: Set<string>;
  readonly measurementIds: Set<string>;
  usage: SubagentInvocationUsage;
};

export const EMPTY_SUBAGENT_USAGE: SubagentInvocationUsage = {
  toolCalls: 0,
  totalTokens: 0,
  requests: 0,
};

/**
 * Seed from the persisted projection so a tracker rebuilt mid-run (for
 * example after the in-memory map was evicted) continues from the durable
 * numbers instead of restarting at zero.
 */
export function createSubagentUsageTracker(
  seed?: SubagentInvocationUsage,
): SubagentUsageTracker {
  return {
    toolCallIds: new Set(),
    measurementIds: new Set(),
    usage: { ...(seed ?? EMPTY_SUBAGENT_USAGE) },
  };
}

/** Fold one child event in; true when the visible counters changed. */
export function applySubagentUsageEvent(
  tracker: SubagentUsageTracker,
  event: AgentEvent,
): boolean {
  if (event.type === 'tool/start') {
    if (tracker.toolCallIds.has(event.toolCallId)) return false;
    tracker.toolCallIds.add(event.toolCallId);
    tracker.usage = { ...tracker.usage, toolCalls: tracker.usage.toolCalls + 1 };
    return true;
  }
  if (event.type === 'usage/finalized') {
    const { measurement } = event;
    if (tracker.measurementIds.has(measurement.measurementId)) return false;
    if (!Number.isFinite(measurement.totalTokens) || measurement.totalTokens < 0) return false;
    tracker.measurementIds.add(measurement.measurementId);
    tracker.usage = {
      ...tracker.usage,
      totalTokens: tracker.usage.totalTokens + measurement.totalTokens,
      requests: tracker.usage.requests + 1,
    };
    return true;
  }
  return false;
}

export function subagentUsageEquals(
  a: SubagentInvocationUsage | undefined,
  b: SubagentInvocationUsage | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.toolCalls === b.toolCalls && a.totalTokens === b.totalTokens && a.requests === b.requests;
}
