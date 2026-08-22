import { describe, expect, it } from 'vitest';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import {
  adjacentSiblingHead,
  clipMessagesBeforeId,
  findActiveBranchPoint,
  formatBranchSwitcherLabel,
} from './conversation-branch.js';

const point: TranscriptBranchPoint = {
  anchorMessageId: 'a1',
  activeIndex: 1,
  siblings: [
    {
      headMessageId: 'u2-a',
      preview: 'original',
      leafPreview: 'original reply',
      messageCount: 2,
      writesWorkspace: false,
      updatedAt: '2026-08-21T00:00:00.000Z',
    },
    {
      headMessageId: 'u2-b',
      preview: 'alternative',
      leafPreview: 'alternative reply',
      messageCount: 2,
      writesWorkspace: false,
      updatedAt: '2026-08-21T00:01:00.000Z',
    },
  ],
};

describe('conversation-branch helpers', () => {
  it('finds the switcher point only on the active sibling head', () => {
    expect(findActiveBranchPoint([point], 'u2-b')).toEqual(point);
    expect(findActiveBranchPoint([point], 'u2-a')).toBeUndefined();
    expect(findActiveBranchPoint([point], 'a1')).toBeUndefined();
  });

  it('walks adjacent sibling heads and labels ‹n/m› from the active index', () => {
    expect(adjacentSiblingHead(point, -1)).toBe('u2-a');
    expect(adjacentSiblingHead(point, 1)).toBeUndefined();
    expect(formatBranchSwitcherLabel(point)).toBe('2/2');
  });

  it('clips the target and everything after it', () => {
    const messages = [{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }, { id: 'a2' }];
    expect(clipMessagesBeforeId(messages, 'u2')).toEqual([{ id: 'u1' }, { id: 'a1' }]);
    expect(clipMessagesBeforeId(messages, 'missing')).toBeNull();
  });
});
