import { formatSkillPrompt } from '@piwin/contracts';

export type CliChatPrompt = {
  text: string;
  skillId?: string;
};

/** Resolve CLI slash syntax into the same structured Skill intent as Desktop. */
export function resolveCliChatPrompt(message: string): CliChatPrompt {
  const writingPlanInvocation = message.match(
    /^\/(?:writing-plans|write-plan)(?:\s+([\s\S]*))?$/,
  );
  if (!writingPlanInvocation) {
    return { text: message };
  }
  return {
    text: formatSkillPrompt(
      'writing-plans',
      'writing-plans',
      writingPlanInvocation[1] ?? '',
    ),
    skillId: 'writing-plans',
  };
}
