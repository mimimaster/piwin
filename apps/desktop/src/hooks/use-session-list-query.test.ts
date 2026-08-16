import { describe, expect, it } from 'vitest';
import { projectSessionSearchHits } from './use-session-list-query';

describe('projectSessionSearchHits', () => {
  it('merges remote hits onto resident sessions and drops nameless leftovers', () => {
    const merged = projectSessionSearchHits(
      [
        {
          sessionId: 's1',
          name: 'Updated name',
          snippet: 'hit body',
          updatedAt: '2026-08-16T00:00:00.000Z',
          isPinned: true,
          projectPath: '',
        },
        {
          sessionId: 's-missing',
          name: '',
          projectPath: '',
        },
      ],
      [{ id: 's1', name: 'Old name', lastPreview: 'old' }],
    );
    expect(merged).toEqual([
      {
        id: 's1',
        name: 'Updated name',
        lastPreview: 'hit body',
        updatedAt: '2026-08-16T00:00:00.000Z',
        isPinned: true,
      },
    ]);
  });
});
