/**
 * Session backend identity (ADR 0082).
 *
 * A session without a binding is a Pi session. Other backends are external
 * coding agents driven over a protocol adapter (Grok Build over ACP). The
 * binding is durable product state; the backend session id is the agent's own
 * native id and is never reused as the product session id.
 */

export const AGENT_BACKEND_IDS = ['pi', 'grok'] as const;

export type AgentBackendId = (typeof AGENT_BACKEND_IDS)[number];

const AGENT_BACKEND_ID_SET: ReadonlySet<string> = new Set(AGENT_BACKEND_IDS);

export function isAgentBackendId(value: unknown): value is AgentBackendId {
  return typeof value === 'string' && AGENT_BACKEND_ID_SET.has(value);
}

/** Durable binding between a product session and an external agent session. */
export type SessionBackendBinding = {
  /**
   * Known ids are `AgentBackendId`; an unknown string is preserved verbatim so
   * a record written by a newer Host is never silently reinterpreted as Pi.
   */
  agentId: string;
  /** Native session id reported by the agent after `session/new`. */
  backendSessionId?: string;
  /** Agent version observed when the binding was last used. */
  agentVersion?: string;
  /** Agent-side last change (epoch ms) already reflected in the transcript projection. */
  syncedChangeUnixMs?: number;
  /** Last model / effort / mode the user chose; re-applied after resume. */
  modelId?: string;
  effortId?: string;
  modeId?: string;
};

/** Effective backend id for a record; absent binding means Pi. */
export function resolveSessionAgentId(binding: SessionBackendBinding | undefined): string {
  return binding?.agentId ?? 'pi';
}

export function isExternalBackendBinding(binding: SessionBackendBinding | undefined): boolean {
  return binding !== undefined && binding.agentId !== 'pi';
}

/** Parse an untrusted persisted binding; returns undefined for malformed input. */
export function parseSessionBackendBinding(value: unknown): SessionBackendBinding | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const agentId = record.agentId;
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    return undefined;
  }
  const binding: SessionBackendBinding = { agentId };
  if (typeof record.backendSessionId === 'string' && record.backendSessionId !== '') {
    binding.backendSessionId = record.backendSessionId;
  }
  if (typeof record.agentVersion === 'string' && record.agentVersion !== '') {
    binding.agentVersion = record.agentVersion;
  }
  if (
    typeof record.syncedChangeUnixMs === 'number' &&
    Number.isFinite(record.syncedChangeUnixMs) &&
    record.syncedChangeUnixMs >= 0
  ) {
    binding.syncedChangeUnixMs = record.syncedChangeUnixMs;
  }
  for (const key of ['modelId', 'effortId', 'modeId'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') {
      binding[key] = value;
    }
  }
  return binding;
}
