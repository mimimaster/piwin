import { describe, expect, it, vi } from 'vitest';
import { buildSessionSwipeActions, type SessionSwipeActionInput } from './swipeable-session-row';

const labels = {
  more: '更多',
  pin: '置顶',
  unpin: '取消置顶',
  archive: '归档',
  restore: '恢复',
  delete: '删除',
};

function input(overrides: Partial<SessionSwipeActionInput> = {}): SessionSwipeActionInput {
  return {
    sessionId: 's1',
    isDraft: false,
    isPinned: false,
    isArchived: false,
    labels,
    onMore: vi.fn(),
    onTogglePin: vi.fn(),
    onArchiveSession: vi.fn(),
    onUnarchiveSession: vi.fn(),
    onDeleteSession: vi.fn(),
    ...overrides,
  };
}

describe('buildSessionSwipeActions', () => {
  it('offers more, pin and archive on a live row', () => {
    const args = input();
    const actions = buildSessionSwipeActions(args);
    expect(actions.map((action) => [action.key, action.label, action.tone])).toEqual([
      ['more', '更多', 'neutral'],
      ['pin', '置顶', 'accent'],
      ['archive', '归档', 'danger'],
    ]);
    actions[1]?.onPress();
    actions[2]?.onPress();
    expect(args.onTogglePin).toHaveBeenCalledWith('s1', false);
    expect(args.onArchiveSession).toHaveBeenCalledWith('s1');
  });

  it('labels the pin action by the current state', () => {
    const args = input({ isPinned: true });
    const pin = buildSessionSwipeActions(args).find((action) => action.key === 'pin');
    expect(pin?.label).toBe('取消置顶');
    pin?.onPress();
    expect(args.onTogglePin).toHaveBeenCalledWith('s1', true);
  });

  it('offers restore and delete on an archived row', () => {
    const args = input({ isArchived: true });
    const actions = buildSessionSwipeActions(args);
    expect(actions.map((action) => action.key)).toEqual(['restore', 'delete']);
    actions[1]?.onPress();
    expect(args.onDeleteSession).toHaveBeenCalledWith('s1');
  });

  it('drops actions the caller cannot perform', () => {
    expect(
      buildSessionSwipeActions(input({ onTogglePin: undefined, onArchiveSession: undefined })).map(
        (action) => action.key,
      ),
    ).toEqual(['more']);
  });

  it('never slides a draft row', () => {
    expect(buildSessionSwipeActions(input({ isDraft: true }))).toEqual([]);
  });
});
