import type { Editor } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS } from './keybindings.js';
import { TuiGlobalKeys, type TuiGlobalKeysPort } from './tui-global-keys.js';

const CTRL_C = '\x03';
const CTRL_U = '\x15';
const ESCAPE = '\x1b';

function setup(overrides: Partial<TuiGlobalKeysPort> = {}, initial: { text?: string; autocomplete?: boolean } = {}) {
  let text = initial.text ?? '';
  const editor = {
    getText: () => text,
    setText: (next: string) => {
      text = next;
    },
    isShowingAutocomplete: () => initial.autocomplete === true,
    handleInput: vi.fn(),
  };
  const port = {
    editor: editor as unknown as Editor,
    embedded: false,
    keybindings: DEFAULT_KEYBINDINGS,
    isModalOpen: () => false,
    isRunning: () => false,
    isEditingTurn: () => false,
    cancelEditingTurn: vi.fn(),
    cancelWaitingMessages: () => false,
    abortTurn: vi.fn(),
    exit: vi.fn(),
    openSessions: vi.fn(),
    pasteClipboardImage: vi.fn(),
    cyclePermissionPreset: vi.fn(),
    openHistorySearch: vi.fn(),
    openRewind: vi.fn(),
    editInExternalEditor: vi.fn(),
    toggleToolOutput: () => true,
    hint: vi.fn(),
    ...overrides,
  };
  return { keys: new TuiGlobalKeys(port), port, editor, text: () => text };
}

describe('TuiGlobalKeys', () => {
  it('follows rebound keys and no longer answers the old ones', () => {
    const { keys, port } = setup({ keybindings: { ...DEFAULT_KEYBINDINGS, history: 'alt+r', sessions: 'f2' } });
    expect(keys.handle('\x12')).toBeUndefined();
    expect(port.openHistorySearch).not.toHaveBeenCalled();
    expect(keys.handle('\x1br')).toEqual({ consume: true });
    expect(port.openHistorySearch).toHaveBeenCalledOnce();
    expect(keys.handle('\x1bOQ')).toEqual({ consume: true });
    expect(port.openSessions).toHaveBeenCalledOnce();
  });

  it('leaves every key to an open modal', () => {
    const { keys, port } = setup({ isModalOpen: () => true });
    expect(keys.handle(CTRL_C)).toBeUndefined();
    expect(port.exit).not.toHaveBeenCalled();
  });

  it('clears typed text before it does anything else on Ctrl+C', () => {
    const { keys, port, text } = setup({ isRunning: () => true }, { text: 'draft' });
    expect(keys.handle(CTRL_C)).toEqual({ consume: true });
    expect(text()).toBe('');
    expect(port.abortTurn).not.toHaveBeenCalled();
  });

  it('aborts a running turn on Ctrl+C once the composer is empty', () => {
    const { keys, port } = setup({ isRunning: () => true });
    keys.handle(CTRL_C);
    expect(port.abortTurn).toHaveBeenCalledOnce();
  });

  it('asks for a second Ctrl+C before exiting', () => {
    const { keys, port } = setup();
    keys.handle(CTRL_C);
    expect(port.exit).not.toHaveBeenCalled();
    expect(port.hint).toHaveBeenCalledWith('再按一次 Ctrl+C 退出');
    keys.handle(CTRL_C);
    expect(port.exit).toHaveBeenCalledOnce();
  });

  it('backs out of a turn rewrite on Ctrl+C', () => {
    const { keys, port, text } = setup({ isEditingTurn: () => true }, { text: 'old prompt' });
    keys.handle(CTRL_C);
    expect(port.cancelEditingTurn).toHaveBeenCalledOnce();
    expect(text()).toBe('');
  });

  it('interrupts a running turn with Escape unless a completion list is open', () => {
    const running = setup({ isRunning: () => true });
    expect(running.keys.handle(ESCAPE)).toEqual({ consume: true });
    expect(running.port.abortTurn).toHaveBeenCalledOnce();

    const completing = setup({ isRunning: () => true }, { autocomplete: true });
    expect(completing.keys.handle(ESCAPE)).toBeUndefined();
    expect(completing.port.abortTurn).not.toHaveBeenCalled();
  });

  it('closes the completion list before Ctrl+U clears the line', () => {
    const { keys, editor } = setup({}, { text: '@bu', autocomplete: true });
    expect(keys.handle(CTRL_U)).toBeUndefined();
    expect(editor.handleInput).toHaveBeenCalledWith('\x1b');
  });

  it('opens the prompt history on Ctrl+R', () => {
    const { keys, port } = setup();
    expect(keys.handle('\x12')).toEqual({ consume: true });
    expect(port.openHistorySearch).toHaveBeenCalledOnce();
  });

  it('opens the rewind list on a second Escape, not on one', () => {
    const { keys, port } = setup();
    expect(keys.handle(ESCAPE)).toBeUndefined();
    expect(port.openRewind).not.toHaveBeenCalled();
    expect(keys.handle(ESCAPE)).toEqual({ consume: true });
    expect(port.openRewind).toHaveBeenCalledOnce();
    // The pair is spent: a third Escape starts over.
    expect(keys.handle(ESCAPE)).toBeUndefined();
    expect(port.openRewind).toHaveBeenCalledOnce();
  });

  it('does not count Escapes pressed to interrupt a run or close a list as a rewind', () => {
    const running = setup({ isRunning: () => true });
    running.keys.handle(ESCAPE);
    running.keys.handle(ESCAPE);
    expect(running.port.openRewind).not.toHaveBeenCalled();
    const completing = setup({}, { autocomplete: true });
    completing.keys.handle(ESCAPE);
    completing.keys.handle(ESCAPE);
    expect(completing.port.openRewind).not.toHaveBeenCalled();
  });

  it('opens the external editor on Ctrl+G', () => {
    const { keys, port } = setup();
    expect(keys.handle('\x07')).toEqual({ consume: true });
    expect(port.editInExternalEditor).toHaveBeenCalledOnce();
  });

  it('keeps Ctrl+S for the session picker out of an embedded pane', () => {
    const embedded = setup({ embedded: true });
    expect(embedded.keys.handle('\x13')).toBeUndefined();
    const standalone = setup();
    standalone.keys.handle('\x13');
    expect(standalone.port.openSessions).toHaveBeenCalledOnce();
  });
});
