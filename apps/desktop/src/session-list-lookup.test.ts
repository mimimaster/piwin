import { describe, expect, it } from 'vitest';
import type { SessionListItemUi } from './chat-reducer';
import {
  collectSessionsForLookup,
  findSessionForLookup,
  mergeSessionsForLookup,
} from './session-list-lookup';

function session(id: string, name: string, extras: Partial<SessionListItemUi> = {}): SessionListItemUi {
  return { id, name, ...extras };
}

describe('mergeSessionsForLookup', () => {
  it('keeps the first copy when the same id appears in both lists', () => {
    const merged = mergeSessionsForLookup(
      [session('s1', 'Primary name')],
      [session('s1', 'Secondary name'), session('s2', 'Other')],
    );
    expect(merged.map((item) => ({ id: item.id, name: item.name }))).toEqual([
      { id: 's1', name: 'Primary name' },
      { id: 's2', name: 'Other' },
    ]);
  });
});

describe('collectSessionsForLookup', () => {
  it('includes general and project-folder rows that are absent from the active list', () => {
    const collected = collectSessionsForLookup({
      sessions: [session('active', 'Open project chat')],
      generalSessions: [session('general', 'Inbox')],
      projectSessionsByPath: {
        '/tmp/other': [session('other-project', 'Other project chat')],
      },
    });
    expect(collected.map((item) => item.id)).toEqual(['active', 'general', 'other-project']);
  });
});

describe('findSessionForLookup', () => {
  it('resolves a session that only lives under another project folder', () => {
    const found = findSessionForLookup('other-project', {
      sessions: [session('active', 'Open project chat')],
      generalSessions: [session('general', 'Inbox')],
      projectSessionsByPath: {
        '/tmp/other': [
          session('other-project', 'Other project chat', {
            isArchived: true,
            scope: { kind: 'project', projectPath: '/tmp/other' },
          }),
        ],
      },
    });
    expect(found?.name).toBe('Other project chat');
    expect(found?.isArchived).toBe(true);
  });
});
