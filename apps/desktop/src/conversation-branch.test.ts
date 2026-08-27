import { describe, expect, it } from 'vitest';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import {
  adjacentSiblingHead,
  clipMessagesAfterId,
  clipMessagesBeforeId,
  countConversationTreeBranches,
  findActiveBranchPoint,
  formatBranchSwitcherLabel,
  isUnchangedCurrentTurnResend,
  turnContentUnchanged,
} from './conversation-branch.js';

const point: TranscriptBranchPoint = {
  anchorMessageId: 'a1',
  activeIndex: 1,
  siblings: [
    {
      headMessageId: 'u2-a',
      role: 'user',
      preview: 'original',
      leafPreview: 'original reply',
      messageCount: 2,
      writesWorkspace: false,
      updatedAt: '2026-08-21T00:00:00.000Z',
    },
    {
      headMessageId: 'u2-b',
      role: 'user',
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

  it('counts extra in-session siblings, not related Fork Chat sessions', () => {
    expect(countConversationTreeBranches([])).toBe(0);
    expect(countConversationTreeBranches([point])).toBe(1);
    expect(
      countConversationTreeBranches([
        point,
        {
          ...point,
          anchorMessageId: 'root',
          siblings: [...point.siblings, { ...point.siblings[0]!, headMessageId: 'u2-c' }],
        },
      ]),
    ).toBe(3);
  });

  it('does not count answer versions in the header badge', () => {
    expect(
      countConversationTreeBranches([
        {
          ...point,
          siblings: point.siblings.map((sibling, index) => ({
            ...sibling,
            headMessageId: `a${String(index + 1)}`,
            role: 'assistant' as const,
          })),
        },
      ]),
    ).toBe(0);
  });

  it('clips after the target, keeping that row', () => {
    const messages = [{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }, { id: 'a2' }];
    expect(clipMessagesAfterId(messages, 'u2')).toEqual([{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }]);
    expect(clipMessagesAfterId(messages, 'missing')).toBeNull();
  });

  it('treats unchanged turn content as a retry', () => {
    const original = {
      text: ' ask once ',
      attachments: [{ id: 'img-1' }],
      contextRefs: [{ kind: 'selection' as const, snapshotText: 'quoted', label: 'quoted' }],
    };
    expect(turnContentUnchanged(original, { text: 'ask once' })).toBe(true);
    expect(turnContentUnchanged(original, { text: 'ask twice' })).toBe(false);
    expect(
      turnContentUnchanged(original, { text: 'ask once', attachments: [{ id: 'img-2' }] }),
    ).toBe(false);
  });

  it('retries only an unchanged resend of the current user turn', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user' as const,
        text: 'first',
        attachments: [] as { id: string }[],
      },
      { id: 'a1', role: 'assistant' as const, text: 'ok', attachments: [] },
      { id: 'u2', role: 'user' as const, text: 'second', attachments: [] },
    ];
    expect(isUnchangedCurrentTurnResend(messages, 'u2', { text: 'second' })).toBe(true);
    expect(isUnchangedCurrentTurnResend(messages, 'u2', { text: 'changed' })).toBe(false);
    expect(isUnchangedCurrentTurnResend(messages, 'u1', { text: 'first' })).toBe(false);
  });
});
