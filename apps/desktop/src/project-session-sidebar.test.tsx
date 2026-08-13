// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ProjectRecord } from '@piwin/contracts';
import { ProjectSessionSidebar, type ProjectSessionSidebarProps } from './project-session-sidebar';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';

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
    onRemoveProject: () => {},
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

describe('ProjectSessionSidebar resident session lists', () => {
  it('renders the full resident project list without disclosure or lazy controls', () => {
    const sessions = createMockSessions(13);
    const { container } = renderSidebar({
      filteredSessions: sessions,
    });

    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    expect(sessionItems.length).toBe(13);
    expect(container.textContent).toContain('Session Item 13');
    expect(container.querySelector('[data-testid="project-session-pager"]')).toBeNull();
    expect(container.querySelector('.session-page-row')).toBeNull();
    expect(container.querySelector('[data-testid="see-all-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="session-lazy-next"]')).toBeNull();
    expect(container.querySelector('[data-testid="load-more-project-sessions"]')).toBeNull();
  });

  it('displays a small project list without page controls', () => {
    const sessions = createMockSessions(5);
    const { container } = renderSidebar({
      filteredSessions: sessions,
    });

    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    expect(sessionItems.length).toBe(5);
    expect(container.querySelector('[data-testid="project-session-pager"]')).toBeNull();
  });

  it('uses Chinese sidebar labels when the display locale is zh-CN', () => {
    const { container } = renderSidebar({ locale: 'zh-CN' });

    expect(container.textContent).toContain('项目');
    expect(container.textContent).toContain('会话');
    expect(
      container.querySelector('[data-testid="display-options-btn"]')?.getAttribute('aria-label'),
    ).toBe('显示选项');
  });

  it('collapses and expands the Projects and Conversations sections independently', () => {
    const projects = createMockProjects(2);
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      filteredSessions: createMockSessions(1),
      generalSessions: createMockSessions(1),
    });

    const projectsToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="projects-section-toggle"]',
    );
    const projectsContent = container.querySelector<HTMLElement>(
      '[data-testid="projects-section-content"]',
    );
    const conversationsToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="conversations-section-toggle"]',
    );
    const conversationsContent = container.querySelector<HTMLElement>(
      '[data-testid="conversations-section-content"]',
    );

    expect(projectsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(projectsContent?.hidden).toBe(false);
    expect(conversationsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(conversationsContent?.hidden).toBe(false);

    act(() => {
      projectsToggle?.click();
    });
    expect(projectsToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(projectsContent?.hidden).toBe(true);
    expect(conversationsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(conversationsContent?.hidden).toBe(false);

    act(() => {
      conversationsToggle?.click();
    });
    expect(projectsContent?.hidden).toBe(true);
    expect(conversationsToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(conversationsContent?.hidden).toBe(true);

    act(() => {
      projectsToggle?.click();
      conversationsToggle?.click();
    });
    expect(projectsContent?.hidden).toBe(false);
    expect(conversationsContent?.hidden).toBe(false);
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
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders every project without a separate all-projects row', () => {
    const projects = createMockProjects(8);
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
    });

    expect(container.querySelectorAll('[data-testid="repository-item"]')).toHaveLength(8);
    expect(container.querySelector('[data-testid="view-all-projects-btn"]')).toBeNull();
    expect(container.textContent).not.toContain('View all projects');
  });

  it('renders a fold toggle for projects that have child sessions', () => {
    const projects = createMockProjects(8);
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[7]?.path ?? null,
      filteredSessions: createMockSessions(1),
    });

    // Every project remains rendered; only a project's child list folds.
    expect(container.querySelectorAll('[data-testid="repository-item"]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid="project-fold-toggle"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="projects-section-title"]')).not.toBeNull();
  });

  it('renders the full Conversations list without See all', () => {
    const { container } = renderSidebar({
      generalSessions: createMockSessions(12),
    });

    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(12);
    expect(container.querySelector('[data-testid="see-all-general-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="general-session-pager"]')).toBeNull();
  });

  it('keeps project and General lists independently owned', () => {
    const projects = createMockProjects(2);
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      projectSessionsByPath: {
        [projects[1]!.path]: createMockSessions(8),
      },
      generalSessions: createMockSessions(8),
    });

    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(16);
    expect(container.querySelector('[data-testid="project-session-pager"]')).toBeNull();
    expect(container.querySelector('[data-testid="general-session-pager"]')).toBeNull();
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

