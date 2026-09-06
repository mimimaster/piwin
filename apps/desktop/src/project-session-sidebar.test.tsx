// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    onOpenSessionSearch: () => {},
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
  it('reveals resident project sessions five at a time', () => {
    const sessions = createMockSessions(13);
    const { container } = renderSidebar({
      filteredSessions: sessions,
    });

    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(5);
    const showMore = container.querySelector<HTMLButtonElement>(
      '[data-testid="project-session-show-more"]',
    );
    expect(showMore?.textContent).toBe('Show more');
    expect(showMore?.getAttribute('aria-label')).toBe('Show 5 more sessions');

    act(() => showMore?.click());
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(10);

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="project-session-show-more"]')
        ?.click(),
    );
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(13);
    expect(container.textContent).toContain('Session Item 13');
    expect(container.querySelector('[data-testid="project-session-show-more"]')).toBeNull();
  });

  it('displays a small project list without page controls', () => {
    const sessions = createMockSessions(5);
    const { container } = renderSidebar({
      filteredSessions: sessions,
    });

    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    expect(sessionItems.length).toBe(5);
    expect(container.querySelector('[data-testid="project-session-show-more"]')).toBeNull();
  });

  it('uses Chinese sidebar labels when the display locale is zh-CN', () => {
    const { container } = renderSidebar({
      locale: 'zh-CN',
      filteredSessions: createMockSessions(6),
    });

    expect(container.textContent).toContain('项目');
    expect(container.textContent).toContain('会话');
    expect(container.querySelector('[data-testid="project-session-show-more"]')?.textContent).toBe(
      '显示更多',
    );
    expect(
      container
        .querySelector('[data-testid="project-session-show-more"]')
        ?.getAttribute('aria-label'),
    ).toBe('再显示 1 个会话');
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
    const conversationsToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="conversations-section-toggle"]',
    );

    expect(projectsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(conversationsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="repository-item"]')).not.toBeNull();

    act(() => {
      projectsToggle?.click();
    });
    expect(projectsToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="repository-item"]')).toBeNull();
    expect(conversationsToggle?.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      conversationsToggle?.click();
    });
    expect(projectsToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(conversationsToggle?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      projectsToggle?.click();
      conversationsToggle?.click();
    });
    expect(projectsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(conversationsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="repository-item"]')).not.toBeNull();
  });

  it('renders New Agent / Search as flat action rows and requests the search dialog', () => {
    const onOpenSessionSearch = vi.fn();
    const { container, root } = renderSidebar({ onOpenSessionSearch });

    const newSessionButton = container.querySelector('[data-testid="new-session-btn"]');
    expect(newSessionButton).not.toBeNull();
    expect(newSessionButton?.classList.contains('sidebar-action-row')).toBe(true);
    expect(newSessionButton?.textContent).toContain('New Agent');

    const searchButton = container.querySelector('[data-testid="session-search-btn"]');
    expect(searchButton).not.toBeNull();
    expect(searchButton?.classList.contains('sidebar-action-row')).toBe(true);
    act(() => {
      (searchButton as HTMLButtonElement).click();
    });
    expect(onOpenSessionSearch).toHaveBeenCalledOnce();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('labels general-scope creation as New Chat', () => {
    const { container, root } = renderSidebar({ generalActive: true });

    expect(container.querySelector('[data-testid="new-session-btn"]')?.textContent).toContain(
      'New Chat',
    );
    expect(
      container.querySelector('[data-testid="general-workspace-btn"]')?.getAttribute('aria-label'),
    ).toBe('New Chat');

    act(() => root.unmount());
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

  it('renders a fold toggle for every project folder', () => {
    const projects = createMockProjects(8);
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[7]?.path ?? null,
      filteredSessions: createMockSessions(1),
    });

    // Every project remains rendered; only a project's child list folds.
    expect(container.querySelectorAll('[data-testid="repository-item"]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid="project-fold-toggle"]')).toHaveLength(8);
    expect(container.querySelectorAll('.tree-folder-icon')).toHaveLength(8);
    expect(container.querySelector('[data-testid="projects-section-title"]')).not.toBeNull();
  });

  it('does not show an empty hint under an expanded project with no sessions', () => {
    const { container } = renderSidebar({
      generalSessions: createMockSessions(1),
    });

    expect(container.querySelector('[data-testid="sidebar-empty-hint"]')).toBeNull();
    expect(container.textContent).not.toContain('No general conversations');
    expect(container.querySelector('[data-testid="tree-folder-icon-open"]')).not.toBeNull();

    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="project-fold-toggle"]')?.click(),
    );
    expect(container.querySelector('[data-testid="tree-folder-icon-closed"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tree-folder-icon-open"]')).toBeNull();
  });

  it('swaps the project folder glyph between open and closed', () => {
    const { container } = renderSidebar({
      filteredSessions: createMockSessions(1),
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="project-fold-toggle"]',
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="tree-folder-icon-open"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tree-folder-icon-closed"]')).toBeNull();

    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="tree-folder-icon-closed"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tree-folder-icon-open"]')).toBeNull();
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
    const otherPath = projects[1]!.path;
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      projectSessionsByPath: {
        [otherPath]: createMockSessions(8),
      },
      generalSessions: createMockSessions(8),
    });

    // Inactive project folders start collapsed; expand to inspect their list.
    const otherProjectRow = container.querySelector<HTMLButtonElement>(
      `[data-testid="repository-item"][data-project-path="${otherPath}"]`,
    );
    act(() => otherProjectRow?.click());

    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(13);
    expect(container.querySelector('[data-testid="project-session-show-more"]')).not.toBeNull();
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

it('renders an offloaded storage badge and data attribute', () => {
  const sessions: SessionListItemUi[] = [
    {
      id: 'off-1',
      name: 'Cold chat',
      updatedAt: new Date().toISOString(),
      isArchived: true,
      storage: { state: 'offloaded', packId: 'pack-1' },
    },
  ];
  const { container } = renderSidebar({
    filteredSessions: sessions,
    showArchivedSessions: true,
  });
  const item = container.querySelector('[data-testid="session-item"]');
  expect(item?.getAttribute('data-storage')).toBe('offloaded');
  expect(container.querySelector('[data-testid="session-storage-badge"]')?.textContent).toMatch(
    /Offloaded|已卸载/,
  );
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

it('starts a project draft with the row scope and does not also open the project', () => {
  const onOpenProject = vi.fn();
  const onNewSession = vi.fn();
  const { container } = renderSidebar({ onOpenProject, onNewSession });

  act(() => {
    (container.querySelector('.tree-folder-add-btn') as HTMLButtonElement).click();
  });

  // Opening/switching is owned by handleStartNewSession; the row only names P.
  expect(onOpenProject).not.toHaveBeenCalled();
  expect(onNewSession).toHaveBeenCalledWith({
    scope: { kind: 'project', projectPath: '/Users/test/project-a' },
  });
});

it('does not spin the open session when the composer is idle', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    activeSessionId: 'session-1',
    runPhase: 'idle',
    workingSessionIds: { 'session-1': true },
  });

  expect(container.querySelector('[data-testid="session-working-indicator"]')).toBeNull();
  expect(container.querySelector('.session-item-time')).not.toBeNull();
});

