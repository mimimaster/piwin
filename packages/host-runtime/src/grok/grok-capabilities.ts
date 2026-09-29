/**
 * Grok capability descriptor (ADR 0082). Operations piwin implements on top
 * of Pi only are unsupported with a user-facing reason; the Host rejects them
 * and clients hide the controls.
 */

import {
  createPiSessionCapabilities,
  type SessionBackendCapabilities,
} from '@piwin/contracts';

export const GROK_AGENT_ID = 'grok';

export function createGrokSessionCapabilities(): SessionBackendCapabilities {
  const capabilities = createPiSessionCapabilities();
  capabilities.agentId = GROK_AGENT_ID;
  const unsupported = (reason: string) => ({ supported: false as const, reason });
  capabilities.operations.images = unsupported('Grok does not accept images yet');
  capabilities.operations.fork = unsupported('Forking Grok sessions is not available yet');
  capabilities.operations.rewind = unsupported('Rewinding Grok sessions is not available yet');
  capabilities.operations.duplicate = unsupported('Grok sessions cannot be duplicated');
  capabilities.operations.pause = unsupported('Grok has no pause; use Stop');
  capabilities.operations.compact = unsupported('Use the /compact command in Grok sessions');
  capabilities.operations.conversationTree = unsupported('Grok keeps a linear history');
  capabilities.operations.coldStorage = unsupported('Grok keeps its own session storage');
  capabilities.operations.hostSubagents = unsupported('Grok runs its own subagents');
  capabilities.operations.hostTools = unsupported('Grok uses its own tools and MCP servers');
  return capabilities;
}

/** Host commands refused for a Grok session, with the capability that gates them. */
export const GROK_UNSUPPORTED_COMMANDS: ReadonlyMap<string, keyof SessionBackendCapabilities['operations']> =
  new Map([
    ['session/fork', 'fork'],
    ['session/duplicate', 'duplicate'],
    ['session/pause', 'pause'],
    ['session/resume-run', 'pause'],
    ['session/compact', 'compact'],
    ['session/compact-export', 'compact'],
    ['session/branch-switch', 'conversationTree'],
    ['session/truncate-from', 'rewind'],
    ['session/retract-paused-prompt', 'pause'],
    ['session/follow_up', 'queue'],
    ['session/reload-runtime', 'hostTools'],
    ['session/set-auto-compaction', 'compact'],
  ]);
