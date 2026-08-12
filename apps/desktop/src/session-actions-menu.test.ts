import { describe, expect, it } from 'vitest';
import { sessionActionItems } from './session-actions-menu';

describe('sessionActionItems', () => {
  it('offers restore-from-pack instead of unarchive/delete for offloaded sessions', () => {
    const items = sessionActionItems({
      isPinned: false,
      isArchived: true,
      storageState: 'offloaded',
    });
    expect(items.map((item) => item.action)).toEqual(['restore-pack', 'rename', 'copy-id']);
  });
});
