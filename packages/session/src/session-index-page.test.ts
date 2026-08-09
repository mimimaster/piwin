import { describe, expect, it } from 'vitest';
import type { SessionIndexRecord, SessionListPageQuery } from '@piwin/contracts';
import { createSessionIndexPage, SessionIndexCursorError } from './session-index-page.js';

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

function query(overrides: Partial<SessionListPageQuery> = {}): SessionListPageQuery {
  return {
    scope: { kind: 'general' },
    lifecycle: 'active',
    order: 'updated',
    limit: 6,
    ...overrides,
  };
}

describe('createSessionIndexPage', () => {
  it('keeps a 1,003-record authority inside deterministic six-item pages', () => {
    const records = Array.from({ length: 1_003 }, (_, index) => record(index));
    const first = createSessionIndexPage(records, query());
    expect(first.status).toBe('page');
    if (first.status !== 'page') return;

    expect(first.sessions).toHaveLength(6);
    expect(first.page.totalCount).toBe(1_003);
    expect(first.page.pageCount).toBe(168);
    expect(first.page.pageIndex).toBe(0);
    expect(first.page.nextCursor).toBeTypeOf('string');
    const nextCursor = first.page.nextCursor;
    if (nextCursor === undefined) {
      throw new Error('expected a next cursor fixture');
    }

    const second = createSessionIndexPage(records, query({ cursor: nextCursor }));
    expect(second.status).toBe('page');
    if (second.status !== 'page') return;
    expect(second.sessions).toHaveLength(6);
    expect(second.page.pageIndex).toBe(1);
    expect(second.page.previousCursor).toBeTypeOf('string');
  });

  it('filters lifecycle and placeholders before calculating page totals', () => {
    const records = [
      record(1, { name: 'Visible active' }),
      record(2, { name: 'Visible archived', isArchived: true }),
      record(3, { name: 'session-placeholder' }),
    ];

    const active = createSessionIndexPage(records, query());
    const archived = createSessionIndexPage(records, query({ lifecycle: 'archived' }));
    expect(active.status === 'page' ? active.page.totalCount : -1).toBe(1);
    expect(archived.status === 'page' ? archived.page.totalCount : -1).toBe(1);
  });

  it('applies alphabetical order to the complete collection before slicing', () => {
    const records = [
      record(1, { name: 'Zulu' }),
      record(2, { name: 'Alpha' }),
      record(3, { name: 'Bravo' }),
    ];
    const page = createSessionIndexPage(records, query({ order: 'alphabetical', limit: 2 }));
    expect(page.status).toBe('page');
    if (page.status !== 'page') return;
    expect(page.sessions.map((session) => session.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('starts on the globally ordered page containing an anchor session', () => {
    const records = Array.from({ length: 10_000 }, (_, index) => record(index));
    const page = createSessionIndexPage(
      records,
      query({ order: 'alphabetical', anchorSessionId: 'id-9998' }),
    );

    expect(page.status).toBe('page');
    if (page.status !== 'page') return;
    expect(page.page.pageIndex).toBe(1_666);
    expect(page.sessions.some((session) => session.id === 'id-9998')).toBe(true);
    expect(page.sessions).toHaveLength(4);
  });

  it('returns an explicit stale result after an ordering mutation', () => {
    const records = Array.from({ length: 10 }, (_, index) => record(index));
    const first = createSessionIndexPage(records, query());
    if (first.status !== 'page' || first.page.nextCursor === undefined) {
      throw new Error('expected a next cursor fixture');
    }

    const mutated = records.map((item, index) =>
      index === 0 ? { ...item, isPinned: true, pinnedAt: '2026-08-09T00:00:00.000Z' } : item,
    );
    const result = createSessionIndexPage(mutated, query({ cursor: first.page.nextCursor }));
    expect(result.status).toBe('stale-cursor');
  });

  it('invalidates an active-page cursor after an archive lifecycle mutation', () => {
    const records = Array.from({ length: 10 }, (_, index) => record(index));
    const first = createSessionIndexPage(records, query());
    if (first.status !== 'page' || first.page.nextCursor === undefined) {
      throw new Error('expected a next cursor fixture');
    }
    const archived = records.map((item, index) =>
      index === 0 ? { ...item, isArchived: true, archivedAt: '2026-08-09T00:00:00.000Z' } : item,
    );

    expect(createSessionIndexPage(archived, query({ cursor: first.page.nextCursor })).status).toBe(
      'stale-cursor',
    );
  });

  it('rejects malformed cursors and limits beyond the contract cap', () => {
    expect(() => createSessionIndexPage([record(1)], query({ cursor: 'not+a+cursor' }))).toThrow(
      SessionIndexCursorError,
    );
    expect(() => createSessionIndexPage([record(1)], query({ limit: 51 }))).toThrow(RangeError);
  });
});
