/**
 * Goal (and any future composer agentMode) is conversation-scoped UI state.
 *
 * A single workbench `useState` leaked `/goal` into every other session,
 * including New Agent. Switching conversations parks the outgoing session's
 * mode and restores the incoming one (default Agent). New Agent is always
 * Agent. First-send (draft → created session) is not a leave — the caller
 * must not invoke this helper then.
 */
import type { AgentModeId } from './agent-mode';

export type ComposerAgentModeSessionChange = {
  previousSessionId: string | null;
  nextSessionId: string | null;
};

export function resolveComposerAgentModeForSessionChange(input: {
  previousSessionId: string | null;
  nextSessionId: string | null;
  currentMode: AgentModeId;
  parked: ReadonlyMap<string, AgentModeId>;
}): { mode: AgentModeId; parked: Map<string, AgentModeId> } {
  const parked = new Map(input.parked);
  if (input.previousSessionId) {
    if (input.currentMode === 'agent') {
      parked.delete(input.previousSessionId);
    } else {
      parked.set(input.previousSessionId, input.currentMode);
    }
  }
  const mode = input.nextSessionId
    ? (parked.get(input.nextSessionId) ?? 'agent')
    : 'agent';
  return { mode, parked };
}
