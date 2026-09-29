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
      checkedAt: string;
    };

export function isExternalAgentReady(status: ExternalAgentStatus | undefined): boolean {
  return status?.state === 'ready';
}

/** Bounded MCP server status projected from the agent; never carries env or headers. */
export type ExternalAgentMcpServerStatus = {
  name: string;
  transport?: string;
  status: string;
  reason?: string;
};
