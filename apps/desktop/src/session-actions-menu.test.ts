import { describe, expect, it } from 'vitest';
import { sessionActionItems } from './session-actions-menu';

describe('sessionActionItems', () => {
  it('offers Fork Chat next to Duplicate for active sessions', () => {
    const items = sessionActionItems({ isPinned: false, isArchived: false });
    expect(items).toContainEqual({
      action: 'fork-chat',
      label: 'Fork Chat',
      testId: 'session-menu-fork-chat',
    });
  });

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

  it('hides export, duplicate, and continue-in-project when the Host omits those commands', () => {
    const items = sessionActionItems({
      isPinned: false,
      isArchived: false,
      canExport: false,
      canDuplicate: false,
      canContinueInProject: false,
    });
    expect(items.map((item) => item.action)).toEqual([
      'pin',
      'rename',
      'copy-id',
      'fork-chat',
      'archive',
      'delete',
    ]);
  });

  it('hides Fork Chat when the Host omits session/fork', () => {
    const items = sessionActionItems({
      isPinned: false,
      isArchived: false,
      canForkChat: false,
    });
    expect(items.some((item) => item.action === 'fork-chat')).toBe(false);
  });

  it('offers Copy Transcript immediately after Copy ID', () => {
    const items = sessionActionItems({ isPinned: false, isArchived: false });
    const actions = items.map((item) => item.action);
    expect(actions.indexOf('copy-transcript')).toBe(actions.indexOf('copy-id') + 1);
  });
});