it('renders local drafts first with a hollow mark and restores the selected draft', () => {
  const onResumeDraft = vi.fn();
  const drafts: DraftSessionItemUi[] = [
    {
      id: 'draft-old',
      name: 'Older draft',
      text: 'Older draft',
      createdAt: '2026-08-09T08:00:00.000Z',
      updatedAt: '2026-08-09T08:00:00.000Z',
      scope: { kind: 'project', projectPath: '/Users/test/project-a' },
      isDraft: true,
    },
    {
      id: 'draft-new',
      name: 'Newer draft',
      text: 'Newer draft',
      createdAt: '2026-08-09T09:00:00.000Z',
      updatedAt: '2026-08-09T09:00:00.000Z',
      scope: { kind: 'project', projectPath: '/Users/test/project-a' },
      isDraft: true,
    },
  ];
  const { container } = renderSidebar({
    filteredSessions: [
      {
        id: 'real-session',
        name: 'Durable session',
        updatedAt: '2026-08-09T10:00:00.000Z',
      },
    ],
    draftSessions: drafts,
    activeDraftId: 'draft-new',
    onResumeDraft,
  });

  const sessionItems = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="session-item"]'),
  );
  expect(sessionItems.map((item) => item.dataset.sessionId)).toEqual([
    'draft-new',
    'draft-old',
    'real-session',
  ]);
  expect(container.querySelectorAll('[data-draft="true"]')).toHaveLength(2);
  expect(container.querySelectorAll('.session-draft-mark')).toHaveLength(2);
  expect(container.querySelector('[data-session-id="draft-new"]')?.className).toContain('active');
  expect(container.querySelector('.session-row--draft .session-row-actions--draft')).not.toBeNull();

  (sessionItems[0] as HTMLButtonElement).click();
  expect(onResumeDraft).toHaveBeenCalledWith('draft-new');
});

it('passes the clicked project scope explicitly when starting a project draft', () => {
  const onOpenProject = vi.fn();
  const onNewSession = vi.fn();
  const { container } = renderSidebar({ onOpenProject, onNewSession });

  act(() => {
    (container.querySelector('.tree-folder-add-btn') as HTMLButtonElement).click();
  });

  expect(onOpenProject).toHaveBeenCalledWith('/Users/test/project-a');
  expect(onNewSession).toHaveBeenCalledWith({
    scope: { kind: 'project', projectPath: '/Users/test/project-a' },
  });
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

it('exposes the selected session as an explicit active row', () => {
  const sessions = createMockSessions(2);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    activeSessionId: 'session-1',
  });

  const selected = container.querySelector<HTMLButtonElement>('[data-session-id="session-1"]');
  const other = container.querySelector<HTMLButtonElement>('[data-session-id="session-2"]');
  expect(selected?.className).toContain('active');
  expect(selected?.getAttribute('aria-current')).toBe('page');
  expect(selected?.getAttribute('data-completed')).toBe('false');
  expect(other?.className).not.toContain('active');
  expect(other?.getAttribute('aria-current')).toBeNull();
});

it('shows a completion marker and replaces the session timestamp', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    completedAttentionSessionIds: { 'session-1': true },
  });

  const item = container.querySelector<HTMLButtonElement>('[data-session-id="session-1"]');
  expect(item?.getAttribute('data-completed')).toBe('true');
  expect(container.querySelector('[data-testid="session-completed-indicator"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="session-completed-dismiss"]')).not.toBeNull();
  expect(container.querySelector('.session-item-time')).toBeNull();
});

