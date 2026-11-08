import {
  DEVIN_CONVERSATION_PREFIX,
  DEVIN_SUMMARIZE_INSTRUCTION,
  DEVIN_SUMMARIZER_SYSTEM,
} from './prompt.js';
import { asArray, asLoose, asString } from './values.js';

export type SummarizerRequest = {
  /** Bare history file name, e.g. `history_ab12cd34ef567890.md`. */
  historyFileName: string;
  /** Transcript already elided by `elideTranscript`. */
  transcript: string;
  /** Optional extra focus line (`/compact <text>`); extension-only affordance. */
  focus?: string;
  signal?: AbortSignal;
};

export type ModelCompleter = {
  complete: (model: unknown, context: unknown, options: unknown) => Promise<unknown>;
};

function collectText(content: unknown): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of asArray(content)) {
    const loose = asLoose(block);
    if (asString(loose?.type) !== 'text') continue;
    const text = asString(loose?.text);
    if (text !== undefined) parts.push(text);
  }
  return parts.join('');
}

/**
 * The summarizer conversation is exactly three turns in Devin:
 *   1. system  - the recovered prompt, with the bare history file name
 *   2. user    - "\nConversation to summarize:\n" + transcript
 *   3. user    - "Now summarize the conversation above as per the format given..."
 */
export function buildSummarizerMessages(request: SummarizerRequest): unknown[] {
  const messages: unknown[] = [
    {
      role: 'system',
      content: DEVIN_SUMMARIZER_SYSTEM.replace('{historyFile}', request.historyFileName),
      timestamp: Date.now(),
    },
    {
      role: 'user',
      content: `${DEVIN_CONVERSATION_PREFIX}${request.transcript}`,
      timestamp: Date.now(),
    },
    {
      role: 'user',
      content: DEVIN_SUMMARIZE_INSTRUCTION,
      timestamp: Date.now(),
    },
  ];
  const focus = request.focus?.trim();
  if (focus) {
    messages.push({ role: 'user', content: `Additional focus for this summary: ${focus}`, timestamp: Date.now() });
  }
  return messages;
}

export async function summarizeWithModel(
  completer: ModelCompleter,
  model: unknown,
  request: SummarizerRequest,
): Promise<string | undefined> {
  const result = await completer.complete(
    model,
    { messages: buildSummarizerMessages(request) },
    request.signal ? { signal: request.signal } : {},
  );
  const text = collectText(asLoose(result)?.content).trim();
  return text.length > 0 ? text : undefined;
}
