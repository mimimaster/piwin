import type { PromptInput } from '@piwin/contracts';

/** Preserve explicit user intent before model-only context assembly. Never derive it from history. */
export function readExtensionCommandText(input: PromptInput): string | undefined {
  const text = input.text.trim();
  return /^\/\S+/.test(text) && !input.skillId &&
    !input.attachments?.length && !input.contextRefs?.length && !input.streamingBehavior &&
    input.source !== 'resume' && input.source !== 'continuation' && input.source !== 'voice-delegation'
    ? text : undefined;
}
