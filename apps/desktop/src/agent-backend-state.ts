/**
 * Pure state helpers for optional agent backends (ADR 0082).
 *
 * Kept free of HostClient/transport so both the chat reducer and the bootstrap
 * hook can share one definition of "what states mean" and how a pushed status
 * merges into the known list.
 */
import type {
  ExternalAgentStatus,
  SessionBackendCapabilities,
  SessionBackendOptions,
} from '@piwin/contracts';

/**
 * Product display names for agent backends. Unknown ids fall back to the raw
 * id so a newer Host's agent is shown rather than mislabelled as Pi.
 */
export const AGENT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  pi: 'Pi',
  grok: 'Grok Build',
};

export function agentDisplayName(agentId: string | undefined | null): string {
  if (agentId === undefined || agentId === null || agentId === '') {
    return AGENT_DISPLAY_NAMES['pi'] ?? 'Pi';
  }
  return AGENT_DISPLAY_NAMES[agentId] ?? agentId;
}

/**
 * True when the agent reports a usable backend. `unauthenticated` is
 * deliberately excluded: piwin must never present an agent as usable before a
 * real handshake succeeded (spec §2.2).
 */
export function isAgentReady(status: ExternalAgentStatus | undefined): boolean {
  return status?.state === 'ready';
}

/**
 * Merge one pushed status into the known list. Keeps unknown agents instead of
 * dropping them, so a newer Host's agent id is never silently lost.
 */
export function mergeAgentStatus(
  agents: readonly ExternalAgentStatus[],
  status: ExternalAgentStatus,
): ExternalAgentStatus[] {
  const existingIndex = agents.findIndex((agent) => agent.agentId === status.agentId);
  if (existingIndex === -1) {
    return [...agents, status];
  }
  const next = [...agents];
  next[existingIndex] = status;
  return next;
}

/** Bind (or clear) capabilities for one session; `undefined` leaves it untouched. */
export function setBackendCapabilities(
  map: Readonly<Record<string, SessionBackendCapabilities>>,
  sessionId: string,
  capabilities: SessionBackendCapabilities | undefined,
): Record<string, SessionBackendCapabilities> {
  if (capabilities === undefined) {
    return map as Record<string, SessionBackendCapabilities>;
  }
  return { ...map, [sessionId]: capabilities };
}

/** Bind (or clear) backend options for one session; `undefined` leaves it untouched. */
export function setBackendOptions(
  map: Readonly<Record<string, SessionBackendOptions>>,
  sessionId: string,
  options: SessionBackendOptions | undefined,
): Record<string, SessionBackendOptions> {
  if (options === undefined) {
    return map as Record<string, SessionBackendOptions>;
  }
  return { ...map, [sessionId]: options };
}

/** Backend options bound to a session, if any. */
export function backendOptionsFor(
  map: Readonly<Record<string, SessionBackendOptions>>,
  sessionId: string | null | undefined,
): SessionBackendOptions | undefined {
  return sessionId ? map[sessionId] : undefined;
}

/** Backend capabilities bound to a session, if any. */
export function backendCapabilitiesFor(
  map: Readonly<Record<string, SessionBackendCapabilities>>,
  sessionId: string | null | undefined,
): SessionBackendCapabilities | undefined {
  return sessionId ? map[sessionId] : undefined;
}
