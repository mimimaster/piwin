/**
 * Pure composer-dock assembly helpers. The React hook that builds ComposerDockProps
 * lives in hooks/use-composer-dock-props.ts so App does not own this policy.
 */

export function listSessionUserPrompts(
  messages: readonly { role: string; text: string }[],
  limit = 10,
): string[] {
  const prompts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') {
      continue;
    }
    const text = message.text.trim();
    if (!text || prompts.includes(text)) {
      continue;
    }
    prompts.push(text);
    if (prompts.length >= limit) {
      break;
    }
  }
  return prompts;
}

export function resolveComposerLayoutMode(input: {
  messageCount: number;
  awaitingTranscript: boolean;
}): 'centered' | 'docked' {
  return input.messageCount === 0 && !input.awaitingTranscript ? 'centered' : 'docked';
}

export function isGoalExtensionEnabled(disabledIds: readonly string[] | undefined): boolean {
  return !(disabledIds ?? []).some((id) => id.toLowerCase() === 'goal');
}
