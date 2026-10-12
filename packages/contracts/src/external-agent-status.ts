/**
 * External agent (Grok Build) availability as seen by the Host (ADR 0082).
 * Settings renders this; session creation refuses an agent that is not ready.
 */

export type ExternalAgentSupportStatus = 'verified' | 'unverified';

export type ExternalAgentStatus =
  | {
      agentId: string;
      state: 'not-installed';
      /** Paths the Host searched, for the install hint. */
      searched: readonly string[];
      checkedAt: string;
    }
  | {
      agentId: string;
      state: 'unavailable';
      /** Binary found but the handshake failed. */
      binaryPath: string;
      reason: string;
      checkedAt: string;
    }
  | {
      agentId: string;
      state: 'unauthenticated' | 'ready';
      binaryPath: string;
      version: string;
      supportStatus: ExternalAgentSupportStatus;
      /** Auth method the agent will use by default, when reported. */
      defaultAuthMethodId?: string;
      /** Agent-global permission mode read from the agent itself, when reported. */
      permissionMode?: string;
      /** Agent-level defaults for a new session (models, commands, modes). */
      options?: import('./agent-backend-capabilities.js').SessionBackendOptions;
      /**
       * Optional agent-level native CLI advertisement. May appear while
       * `unauthenticated`; callers must still require `state: 'ready'` before use.
       */
      nativeCli?: import('./agent-backend-capabilities.js').SessionBackendOperationSupport;
      checkedAt: string;
    };

export function isExternalAgentReady(status: ExternalAgentStatus | undefined): boolean {
  return status?.state === 'ready';
}

/**
 * Native CLI is usable only when the agent is ready and explicitly advertises
 * support. Absent capability or non-ready states are false.
 */
export function isExternalAgentNativeCliReady(status: ExternalAgentStatus | undefined): boolean {
  return status?.state === 'ready' && status.nativeCli?.supported === true;
}

/** Bounded MCP server status projected from the agent; never carries env or headers. */
export type ExternalAgentMcpServerStatus = {
  name: string;
  transport?: string;
  status: string;
  reason?: string;
};