it('dismisses the completion marker on checkmark click without opening the session', () => {
  const sessions = createMockSessions(1);
  const onResumeSession = vi.fn();
  const onDismissCompletedAttention = vi.fn();
  const { container } = renderSidebar({
    filteredSessions: sessions,
    completedAttentionSessionIds: { 'session-1': true },
    onResumeSession,
    onDismissCompletedAttention,
  });

  const dismiss = container.querySelector<HTMLButtonElement>(
    '[data-testid="session-completed-dismiss"]',
  );
  expect(dismiss).not.toBeNull();
  act(() => {
    dismiss?.click();
  });
  expect(onDismissCompletedAttention).toHaveBeenCalledWith('session-1');
  expect(onResumeSession).not.toHaveBeenCalled();
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

describe('ProjectSessionSidebar project row behavior', () => {
  it('opens a project context menu and removes the selected project from the sidebar', () => {
    const onRemoveProject = vi.fn();
    const projects = createMockProjects(2);
    const { container } = renderSidebar({
      recentProjects: projects,
      onRemoveProject,
    });
    const projectRow = container.querySelector<HTMLElement>('[data-testid="repository-item"]');
    expect(projectRow).not.toBeNull();

    act(() => {
      projectRow?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 80,
        }),
      );
    });

    const removeItem = document.querySelector<HTMLElement>(
      '[data-testid="project-remove-from-sidebar"]',
    );
    expect(removeItem).not.toBeNull();
    act(() => {
      removeItem?.click();
    });
    expect(onRemoveProject).toHaveBeenCalledWith(projects[0]?.path);
  });

  it('folds the project when its row is clicked without switching projects', () => {
    const onOpenProject = vi.fn();
    const projects = createMockProjects(2);
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      filteredSessions: createMockSessions(1),
      onOpenProject,
    });

    const projectRow = container.querySelector<HTMLButtonElement>(
      '[data-testid="repository-item"]',
    );
    expect(projectRow).not.toBeNull();
    expect(projectRow?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(1);

    act(() => {
      projectRow?.click();
    });

    expect(projectRow?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(0);
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('shows sessions from projectSessionsByPath for every project row', () => {
    const projects = createMockProjects(2);
    const otherProjectPath = projects[1]!.path;
    const otherSessions: SessionListItemUi[] = [
      {
        id: 'other-session-1',
        name: 'Other Project Chat',
        updatedAt: new Date().toISOString(),
        isPinned: false,
        isArchived: false,
      },
    ];
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      projectSessionsByPath: { [otherProjectPath]: otherSessions },
    });

    // Project sessions are visible without a project-level fold control.
    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    const names = Array.from(sessionItems).map((el) => el.textContent ?? '');
    expect(names.some((name) => name.includes('Other Project Chat'))).toBe(true);
  });

  it('keeps sessions for multiple projects visible simultaneously', () => {
    const projects = createMockProjects(3);
    const sessionsByPath: Record<string, SessionListItemUi[]> = {
      [projects[1]!.path]: [
        {
          id: 'session-b1',
          name: 'Project B Chat',
          updatedAt: new Date().toISOString(),
          isPinned: false,
          isArchived: false,
        },
      ],
      [projects[2]!.path]: [
        {
          id: 'session-c1',
          name: 'Project C Chat',
          updatedAt: new Date().toISOString(),
          isPinned: false,
          isArchived: false,
        },
      ],
    };
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      projectSessionsByPath: sessionsByPath,
    });

    const names = Array.from(container.querySelectorAll('[data-testid="session-item"]')).map(
      (el) => el.textContent ?? '',
    );
    expect(names.some((n) => n.includes('Project B Chat'))).toBe(true);
    expect(names.some((n) => n.includes('Project C Chat'))).toBe(true);
  });

  it('collapses one project without hiding other project sessions', () => {
    const projects = createMockProjects(2);
    const firstProjectSessions = createMockSessions(1);
    const secondProjectSessions: SessionListItemUi[] = [
      {
        id: 'session-second-project',
        name: 'Second Project Chat',
        updatedAt: new Date().toISOString(),
        isPinned: false,
        isArchived: false,
      },
    ];
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      filteredSessions: firstProjectSessions,
      projectSessionsByPath: {
        [projects[1]!.path]: secondProjectSessions,
      },
    });

    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(2);
    const foldButtons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="project-fold-toggle"]',
    );
    expect(foldButtons).toHaveLength(2);

    act(() => {
      foldButtons[0]?.click();
    });

    expect(foldButtons[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(1);
    expect(container.textContent).toContain('Second Project Chat');

    act(() => {
      foldButtons[0]?.click();
    });

    expect(foldButtons[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(2);
  });
});
