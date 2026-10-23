/**
 * Send completion must write back to the owner that started the turn, not
 * whatever session/draft is selected when the ACK or failure arrives.
 */
export function sendOwnerLockKey(
  sessionId: string | null,
  draftId: string | null,
): string {
  if (sessionId) {
    return `session:${sessionId}`;
  }
  if (draftId) {
    return `draft:${draftId}`;
  }
  return 'draft:anon';
}

export function acquireSendOwnerLock(locks: Set<string>, key: string): boolean {
  if (locks.has(key)) {
    return false;
  }
  locks.add(key);
  return true;
}

export function releaseSendOwnerLock(locks: Set<string>, key: string): void {
  locks.delete(key);
}

export function shouldRestoreLiveComposer(input: {
  ownerSessionId: string | null;
  liveSessionId: string | null;
  liveComposer: string;
  restoreText: string;
}): boolean {
  if (
    input.ownerSessionId !== input.liveSessionId &&
    !(input.liveSessionId === null && input.ownerSessionId !== null)
  ) {
    return false;
  }
  const live = input.liveComposer;
  return live.trim().length === 0 || live === input.restoreText;
}
