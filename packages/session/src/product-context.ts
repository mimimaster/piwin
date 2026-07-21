/**
 * Rebuild model-facing history from product transcript (ADR 0009 / CE-CHAT truncate).
 * W1 does not rewind Pi JSONL — next prompt carries product context as text.
 */
import type { SessionTranscriptMessage } from '@piwin/contracts';

const DEFAULT_MAX_CHARS = 24_000;
const DEFAULT_MAX_MESSAGES = 40;

export type ProductHistoryContextOptions = {
  maxChars?: number;
  maxMessages?: number;
  /**
   * When set, exclude this message id (typically the user turn just recorded
   * for the live prompt).
   */
  excludeMessageId?: string;
};

/**
 * Format remaining product transcript as a context prefix for the next model prompt.
 * Returns empty string when there is nothing useful to inject.
 */
export function buildProductHistoryContext(
  messages: SessionTranscriptMessage[],
  options: ProductHistoryContextOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;

  const filtered = messages.filter((message) => {
    if (options.excludeMessageId && message.id === options.excludeMessageId) {
      return false;
    }
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') {
      return false;
    }
    return message.text.trim().length > 0;
  });

  if (filtered.length === 0) {
    return '';
  }

  const windowed = filtered.slice(-maxMessages);
  const lines: string[] = [
    '[piwin-product-history]',
    'Prior conversation (product transcript; not Pi JSONL):',
  ];

  let used = lines.join('\n').length;
  const bodyLines: string[] = [];

  for (const message of windowed) {
    const roleLabel =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    const text = message.text.trim().slice(0, 4000);
    const block = `${roleLabel}: ${text}`;
    if (used + block.length + 1 > maxChars) {
      break;
    }
    bodyLines.push(block);
    used += block.length + 1;
  }

  if (bodyLines.length === 0) {
    return '';
  }

  return [...lines, ...bodyLines, '[/piwin-product-history]'].join('\n');
}

/**
 * Prepend product history to the live user prompt text.
 */
export function mergeProductHistoryIntoPrompt(
  historyContext: string,
  userPromptText: string,
): string {
  const history = historyContext.trim();
  const userText = userPromptText.trim();
  if (!history) {
    return userPromptText;
  }
  if (!userText) {
    return history;
  }
  return `${history}\n\n---\nCurrent user message:\n${userText}`;
}
