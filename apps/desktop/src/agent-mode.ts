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
    systemPreamble: [
      'Operating contract for this turn:',
      'Success: satisfy the user\'s stated goal with the smallest correct change; leave clear evidence of what was verified.',
      'If success criteria, technical choices, or constraints are ambiguous in a way that changes the outcome, state the real options and ask — especially for stack/architecture decisions.',
      'Stop: do not expand scope, invent requirements, or keep working past a blocker; surface conflicts instead of thrashing.',
      'Verify: do not claim done, fixed, or passing without checks run in this environment when the claim depends on them.',
      'Safety and permissions are enforced by the host; follow tool results and denials rather than restating policy.',
      'Prefer outcomes and evidence over process narration.',
    ].join(' '),
    placeholder: 'Plan, search, build anything',
  },
  {
    id: 'plan',
    label: 'Plan',
    title: 'Plan Mode',
    description: 'Generate an implementation plan',
    systemPreamble: [
      'You are in Plan Mode until the user explicitly ends it.',
      'Success: a decision-complete implementation plan — goal, non-goals, steps, affected files, risks, acceptance criteria, and verification — grounded in the repo.',
      'Do not implement or mutate files; explore (read/search) only.',
      'Discover repo facts yourself first; ask only questions that would change the plan (especially technical choices).',
      'Stop when the plan is reviewable or a blocking decision needs the user; do not pad with process theater.',
    ].join(' '),
    placeholder: 'Describe what you want planned…',
  },
  {
    id: 'ask',
    label: 'Ask',
    title: 'Ask',
    description: 'Answer questions without making changes',
    systemPreamble: [
      'You are in Ask Mode.',
      'Success: accurate answers about the codebase and design, with paths cited when helpful.',
      'Do not edit files, run mutating commands, or implement features unless the user exits Ask mode.',
      'Stop at explanation; if implementation is required, say so and wait for Agent/Plan mode.',
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
