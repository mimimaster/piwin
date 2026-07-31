/**
 * Left project/session rail: brand, repositories, agent list, host status footer.
 * Handlers stay in App — this component is presentation + local open menu state only.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { HostStatusData, ProjectRecord } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { SessionTimeGroup } from './session-groups';
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  IconButton,
} from '@piwin/ui-kit';
import { projectDisplayName } from './project-display-name';
import {
  IconBook,
  IconChat,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSliders,
} from './shell-icons';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

export type ProjectSessionSidebarProps = {
  projectPath: string | null;
  projectTrusted: boolean;
  /** When true, General (no project) is the active scope. */
  generalActive?: boolean;
  onSelectGeneral?: () => void;
  hostReady: boolean;
  hostMock: boolean;
  transportLabel: string;
  hostStatus: HostStatusData | null;
  recentProjects: ProjectRecord[];
  sessions: SessionListItemUi[];
  filteredSessions: SessionListItemUi[];
  sessionGroups: SessionTimeGroup<SessionListItemUi>[];
  activeSessionId: string | null;
  sessionSearch: string;
  onSessionSearchChange: (value: string) => void;
  showArchivedSessions: boolean;
  onToggleShowArchived: () => void;
  settingsOpen: boolean;
  onOpenWorkspace: () => void;
  onOpenProject: (path: string) => void;
  onNewSession: (options?: {
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  }) => void;
  /** Switch to General scope and create a new general session in one sequenced flow. */
  onNewGeneralSession: () => void;
  onResumeSession: (sessionId: string) => void;
  onOpenSessionMenu: (sessionId: string, x: number, y: number) => void;
  onOpenSettings: () => void;
  knowledgeOpen?: boolean;
  onToggleKnowledge?: () => void;
  isOverlayPresentation?: boolean;
  onCloseOverlay?: () => void;
  locale?: DesktopLocale;
};

