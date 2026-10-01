import { describe, expect, it } from 'vitest';
import type { TurnChangeSummary } from '@piwin/contracts';

import { describeMobileTurnChangeState } from './turn-change-status.js';

function summary(overrides: Partial<TurnChangeSummary> = {}): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'at-1',
    sessionId: 's1',
    workspaceId: 'ws',
    userMessageId: null,
    runIds: ['r1'],
    revision: 1,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 1,
    additions: 1,
    deletions: 0,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: { allowed: true },
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: null,
    latestOperationId: null,
    ...overrides,
  };
}

describe('describeMobileTurnChangeState', () => {
  it.each([
    ['nothing to say for an undoable turn', summary(), null],
    ['undone', summary({ disposition: 'undone' }), '已撤销'],
    ['expired', summary({ captureState: 'expired' }), '撤销数据已过期'],
    ['needs repair', summary({ undo: { allowed: false, reason: 'needs-repair' } }), '需要在桌面端修复'],
    ['another client is working on it', summary({ undo: { allowed: false, reason: 'workspace-restoring' } }), '正在撤销或恢复…'],
    [
      'storage full',
      summary({ captureState: 'incomplete', coverageComplete: false, incompleteReason: 'storage-full', undo: { allowed: false, reason: 'capture-incomplete' } }),
      '撤销存储已满，未保存',
    ],
    ['incomplete', summary({ captureState: 'incomplete', coverageComplete: false, undo: { allowed: false, reason: 'capture-incomplete' } }), '记录不完整'],
  ] as const)('%s', (_label, input, expected) => {
    expect(describeMobileTurnChangeState(input)).toBe(expected);
  });

  it('is silent without a record', () => {
    expect(describeMobileTurnChangeState(undefined)).toBeNull();
  });
});
