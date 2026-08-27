/**
 * Composer collaboration modes. The live Desktop entries are Agent and Goal.
 * Plan / Ask were removed from the + menu and slash catalog; they are not
 * composer modes anymore. Host still understands the legacy ids if a prompt
 * carries them.
 *
 * Mode operating contracts are owned by `@piwin/contracts` and injected by
 * the host on the model-facing path only. Desktop must send clean user text
 * + `agentMode` so transcript / session naming never see the preamble.
 */

import {
  AGENT_MODE_SYSTEM_PREAMBLES,
  mergeAgentModeIntoPrompt,
  type AgentModeId,
} from '@piwin/contracts';

export type { AgentModeId };

export type AgentModeDefinition = {
  id: AgentModeId;
  label: string;
  /** Short tooltip like Cursor hover cards. */
  title: string;
  description: string;
  /** Injected ahead of the user message when this mode is active (host-owned). */
  systemPreamble: string;
  placeholder: string;
};

export const AGENT_MODES: readonly AgentModeDefinition[] = [
  {
    id: 'agent',
    label: 'Agent',
    title: 'Agent',
    description: 'Default coding agent — explore, edit, and run tools.',
    systemPreamble: AGENT_MODE_SYSTEM_PREAMBLES.agent,
    placeholder: 'Plan, search, build anything',
  },
  {
    id: 'goal',
    label: 'Goal',
    title: 'Goal Mode',
    description: 'Autonomous goal execution loop (@narumitw/pi-goal)',
    systemPreamble: AGENT_MODE_SYSTEM_PREAMBLES.goal,
    placeholder: 'Set an objective & acceptance criteria to run autonomously…',
  },
] as const;

export function getAgentMode(modeId: AgentModeId): AgentModeDefinition {
  return AGENT_MODES.find((mode) => mode.id === modeId) ?? AGENT_MODES[0]!;
}

/**
 * @deprecated Host injects mode contracts via `mergeAgentModeIntoPrompt`.
 * Kept for unit tests / any residual client paths that still need a local preview.
 * Desktop send/edit paths must NOT put this string into `session/prompt.input.text`.
 */
export function applyAgentModeToPrompt(modeId: AgentModeId, userText: string): string {
  return mergeAgentModeIntoPrompt(modeId, userText);
}
