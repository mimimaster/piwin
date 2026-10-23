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

  it('does not offer delete on live sessions; archived sessions keep permanent delete', () => {
    const live = sessionActionItems({ isPinned: false, isArchived: false });
    expect(live.some((item) => item.action === 'delete')).toBe(false);
    expect(live.some((item) => item.action === 'archive')).toBe(true);

    const archived = sessionActionItems({ isPinned: false, isArchived: true });
    expect(archived).toContainEqual({
      action: 'delete',
      label: 'Delete permanently',
      danger: true,
      testId: 'session-menu-delete',
    });
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
      'handoff',
      'archive',
    ]);
  });

  it('offers Hand off right after Fork Chat, in Chinese too', () => {
    const actions = sessionActionItems({ isPinned: false, isArchived: false }).map((item) => item.action);
    expect(actions.indexOf('handoff')).toBe(actions.indexOf('fork-chat') + 1);
    expect(sessionActionItems({ isPinned: false, isArchived: false, locale: 'zh-CN' })).toContainEqual({
      action: 'handoff',
      label: '交接到新会话',
      testId: 'session-menu-handoff',
    });
  });

  it('hides Hand off when the Host or session cannot summarize', () => {
    const items = sessionActionItems({ isPinned: false, isArchived: false, canHandoff: false });
    expect(items.some((item) => item.action === 'handoff')).toBe(false);
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

  it('localizes actions to Chinese when locale is zh-CN', () => {
    const items = sessionActionItems({ isPinned: false, isArchived: false, locale: 'zh-CN' });
    const pin = items.find((i) => i.action === 'pin');
    const fork = items.find((i) => i.action === 'fork-chat');
    const archive = items.find((i) => i.action === 'archive');
    expect(pin?.label).toBe('置顶');
    expect(fork?.label).toBe('分叉');
    expect(archive?.label).toBe('归档');
    expect(items.some((item) => item.action === 'delete')).toBe(false);
  });

  it('leads with Mark as Read only while the row shows an unread outcome', () => {
    const plain = sessionActionItems({ isPinned: false, isArchived: false });
    expect(plain.some((item) => item.action === 'dismiss-attention')).toBe(false);

    const unread = sessionActionItems({
      isPinned: false,
      isArchived: false,
      hasAttention: true,
      locale: 'zh-CN',
    });
    expect(unread[0]?.action).toBe('dismiss-attention');
    expect(unread[0]?.label).toBe('标为已读');
    expect(unread.slice(1)).toEqual(
      sessionActionItems({ isPinned: false, isArchived: false, locale: 'zh-CN' }),
    );
  });
});