export function ProjectSessionSidebar(props: ProjectSessionSidebarProps): ReactElement {
  const copy = getDesktopCopy(props.locale ?? 'zh-CN');
  const [sortBy, setSortBy] = useState<'updated' | 'alphabetical'>('updated');
  const [groupBy, setGroupBy] = useState<'time' | 'none'>('time');
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

  const sortedFilteredSessions = useMemo(() => {
    const list = [...props.filteredSessions];
    if (sortBy === 'alphabetical') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [props.filteredSessions, sortBy]);

  return (
    <aside className="sidebar" aria-label={copy.workspace}>
      <div className="sidebar-top">
        {props.isOverlayPresentation ? (
          <div className="sidebar-overlay-header">
            <strong>{copy.workspace}</strong>
            <Button
              variant="ghost"
              size="compact"
              data-testid="sidebar-close-btn"
              onClick={props.onCloseOverlay}
            >
              {copy.close}
            </Button>
          </div>
        ) : null}

        {/* New Agent — top priority action (Cursor-style) */}
        <button
          type="button"
          className="sidebar-new-agent"
          data-testid="new-session-btn"
          onClick={() => props.onNewSession()}
          title="New session"
          aria-label="New session"
        >
          <IconPlus />
          <span>{copy.newSession}</span>
        </button>

        {/* Search */}
        <label className="search-field">
          <IconSearch />
          <input
            value={props.sessionSearch}
            onChange={(event) => props.onSessionSearchChange(event.target.value)}
            placeholder={copy.searchSessions}
            aria-label={copy.searchSessions}
            data-testid="session-search-input"
          />
        </label>
      </div>

      {/* Unified Folder Tree (Antigravity project-conversation tree style) */}
      <div className="sidebar-folder-tree" data-testid="sessions-list">
        {/* Header Toolbar: Projects Title, Display Options, Add Project */}
        <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
          <span>Projects</span>
          <div className="sidebar-section-label-actions">
            <span className="sidebar-section-count muted">{props.recentProjects.length}</span>

            {/* Display Options Dropdown (Sort, Group By, Filter) */}
            <DropdownMenu
              trigger={
                <IconButton
                  className="sidebar-icon-btn"
                  label="Display options"
                  title="Display options"
                  data-testid="display-options-btn"
                >
                  <IconSliders />
                </IconButton>
              }
            >
              <DropdownMenuLabel className="plus-menu-caption muted">
                Sort Conversations
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setSortBy('updated')}>
                {sortBy === 'updated' ? '✓ ' : ''}Last Updated
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSortBy('alphabetical')}>
                {sortBy === 'alphabetical' ? '✓ ' : ''}Alphabetical (A-Z)
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="plus-menu-caption muted">Group By</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setGroupBy('time')}>
                {groupBy === 'time' ? '✓ ' : ''}Date / Time
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setGroupBy('none')}>
                {groupBy === 'none' ? '✓ ' : ''}None (Flat list)
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="plus-menu-caption muted">Filter</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => props.onToggleShowArchived()}>
                {props.showArchivedSessions ? '✓ Archived Sessions' : 'Active Sessions'}
              </DropdownMenuItem>
            </DropdownMenu>

            {/* New Project / Open Workspace Dropdown */}
            <DropdownMenu
              trigger={
                <IconButton
                  className="sidebar-icon-btn"
                  label="Open workspace folder"
                  data-testid="open-workspace-btn"
                  title={props.projectPath ?? 'Open workspace folder'}
                >
                  <IconFolderPlus />
                </IconButton>
              }
            >
              <DropdownMenuItem onSelect={() => props.onOpenWorkspace()}>
                <IconFolder width={14} height={14} /> Open Workspace Folder…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onSelectGeneral?.()}>
                <IconChat width={14} height={14} /> General Chat (Quick Start)
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>

        {/* Project Folders list */}
        <div className="tree-node-list">
          {props.recentProjects.map((project) => {
            const isActiveProject = project.path === props.projectPath;
            const isProjectOpen = openProjects[project.path] ?? isActiveProject;
            const displayName = project.displayName ?? projectDisplayName(project.path);
            const projectSessions = isActiveProject ? sortedFilteredSessions : [];

            return (
              <details key={project.path} className="tree-folder-details" open={isProjectOpen}>
                <summary
                  className={isActiveProject ? 'tree-folder-summary active' : 'tree-folder-summary'}
                  data-testid="repository-item"
                  data-project-path={project.path}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenProjects((prev) => ({
                      ...prev,
                      [project.path]: !isProjectOpen,
                    }));
                    props.onOpenProject(project.path);
                  }}
                  title={project.path}
                >
                  <span className="tree-folder-title">
                    {isProjectOpen ? (
                      <IconFolderOpen className="tree-folder-icon" />
                    ) : (
                      <IconFolder className="tree-folder-icon" />
                    )}
                    <span>{displayName}</span>
                  </span>
                  <button
                    type="button"
                    className="tree-folder-add-btn"
                    title={`New conversation in ${displayName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenProject(project.path);
                      props.onNewSession();
                    }}
                  >
                    <IconPlus width={12} height={12} />
                  </button>
                </summary>

                {/* Sessions under this project */}
                {isActiveProject && projectSessions.length > 0 ? (
                  <ul className="tree-session-list">
                    {projectSessions.map((session) => (
                      <li key={session.id} className="session-row">
                        <button
                          type="button"
                          data-testid="session-item"
                          data-session-id={session.id}
                          data-pinned={session.isPinned === true ? 'true' : 'false'}
                          data-archived={session.isArchived === true ? 'true' : 'false'}
                          className={
                            session.id === props.activeSessionId
                              ? 'session-item active'
                              : 'session-item'
                          }
                          onClick={() => props.onResumeSession(session.id)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            props.onOpenSessionMenu(session.id, event.clientX, event.clientY);
                          }}
                        >
                          <span
                            className={`session-status-dot${session.id === props.activeSessionId ? ' is-active' : ''}`}
                            aria-hidden
                          />
                          <span className="session-item-body">
                            <span className="session-item-name">
                              {session.isPinned === true ? (
                                <span className="session-pin-mark" aria-hidden>
                                  <IconPin width={12} height={12} />
                                </span>
                              ) : null}
                              {session.name}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="session-menu-btn"
                          data-testid="session-menu-btn"
                          title="Session actions"
                          aria-label="Session actions"
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            props.onOpenSessionMenu(session.id, rect.right - 8, rect.bottom + 4);
                          }}
                        >
                          ···
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            );
          })}
        </div>

        {/* SECTION 2: CONVERSATIONS (General / Non-Project Sessions) */}
        <div className="sidebar-conversations-section">
          <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
            <span>Conversations</span>
            <div className="sidebar-section-label-actions">
              <IconButton
                className="sidebar-icon-btn"
                label={copy.newSession}
                title={copy.newSession}
                data-testid="general-workspace-btn"
                onClick={() => props.onNewGeneralSession()}
              >
                <IconPlus width={14} height={14} />
              </IconButton>
            </div>
          </div>

          <ul className="tree-session-list conversations-list">
            {(!props.projectPath || props.generalActive) && sortedFilteredSessions.length > 0 ? (
              sortedFilteredSessions.map((session) => (
                <li key={session.id} className="session-row">
                  <button
                    type="button"
                    data-testid="session-item"
                    data-session-id={session.id}
                    data-pinned={session.isPinned === true ? 'true' : 'false'}
                    data-archived={session.isArchived === true ? 'true' : 'false'}
                    className={
                      session.id === props.activeSessionId ? 'session-item active' : 'session-item'
                    }
                    onClick={() => props.onResumeSession(session.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      props.onOpenSessionMenu(session.id, event.clientX, event.clientY);
                    }}
                  >
                    <span
                      className={`session-status-dot${session.id === props.activeSessionId ? ' is-active' : ''}`}
                      aria-hidden
                    />
                    <span className="session-item-body">
                      <span className="session-item-name">
                        {session.isPinned === true ? (
                          <span className="session-pin-mark" aria-hidden>
                            <IconPin width={12} height={12} />
                          </span>
                        ) : null}
                        {session.name}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="session-menu-btn"
                    data-testid="session-menu-btn"
                    title="Session actions"
                    aria-label="Session actions"
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      props.onOpenSessionMenu(session.id, rect.right - 8, rect.bottom + 4);
                    }}
                  >
                    ···
                  </button>
                </li>
              ))
            ) : (
              <li className="sidebar-empty-hint muted">No general conversations</li>
            )}
          </ul>
        </div>
      </div>

      <div className="sidebar-footer">
        <button
          type="button"
          className={
            props.knowledgeOpen
              ? 'sidebar-footer-button sidebar-knowledge-button active'
              : 'sidebar-footer-button sidebar-knowledge-button'
          }
          title={copy.knowledgeCenter}
          aria-label={copy.knowledgeCenter}
          aria-pressed={props.knowledgeOpen}
          data-testid="sidebar-knowledge-btn"
          onClick={props.onToggleKnowledge}
        >
          <IconBook />
          <span className="sidebar-footer-label">{copy.knowledgeCenter}</span>
        </button>
        <button
          type="button"
          className={
            props.settingsOpen
              ? 'sidebar-footer-button sidebar-settings-button active'
              : 'sidebar-footer-button sidebar-settings-button'
          }
          title={copy.settings}
          aria-label={copy.settings}
          aria-pressed={props.settingsOpen}
          data-testid="settings-open-btn"
          onClick={props.onOpenSettings}
        >
          <IconSettings />
          <span className="sidebar-footer-label">{copy.settings}</span>
        </button>
        <span className="sr-only" data-testid="agent-mode-pill">
          {props.hostMock ? 'mock' : 'live'}
        </span>
      </div>
    </aside>
  );
}
