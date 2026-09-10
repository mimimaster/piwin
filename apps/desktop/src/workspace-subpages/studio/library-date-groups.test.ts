import { describe, expect, it } from 'vitest';
import { groupLibraryItemsByDate } from './library-date-groups';

type Fixture = { id: string; createdAt: string };

const NOW = new Date('2026-03-15T12:00:00.000Z');

function iso(daysAgo: number): string {
  const d = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

describe('groupLibraryItemsByDate', () => {
  it('buckets today, yesterday, and the 7/30-day windows', () => {
    const items: Fixture[] = [
      { id: 'a', createdAt: iso(0) },
      { id: 'b', createdAt: iso(1) },
      { id: 'c', createdAt: iso(5) },
      { id: 'd', createdAt: iso(20) },
    ];
    const groups = groupLibraryItemsByDate(items, { isZh: false, now: NOW });
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'week', 'month']);
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 Days',
      'Previous 30 Days',
    ]);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it('clusters adjacent items sharing a bucket instead of one row per item', () => {
    const items: Fixture[] = [
      { id: 'a', createdAt: iso(0) },
      { id: 'b', createdAt: iso(0) },
      { id: 'c', createdAt: iso(1) },
    ];
    const groups = groupLibraryItemsByDate(items, { isZh: false, now: NOW });
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['c']);
  });

  it('falls back to a month/year label beyond 30 days', () => {
    const items: Fixture[] = [{ id: 'a', createdAt: iso(90) }];
    const groups = groupLibraryItemsByDate(items, { isZh: false, now: NOW });
    expect(groups[0]!.key).toBe('2025-11');
    expect(groups[0]!.label).toBe('December 2025');
  });

  it('localizes labels to zh-CN', () => {
    const items: Fixture[] = [
      { id: 'a', createdAt: iso(0) },
      { id: 'b', createdAt: iso(1) },
      { id: 'c', createdAt: iso(90) },
    ];
    const groups = groupLibraryItemsByDate(items, { isZh: true, now: NOW });
    expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '2025年12月']);
  });

  it('groups correctly for ascending (oldest-first) input without re-sorting', () => {
    const items: Fixture[] = [
      { id: 'old', createdAt: iso(90) },
      { id: 'mid', createdAt: iso(1) },
      { id: 'new', createdAt: iso(0) },
    ];
    const groups = groupLibraryItemsByDate(items, { isZh: false, now: NOW });
    expect(groups.map((g) => g.key)).toEqual(['2025-11', 'yesterday', 'today']);
  });

  it('folds unparsable dates into an "Undated" bucket instead of throwing', () => {
    const items: Fixture[] = [{ id: 'bad', createdAt: 'not-a-date' }];
    const groups = groupLibraryItemsByDate(items, { isZh: false, now: NOW });
    expect(groups[0]!.key).toBe('unknown');
    expect(groups[0]!.label).toBe('Undated');
  });

  it('clamps future-dated items (clock skew) into Today rather than a negative bucket', () => {
    const items: Fixture[] = [{ id: 'future', createdAt: iso(-5) }];
    const groups = groupLibraryItemsByDate(items, { isZh: false, now: NOW });
    expect(groups[0]!.key).toBe('today');
  });

  it('returns an empty array for an empty input', () => {
    expect(groupLibraryItemsByDate([], { isZh: false, now: NOW })).toEqual([]);
  });
});
