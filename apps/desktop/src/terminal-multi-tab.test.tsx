// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { RightPanel } from './right-panel';
import { writeStoredRightPanelState, RIGHT_PANEL_STATE_STORAGE_KEY } from './right-panel-memory';
import type { TerminalSessionsApi, TerminalSession } from './use-terminal-sessions';
import { TerminalDock } from './terminal-dock';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createMockTerminalSessions(
  initialSessions: TerminalSession[] = [
    {
      id: 'terminal-1',
      name: 'zsh1',
      cwd: '/home',
      projectPath: '',
      status: 'open',
      error: null,
      generation: 0,
      ptyId: 'pty-1',
    },
  ],
): TerminalSessionsApi {
  let sessions = [...initialSessions];
  let activeId: string | null = sessions[0]?.id ?? null;
  let sidebarOpen = false;

  const api: TerminalSessionsApi = {
    get sessions() {
      return sessions;
    },
    get activeSessionId() {
      return activeId;
    },
    setActiveSessionId: (id) => {
      activeId = id;
    },
    get sidebarOpen() {
      return sidebarOpen;
    },
    setSidebarOpen: (action) => {
      sidebarOpen = typeof action === 'function' ? action(sidebarOpen) : action;
    },
    addSession: () => {
      const num = sessions.length + 1;
      const s: TerminalSession = {
        id: `terminal-${num}`,
        name: `zsh${num}`,
        cwd: '/home',
        projectPath: '',
        status: 'open',
        error: null,
        generation: 0,
        ptyId: `pty-${num}`,
      };
      sessions = [...sessions, s];
      activeId = s.id;
      return s;
    },
    closeSession: (id) => {
      sessions = sessions.filter((s) => s.id !== id);
      if (activeId === id) {
        activeId = sessions[sessions.length - 1]?.id ?? null;
      }
    },
    restartSession: () => {},
    onSessionStatus: () => {},
  };
  return api;
}

describe('Terminal Multi-Tab & Cursor-Style Coexistence', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    root = undefined;
    container = undefined;
    document.querySelectorAll('[data-testid="right-panel-plus-menu"]').forEach((node) => {
      node.remove();
    });
    try {
      sessionStorage.removeItem(RIGHT_PANEL_STATE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });

  it('renders multiple terminal tabs alongside file tabs without badge numbers', () => {
    writeStoredRightPanelState({
      openTabs: ['files', 'terminal-1', 'terminal-2'],
      activeTab: 'terminal-1',
    });
    const mockSessions = createMockTerminalSessions([
      {
        id: 'terminal-1',
        name: 'zsh1',
        cwd: '/home',
        projectPath: '',
        status: 'open',
        error: null,
        generation: 0,
        ptyId: 'pty-1',
      },
      {
        id: 'terminal-2',
        name: 'zsh2',
        cwd: '/home',
        projectPath: '',
        status: 'open',
        error: null,
        generation: 0,
        ptyId: 'pty-2',
      },
    ]);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="terminal-1"
            onTabChange={() => {}}
            panelWidthPx={400}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            runningJobCount={64}
            terminalSessions={mockSessions}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
          />
        </PiwinUiProvider>,
      );
    });

    // Verify tabs exist together
    const filesTab = container.querySelector('[data-testid="right-panel-open-tab-files"]');
    const term1Tab = container.querySelector('[data-testid="right-panel-open-tab-terminal-1"]');
    const term2Tab = container.querySelector('[data-testid="right-panel-open-tab-terminal-2"]');

    expect(filesTab).not.toBeNull();
    expect(term1Tab).not.toBeNull();
    expect(term2Tab).not.toBeNull();

    // Verify naming: zsh1, zsh2
    expect(term1Tab?.textContent).toContain('zsh1');
    expect(term2Tab?.textContent).toContain('zsh2');

    // Verify NO "64" badge count on terminal tabs
    expect(term1Tab?.querySelector('.right-panel-tab-badge')).toBeNull();
    expect(term2Tab?.querySelector('.right-panel-tab-badge')).toBeNull();

    // Verify top action icons are rendered when terminal is active
    expect(container.querySelector('[data-testid="pty-restart-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="terminal-sidebar-toggle"]')).not.toBeNull();
  });

  it('hides terminal action icons when switching to non-terminal tab', () => {
    writeStoredRightPanelState({
      openTabs: ['files', 'terminal-1'],
      activeTab: 'files',
    });
    const mockSessions = createMockTerminalSessions();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="files"
            onTabChange={() => {}}
            panelWidthPx={400}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            terminalSessions={mockSessions}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
          />
        </PiwinUiProvider>,
      );
    });

    // When files tab is active, terminal restart and sidebar buttons are hidden
    expect(container.querySelector('[data-testid="pty-restart-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="terminal-sidebar-toggle"]')).toBeNull();
  });

  it('has no secondary toolbar row inside TerminalDock', () => {
    const mockSessions = createMockTerminalSessions();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TerminalDock
            projectPath="/test"
            projectTrusted={true}
            ptyOutput={[]}
            onClearPtyOutput={() => {}}
            currentCwd="/test"
            onCwdChange={() => {}}
            recentDirs={[]}
            request={async () => ({ type: "response", command: "pty/open", success: true, data: {} } as any)}
            terminalSessions={mockSessions}
          />
        </PiwinUiProvider>,
      );
    });

    // Verify the secondary toolbar header is completely gone
    expect(container.querySelector('[data-testid="terminal-dock-toolbar"]')).toBeNull();
    expect(container.querySelector('.terminal-dir-switcher')).toBeNull();
  });

  it('opens another terminal tab when selecting zsh from + menu while already having a terminal open', () => {
    writeStoredRightPanelState({
      openTabs: ['terminal-1'],
      activeTab: 'terminal-1',
    });
    const mockSessions = createMockTerminalSessions();
    let currentActiveTab: string | null = 'terminal-1';

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="terminal-1"
            onTabChange={(tab) => {
              currentActiveTab = tab;
            }}
            panelWidthPx={400}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            terminalSessions={mockSessions}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
          />
        </PiwinUiProvider>,
      );
    });

    // Open the + menu via Radix pointerdown / pointerup / click sequence
    const plusButton = container.querySelector<HTMLButtonElement>('[data-testid="right-panel-tab-add"]');
    expect(plusButton).not.toBeNull();
    act(() => {
      plusButton?.dispatchEvent(
        new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      plusButton?.dispatchEvent(
        new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }),
      );
      plusButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    // Find the terminal item in the dropdown
    const terminalItem = document.querySelector<HTMLElement>('[data-testid="right-panel-plus-terminal"]');
    expect(terminalItem).not.toBeNull();
    // It should NOT say "已打开"
    expect(terminalItem?.textContent).not.toContain('已打开');

    act(() => {
      terminalItem?.click();
    });

    expect(currentActiveTab).toBe('terminal-2');
    expect(mockSessions.sessions.length).toBe(2);
  });
});
