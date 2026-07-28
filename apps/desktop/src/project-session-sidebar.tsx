/**
 * Left project/session rail: brand, repositories, agent list, host status footer.
 * Handlers stay in App — this component is presentation + local open menu state only.
 */
import type { ReactElement } from 'react';
import type { HostStatusData, ProjectRecord } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { SessionTimeGroup } from './session-groups';
import { Button, IconButton, ListRow } from '@piwin/ui-kit';
import { projectDisplayName } from './project-display-name';
import {
  IconBook,
  IconChat,
  IconFolder,
  IconFolderPlus,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
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
  onNewSession: () => void;
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

        <div className="sidebar-brand" data-testid="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            <img src="/ui/brand-mark.jpg" alt="" />
          </span>
          <strong>piwin</strong>
        </div>

        {/* New Agent — top priority action (Cursor-style) */}
        <button
          type="button"
          className="sidebar-new-agent"
          data-testid="new-session-btn"
          onClick={props.onNewSession}
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

      {/* Sessions — primary content (Agent-first) */}
      <div className="sidebar-section sidebar-sessions">
        <div className="sidebar-section-label sidebar-section-label-row">
          <span>{props.showArchivedSessions ? 'Archived' : 'Sessions'}</span>
          <div className="sidebar-section-label-actions">
            {props.projectPath ? (
              <button
                type="button"
                className={
                  props.showArchivedSessions
                    ? 'sidebar-archive-toggle active'
                    : 'sidebar-archive-toggle'
                }
                data-testid="show-archived-toggle"
                title={
                  props.showArchivedSessions ? 'Show active sessions' : 'Show archived sessions'
                }
                aria-pressed={props.showArchivedSessions}
                onClick={props.onToggleShowArchived}
              >
                {props.showArchivedSessions ? 'Active' : 'Archived'}
              </button>
            ) : null}
            {props.projectPath ? (
              <span className="sidebar-section-count muted">{props.filteredSessions.length}</span>
            ) : null}
          </div>
        </div>
        {props.filteredSessions.length === 0 ? (
          <div className="muted sessions-empty" data-testid="sessions-empty">
            {props.sessions.length === 0
              ? props.showArchivedSessions
                ? 'No archived sessions'
                : 'No sessions yet — type below or press New session.'
              : 'No matches'}
          </div>
        ) : (
          <div className="session-groups" data-testid="sessions-list">
            {props.sessionGroups.map((group) => (
              <div key={group.id} className="session-group" data-testid="session-group">
                <div className="sidebar-section-label">{group.label}</div>
                <ul className="session-list">
                  {group.sessions.map((session) => (
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
                          {session.lastPreview ? (
                            <span className="session-item-preview muted">
                              {session.lastPreview}
                            </span>
                          ) : null}
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
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Projects — secondary, collapsible */}
      <details className="sidebar-projects-details" open>
        <summary className="sidebar-section-label sidebar-section-label-row sidebar-projects-summary">
          <span>Projects</span>
          <div className="sidebar-section-label-actions">
            <span className="sidebar-section-count muted">{props.recentProjects.length}</span>
            <IconButton
              className="sidebar-icon-btn"
              label="Open workspace folder"
              data-testid="open-workspace-btn"
              title={props.projectPath ?? 'Open workspace folder'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onOpenWorkspace();
              }}
            >
              <IconFolderPlus />
            </IconButton>
          </div>
        </summary>

        {/* General chat */}
        <ListRow
          className="repository-row"
          selected={props.generalActive !== false && !props.projectPath}
          data-testid="general-workspace-btn"
          onClick={() => props.onSelectGeneral?.()}
          title="Chat without a project folder"
        >
          <IconChat />
          <span className="repository-row-copy">
            <span>General chat</span>
            <small>No project required</small>
          </span>
        </ListRow>

        {props.recentProjects.length === 0 ? (
          <button
            type="button"
            className="repository-empty-btn"
            onClick={props.onOpenWorkspace}
          >
            Open a folder to add it here.
          </button>
        ) : (
          <div className="repository-list">
            {props.recentProjects.slice(0, 8).map((project) => {
              const isActiveProject = project.path === props.projectPath;
              return (
                <ListRow
                  key={project.path}
                  className="repository-row"
                  selected={isActiveProject}
                  data-testid="repository-item"
                  data-project-path={project.path}
                  onClick={() => props.onOpenProject(project.path)}
                  title={project.path}
                >
                  <IconFolder />
                  <span className="repository-row-copy">
                    <span>{project.displayName ?? projectDisplayName(project.path)}</span>
                    <small>{project.trust === 'trusted' ? 'Trusted' : 'Untrusted'}</small>
                  </span>
                </ListRow>
              );
            })}
          </div>
        )}
      </details>

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
