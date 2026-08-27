import { describe, expect, it } from 'vitest';
import { buildSessionSearchDialogItems } from './session-search-dialog-model';

describe('buildSessionSearchDialogItems', () => {
  it('sorts an empty query by recency and removes duplicate General rows', () => {
    const result = buildSessionSearchDialogItems({
      primaryScope: { kind: 'general' },
      primarySessions: [
        { id: 'older', name: 'Older', updatedAt: '2026-08-20T00:00:00.000Z' },
        { id: 'newer', name: 'Newer', updatedAt: '2026-08-24T00:00:00.000Z' },
      ],
      generalSessions: [
        { id: 'newer', name: 'Duplicate newer', updatedAt: '2026-08-24T00:00:00.000Z' },
      ],
      query: '',
    });

    expect(result.map((item) => item.id)).toEqual(['newer', 'older']);
    expect(result.every((item) => item.scope.kind === 'general')).toBe(true);
  });

  it('preserves Host relevance order and explicit result scope during search', () => {
    const result = buildSessionSearchDialogItems({
      primaryScope: { kind: 'project', projectPath: '/fallback' },
      primarySessions: [
        {
          id: 'body-hit',
          name: 'Body match',
          scope: { kind: 'project', projectPath: '/actual' },
        },
        { id: 'title-hit', name: 'Title match' },
      ],
      generalSessions: [{ id: 'general-hit', name: 'General match' }],
      query: 'match',
    });

    expect(result.map((item) => item.id)).toEqual(['body-hit', 'title-hit', 'general-hit']);
    expect(result[0]?.scope).toEqual({ kind: 'project', projectPath: '/actual' });
    expect(result[1]?.scope).toEqual({ kind: 'project', projectPath: '/fallback' });
    expect(result[2]?.scope).toEqual({ kind: 'general' });
  });
});
