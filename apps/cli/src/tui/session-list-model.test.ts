import type { RemoteSessionSummary } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildSessionRows,
  filterSessionRows,
  flattenSessionGroups,
  formatRelativeTime,
  groupSessionRows,
  listProjectFilterOptions,
  type SessionRow,
} from './session-list-model.js';

const NOW = new Date('2026-10-08T12:00:00.000Z');

function session(
  overrides: Partial<RemoteSessionSummary> & { sessionId: string },
): RemoteSessionSummary {
  return { scope: 'general', kind: 'main', updatedAt: '2026-10-08T11:00:00.000Z', ...overrides };
}

describe('buildSessionRows', () => {
  it('orders pinned sessions first, then most recently updated', () => {
    const rows = buildSessionRows(
      [
        session({ sessionId: 'old', updatedAt: '2026-10-01T00:00:00.000Z' }),
        session({ sessionId: 'new', updatedAt: '2026-10-08T11:59:30.000Z' }),
        session({ sessionId: 'pinned', updatedAt: '2026-09-01T00:00:00.000Z', pinned: true }),
      ],
      [],
      NOW,
    );
    expect(rows.map((row) => row.sessionId)).toEqual(['pinned', 'new', 'old']);
  });

  it('hides subagent and side-chat sessions; they are reached through their parent', () => {
    const rows = buildSessionRows(
      [
        session({ sessionId: 'main' }),
        session({ sessionId: 'child', kind: 'subagent' }),
        session({ sessionId: 'side', kind: 'side-chat' }),
      ],
      [],
      NOW,
    );
    expect(rows.map((row) => row.sessionId)).toEqual(['main']);
  });

  it('labels project sessions with the project name and flags external agents', () => {
    const [row] = buildSessionRows(
      [
        session({
          sessionId: 's1',
          scope: 'project',
          projectId: 'project-1',
          name: '  fix   build ',
          backend: { agentId: 'grok' },
        }),
      ],
      [{ projectId: 'project-1', displayName: 'piwin' }],
      NOW,
    );
    expect(row).toMatchObject({ title: 'fix build', scopeLabel: 'piwin', agentId: 'grok' });
  });

  it('falls back to the last preview for unnamed sessions', () => {
    const [row] = buildSessionRows(
      [session({ sessionId: 's1', lastPreview: 'hello there' })],
      [],
      NOW,
    );
    expect(row?.title).toBe('hello there');
  });
});

describe('groupSessionRows', () => {
  const now = new Date(2026, 9, 8, 12, 0, 0);

  function at(day: number, hour: number): string {
    return new Date(2026, 9, day, hour, 0, 0).toISOString();
  }

  it('puts pinned only in 置顶, today apart from earlier, and archives even pinned ones', () => {
    const rows = buildSessionRows(
      [
        session({ sessionId: 'pinned-today', pinned: true, updatedAt: at(8, 11), name: 'pinned' }),
        session({ sessionId: 'today', updatedAt: at(8, 9), name: 'today' }),
        session({ sessionId: 'earlier', updatedAt: at(7, 23), name: 'earlier' }),
        session({
          sessionId: 'archived-pinned',
          pinned: true,
          archived: true,
          updatedAt: at(8, 8),
          name: 'archived',
        }),
        { sessionId: 'missing-time', scope: 'general', kind: 'main', name: 'missing' },
      ],
      [],
      now,
    );
    const groups = groupSessionRows(rows, now);
    expect(groups.map((group) => [group.id, group.label])).toEqual([
      ['pinned', '置顶'],
      ['today', '今天'],
      ['earlier', '更早'],
      ['archived', '已归档'],
    ]);
    expect(groups.map((group) => group.rows.map((row) => row.sessionId))).toEqual([
      ['pinned-today'],
      ['today'],
      ['earlier', 'missing-time'],
      ['archived-pinned'],
    ]);
    const collapsed = flattenSessionGroups(groups, false);
    expect(
      collapsed.some(
        (entry) => entry.kind === 'header' && entry.id === 'archived' && entry.collapsed,
      ),
    ).toBe(true);
    expect(
      collapsed.some((entry) => entry.kind === 'row' && entry.row.sessionId === 'archived-pinned'),
    ).toBe(false);
    const expanded = flattenSessionGroups(groups, true);
    expect(
      expanded.some((entry) => entry.kind === 'row' && entry.row.sessionId === 'archived-pinned'),
    ).toBe(true);
  });

  it('omits empty groups', () => {
    const rows = buildSessionRows([session({ sessionId: 'only', updatedAt: at(8, 1) })], [], now);
    expect(groupSessionRows(rows, now).map((group) => group.id)).toEqual(['today']);
  });
});

