import { describe, expect, it } from 'vitest';
import { resolveConversationPaneShortcut } from './conversation-pane-shortcuts.js';

function key(
  value: string,
  modifiers: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
  }> = {},
) {
  return {
    key: value,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...modifiers,
  };
}

describe('conversation pane shortcuts', () => {
  it('maps split, cycle, maximize, and close chords', () => {
    expect(resolveConversationPaneShortcut(key('d', { metaKey: true }))).toEqual({
      type: 'split',
      orientation: 'row',
    });
    expect(resolveConversationPaneShortcut(key('D', { metaKey: true, shiftKey: true }))).toEqual({
      type: 'split',
      orientation: 'column',
    });
    expect(resolveConversationPaneShortcut(key(']', { ctrlKey: true }))).toEqual({
      type: 'focus-adjacent',
      offset: 1,
    });
    expect(
      resolveConversationPaneShortcut(key('Enter', { metaKey: true, shiftKey: true })),
    ).toEqual({
      type: 'maximize',
    });
    expect(resolveConversationPaneShortcut(key('w', { metaKey: true, altKey: true }))).toEqual({
      type: 'close',
    });
  });

  it('keeps focus and resize directional chords distinct', () => {
    expect(
      resolveConversationPaneShortcut(key('ArrowLeft', { metaKey: true, altKey: true })),
    ).toEqual({ type: 'focus-direction', direction: 'left' });
    expect(
      resolveConversationPaneShortcut(key('ArrowLeft', { metaKey: true, ctrlKey: true })),
    ).toEqual({ type: 'resize', direction: 'left' });
    expect(
      resolveConversationPaneShortcut(
        key('ArrowDown', { ctrlKey: true, altKey: true, shiftKey: true }),
      ),
    ).toEqual({ type: 'resize', direction: 'down' });
  });

  it('does not repeat destructive split commands', () => {
    expect(resolveConversationPaneShortcut(key('d', { metaKey: true, repeat: true }))).toBeNull();
  });
});
