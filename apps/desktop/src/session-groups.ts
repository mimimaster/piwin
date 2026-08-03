/**
 * Cursor-style session list grouping:
 * Pinned (if any) → Today / Yesterday / Previous 7 days / Older.
 */

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
    return 'older';
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
    // Missing updatedAt = just created; treat as newest so new rows stay on top.
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.updatedAt
      ? new Date(right.updatedAt).getTime()
      : Number.POSITIVE_INFINITY;
    const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
    if (leftSafe !== rightSafe) {
      return rightSafe - leftSafe;
    }
    return left.name.localeCompare(right.name);
  });
}

export function groupSessionsByRecency<T extends SessionGroupable>(
  sessions: readonly T[],
  now: Date = new Date(),
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
    buckets[resolveTimeGroupId(session.updatedAt, now)].push(session);
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
