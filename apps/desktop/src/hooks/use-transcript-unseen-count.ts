/**
 * Unseen messages since the reader left the live tail (the jump-to-latest
 * badge). Leaving the tail sets the origin; returning to it clears it.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import {
  countUnseenTranscriptMessages,
  type UnseenCountMessage,
} from '../conversation/transcript-unseen-count.js';

export function useTranscriptUnseenCount(options: {
  /** Origin carried over from a remembered reading position; null at the tail. */
  initialLastSeenMessageId: string | null;
  followTail: boolean;
  messages: readonly UnseenCountMessage[];
  historyViewActive: boolean;
}): { lastSeenMessageId: string | null; unseenCount: number } {
  const [lastSeenMessageId, setLastSeenMessageId] = useState(options.initialLastSeenMessageId);
  // Transitions only: the first render's "following" must not wipe a
  // remembered origin before the open effect detaches from the tail.
  const previousFollowTailRef = useRef(options.followTail);
  useLayoutEffect(() => {
    const wasFollowing = previousFollowTailRef.current;
    previousFollowTailRef.current = options.followTail;
    if (wasFollowing === options.followTail) return;
    if (options.followTail) {
      setLastSeenMessageId(null);
      return;
    }
    const lastMessageId = options.messages.at(-1)?.id ?? null;
    setLastSeenMessageId((current) => current ?? lastMessageId);
  }, [options.followTail, options.messages]);
  // A history window is not the live tail; counting there means nothing.
  const unseenCount =
    options.historyViewActive || options.followTail
      ? 0
      : countUnseenTranscriptMessages(options.messages, lastSeenMessageId);
  return { lastSeenMessageId, unseenCount };
}
