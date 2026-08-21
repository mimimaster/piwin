import type { SessionListItemUi } from './chat-reducer';

export type FindAdjacentSessionOptions = {
  activeSessionId: string;
  sessions: readonly SessionListItemUi[];
  fallbackSessions?: readonly SessionListItemUi[] | undefined;
};

/**
 * Finds the nearest/adjacent session to switch to when the active session is archived or closed.
 * Priority:
 * 1. The first unarchived session immediately following the active session in `sessions`.
 * 2. If no subsequent unarchived session exists, the last unarchived session preceding the active session.
 * 3. Fallback sessions (e.g. generalSessions) if the primary list has no unarchived candidate.
 * 4. null if no other candidate sessions exist (indicating transition to a new session draft).
 */
export function findAdjacentSessionId(options: FindAdjacentSessionOptions): string | null {
  const { activeSessionId, sessions, fallbackSessions } = options;

  const remaining = sessions.filter((s) => s.id !== activeSessionId && !s.isArchived);
  const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);

  if (remaining.length > 0) {
    if (currentIndex >= 0) {
      // Find the first unarchived session after currentIndex
      const nextCandidate = sessions
        .slice(currentIndex + 1)
        .find((s) => s.id !== activeSessionId && !s.isArchived);
      if (nextCandidate) {
        return nextCandidate.id;
      }
      // If none after, find the last unarchived session before currentIndex
      const prevCandidate = sessions
        .slice(0, currentIndex)
        .reverse()
        .find((s) => s.id !== activeSessionId && !s.isArchived);
      if (prevCandidate) {
        return prevCandidate.id;
      }
    }
    return remaining[0]!.id;
  }

  if (fallbackSessions && fallbackSessions.length > 0) {
    const fallbackRemaining = fallbackSessions.filter(
      (s) => s.id !== activeSessionId && !s.isArchived,
    );
    const fallbackIndex = fallbackSessions.findIndex((s) => s.id === activeSessionId);
    if (fallbackRemaining.length > 0) {
      if (fallbackIndex >= 0) {
        const nextCandidate = fallbackSessions
          .slice(fallbackIndex + 1)
          .find((s) => s.id !== activeSessionId && !s.isArchived);
        if (nextCandidate) {
          return nextCandidate.id;
        }
        const prevCandidate = fallbackSessions
          .slice(0, fallbackIndex)
          .reverse()
          .find((s) => s.id !== activeSessionId && !s.isArchived);
        if (prevCandidate) {
          return prevCandidate.id;
        }
      }
      return fallbackRemaining[0]!.id;
    }
  }

  return null;
}
