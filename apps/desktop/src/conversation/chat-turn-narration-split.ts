import type { ChatMessageUi } from './chat-reducer';

const narrationOnlyCache = new WeakMap<ChatMessageUi, ChatMessageUi>();
const withoutNarrationCache = new WeakMap<ChatMessageUi, ChatMessageUi>();

/**
 * A segment's narration is what the model said; its tools are what it did.
 * The narration renders outside the work fold, so the same message becomes two
 * rows: this copy carries only the words, `withoutNarration` only the work.
 * Cached per message so the memoized rows keep their identity between renders.
 */
export function narrationOnlyMessage(message: ChatMessageUi): ChatMessageUi {
  const cached = narrationOnlyCache.get(message);
  if (cached !== undefined) return cached;
  const words: ChatMessageUi = { ...message, thinking: '', tools: [] };
  delete words.searchEvidence;
  delete words.subagentActivity;
  narrationOnlyCache.set(message, words);
  return words;
}

export function withoutNarration(message: ChatMessageUi): ChatMessageUi {
  const cached = withoutNarrationCache.get(message);
  if (cached !== undefined) return cached;
  const work: ChatMessageUi = { ...message, text: '' };
  withoutNarrationCache.set(message, work);
  return work;
}
