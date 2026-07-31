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
  IconArchive,
  IconBook,
  IconChat,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMoreVertical,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSliders,
} from './shell-icons';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (isNaN(diffMs) || diffMs < 0) return '';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}

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
  onTogglePin?: ((sessionId: string, currentlyPinned: boolean) => void) | undefined;
  onArchiveSession?: ((sessionId: string) => void) | undefined;
  onUnarchiveSession?: ((sessionId: string) => void) | undefined;
  onOpenSettings: () => void;
  knowledgeOpen?: boolean;
  onToggleKnowledge?: () => void;
  isOverlayPresentation?: boolean;
  onCloseOverlay?: () => void;
  locale?: DesktopLocale;
};

function SessionRowItem({
  session,
  activeSessionId,
  onResumeSession,
  onOpenSessionMenu,
  onTogglePin,
  onArchiveSession,
  onUnarchiveSession,
}: {
  session: SessionListItemUi;
  activeSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  onOpenSessionMenu: (sessionId: string, x: number, y: number) => void;
  onTogglePin?: ((sessionId: string, currentlyPinned: boolean) => void) | undefined;
  onArchiveSession?: ((sessionId: string) => void) | undefined;
  onUnarchiveSession?: ((sessionId: string) => void) | undefined;
}): ReactElement {
  const isPinned = session.isPinned === true;
  const isArchived = session.isArchived === true;
  const isActive = session.id === activeSessionId;

  return (
    <li key={session.id} className="session-row">
      <button
        type="button"
        data-testid="session-item"
        data-session-id={session.id}
        data-pinned={isPinned ? 'true' : 'false'}
        data-archived={isArchived ? 'true' : 'false'}
        className={isActive ? 'session-item active' : 'session-item'}
        onClick={() => onResumeSession(session.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenSessionMenu(session.id, event.clientX, event.clientY);
        }}
      >
        <span className="session-item-body">
          <span className="session-item-name">
            {isPinned ? (
              <span className="session-pin-mark" aria-hidden>
                <IconPin width={12} height={12} />
              </span>
            ) : null}
            {session.name}
          </span>
        </span>
        {session.updatedAt ? (
          <span className="session-item-time" aria-label={session.updatedAt}>
            {formatRelativeTime(session.updatedAt)}
          </span>
        ) : null}
      </button>
      <div className="session-row-actions">
        <button
          type="button"
          className="session-action-btn session-menu-btn"
          data-testid="session-menu-btn"
          title="Session actions"
          aria-label="Session actions"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenSessionMenu(session.id, rect.right - 8, rect.bottom + 4);
          }}
        >
          <IconMoreVertical width={14} height={14} />
        </button>
        <button
          type="button"
          className={isPinned ? 'session-action-btn session-pin-btn active' : 'session-action-btn session-pin-btn'}
          data-testid="session-pin-btn"
          title={isPinned ? 'Unpin session' : 'Pin session'}
          aria-label={isPinned ? 'Unpin session' : 'Pin session'}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin?.(session.id, isPinned);
          }}
        >
          <IconPin width={13} height={13} />
        </button>
        <button
          type="button"
          className={isArchived ? 'session-action-btn session-archive-btn active' : 'session-action-btn session-archive-btn'}
          data-testid="session-archive-btn"
          title={isArchived ? 'Restore session' : 'Archive session'}
          aria-label={isArchived ? 'Restore session' : 'Archive session'}
          onClick={(event) => {
            event.stopPropagation();
            if (isArchived) {
              onUnarchiveSession?.(session.id);
            } else {
              onArchiveSession?.(session.id);
            }
          }}
        >
          <IconArchive width={13} height={13} />
        </button>
      </div>
    </li>
  );
}


export function ProjectSessionSidebar(props: ProjectSessionSidebarProps): ReactElement {
  const copy = getDesktopCopy(props.locale ?? 'zh-CN');
  const [sortBy, setSortBy] = useState<'updated' | 'alphabetical'>('updated');
  const [groupBy, setGroupBy] = useState<'time' | 'none'>('time');
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [showAllProjectSessions, setShowAllProjectSessions] = useState<Record<string, boolean>>({});
  const [showAllGeneralSessions, setShowAllGeneralSessions] = useState<boolean>(false);

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

            const activeSessionIndex = projectSessions.findIndex((s) => s.id === props.activeSessionId);
            const hasActiveInHidden = activeSessionIndex >= 6;
            const isProjectExpanded = showAllProjectSessions[project.path] ?? hasActiveInHidden;
            const visibleProjectSessions = isProjectExpanded
              ? projectSessions
              : projectSessions.slice(0, 6);

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
                    {visibleProjectSessions.map((session) => (
                      <SessionRowItem
                        key={session.id}
                        session={session}
                        activeSessionId={props.activeSessionId}
                        onResumeSession={props.onResumeSession}
                        onOpenSessionMenu={props.onOpenSessionMenu}
                        onTogglePin={props.onTogglePin}
                        onArchiveSession={props.onArchiveSession}
                        onUnarchiveSession={props.onUnarchiveSession}
                      />
                    ))}
                    {projectSessions.length > 6 ? (
                      <li className="session-row see-all-row">
                        <button
                          type="button"
                          className="sidebar-see-all-btn"
                          data-testid="see-all-btn"
                          onClick={() =>
                            setShowAllProjectSessions((prev) => ({
                              ...prev,
                              [project.path]: !isProjectExpanded,
                            }))
                          }
                        >
                          {isProjectExpanded ? 'Show less' : `See all (${projectSessions.length})`}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </details>
            );
          })}
        </div>

        {/* SECTION 2: CONVERSATIONS (General / Non-Project Sessions) */}
        {(() => {
          const generalSessions = (!props.projectPath || props.generalActive) ? sortedFilteredSessions : [];
          const activeGeneralIndex = generalSessions.findIndex((s) => s.id === props.activeSessionId);
          const hasGeneralActiveInHidden = activeGeneralIndex >= 6;
          const isGeneralExpanded = showAllGeneralSessions || hasGeneralActiveInHidden;
          const visibleGeneralSessions = isGeneralExpanded
            ? generalSessions
            : generalSessions.slice(0, 6);

          return (
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
                {generalSessions.length > 0 ? (
                  <>
                    {visibleGeneralSessions.map((session) => (
                      <SessionRowItem
                        key={session.id}
                        session={session}
                        activeSessionId={props.activeSessionId}
                        onResumeSession={props.onResumeSession}
                        onOpenSessionMenu={props.onOpenSessionMenu}
                        onTogglePin={props.onTogglePin}
                        onArchiveSession={props.onArchiveSession}
                        onUnarchiveSession={props.onUnarchiveSession}
                      />
                    ))}
                    {generalSessions.length > 6 ? (
                      <li className="session-row see-all-row">
                        <button
                          type="button"
                          className="sidebar-see-all-btn"
                          data-testid="see-all-general-btn"
                          onClick={() => setShowAllGeneralSessions((prev) => !prev)}
                        >
                          {isGeneralExpanded ? 'Show less' : `See all (${generalSessions.length})`}
                        </button>
                      </li>
                    ) : null}
                  </>
                ) : (
                  <li className="sidebar-empty-hint muted">No general conversations</li>
                )}
              </ul>
            </div>
          );
        })()}
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
