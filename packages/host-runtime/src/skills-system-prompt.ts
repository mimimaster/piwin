/**
 * Product system-prompt section that makes Agent sessions load matching skills
 * on their own. Pi appends the `<available_skills>` catalog only when the
 * `read` tool is active, so this section follows the same condition.
 */
export function formatSkillDiscoveryPrompt(input: {
  skillCount: number;
  piBuiltinToolNames: readonly string[];
}): string {
  if (input.skillCount === 0 || !input.piBuiltinToolNames.includes('read')) return '';
  return [
    '## Skills',
    'The `<available_skills>` list at the end of this prompt holds task playbooks.',
    'Before acting on a request, compare it with each skill description. When one matches, read that SKILL.md with the read tool first and follow it. Do not wait for the user to name the skill.',
    'Re-check the list when the task changes mid-session (for example from planning to debugging or verification).',
  ].join('\n');
}
