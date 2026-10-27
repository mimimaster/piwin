/**
 * The way back after a deliberate jump: where a history tick or
 * jump-to-latest took the reader from, while they were reading history.
 * From the tail there is no return point — jump-to-latest already is one.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TranscriptReadingAnchor } from '../conversation/transcript-reading-anchor.js';
import type { TranscriptReadingRestore } from './use-transcript-reading-restore.js';

export function useTranscriptReturnPoint(options: {
  reading: Pick<TranscriptReadingRestore, 'cancelPending' | 'captureAnchor' | 'navigateToAnchor'>;
  isFollowingTail: () => boolean;
  /** Effective live turn; a new send makes the old way back stale. */
  liveTurnId: string | null;
  /** History paging must not re-anchor the window change this jump causes. */
  resetPagingIntent: () => void;
}): {
  returnPoint: TranscriptReadingAnchor | null;
  markJumpOrigin: () => void;
  returnToPoint: () => void;
} {
  const { reading, isFollowingTail, liveTurnId, resetPagingIntent } = options;
  const [returnPoint, setReturnPoint] = useState<TranscriptReadingAnchor | null>(null);

  const markJumpOrigin = useCallback((): void => {
    reading.cancelPending();
    setReturnPoint(isFollowingTail() ? null : reading.captureAnchor());
  }, [isFollowingTail, reading.cancelPending, reading.captureAnchor]);

  const returnToPoint = useCallback((): void => {
    if (!returnPoint) return;
    setReturnPoint(null);
    resetPagingIntent();
    reading.navigateToAnchor(returnPoint);
  }, [reading.navigateToAnchor, resetPagingIntent, returnPoint]);

  useEffect(() => {
    if (liveTurnId) setReturnPoint(null);
  }, [liveTurnId]);

  return { returnPoint, markJumpOrigin, returnToPoint };
}
