import { describe, expect, it } from 'vitest';
import type {
  SessionBranchListData,
  SessionBranchSwitchData,
  TranscriptBranchPoint,
} from './session-branches.js';

describe('session branch contracts (ADR 0055)', () => {
  it('constructs branch list data with a root fork (null anchor)', () => {
    const point: TranscriptBranchPoint = {
      anchorMessageId: null,
      activeIndex: 1,
      siblings: [
        {
          headMessageId: 'root-a',
          preview: 'original opening',
          leafPreview: 'original ending',
          messageCount: 4,
          writesWorkspace: true,
          updatedAt: '2026-08-21T00:00:00.000Z',
        },
        {
          headMessageId: 'root-b',
          preview: 'fresh start',
          leafPreview: 'fresh start',
          messageCount: 1,
          writesWorkspace: false,
          updatedAt: '2026-08-21T00:01:00.000Z',
        },
      ],
    };
    const data: SessionBranchListData = {
      sessionId: 's1',
      revision: 'rev-token',
      branchPoints: [point],
    };
    expect(data.branchPoints[0]?.siblings).toHaveLength(2);
  });

  it('constructs every branch switch outcome', () => {
    const switched: SessionBranchSwitchData = {
      status: 'switched',
      sessionId: 's1',
      activeLeafMessageId: 'm-leaf',
      session: {
        id: 's1',
        name: 'Session',
        scope: { kind: 'general' },
        workingDirectory: '/tmp/project',
        projectPath: '',
        updatedAt: '2026-08-21T00:00:00.000Z',
        messageCount: 4,
      },
    };
    const needsConfirmation: SessionBranchSwitchData = {
      status: 'needs-confirmation',
      offPathWrites: { files: ['src/app.ts'], hasUnknownWrites: false },
    };
    const runActive: SessionBranchSwitchData = { status: 'run-active' };
    expect(switched.status).toBe('switched');
    expect(needsConfirmation.status).toBe('needs-confirmation');
    expect(runActive.status).toBe('run-active');
  });
});
