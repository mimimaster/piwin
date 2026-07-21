/**
 * Cursor-style session list grouping (Today / Yesterday / Previous 7 days / Older).
 */

export type SessionGroupable = {
  id: string;
  name: string;
  lastPreview?: string;
  updatedAt?: string;
  isPinned?: boolean;
};

export type SessionTimeGroupId = 'today' | 'yesterday' | 'week' | 'older';

export type SessionTimeGroup<T extends SessionGroupable = SessionGroupable> = {
  id: SessionTimeGroupId;
  label: string;
  sessions: T[];
};

const GROUP_ORDER: SessionTimeGroupId[] = ['today', 'yesterday', 'week', 'older'];

const GROUP_LABELS: Record<SessionTimeGroupId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Previous 7 days',
  older: 'Older',
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function resolveGroupId(updatedAt: string | undefined, now: Date): SessionTimeGroupId {
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

export function groupSessionsByRecency<T extends SessionGroupable>(
  sessions: readonly T[],
  now: Date = new Date(),
): SessionTimeGroup<T>[] {
  const buckets: Record<SessionTimeGroupId, T[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };

  const sorted = [...sessions].sort((left, right) => {
    const leftPinned = left.isPinned === true;
    const rightPinned = right.isPinned === true;
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.name.localeCompare(right.name);
  });

  for (const session of sorted) {
    buckets[resolveGroupId(session.updatedAt, now)].push(session);
  }

  return GROUP_ORDER.filter((groupId) => buckets[groupId].length > 0).map((groupId) => ({
    id: groupId,
    label: GROUP_LABELS[groupId],
    sessions: buckets[groupId],
  }));
}