it('spins the open session while its run is streaming even without a leftover map', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    activeSessionId: 'session-1',
    runPhase: 'streaming',
  });

  expect(container.querySelector('[data-testid="session-working-indicator"]')).not.toBeNull();
  expect(container.querySelector('.session-item-time')).toBeNull();
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

it('opens the overflow menu for the clicked row, not the first session', () => {
  const onOpenSessionMenu = vi.fn();
  const onArchiveSession = vi.fn();
  const sessions = createMockSessions(3);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    activeSessionId: 'session-1',
    onOpenSessionMenu,
    onArchiveSession,
  });

  const menuButtons = container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="session-menu-btn"]',
  );
  const archiveButtons = container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="session-archive-btn"]',
  );
  expect(menuButtons).toHaveLength(3);
  expect(archiveButtons).toHaveLength(3);

  act(() => {
    menuButtons[1]?.click();
    archiveButtons[2]?.click();
  });

  expect(onOpenSessionMenu).toHaveBeenCalledTimes(1);
  expect(onOpenSessionMenu).toHaveBeenCalledWith(
    'session-2',
    expect.any(Number),
    expect.any(Number),
  );
  expect(onArchiveSession).toHaveBeenCalledTimes(1);
  expect(onArchiveSession).toHaveBeenCalledWith('session-3');
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