describe('filterSessionRows', () => {
  const projects = [{ projectId: 'project-1', displayName: 'piwin' }];

  function rows(): SessionRow[] {
    return buildSessionRows(
      [
        session({ sessionId: 'general', name: 'general chat' }),
        session({
          sessionId: 'project',
          name: 'project chat',
          scope: 'project',
          projectId: 'project-1',
        }),
      ],
      projects,
      NOW,
    );
  }

  it('filters by project key and by a title substring', () => {
    expect(
      filterSessionRows(rows(), { projectKey: 'general' }).map((row) => row.sessionId),
    ).toEqual(['general']);
    expect(
      filterSessionRows(rows(), { projectKey: 'project-1' }).map((row) => row.sessionId),
    ).toEqual(['project']);
    expect(
      filterSessionRows(rows(), { projectKey: 'all', query: 'PROJECT' }).map(
        (row) => row.sessionId,
      ),
    ).toEqual(['project']);
    expect(filterSessionRows(rows(), {}).map((row) => row.sessionId)).toEqual([
      'general',
      'project',
    ]);
  });

  it('lists 全部, general, then projects that appear', () => {
    expect(listProjectFilterOptions(rows(), projects)).toEqual([
      { key: 'all', label: '全部' },
      { key: 'general', label: '对话' },
      { key: 'project-1', label: 'piwin' },
    ]);
  });
});

describe('session list performance', () => {
  it('builds, filters and groups 500 sessions in under 200ms', () => {
    const sessions = Array.from({ length: 500 }, (_, index) =>
      session({
        sessionId: `s${index}`,
        name: `session ${index}`,
        updatedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
        pinned: index % 17 === 0,
        archived: index % 11 === 0,
        ...(index % 3 === 0
          ? { scope: 'project' as const, projectId: `project-${index % 5}` }
          : {}),
      }),
    );
    const projects = Array.from({ length: 5 }, (_, index) => ({
      projectId: `project-${index}`,
      displayName: `Project ${index}`,
    }));
    const start = performance.now();
    const built = buildSessionRows(sessions, projects, NOW);
    const filtered = filterSessionRows(built, { projectKey: 'general', query: 'session' });
    const groups = groupSessionRows(filtered, NOW);
    const entries = flattenSessionGroups(groups, false);
    const elapsed = performance.now() - start;
    expect(built).toHaveLength(500);
    expect(entries.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('formatRelativeTime', () => {
  it('formats minutes, hours, days and falls back to the date', () => {
    expect(formatRelativeTime('2026-10-08T11:59:40.000Z', NOW)).toBe('刚刚');
    expect(formatRelativeTime('2026-10-08T11:30:00.000Z', NOW)).toBe('30 分钟前');
    expect(formatRelativeTime('2026-10-08T09:00:00.000Z', NOW)).toBe('3 小时前');
    expect(formatRelativeTime('2026-10-05T12:00:00.000Z', NOW)).toBe('3 天前');
    expect(formatRelativeTime('2026-07-01T12:00:00.000Z', NOW)).toBe('2026-07-01');
    expect(formatRelativeTime(undefined, NOW)).toBe('');
  });
});
