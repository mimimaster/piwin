/**
 * Agent collaboration modes — interaction model aligned with Cursor Agent
 * (Plan / Ask from composer + menu) and Codex plan.md constraints
 * for the Plan mode body. Not a side panel form.
 */

export type AgentModeId = 'agent' | 'plan' | 'ask';

export type AgentModeDefinition = {
  id: AgentModeId;
  label: string;
  /** Short tooltip like Cursor hover cards. */
  title: string;
  description: string;
  /** Injected ahead of the user message when this mode is active. */
  systemPreamble: string;
  placeholder: string;
};

export const AGENT_MODES: readonly AgentModeDefinition[] = [
  {
    id: 'agent',
    label: 'Agent',
    title: 'Agent',
    description: 'Default coding agent — explore, edit, and run tools.',
    systemPreamble: '',
    placeholder: 'Plan, search, build anything',
  },
  {
    id: 'plan',
    label: 'Plan',
    title: 'Plan Mode',
    description: 'Generate an implementation plan',
    systemPreamble: [
      'You are in Plan Mode until the user explicitly ends it.',
      'Do not implement code changes. Explore (read/search) only; no file mutations.',
      'Work in phases: (1) ground in the repo, (2) clarify intent, (3) decision-complete implementation plan.',
      'Prefer questions that change the plan; discover repo facts yourself first.',
      'End with a concrete proposed plan: goal, steps, files, risks, acceptance criteria.',
    ].join(' '),
    placeholder: 'Describe what you want planned…',
  },
  {
    id: 'ask',
    label: 'Ask',
    title: 'Ask',
    description: 'Answer questions without making changes',
    systemPreamble: [
      'You are in Ask Mode: answer questions about the codebase and design.',
      'Do not edit files, run mutating commands, or implement features unless the user exits Ask mode.',
      'Read and explain; cite paths when helpful.',
    ].join(' '),
    placeholder: 'Ask anything about this project…',
  },
] as const;

export function getAgentMode(modeId: AgentModeId): AgentModeDefinition {
  return AGENT_MODES.find((mode) => mode.id === modeId) ?? AGENT_MODES[0]!;
}

/** Prefix user text so host/model sees mode constraints without a separate panel. */
export function applyAgentModeToPrompt(modeId: AgentModeId, userText: string): string {
  const mode = getAgentMode(modeId);
  const trimmed = userText.trim();
  if (!mode.systemPreamble) {
    return trimmed;
  }
  return `[piwin-mode:${mode.id}]\n${mode.systemPreamble}\n\n---\nUser:\n${trimmed}`;
}
