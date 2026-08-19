import { describe, expect, it } from 'vitest';
import { sessionActionItems } from './session-actions-menu';

describe('sessionActionItems', () => {
  it('offers a non-destructive continue-in-project action for active sessions', () => {
    const items = sessionActionItems({ isPinned: false, isArchived: false });
    expect(items).toContainEqual({
      action: 'continue-in-project',
      label: 'Continue in project…',
      testId: 'session-menu-continue-in-project',
    });
  });

  it('does not offer continuation from archived sessions', () => {
    const items = sessionActionItems({ isPinned: false, isArchived: true });
    expect(items.some((item) => item.action === 'continue-in-project')).toBe(false);
  });

  it('offers restore-from-pack instead of unarchive/delete for offloaded sessions', () => {
    const items = sessionActionItems({
      isPinned: false,
      isArchived: true,
      storageState: 'offloaded',
    });
    expect(items.map((item) => item.action)).toEqual(['restore-pack', 'rename', 'copy-id']);
  });
});
