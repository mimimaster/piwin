/**
 * Capability gating for the active session's backend (ADR 0082).
 *
 * The Host is the authority and rejects an unsupported operation regardless of
 * what a client sends; this gate exists so the UI never *offers* an action the
 * backend cannot perform, and can explain why when it must stay visible.
 *
 * Unknown capabilities (a Pi session, or a Host that did not report any) are
 * treated as fully supported — that is today's behaviour and keeps Pi working
 * unchanged.
 */
import { useMemo } from 'react';
import {
  sessionOperationUnsupportedReason,
  type SessionBackendCapabilities,
  type SessionBackendOperation,
} from '@piwin/contracts';
import { backendCapabilitiesFor } from '../agent-backend-state';

export type SessionCapabilityGate = {
  /** True for Pi sessions and for any operation the backend reports as supported. */
  supports: (operation: SessionBackendOperation) => boolean;
  /** User-facing reason when unsupported; undefined when supported. */
  unsupportedReason: (operation: SessionBackendOperation) => string | undefined;
  /** True when the active session runs a non-Pi backend. */
  isExternalBackend: boolean;
};

/** Pure gate builder — the hook is a memo wrapper so this stays unit-testable. */
export function createSessionCapabilityGate(
  capabilities: SessionBackendCapabilities | undefined,
): SessionCapabilityGate {
  return {
    supports: (operation) =>
      sessionOperationUnsupportedReason(capabilities, operation) === undefined,
    unsupportedReason: (operation) => sessionOperationUnsupportedReason(capabilities, operation),
    isExternalBackend: capabilities !== undefined && capabilities.agentId !== 'pi',
  };
}

export function useSessionCapabilities(args: {
  sessionId: string | null;
  capabilitiesBySession: Readonly<Record<string, SessionBackendCapabilities>>;
}): SessionCapabilityGate {
  const { sessionId, capabilitiesBySession } = args;
  return useMemo(
    () => createSessionCapabilityGate(backendCapabilitiesFor(capabilitiesBySession, sessionId)),
    [capabilitiesBySession, sessionId],
  );
}
