/**
 * Reads the bound session's transcript tail and turns it into the Live startup
 * summary. Failure is never fatal: a call starts without continuity rather than
 * not at all, and only an abort propagates to the caller.
 */

import {
  toLiveContextTranscriptTurn,
  type LiveReviewSessionTurn,
  type ModelRef,
  type SessionTranscriptMessage,
} from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';
import {
  createLiveSessionContextSummarizer,
  type LiveSessionContextSummarizer,
} from '@piwin/voice';
import type { LiveSessionModelBinding, LiveSessionModelCompletion } from './compose-live-completion.js';

export const LIVE_SESSION_CONTEXT_TAIL_ROWS = 60;
export const LIVE_SESSION_CONTEXT_TIMEOUT_MS = 15_000;
const LIVE_SESSION_CONTEXT_MAX_OUTPUT_TOKENS = 600;

export type LiveSessionContextSource = {
  resolve(sessionId: string, signal: AbortSignal): Promise<string | null>;
};

export function createLiveSessionContextSource(input: {
  getTranscriptStore: (sessionId: string) => Promise<SessionTranscriptStore>;
  completion: LiveSessionModelCompletion;
  summarizer?: LiveSessionContextSummarizer;
}): LiveSessionContextSource {
  // A binding is captured per resolve; this holder lets the injected
  // summarizer reach the already-resolved model without resolving again.
  let activeBinding: LiveSessionModelBinding | null = null;
  const summarizer =
    input.summarizer ??
    createLiveSessionContextSummarizer({
      complete: async (request) => {
        const binding = activeBinding;
        if (!binding) throw new Error('live-session-context-model-unavailable');
        return binding.complete({
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          maxOutputTokens: LIVE_SESSION_CONTEXT_MAX_OUTPUT_TOKENS,
          signal: request.signal,
        });
      },
    });

  return {
    async resolve(sessionId, signal) {
      const deadline = AbortSignal.timeout(LIVE_SESSION_CONTEXT_TIMEOUT_MS);
      const combined = AbortSignal.any([signal, deadline]);
      try {
        combined.throwIfAborted();
        const store = await input.getTranscriptStore(sessionId);
        combined.throwIfAborted();
        const messages = await store.listTail(LIVE_SESSION_CONTEXT_TAIL_ROWS);
        combined.throwIfAborted();
        const lastMessageId = lastLiveContextMessageId(messages);
        if (!lastMessageId) return null;
        const binding = await input.completion.forSession(sessionId);
        combined.throwIfAborted();
        if (!binding) return null;
        activeBinding = binding;
        return await summarizer({
          sessionId,
          messages,
          signal: combined,
          cacheKey: liveSessionContextCacheKey(sessionId, lastMessageId, binding.model),
        });
      } catch (error: unknown) {
        // An aborted call is the caller's own decision, not a failure to log.
        if (signal.aborted) throw error;
        const detail = error instanceof Error ? error.message : 'unknown';
        console.error(`[piwin-live] startup context unavailable: ${detail}`);
        return null;
      } finally {
        activeBinding = null;
      }
    },
  };
}

export function liveSessionContextCacheKey(
  sessionId: string,
  lastMessageId: string,
  model: ModelRef,
): string {
  return `${sessionId}:${lastMessageId}:${model.providerId}/${model.modelId}`;
}

/**
 * Cache identity is the newest row the summary can actually see, so a tool call
 * or streaming row landing afterwards does not invalidate a still-valid summary.
 */
function lastLiveContextMessageId(
  messages: readonly SessionTranscriptMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (toLiveContextTranscriptTurn(message)) return message.id;
  }
  return undefined;
}

const LIVE_REVIEW_TURNS_MAX = 12;
const LIVE_REVIEW_TURNS_MAX_BYTES = 4 * 1024;

export async function listRecentLiveReviewTurns(
  store: SessionTranscriptStore,
): Promise<LiveReviewSessionTurn[]> {
  const messages = await store.listTail(LIVE_REVIEW_TURNS_MAX);
  const turns: LiveReviewSessionTurn[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const turn = toLiveContextTranscriptTurn(message);
    if (!turn) continue;
    const size = encoder.encode(turn.text).byteLength;
    if (bytes + size > LIVE_REVIEW_TURNS_MAX_BYTES) break;
    turns.unshift({ role: turn.role, text: turn.text });
    bytes += size;
    if (turns.length >= LIVE_REVIEW_TURNS_MAX) break;
  }
  return turns;
}