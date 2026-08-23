import { describe, expect, it } from 'vitest';
import { archivedSessionsFromListData } from './archive-session-list';

describe('archivedSessionsFromListData', () => {
  it('keeps local SessionSummary rows that set isArchived', () => {
    const archived = archivedSessionsFromListData({
      sessions: [
        {
          id: 'local-archived',
          name: 'Old notes',
          scope: { kind: 'general' },
          workingDirectory: '',
          projectPath: '',
          updatedAt: '2026-08-15T12:00:00.000Z',
          archivedAt: '2026-08-15T12:30:00.000Z',
          isArchived: true,
          messageCount: 3,
        },
        {
          id: 'local-active',
          name: 'Live chat',
          scope: { kind: 'general' },
          workingDirectory: '',
          projectPath: '',
          updatedAt: '2026-08-16T09:00:00.000Z',
          isArchived: false,
          messageCount: 1,
        },
      ],
    });
    expect(archived.map((session) => session.id)).toEqual(['local-archived']);
    expect(archived[0]?.name).toBe('Old notes');
  });

  it('maps remote session/list rows that use sessionId and archived', () => {
    const archived = archivedSessionsFromListData({
      sessions: [
        {
          sessionId: 'remote-archived',
          name: 'Packed chat',
          scope: 'project',
          projectId: 'proj-abc',
          updatedAt: '2026-08-14T10:00:00.000Z',
          archived: true,
          messageCount: 5,
          lastPreview: 'done',
        },
        {
          sessionId: 'remote-active',
          name: 'Still open',
          scope: 'general',
          archived: false,
        },
      ],
      totalCount: 2,
      truncated: false,
    });
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe('remote-archived');
    expect(archived[0]?.isArchived).toBe(true);
    expect(archived[0]?.scope).toEqual({ kind: 'project', projectPath: 'proj-abc' });
    expect(archived[0]?.lastPreview).toBe('done');
  });
});
