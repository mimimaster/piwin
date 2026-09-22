import { describe, expect, it } from 'vitest';
import {
  allocateRightPanelInstanceId,
  insertTabAfterActive,
  isRightPanelInstanceTab,
  rightPanelTabKind,
} from './right-panel-instances';

describe('right panel instances', () => {
  it('reads the tool kind off a bare tab and an instance tab', () => {
    expect(rightPanelTabKind('browser')).toBe('browser');
    expect(rightPanelTabKind('browser-2')).toBe('browser');
    expect(rightPanelTabKind('sideChat-3')).toBe('sideChat');
    expect(rightPanelTabKind('terminal-1')).toBe('terminal');
    expect(rightPanelTabKind('nope')).toBeNull();
    expect(rightPanelTabKind('nope-2')).toBeNull();
  });

  it('allocates the bare kind first, then the next free number', () => {
    expect(allocateRightPanelInstanceId('browser', [])).toBe('browser');
    expect(allocateRightPanelInstanceId('browser', ['browser', 'files'])).toBe('browser-2');
    expect(allocateRightPanelInstanceId('browser', ['browser', 'browser-2'])).toBe('browser-3');
    expect(allocateRightPanelInstanceId('browser', ['browser-2'])).toBe('browser');
  });

  it('treats a terminal session id as a terminal instance', () => {
    expect(isRightPanelInstanceTab('terminal-4', 'terminal')).toBe(true);
    expect(isRightPanelInstanceTab('browser-2', 'terminal')).toBe(false);
  });

  it('inserts a new tab directly after the active one', () => {
    expect(insertTabAfterActive(['zsh1', 'files', 'changes'], 'zsh2', 'changes')).toEqual([
      'zsh1',
      'files',
      'changes',
      'zsh2',
    ]);
    expect(insertTabAfterActive(['browser', 'files'], 'notes', 'browser')).toEqual([
      'browser',
      'notes',
      'files',
    ]);
    expect(insertTabAfterActive(['files'], 'browser', null)).toEqual(['files', 'browser']);
    expect(insertTabAfterActive(['files', 'browser'], 'browser', 'files')).toEqual([
      'files',
      'browser',
    ]);
  });
});
