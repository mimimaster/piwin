import { describe, expect, it } from 'vitest';
import { collectSessionDocuments } from './session-documents';

describe('collectSessionDocuments', () => {
  it('collects the plan, markdown path chips, active doc, and ready walkthroughs', () => {
    const items = collectSessionDocuments({
      sessionPlan: { sessionId: 'sess-1', title: 'Ship Slice 3' },
      messages: [
        { text: 'See /Users/me/.piwin/notes/readme.md and /workspace/docs/local.md' },
        { text: 'Also ~/.piwin/permissions.json stays off this rail.' },
      ],
      activeDocument: { title: 'Open note', filePath: '/tmp/open.md' },
      walkthroughsByMessageId: {
        'msg-ready': { status: 'ready' },
        'msg-pending': { status: 'pending' },
      },
    });

    expect(items).toEqual([
      {
        id: 'plans/sess-1.md',
        title: 'Ship Slice 3',
        path: 'plans/sess-1.md',
        iconKind: 'plan',
      },
      {
        id: '/Users/me/.piwin/notes/readme.md',
        title: 'readme',
        path: '/Users/me/.piwin/notes/readme.md',
        iconKind: 'doc',
      },
      {
        id: '/workspace/docs/local.md',
        title: 'local',
        path: '/workspace/docs/local.md',
        iconKind: 'doc',
      },
      {
        id: '/tmp/open.md',
        title: 'Open note',
        path: '/tmp/open.md',
        iconKind: 'doc',
      },
      {
        id: 'walkthroughs/msg-ready.md',
        title: 'Walkthrough',
        path: 'walkthroughs/msg-ready.md',
        iconKind: 'book',
      },
    ]);
  });

  it('deduplicates by path and ignores non-markdown config chips', () => {
    const items = collectSessionDocuments({
      messages: [{ text: '/Users/me/.piwin/config.json and /tmp/a.md then /tmp/a.md again' }],
      walkthroughsByMessageId: {},
    });
    expect(items.map((item) => item.path)).toEqual(['/tmp/a.md']);
  });
});