it('shows the waiting-you ink-line node in preference to working and service indicators', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    workingSessionIds: { 'session-1': true },
    backendServiceSessionIds: { 'session-1': true },
    waitingPermissionSessionIds: { 'session-1': true },
  });

  const item = container.querySelector<HTMLButtonElement>('[data-session-id="session-1"]');
  expect(item?.getAttribute('data-waiting-permission')).toBe('true');
  const node = container.querySelector('[data-testid="ink-line-node"]');
  expect(node).not.toBeNull();
  expect(node?.getAttribute('data-kind')).toBe('waiting-you');
  expect(container.querySelector('[data-testid="session-working-indicator"]')).toBeNull();
  expect(container.querySelector('[data-testid="session-service-indicator"]')).toBeNull();
  expect(container.querySelector('.session-item-time')).toBeNull();
});

it('shows a failed marker and replaces the session timestamp', () => {
  const sessions = createMockSessions(1);
  const { container } = renderSidebar({
    filteredSessions: sessions,
    failedAttentionSessionIds: { 'session-1': true },
  });

  const item = container.querySelector<HTMLButtonElement>('[data-session-id="session-1"]');
  expect(item?.getAttribute('data-failed')).toBe('true');
  expect(container.querySelector('[data-testid="session-failed-dismiss"]')).not.toBeNull();
  expect(container.querySelector('.session-item-time')).toBeNull();
  // Mutually exclusive with the completed marker.
  expect(container.querySelector('[data-testid="session-completed-dismiss"]')).toBeNull();
});

