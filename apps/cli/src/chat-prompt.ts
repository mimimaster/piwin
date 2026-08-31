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
  if (writingPlanInvocation) {
    return {
      text: formatSkillPrompt(
        'writing-plans',
        'writing-plans',
        writingPlanInvocation[1] ?? '',
      ),
      skillId: 'writing-plans',
    };
  }

  const optimizePromptInvocation = message.match(
    /^\/(?:optimize-prompt|optimize-prompts|prompt-optimize)(?:\s+([\s\S]*))?$/,
  );
  if (optimizePromptInvocation) {
    return {
      text: formatSkillPrompt(
        'optimize-prompt',
        'optimize-prompt',
        optimizePromptInvocation[1] ?? '',
      ),
      skillId: 'optimize-prompt',
    };
  }

  return { text: message };
}
