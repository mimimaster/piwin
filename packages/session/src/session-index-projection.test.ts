import { describe, expect, it } from 'vitest';
import type { SessionIndexRecord, SessionListOrder } from '@piwin/contracts';
import {
  orderSessionIndexRecords,
  projectSessionIndex,
} from './session-index-projection.js';

function record(index: number, overrides: Partial<SessionIndexRecord> = {}): SessionIndexRecord {
  return {
    id: `id-${index.toString().padStart(4, '0')}`,
    projectPath: '',
    scope: { kind: 'general' },
    workingDirectory: 'general',
    name: `Chat ${index.toString().padStart(4, '0')}`,
    nameSource: 'user',
    createdAt: `2026-08-08T00:${(index % 60).toString().padStart(2, '0')}:00.000Z`,
    updatedAt: `2026-08-08T00:${(index % 60).toString().padStart(2, '0')}:00.000Z`,
    messageCount: index,
    ...overrides,
  };
}

function project(
  records: readonly SessionIndexRecord[],
  overrides: { includeArchived?: boolean; order?: SessionListOrder; maxItems?: number } = {},
) {
  return projectSessionIndex(records, {
    order: overrides.order ?? 'updated',
    ...(overrides.includeArchived !== undefined
      ? { includeArchived: overrides.includeArchived }
      : {}),
    ...(overrides.maxItems !== undefined ? { maxItems: overrides.maxItems } : {}),
  });
}

describe('orderSessionIndexRecords', () => {
  it('orders updated as pinned first, then pin/update time descending, then session id', () => {
    const records = [
      record(1, { name: 'unpinned-old', updatedAt: '2026-08-01T00:00:00.000Z' }),
      record(2, { name: 'unpinned-new', updatedAt: '2026-08-03T00:00:00.000Z' }),
      record(3, {
        name: 'pinned-older-pin',
        isPinned: true,
        pinnedAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      }),
      record(4, {
        name: 'pinned-newer-pin',
        isPinned: true,
        pinnedAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
      record(5, {
        name: 'pinned-same-times-b',
        id: 'id-same-b',
        isPinned: true,
        pinnedAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
      record(6, {
        name: 'unpinned-same-time-a',
        id: 'id-unp-a',
        updatedAt: '2026-08-03T00:00:00.000Z',
      }),
    ];

    expect(orderSessionIndexRecords(records, 'updated').map((item) => item.name)).toEqual([
      'pinned-newer-pin',
      'pinned-same-times-b',
      'pinned-older-pin',
      'unpinned-new',
      'unpinned-same-time-a',
      'unpinned-old',
    ]);
  });

  it('orders alphabetical by name then session id and ignores pins', () => {
    const records = [
      record(1, { name: 'Zulu', isPinned: true, pinnedAt: '2026-08-09T00:00:00.000Z' }),
      record(2, { name: 'Alpha', id: 'id-alpha-z' }),
      record(3, { name: 'Alpha', id: 'id-alpha-a' }),
      record(4, { name: 'Bravo' }),
    ];

    expect(orderSessionIndexRecords(records, 'alphabetical').map((item) => item.id)).toEqual([
      'id-alpha-a',
      'id-alpha-z',
      'id-0004',
      'id-0001',
    ]);
  });
});

describe('projectSessionIndex', () => {
  it('captures totalCount after listability and archive filtering', () => {
    const records = [
      record(1, { name: 'Visible active' }),
      record(2, { name: 'Visible archived', isArchived: true }),
      record(3, { name: 'session-placeholder' }),
      record(4, { name: 'session-placeholder-archived', isArchived: true }),
    ];

    const active = project(records);
    expect(active.sessions.map((item) => item.name)).toEqual(['Visible active']);
    expect(active.totalCount).toBe(1);
    expect(active.truncated).toBe(false);

    const withArchived = project(records, { includeArchived: true });
    expect(withArchived.sessions.map((item) => item.name)).toEqual([
      'Visible archived',
      'Visible active',
    ]);
    expect(withArchived.totalCount).toBe(2);
    expect(withArchived.truncated).toBe(false);
  });

  it('applies global order before truncation', () => {
    const records = [
      record(1, { name: 'Zulu', updatedAt: '2026-08-10T00:00:00.000Z' }),
      record(2, { name: 'Alpha', updatedAt: '2026-08-01T00:00:00.000Z' }),
      record(3, { name: 'Bravo', updatedAt: '2026-08-05T00:00:00.000Z' }),
    ];

    const alphabetical = project(records, { order: 'alphabetical', maxItems: 2 });
    expect(alphabetical.sessions.map((item) => item.name)).toEqual(['Alpha', 'Bravo']);
    expect(alphabetical.totalCount).toBe(3);
    expect(alphabetical.truncated).toBe(true);

    const updated = project(records, { order: 'updated', maxItems: 2 });
    expect(updated.sessions.map((item) => item.name)).toEqual(['Zulu', 'Bravo']);
    expect(updated.totalCount).toBe(3);
    expect(updated.truncated).toBe(true);
  });

  it('reports truncated false for empty and exact-bound results', () => {
    expect(project([])).toEqual({ sessions: [], totalCount: 0, truncated: false });

    const exact = [record(1, { name: 'Only' }), record(2, { name: 'Pair' })];
    const result = project(exact, { maxItems: 2 });
    expect(result.sessions).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('truncates a 10,000-record fixture to 2,000 while preserving totalCount', () => {
    const records = Array.from({ length: 10_000 }, (_, index) => record(index));
    const result = project(records, { order: 'updated', maxItems: 2_000 });

    expect(result.sessions).toHaveLength(2_000);
    expect(result.totalCount).toBe(10_000);
    expect(result.truncated).toBe(true);
    expect(result.sessions[0]?.id).toBe(orderSessionIndexRecords(records, 'updated')[0]?.id);
    expect(result.sessions.at(-1)?.id).toBe(
      orderSessionIndexRecords(records, 'updated')[1_999]?.id,
    );
  });

  it('rejects maxItems that are not a positive safe integer', () => {
    const records = [record(1)];
    for (const maxItems of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => project(records, { maxItems })).toThrow(RangeError);
    }
  });

  it('omits truncation when maxItems is absent', () => {
    const records = Array.from({ length: 8 }, (_, index) => record(index));
    const result = project(records);
    expect(result.sessions).toHaveLength(8);
    expect(result.totalCount).toBe(8);
    expect(result.truncated).toBe(false);
  });
});