it('dismisses the failed marker on click without opening the session', () => {
  const sessions = createMockSessions(1);
  const onResumeSession = vi.fn();
  const onDismissCompletedAttention = vi.fn();
  const { container } = renderSidebar({
    filteredSessions: sessions,
    failedAttentionSessionIds: { 'session-1': true },
    onResumeSession,
    onDismissCompletedAttention,
  });

  const dismiss = container.querySelector<HTMLButtonElement>(
    '[data-testid="session-failed-dismiss"]',
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

  it('keeps the footer fade above settings and has no Knowledge Center door', () => {
    const { container } = renderSidebar();
    expect(container.querySelector('.sidebar-footer-fade')).not.toBeNull();
    expect(container.querySelector('[data-testid="sidebar-knowledge-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-open-btn"]')).not.toBeNull();
  });

  it('keeps inactive project folders collapsed until the user expands them', () => {
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
      filteredSessions: createMockSessions(1),
      projectSessionsByPath: { [otherProjectPath]: otherSessions },
    });

    expect(container.textContent).not.toContain('Other Project Chat');
    const otherProjectRow = container.querySelector<HTMLButtonElement>(
      `[data-testid="repository-item"][data-project-path="${otherProjectPath}"]`,
    );
    expect(otherProjectRow?.getAttribute('aria-expanded')).toBe('false');

    act(() => otherProjectRow?.click());

    expect(otherProjectRow?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Other Project Chat');
  });

  it('keeps sessions for multiple projects visible after each folder is expanded', () => {
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

    for (const path of [projects[1]!.path, projects[2]!.path]) {
      const row = container.querySelector<HTMLButtonElement>(
        `[data-testid="repository-item"][data-project-path="${path}"]`,
      );
      act(() => row?.click());
    }

    const names = Array.from(container.querySelectorAll('[data-testid="session-item"]')).map(
      (el) => el.textContent ?? '',
    );
    expect(names.some((n) => n.includes('Project B Chat'))).toBe(true);
    expect(names.some((n) => n.includes('Project C Chat'))).toBe(true);
  });

  it('expands project session groups independently', () => {
    const projects = createMockProjects(2);
    const otherPath = projects[1]!.path;
    const { container } = renderSidebar({
      recentProjects: projects,
      projectPath: projects[0]?.path ?? null,
      filteredSessions: createMockSessions(8),
      projectSessionsByPath: {
        [otherPath]: createMockSessions(8).map((session) => ({
          ...session,
          id: `other-${session.id}`,
          name: `Other ${session.name}`,
        })),
      },
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          `[data-testid="repository-item"][data-project-path="${otherPath}"]`,
        )
        ?.click(),
    );

    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(10);
    const showMoreButtons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="project-session-show-more"]',
    );
    expect(showMoreButtons).toHaveLength(2);

    act(() => showMoreButtons[0]?.click());

    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(13);
    expect(container.querySelectorAll('[data-testid="project-session-show-more"]')).toHaveLength(1);
    expect(container.textContent).toContain('Session Item 8');
    expect(container.textContent).not.toContain('Other Session Item 8');
  });

  it('returns a project to five visible sessions after it is folded and reopened', () => {
    const { container } = renderSidebar({
      filteredSessions: createMockSessions(8),
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="project-session-show-more"]')
        ?.click(),
    );
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(8);

    const foldToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="project-fold-toggle"]',
    );
    act(() => foldToggle?.click());
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(0);

    act(() => foldToggle?.click());
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(5);
    expect(container.querySelector('[data-testid="project-session-show-more"]')).not.toBeNull();
  });

  it('collapses one project without hiding other expanded project sessions', () => {
    const projects = createMockProjects(2);
    const firstProjectSessions = createMockSessions(1);
    const secondPath = projects[1]!.path;
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
        [secondPath]: secondProjectSessions,
      },
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          `[data-testid="repository-item"][data-project-path="${secondPath}"]`,
        )
        ?.click(),
    );

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



describe('ProjectSessionSidebar virtualization gate', () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let geometrySpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    originalResizeObserver = window.ResizeObserver;
    class TestResizeObserver implements ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      disconnect(): void {}
      observe(target: Element): void {
        this.callback(
          [
            {
              target,
              contentRect: target.getBoundingClientRect(),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      }
      unobserve(): void {}
    }
    window.ResizeObserver = TestResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver;
    geometrySpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getTestBounds(this: HTMLElement): DOMRect {
        const isTree = this.classList.contains('sidebar-folder-tree');
        const height = isTree ? 400 : 31;
        return {
          top: 0,
          right: 280,
          bottom: height,
          left: 0,
          width: 280,
          height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('sidebar-folder-tree') ? 400 : 31;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('sidebar-folder-tree') ? 400 : 31;
      },
    });
  });

  afterEach(() => {
    geometrySpy?.mockRestore();
    geometrySpy = null;
    if (originalResizeObserver) {
      window.ResizeObserver = originalResizeObserver;
      globalThis.ResizeObserver = originalResizeObserver;
    }
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  });

  it('mounts at most 80 session rows for a 1,035-session fixture', () => {
    const sessions = createMockSessions(1_035);
    const onResume = vi.fn();
    const { container } = renderSidebar({
      filteredSessions: [],
      generalSessions: sessions,
      onResumeSession: onResume,
    });

    expect(sessions).toHaveLength(1_035);
    const mounted = container.querySelectorAll('[data-testid="session-item"]');
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThanOrEqual(80);
    expect(container.querySelector('[data-session-id="session-1035"]')).toBeNull();
    expect(container.querySelector('[data-testid="see-all-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="see-all-general-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="session-lazy-next"]')).toBeNull();
    expect(container.querySelector('.ui-spinner')).toBeNull();

    const tree = container.querySelector('.sidebar-folder-tree');
    expect(tree).not.toBeNull();
    act(() => {
      if (tree) {
        Object.defineProperty(tree, 'scrollTop', {
          configurable: true,
          value: 40_000,
          writable: true,
        });
        tree.dispatchEvent(new Event('scroll'));
      }
    });
    const far = container.querySelector<HTMLButtonElement>('[data-session-id="session-1035"]');
    expect(far).not.toBeNull();
    act(() => {
      far?.click();
    });
    expect(onResume).toHaveBeenCalledWith('session-1035');
  });

  it('activates a durable session with Enter and skips the search input', () => {
    const onResume = vi.fn();
    const { container } = renderSidebar({
      filteredSessions: createMockSessions(3),
      onResumeSession: onResume,
    });
    const first = container.querySelector<HTMLButtonElement>('[data-session-id="session-1"]');
    expect(first).not.toBeNull();
    act(() => {
      first?.focus();
      first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onResume).toHaveBeenCalledWith('session-1');

    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"], input[data-testid="session-search-input"]',
    );
    if (search) {
      act(() => {
        search.focus();
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      expect(document.activeElement).toBe(search);
    }
  });
});



