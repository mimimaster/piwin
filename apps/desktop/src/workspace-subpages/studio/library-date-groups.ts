/**
 * Bucket already-sorted library items into date-range groups (Today,
 * Yesterday, Previous 7 Days, Previous 30 Days, then one bucket per calendar
 * month beyond that) — the same ladder Finder and Photos use.
 *
 * Buckets are assigned by a single pass that clusters adjacent items sharing
 * a bucket key, so the function works for both newest-first and oldest-first
 * input: it never re-sorts, it only labels and groups what it's given.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type LibraryDateGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function bucketFor(
  createdAt: string,
  todayStartMs: number,
  isZh: boolean,
): { key: string; label: string } {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return { key: 'unknown', label: isZh ? '未知日期' : 'Undated' };
  }
  // Clock skew / server time ahead of the client: fold anything "in the
  // future" into Today rather than inventing a negative-days bucket.
  const daysAgo = Math.max(0, Math.round((todayStartMs - startOfDayMs(parsed)) / DAY_MS));
  if (daysAgo === 0) return { key: 'today', label: isZh ? '今天' : 'Today' };
  if (daysAgo === 1) return { key: 'yesterday', label: isZh ? '昨天' : 'Yesterday' };
  if (daysAgo <= 7) return { key: 'week', label: isZh ? '最近 7 天' : 'Previous 7 Days' };
  if (daysAgo <= 30) return { key: 'month', label: isZh ? '最近 30 天' : 'Previous 30 Days' };
  const key = `${parsed.getFullYear()}-${parsed.getMonth()}`;
  const label = new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
  }).format(parsed);
  return { key, label };
}

export function groupLibraryItemsByDate<T extends { createdAt: string }>(
  items: readonly T[],
  options: { isZh: boolean; now?: Date },
): Array<LibraryDateGroup<T>> {
  const todayStartMs = startOfDayMs(options.now ?? new Date());
  const groups: Array<LibraryDateGroup<T>> = [];
  for (const item of items) {
    const { key, label } = bucketFor(item.createdAt, todayStartMs, options.isZh);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label, items: [item] });
    }
  }
  return groups;
}
