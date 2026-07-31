// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { ProjectSessionSidebar, type ProjectSessionSidebarProps } from './project-session-sidebar';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { SessionListItemUi } from './chat-reducer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createMockSessions(count: number): SessionListItemUi[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i + 1}`,
    name: `Session Item ${i + 1}`,
    updatedAt: new Date(Date.now() - i * 1000).toISOString(),
    projectPath: '/Users/test/project-a',
    isPinned: false,
    isArchived: false,
  }));
}

function renderSidebar(props: Partial<ProjectSessionSidebarProps> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: ProjectSessionSidebarProps = {
    projectPath: '/Users/test/project-a',
    projectTrusted: true,
    hostReady: true,
    hostMock: true,
    transportLabel: 'mock',
    hostStatus: null,
    recentProjects: [
      {
        path: '/Users/test/project-a',
        displayName: 'project-a',
        trust: 'trusted',
        lastOpenedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ],
    sessions: [],
    filteredSessions: [],
    generalSessions: [],
    sessionGroups: [],
    activeSessionId: null,
    sessionSearch: '',
    onSessionSearchChange: () => {},
    showArchivedSessions: false,
    onToggleShowArchived: () => {},
    settingsOpen: false,
    onOpenWorkspace: () => {},
    onOpenProject: () => {},
    onNewSession: () => {},
    onNewGeneralSession: () => {},
    onResumeSession: () => {},
    onOpenSessionMenu: () => {},
    onOpenSettings: () => {},
    ...props,
  };

  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ProjectSessionSidebar {...defaultProps} />
      </PiwinUiProvider>,
    );
  });

  return { container, root };
}

describe('ProjectSessionSidebar "See all" functionality', () => {
  it('displays at most 6 session items when sessions count > 6 and renders "See all (N)" button', () => {
    const sessions = createMockSessions(13);
    const { container } = renderSidebar({
      filteredSessions: sessions,
    });

    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    expect(sessionItems.length).toBe(6);

    const seeAllBtn = container.querySelector('[data-testid="see-all-btn"]');
    expect(seeAllBtn).not.toBeNull();
    expect(seeAllBtn?.textContent).toBe('See all (13)');
  });

  it('displays all session items when count <= 6 and hides "See all" button', () => {
    const sessions = createMockSessions(5);
    const { container } = renderSidebar({
      filteredSessions: sessions,
    });

    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    expect(sessionItems.length).toBe(5);

    const seeAllBtn = container.querySelector('[data-testid="see-all-btn"]');
    expect(seeAllBtn).toBeNull();
  });

  it('expands all items and toggles button label to "Show less" when "See all" is clicked', () => {
    const sessions = createMockSessions(10);
    const { container } = renderSidebar({
      filteredSessions: sessions,
    });

    let seeAllBtn = container.querySelector('[data-testid="see-all-btn"]') as HTMLButtonElement;
    expect(seeAllBtn).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="session-item"]').length).toBe(6);

    act(() => {
      seeAllBtn.click();
    });

    expect(container.querySelectorAll('[data-testid="session-item"]').length).toBe(10);
    seeAllBtn = container.querySelector('[data-testid="see-all-btn"]') as HTMLButtonElement;
    expect(seeAllBtn.textContent).toBe('Show less');

    act(() => {
      seeAllBtn.click();
    });

    expect(container.querySelectorAll('[data-testid="session-item"]').length).toBe(6);
  });

  it('auto-expands if active session is beyond index 5', () => {
    const sessions = createMockSessions(10);
    const { container } = renderSidebar({
      filteredSessions: sessions,
      activeSessionId: 'session-8',
    });

    expect(container.querySelectorAll('[data-testid="session-item"]').length).toBe(10);
  });
});
