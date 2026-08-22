import { describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_COMMAND_OPEN_TAB,
  runDesktopCommand,
  type RunDesktopCommandDeps,
} from './run-desktop-command.js';

function createDeps(overrides: Partial<RunDesktopCommandDeps> = {}): RunDesktopCommandDeps {
  return {
    onNewSession: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onStopRun: vi.fn(),
    openSessions: vi.fn(),
    focusSessionSearch: vi.fn(),
    focusComposer: vi.fn(),
    openSettings: vi.fn(),
    toggleSessions: vi.fn(),
    toggleInspector: vi.fn(),
    openInspector: vi.fn(),
    schedule: (task) => task(),
    ...overrides,
  };
}

describe('runDesktopCommand', () => {
  it('opens sessions then focuses the conversation search', () => {
    const deps = createDeps();
    runDesktopCommand('search-sessions', deps);
    expect(deps.openSessions).toHaveBeenCalledOnce();
    expect(deps.focusSessionSearch).toHaveBeenCalledOnce();
  });

  it('toggles the inspector on files, and the right panel with a null tab', () => {
    const deps = createDeps();
    runDesktopCommand('toggle-inspector', deps);
    runDesktopCommand('toggle-right-panel', deps);
    expect(deps.toggleInspector).toHaveBeenNthCalledWith(1, 'files');
    expect(deps.toggleInspector).toHaveBeenNthCalledWith(2, null);
  });

  it('maps numbered tab commands onto inspector tabs', () => {
    const deps = createDeps();
    for (const [commandId, tab] of Object.entries(DESKTOP_COMMAND_OPEN_TAB)) {
      runDesktopCommand(commandId as keyof typeof DESKTOP_COMMAND_OPEN_TAB, deps);
      expect(deps.openInspector).toHaveBeenCalledWith(tab);
    }
  });

  it('ignores the palette command itself', () => {
    const deps = createDeps();
    runDesktopCommand('palette', deps);
    expect(deps.openInspector).not.toHaveBeenCalled();
    expect(deps.openSettings).not.toHaveBeenCalled();
  });
});
