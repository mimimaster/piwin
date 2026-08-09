import { describe, expect, it } from 'vitest';
import type { SessionScope } from '@piwin/contracts';
import {
  draftSessionMatchesQuery,
  sortDraftSessions,
  type DraftSessionItemUi,
} from './draft-session';

const projectScope: SessionScope = { kind: 'project', projectPath: '/workspace/piwin' };

function draft(id: string, createdAt: string, name: string): DraftSessionItemUi {
  return {
    id,
    name,
    text: name,
    createdAt,
    updatedAt: createdAt,
    scope: projectScope,
    isDraft: true,
  };
}

describe('local composer drafts', () => {
  it('sorts drafts newest first without mutating the source list', () => {
    const older = draft('older', '2026-08-09T08:00:00.000Z', 'older');
    const newer = draft('newer', '2026-08-09T09:00:00.000Z', 'newer');
    const input = [older, newer];

    expect(sortDraftSessions(input).map((item) => item.id)).toEqual(['newer', 'older']);
    expect(input.map((item) => item.id)).toEqual(['older', 'newer']);
  });

  it('searches both the displayed title and the preserved composer text', () => {
    const item = draft('draft-1', '2026-08-09T09:00:00.000Z', 'Open the project');
    item.text = 'Inspect the auth flow';

    expect(draftSessionMatchesQuery(item, 'project')).toBe(true);
    expect(draftSessionMatchesQuery(item, 'AUTH')).toBe(true);
    expect(draftSessionMatchesQuery(item, 'missing')).toBe(false);
  });
});
