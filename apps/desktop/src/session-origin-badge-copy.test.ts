import { describe, expect, it } from 'vitest';
import { describeSessionOriginBadge } from './session-origin-badge-copy';

describe('describeSessionOriginBadge', () => {
  it('names a handoff after its source session', () => {
    const origin = {
      kind: 'handoff' as const,
      sourceSessionId: 'prev',
      sourceSessionNameSnapshot: 'Auth refactor',
      createdAt: '2026-10-15T00:00:00.000Z',
    };
    expect(describeSessionOriginBadge(origin, true)).toEqual({ title: '交接自「Auth refactor」', label: '交接' });
    expect(describeSessionOriginBadge(origin, false)).toEqual({
      title: 'Handed off from "Auth refactor"',
      label: 'Handoff',
    });
  });

  it('keeps the duplicate wording and falls back when the source name is unknown', () => {
    expect(
      describeSessionOriginBadge(
        { kind: 'duplicate', sourceSessionId: 'prev', createdAt: '2026-10-15T00:00:00.000Z' },
        true,
      ),
    ).toEqual({ title: '复制自「源会话」', label: '副本' });
  });
});
