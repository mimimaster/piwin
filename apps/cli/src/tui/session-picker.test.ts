import type { RemoteSessionSummary } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { buildSessionRows, type SessionRow } from './session-list-model.js';
import { SessionPicker, type SessionPickerActions } from './session-picker.js';

const ANSI = /\x1b\[[0-9;]*m/g;

function plain(lines: string[]): string {
  return lines.join('\n').replace(ANSI, '');
}

function actions(): SessionPickerActions {
  return {
    onOpen: () => undefined,
    onNew: () => undefined,
    onRename: () => undefined,
    onArchive: () => undefined,
    onClose: () => undefined,
  };
}

function row(overrides: Partial<SessionRow> & { sessionId: string }): SessionRow {
  return {
    title: overrides.sessionId,
    scopeLabel: '对话',
    projectKey: 'general',
    updatedLabel: '刚刚',
    updatedAt: new Date().toISOString(),
    messageCount: 1,
    pinned: false,
    archived: false,
    searchText: overrides.title ?? overrides.sessionId,
    ...overrides,
  };
}

describe('SessionPicker', () => {
  it('shows loading, a load failure, and an empty list', () => {
    const picker = new SessionPicker(actions(), undefined);
    picker.setLoading();
    expect(plain(picker.render(80))).toContain('加载中');
    picker.setError('list boom');
    expect(plain(picker.render(80))).toContain('加载失败：list boom');
    picker.setRows([], undefined, []);
    expect(plain(picker.render(80))).toContain('还没有会话');
  });

  it('renders group headers, relative time, and expands archived on Tab', () => {
    const picker = new SessionPicker(actions(), 'live');
    picker.setRows(
      [
        row({ sessionId: 'live', title: '活动会话', updatedLabel: '3 分钟前' }),
        row({ sessionId: 'old', title: '归档会话', archived: true }),
      ],
      'live',
      [],
    );
    const folded = plain(picker.render(80));
    expect(folded).toContain('今天');
    expect(folded).toContain('3 分钟前');
    expect(folded).toContain('已折叠');
    expect(folded).not.toContain('归档会话');
    expect(folded).toContain('^P 项目');
    picker.handleInput('\t');
    expect(plain(picker.render(80))).toContain('归档会话');
  });

  it('cycles the project filter without another list read', () => {
    const now = new Date();
    const sessions: RemoteSessionSummary[] = [
      {
        sessionId: 'g',
        scope: 'general',
        kind: 'main',
        name: '通用会话',
        updatedAt: now.toISOString(),
      },
      {
        sessionId: 'p',
        scope: 'project',
        kind: 'main',
        projectId: 'project-1',
        name: '项目会话',
        updatedAt: now.toISOString(),
      },
    ];
    const picker = new SessionPicker(actions(), undefined);
    picker.setRows(
      buildSessionRows(sessions, [{ projectId: 'project-1', displayName: 'piwin' }], now),
      undefined,
      [{ projectId: 'project-1', displayName: 'piwin' }],
    );
    expect(plain(picker.render(80))).toContain('会话 · 全部');
    picker.handleInput('\x10');
    const general = plain(picker.render(80));
    expect(general).toContain('会话 · 对话');
    expect(general).toContain('通用会话');
    expect(general).not.toContain('项目会话');
    picker.handleInput('\x10');
    const project = plain(picker.render(80));
    expect(project).toContain('会话 · piwin');
    expect(project).toContain('项目会话');
    expect(project).not.toContain('通用会话');
  });
});
