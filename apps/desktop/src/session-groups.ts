/**
 * Cursor-style session list grouping:
 * Pinned (if any) → Today / Yesterday / Previous 7 days / Older.
 */

import { compareSessionRecency } from './session-recency';

export type SessionGroupable = {
  id: string;
  name: string;
  lastPreview?: string;
  updatedAt?: string;
  isPinned?: boolean;
};

export type SessionTimeGroupId = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

export type SessionTimeGroup<T extends SessionGroupable = SessionGroupable> = {
  id: SessionTimeGroupId;
  label: string;
  sessions: T[];
};

const GROUP_ORDER: SessionTimeGroupId[] = ['pinned', 'today', 'yesterday', 'week', 'older'];

const GROUP_LABELS: Record<SessionTimeGroupId, string> = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Previous 7 days',
  older: 'Older',
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function resolveTimeGroupId(updatedAt: string | undefined, now: Date): Exclude<SessionTimeGroupId, 'pinned'> {
  if (!updatedAt) {
    return 'today';
  }
  const stamp = new Date(updatedAt);
  if (Number.isNaN(stamp.getTime())) {
    return 'older';
  }
  const dayStart = startOfLocalDay(now).getTime();
  const stampDay = startOfLocalDay(stamp).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.floor((dayStart - stampDay) / dayMs);
  if (dayDiff <= 0) {
    return 'today';
  }
  if (dayDiff === 1) {
    return 'yesterday';
  }
  if (dayDiff < 7) {
    return 'week';
  }
  return 'older';
}

function sortByRecencyThenName<T extends SessionGroupable>(sessions: T[]): T[] {
  return [...sessions].sort((left, right) => {
    const byRecency = compareSessionRecency(left, right);
    if (byRecency !== 0) {
      return byRecency;
    }
    return left.name.localeCompare(right.name);
  });
}

/**
 * `isLive` marks sessions with work in flight; they count as Today whatever
 * their last stamp, so a long run started yesterday is not buried below.
 */
export function groupSessionsByRecency<T extends SessionGroupable>(
  sessions: readonly T[],
  now: Date = new Date(),
  isLive?: (session: T) => boolean,
): SessionTimeGroup<T>[] {
  const buckets: Record<SessionTimeGroupId, T[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };

  for (const session of sessions) {
    if (session.isPinned === true) {
      buckets.pinned.push(session);
      continue;
    }
    const groupId = isLive?.(session) === true ? 'today' : resolveTimeGroupId(session.updatedAt, now);
    buckets[groupId].push(session);
  }

  for (const groupId of GROUP_ORDER) {
    buckets[groupId] = sortByRecencyThenName(buckets[groupId]);
  }

  return GROUP_ORDER.filter((groupId) => buckets[groupId].length > 0).map((groupId) => ({
    id: groupId,
    label: GROUP_LABELS[groupId],
    sessions: buckets[groupId],
  }));
}
