// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ProjectRecord } from '@piwin/contracts';
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
    isPinned: false,
    isArchived: false,
  }));
}

function createMockProjects(count: number): ProjectRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/Users/test/project-${index + 1}`,
    displayName: `project-${index + 1}`,
    trust: 'trusted' as const,
    lastOpenedAt: new Date(Date.now() - index * 1000).toISOString(),
    createdAt: new Date(Date.now() - index * 1000).toISOString(),
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
    locale: 'en',
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

  it('uses Chinese sidebar labels when the display locale is zh-CN', () => {
    const { container } = renderSidebar({ locale: 'zh-CN' });

    expect(container.textContent).toContain('项目');
    expect(container.textContent).toContain('会话');
    expect(
      container.querySelector('[data-testid="display-options-btn"]')?.getAttribute('aria-label'),
    ).toBe('显示选项');
  });

  it('renders New Agent / Search as flat action rows and expands search on click', () => {
    const { container, root } = renderSidebar();

    const newSessionButton = container.querySelector('[data-testid="new-session-btn"]');
    expect(newSessionButton).not.toBeNull();
    expect(newSessionButton?.classList.contains('sidebar-action-row')).toBe(true);
    expect(newSessionButton?.textContent).toContain('New Agent');

    const searchButton = container.querySelector('[data-testid="session-search-btn"]');
    expect(searchButton).not.toBeNull();
    expect(searchButton?.classList.contains('sidebar-action-row')).toBe(true);
    expect(container.querySelector('[data-testid="session-search-input"]')).toBeNull();

    act(() => {
      (searchButton as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-testid="session-search-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="session-search-btn"]')).toBeNull();
    root.unmount();
    container.remove();
  });

  it('limits the visible project rows and opens the searchable all-projects picker', () => {
    const projects = createMockProjects(8);
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
    });

    expect(container.querySelectorAll('[data-testid="repository-item"]')).toHaveLength(6);
    const viewAllButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="view-all-projects-btn"]',
    );
    expect(viewAllButton?.textContent).toContain('View all projects (8)');

    act(() => {
      viewAllButton?.click();
    });

    expect(document.querySelector('[data-testid="project-picker-dialog"]')).not.toBeNull();
    expect(document.querySelectorAll('.project-picker-item')).toHaveLength(8);

    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="project-picker-close-btn"]')
        ?.click();
    });
  });

  it('keeps the active project visible when the project section is folded', () => {
    const projects = createMockProjects(8);
    let toggled = false;
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[7]?.path ?? null,
      projectsSectionCollapsed: true,
      onToggleProjectsSection: () => {
        toggled = true;
      },
    });

    expect(container.querySelectorAll('[data-testid="repository-item"]')).toHaveLength(0);
    expect(
      container.querySelector('[data-testid="active-project-summary"]')?.textContent,
    ).toContain('project-8');
    expect(
      container
        .querySelector('[data-testid="projects-section-toggle"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="projects-section-toggle"]')
        ?.click();
    });
    expect(toggled).toBe(true);
  });
});

it('renders archived session rows with archived mark and data attribute', () => {
  const sessions: SessionListItemUi[] = [
    {
      id: 'archived-1',
      name: 'Old chat',
      updatedAt: new Date().toISOString(),
      isPinned: false,
      isArchived: true,
    },
  ];
  const { container } = renderSidebar({
    filteredSessions: sessions,
    showArchivedSessions: true,
  });

  const item = container.querySelector('[data-testid="session-item"]');
  expect(item).not.toBeNull();
  expect(item?.getAttribute('data-archived')).toBe('true');
  expect(container.querySelector('.session-archived-mark')).not.toBeNull();
});

it('renders a circular indicator for a working session instead of its timestamp', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    workingSessionIds: { 'session-1': true },
  });

  expect(container.querySelector('[data-testid="session-working-indicator"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-service-indicator"]')).toBeNull();
  expect(container.querySelector('.session-item-time')).toBeNull();
  // The action group remains mounted so CSS can swap it in on hover/focus.
  expect(container.querySelector('.session-row-actions')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-menu-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-pin-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-archive-btn"]')).not.toBeNull();
});

it('keeps the three session actions available when the session is idle', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({ filteredSessions: sessions });

  expect(container.querySelector('[data-testid="session-menu-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-pin-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-archive-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-working-indicator"]')).toBeNull();
});

it('renders the three-dot service indicator in preference to the working spinner', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    workingSessionIds: { 'session-1': true },
    backendServiceSessionIds: { 'session-1': true },
  });

  const serviceIndicator = container.querySelector('[data-testid="session-service-indicator"]');
  expect(serviceIndicator).not.toBeNull();
  expect(serviceIndicator?.querySelectorAll('.session-item-activity-dot')).toHaveLength(3);
  expect(container.querySelector('[data-testid="session-working-indicator"]')).toBeNull();
  expect(container.querySelector('.session-item-time')).toBeNull();
  expect(container.querySelector('.session-row-actions')).not.toBeNull();
});

it('archived row shows pin, unarchive, and delete actions', () => {
  const sessions: SessionListItemUi[] = [
    {
      id: 'archived-2',
      name: 'Archived chat',
      updatedAt: new Date().toISOString(),
      isPinned: false,
      isArchived: true,
    },
  ];
  const { container } = renderSidebar({
    filteredSessions: sessions,
    showArchivedSessions: true,
  });

  expect(container.querySelector('[data-testid="session-pin-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-unarchive-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-delete-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-menu-btn"]')).toBeNull();
  expect(container.querySelector('[data-testid="session-archive-btn"]')).toBeNull();
});

it('opens customize menu with ordering, group by, and archived filter', () => {
  let toggledArchived = false;
  const { container } = renderSidebar({
    onToggleShowArchived: () => {
      toggledArchived = true;
    },
  });

  const displayOptionsButton = container.querySelector<HTMLButtonElement>(
    '[data-testid="display-options-btn"]',
  );
  expect(displayOptionsButton).not.toBeNull();

  act(() => {
    // Radix DropdownMenu.Trigger opens on pointerdown, not a bare click.
    displayOptionsButton?.dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
    );
    displayOptionsButton?.dispatchEvent(
      new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }),
    );
    displayOptionsButton?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  });

  // Portaled menu content lives under document.body.
  expect(document.querySelector('[data-testid="display-options-menu"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="display-options-ordering"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="display-options-group-by"]')).not.toBeNull();

  const archivedFilter = document.querySelector<HTMLElement>(
    '[data-testid="display-filter-archived"]',
  );
  expect(archivedFilter).not.toBeNull();
  act(() => {
    archivedFilter?.click();
  });
  expect(toggledArchived).toBe(true);
});
