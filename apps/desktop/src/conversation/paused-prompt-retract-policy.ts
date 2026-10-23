import type { PromptContextRef, SessionRetractedPrompt } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-ui-types';

export type PausedPromptRetractCandidate = {
  sessionId: string;
  userMessageId: string;
};

function carriesOutput(message: ChatMessageUi): boolean {
  return (
    message.role === 'assistant' &&
    (message.text.trim().length > 0 ||
      message.thinking.trim().length > 0 ||
      message.tools.length > 0)
  );
}

/**
 * The prompt the user is stopping, when the model has shown nothing for it
 * yet. Host re-checks durably; this only decides whether to ask.
 */
export function findPausedPromptRetractCandidate(
  sessionId: string | null,
  messages: readonly ChatMessageUi[],
): PausedPromptRetractCandidate | null {
  if (sessionId === null) return null;
  let promptIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      promptIndex = index;
      break;
    }
  }
  const prompt = messages[promptIndex];
  if (prompt === undefined || prompt.instructionDelivery?.kind === 'run-intervention') {
    return null;
  }
  if (messages.slice(promptIndex + 1).some(carriesOutput)) return null;
  return { sessionId, userMessageId: prompt.id };
}

/** Output may land between the Pause click and the paused terminal. */
export function hasOutputAfterPrompt(
  messages: readonly ChatMessageUi[],
  userMessageId: string,
): boolean {
  const promptIndex = messages.findIndex((message) => message.id === userMessageId);
  return promptIndex >= 0 && messages.slice(promptIndex + 1).some(carriesOutput);
}

/**
 * Put a retracted prompt back without discarding what the user typed while
 * the turn was pausing: the prompt leads, a newer draft follows it.
 */
export function mergeRetractedDraft(
  retracted: Pick<SessionRetractedPrompt, 'text' | 'contextRefs'>,
  current: { text: string; contextRefs: readonly PromptContextRef[] },
): { text: string; contextRefs: PromptContextRef[] } {
  const draft = current.text.trim();
  const text =
    draft.length === 0 || draft === retracted.text.trim()
      ? retracted.text
      : `${retracted.text}\n\n${current.text}`;
  const contextRefs = [...(retracted.contextRefs ?? [])];
  for (const ref of current.contextRefs) {
    if (!contextRefs.some((existing) => JSON.stringify(existing) === JSON.stringify(ref))) {
      contextRefs.push(ref);
    }
  }
  return { text, contextRefs };
}
