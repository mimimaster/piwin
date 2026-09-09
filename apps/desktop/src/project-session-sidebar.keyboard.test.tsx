// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
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
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index + 1}`,
    name: `Session Item ${index + 1}`,
    updatedAt: new Date(Date.now() - index * 1000).toISOString(),
    isPinned: false,
    isArchived: false,
  }));
}

function renderSidebar(sessions: SessionListItemUi[]): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props: ProjectSessionSidebarProps = {
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
    filteredSessions: sessions,
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
    onOpenGeneral: () => {},
    onRemoveProject: () => {},
    onNewSession: () => {},
    onNewGeneralSession: () => {},
    onResumeSession: () => {},
    onOpenSessionMenu: () => {},
    onOpenSettings: () => {},
    locale: 'en',
  };
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ProjectSessionSidebar {...props} />
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('ProjectSessionSidebar keyboard navigation', () => {
  it('navigates from a focused session action within its owning row', () => {
    const { container, root } = renderSidebar(createMockSessions(3));
    const firstPin = container.querySelector<HTMLButtonElement>('[data-testid="session-pin-btn"]');
    const second = container.querySelector<HTMLButtonElement>('[data-session-id="session-2"]');
    expect(firstPin).not.toBeNull();
    expect(second).not.toBeNull();

    act(() => {
      firstPin?.focus();
      firstPin?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(document.activeElement).toBe(second);
    act(() => root.unmount());
  });
});
