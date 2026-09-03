import type { LiveDelegationReviewer } from '@piwin/contracts';
import { createLiveDelegationReviewer } from '@piwin/voice';
import {
  createLiveSessionModelCompletion,
  type ComposeLiveSessionCompletionInput,
} from './compose-live-completion.js';

/** Model choice stays Host-owned; no ModelRef in media events or call slots. */
export function composeLiveReviewer(input: ComposeLiveSessionCompletionInput): LiveDelegationReviewer {
  const completion = createLiveSessionModelCompletion(input);
  return createLiveDelegationReviewer({
    complete: (request) =>
      completion.complete({
        sessionId: request.sessionId,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        maxOutputTokens: 512,
        signal: request.signal,
      }),
  });
}
