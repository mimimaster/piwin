import { describe, expect, it } from 'vitest';
import type { InkstoneProjectGroup, InkstoneSessionRow } from '../host/host-bridge.js';
import { buildSessionSections } from './session-sections.js';

function row(sessionId: string, patch: Partial<InkstoneSessionRow> = {}): InkstoneSessionRow {
  return { sessionId, title: sessionId, subtitle: '', status: 'done', time: '', pinned: false, ...patch };
}

const groups: InkstoneProjectGroup[] = [
  { projectId: 'p1', project: 'workspace', rows: [row('a', { pinned: true }), row('b', { status: 'running' })] },
  { projectId: undefined, project: '一般会话', rows: [row('c')] },
  { projectId: 'p2', project: 'piwin', rows: [row('d', { pinned: true })] },
];

describe('buildSessionSections', () => {
  it('floats pinned rows into one section and drops projects left empty', () => {
    const view = buildSessionSections(groups, '全部');
    expect(view.sections.map((section) => section.key)).toEqual([
      'pinned',
      'project:p1',
      'project:__general__',
    ]);
    const pinned = view.sections[0];
    expect(pinned?.rows.map((item) => [item.sessionId, item.scope])).toEqual([
      ['a', 'workspace'],
      ['d', 'piwin'],
    ]);
    expect(view.sections[1]?.rows.map((item) => item.sessionId)).toEqual(['b']);
  });

  it('draws the pinned filter as one flat list, not one empty group per project', () => {
    const view = buildSessionSections(groups, '置顶');
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]?.kind).toBe('flat');
    expect(view.sections[0]?.rows.map((item) => item.sessionId)).toEqual(['a', 'd']);
  });

  it('returns a single empty message when a filter matches nothing', () => {
    const view = buildSessionSections([{ projectId: 'p1', project: 'x', rows: [row('a')] }], '置顶');
    expect(view.sections).toEqual([]);
    expect(view.emptyMessage).toContain('置顶');
  });

  it('keeps only running rows under 进行中 with their project as scope', () => {
    const view = buildSessionSections(groups, '进行中');
    expect(view.sections[0]?.rows.map((item) => [item.sessionId, item.scope])).toEqual([['b', 'workspace']]);
  });
});