describe('ProjectSessionSidebar settings prefetch', () => {
  it('wires settings intent prefetch on the settings button', () => {
    const onPrefetchSettings = vi.fn();
    const { container } = renderSidebar({ onPrefetchSettings });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="settings-open-btn"]');
    expect(button).not.toBeNull();
    const reactPropKey = Object.keys(button as HTMLButtonElement).find((key) =>
      key.startsWith('__reactProps$'),
    );
    expect(reactPropKey).toBeDefined();
    const reactProps = (button as unknown as Record<string, { onMouseEnter?: () => void }>)[
      reactPropKey as string
    ];
    expect(typeof reactProps?.onMouseEnter).toBe('function');
    act(() => {
      reactProps?.onMouseEnter?.();
    });
    expect(onPrefetchSettings).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectSessionSidebar repo grouping', () => {
  it('renders a repo group label and branch names for linked worktrees', () => {
    const now = new Date().toISOString();
    const { container } = renderSidebar({
      projectPath: '/Users/me/piwin',
      recentProjects: [
        {
          path: '/Volumes/disk/piwin-cc',
          displayName: 'piwin-cc',
          trust: 'trusted',
          lastOpenedAt: now,
          createdAt: now,
          gitRepositoryId: 'repo1',
          currentBranch: 'plan/x',
        },
        {
          path: '/Users/me/piwin',
          displayName: 'piwin',
          trust: 'trusted',
          lastOpenedAt: now,
          createdAt: now,
          gitRepositoryId: 'repo1',
          isPrimaryWorktree: true,
          currentBranch: 'main',
        },
      ],
    });
    expect(container.querySelector('[data-testid="sidebar-repo-group"]')?.textContent).toBe(
      'piwin (repo · 2 worktrees)',
    );
    const names = Array.from(container.querySelectorAll('[data-testid="repository-item"]')).map(
      (item) => item.textContent,
    );
    expect(names.some((text) => text?.includes('piwin') && text.includes('main'))).toBe(true);
    expect(names.some((text) => text?.includes('piwin-cc') && text.includes('plan/x'))).toBe(true);
  });

  it('does not nest unrelated projects under a worktree group', () => {
    const now = new Date().toISOString();
    const { container } = renderSidebar({
      projectPath: '/Users/me/piwin',
      projectSessionsByPath: {
        '/Users/me/piwin': [
          {
            id: 'piwin-session',
            name: 'Clustered session',
            updatedAt: now,
            isPinned: false,
            isArchived: false,
          },
        ],
      },
      recentProjects: [
        {
          path: '/Users/me/piwin',
          displayName: 'piwin',
          trust: 'trusted',
          lastOpenedAt: now,
          createdAt: now,
          gitRepositoryId: 'repo1',
          isPrimaryWorktree: true,
          currentBranch: 'main',
        },
        {
          path: '/Users/me/piwin-inkstone-v2',
          displayName: 'piwin-inkstone-v2',
          trust: 'trusted',
          lastOpenedAt: now,
          createdAt: now,
          gitRepositoryId: 'repo1',
          currentBranch: 'feat/inkstone-1to1',
        },
        {
          path: '/Volumes/disk/grok_reg_clean',
          displayName: 'grok_reg_clean',
          trust: 'trusted',
          lastOpenedAt: now,
          createdAt: now,
        },
        {
          path: '/Volumes/disk/planora',
          displayName: 'planora',
          trust: 'trusted',
          lastOpenedAt: now,
          createdAt: now,
          gitRepositoryId: 'repo-planora',
          isPrimaryWorktree: true,
          currentBranch: 'main',
        },
      ],
    });
    expect(container.querySelector('[data-testid="sidebar-repo-group"]')?.textContent).toBe(
      'piwin (repo · 2 worktrees)',
    );
    const folders = Array.from(container.querySelectorAll('.tree-folder-summary'));
    const groupedNames = folders
      .filter((folder) => folder.classList.contains('is-grouped'))
      .map((folder) => folder.querySelector('[data-testid="repository-item"]')?.textContent ?? '');
    const soloNames = folders
      .filter((folder) => !folder.classList.contains('is-grouped'))
      .map((folder) => folder.querySelector('[data-testid="repository-item"]')?.textContent ?? '');
    expect(groupedNames.some((text) => text.includes('piwin') && text.includes('main'))).toBe(true);
    expect(groupedNames.some((text) => text.includes('piwin-inkstone-v2'))).toBe(true);
    expect(soloNames.some((text) => text.includes('grok_reg_clean'))).toBe(true);
    expect(soloNames.some((text) => text.includes('planora'))).toBe(true);
    expect(groupedNames.some((text) => text.includes('grok_reg_clean'))).toBe(false);
    expect(groupedNames.some((text) => text.includes('planora'))).toBe(false);
    expect(
      container.querySelector('[data-session-id="piwin-session"]')?.closest('.is-grouped'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-project-path="/Volumes/disk/grok_reg_clean"]')
        ?.closest('.is-grouped'),
    ).toBeNull();
  });
});

describe('ProjectSessionSidebar Inkstone layout and grouping', () => {
  it('renders sb-top and shelf footer with library, flashcards, settings, and host status', () => {
    const onNewSession = vi.fn();
    const onOpenSessionSearch = vi.fn();
    const onOpenLibrary = vi.fn();
    const onOpenFlashcards = vi.fn();
    const onOpenSettings = vi.fn();

    const { container } = renderSidebar({
      onNewSession,
      onOpenSessionSearch,
      onOpenLibrary,
      onOpenFlashcards,
      onOpenSettings,
      hostMock: false,
      hostReady: true,
      transportLabel: '本机 Host · 8787',
    });

    expect(container.querySelector('[data-testid="sidebar-sb-top"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sidebar-shelf"]')).not.toBeNull();

    const searchBtn = container.querySelector<HTMLButtonElement>('[data-testid="session-search-btn-sb-top"]');
    expect(searchBtn).not.toBeNull();
    act(() => searchBtn?.click());
    expect(onOpenSessionSearch).toHaveBeenCalledTimes(1);

    const newBtn = container.querySelector<HTMLButtonElement>('[data-testid="new-session-btn-sb-top"]');
    expect(newBtn).not.toBeNull();
    act(() => newBtn?.click());
    expect(onNewSession).toHaveBeenCalledTimes(1);

    const libBtn = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-library-shelf-btn"]');
    expect(libBtn).not.toBeNull();
    act(() => libBtn?.click());
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);

    const cardsBtn = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-flashcards-shelf-btn"]');
    expect(cardsBtn).not.toBeNull();
    act(() => cardsBtn?.click());
    expect(onOpenFlashcards).toHaveBeenCalledTimes(1);

    const settingsBtn = container.querySelector<HTMLButtonElement>('[data-testid="settings-open-shelf-btn"]');
    expect(settingsBtn).not.toBeNull();
    act(() => settingsBtn?.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    const hostStatus = container.querySelector('[data-testid="sidebar-host-status"]');
    expect(hostStatus).not.toBeNull();
    expect(hostStatus?.textContent).toContain('本机 Host · 8787');
  });

  it('renders time group headers when sessions span multiple days', () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sessions: SessionListItemUi[] = [
      {
        id: 's-today',
        name: 'Today Chat',
        updatedAt: now.toISOString(),
        isPinned: false,
        isArchived: false,
      },
      {
        id: 's-week',
        name: 'Week Ago Chat',
        updatedAt: threeDaysAgo.toISOString(),
        isPinned: false,
        isArchived: false,
      },
    ];

    const { container } = renderSidebar({
      generalSessions: sessions,
      filteredSessions: [],
    });

    const timeGroups = container.querySelectorAll('[data-testid="sidebar-time-group"]');
    expect(timeGroups.length).toBeGreaterThan(0);
  });

  it('renders pinned section header and project subtitle for pinned project sessions', () => {
    const projectPinned = {
      id: 'proj-pin-1',
      name: 'Coding Agent Prompt Engi...',
      updatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      isPinned: true,
      isArchived: false,
    };
    const generalPinned = {
      id: 'gen-pin-1',
      name: 'Live Voice Reconnect',
      updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      isPinned: true,
      isArchived: false,
    };
    const generalNormal = {
      id: 'gen-norm-1',
      name: 'Song typeface in CJK',
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      isPinned: false,
      isArchived: false,
    };

    const { container } = renderSidebar({
      locale: 'zh-CN',
      recentProjects: [
        {
          path: '/Users/test/piwin',
          displayName: 'piwin',
          trust: 'trusted',
          lastOpenedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      projectSessionsByPath: {
        '/Users/test/piwin': [projectPinned],
      },
      generalSessions: [generalPinned, generalNormal],
      filteredSessions: [],
    });

    // Pinned section header exists with count 2
    const pinnedToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="pinned-section-toggle"]',
    );
    expect(pinnedToggle).not.toBeNull();
    expect(container.querySelector('[data-testid="pinned-section-title"]')?.textContent).toBe('置顶');
    expect(container.querySelector('[data-testid="pinned-section-count"]')?.textContent).toBe('2');

    // Project subtitle is displayed for the project session
    const projectSubtitles = container.querySelectorAll(
      '[data-testid="session-project-subtitle"]',
    );
    expect(projectSubtitles).toHaveLength(1);
    expect(projectSubtitles[0]?.textContent).toBe('piwin');

    // Clicking pinned toggle collapses the pinned sessions
    act(() => pinnedToggle?.click());
    expect(container.querySelectorAll('[data-testid="session-project-subtitle"]')).toHaveLength(0);
  });

  it('does not render pinned section when there are no pinned sessions', () => {
    const { container } = renderSidebar({
      locale: 'zh-CN',
      recentProjects: [
        {
          path: '/Users/test/piwin',
          displayName: 'piwin',
          trust: 'trusted',
          lastOpenedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      projectSessionsByPath: {
        '/Users/test/piwin': [],
      },
      generalSessions: [
        {
          id: 'gen-1',
          name: 'Regular Chat',
          updatedAt: new Date().toISOString(),
          isPinned: false,
          isArchived: false,
        },
      ],
      filteredSessions: [],
    });

    expect(container.querySelector('[data-testid="pinned-section-toggle"]')).toBeNull();
  });
});
