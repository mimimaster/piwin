import { describe, expect, it } from 'vitest';
import { groupSessionsByRecency } from './session-groups';

describe('groupSessionsByRecency', () => {
  // Local calendar construction avoids timezone flakes.
  const now = new Date(2026, 6, 20, 15, 0, 0); // Jul 20 2026 local

  it('groups by today / yesterday / week / older', () => {
    const groups = groupSessionsByRecency(
      [
        { id: '1', name: 'today', updatedAt: new Date(2026, 6, 20, 10, 0, 0).toISOString() },
        { id: '2', name: 'yest', updatedAt: new Date(2026, 6, 19, 10, 0, 0).toISOString() },
        { id: '3', name: 'week', updatedAt: new Date(2026, 6, 16, 10, 0, 0).toISOString() },
        { id: '4', name: 'old', updatedAt: new Date(2026, 5, 1, 10, 0, 0).toISOString() },
      ],
      now,
    );
    expect(groups.map((group) => group.id)).toEqual([
      'today',
      'yesterday',
      'week',
      'older',
    ]);
    expect(groups[0]?.sessions[0]?.name).toBe('today');
  });

  it('omits empty groups', () => {
    const groups = groupSessionsByRecency(
      [{ id: '1', name: 'only', updatedAt: new Date(2026, 6, 20, 12, 0, 0).toISOString() }],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Today');
  });

  it('puts pinned sessions in a dedicated Pinned group above recency', () => {
    const groups = groupSessionsByRecency(
      [
        {
          id: 'p1',
          name: 'Pinned old',
          isPinned: true,
          updatedAt: new Date(2026, 5, 10, 12, 0, 0).toISOString(),
        },
        {
          id: 't1',
          name: 'Today free',
          updatedAt: new Date(2026, 6, 20, 12, 0, 0).toISOString(),
        },
      ],
      now,
    );
    expect(groups.map((group) => group.id)).toEqual(['pinned', 'today']);
    expect(groups[0]?.sessions.map((session) => session.id)).toEqual(['p1']);
    expect(groups[1]?.sessions.map((session) => session.id)).toEqual(['t1']);
  });

});
