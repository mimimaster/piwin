import type { RemoteSessionSummary } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { buildSessionRows, formatRelativeTime } from './session-list-model.js';

const NOW = new Date('2026-10-08T12:00:00.000Z');

function session(overrides: Partial<RemoteSessionSummary> & { sessionId: string }): RemoteSessionSummary {
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
    const [row] = buildSessionRows([session({ sessionId: 's1', lastPreview: 'hello there' })], [], NOW);
    expect(row?.title).toBe('hello there');
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
