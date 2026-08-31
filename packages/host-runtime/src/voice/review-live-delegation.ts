import type { LiveDelegationReviewer, LiveDelegationReviewInput } from '@piwin/contracts';

export const LIVE_DELEGATION_REVIEW_TIMEOUT_MS = 20_000;

/** Bound even a provider that ignores abort; late decisions can never admit work. */
export async function reviewLiveDelegation(
  review: LiveDelegationReviewer,
  input: LiveDelegationReviewInput,
  timeoutMs = LIVE_DELEGATION_REVIEW_TIMEOUT_MS,
) {
  const deadline = new AbortController();
  const signal = AbortSignal.any([input.signal, deadline.signal]);
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('live-delegation-review-cancelled'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => deadline.abort(), Math.max(0, timeoutMs));
  try {
    signal.throwIfAborted();
    return await Promise.race([review({ ...input, signal }), cancelled]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
