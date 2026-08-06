/**
 * Left project/session rail: brand, repositories, agent list, host status footer.
 * Handlers stay in App — this component is presentation + local open menu state only.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { HostStatusData, ProjectRecord } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { SessionTimeGroup } from './session-groups';
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  IconButton,
} from '@piwin/ui-kit';
import { projectDisplayName } from './project-display-name';
import { ProjectPickerDialog } from './project-picker-dialog';
import {
  IconArchive,
  IconBook,
  IconChat,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDocument,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMoreVertical,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSliders,
  IconTrash,
  IconUnarchive,
} from './shell-icons';
import { getDesktopCopy, type DesktopCopy, type DesktopLocale } from './desktop-locale';

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

/** Sort sessions: pinned first, then updatedAt descending (missing = newest). */
function sortByPinnedThenUpdated(list: SessionListItemUi[]): SessionListItemUi[] {
  const sorted = [...list];
  sorted.sort((left, right) => {
    const leftPinned = left.isPinned === true;
    const rightPinned = right.isPinned === true;
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    // Missing updatedAt means just-created; keep above stamped rows so new
    // Conversations entries stay at the top of the section.
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.POSITIVE_INFINITY;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.POSITIVE_INFINITY;
    const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
    return rightSafe - leftSafe;
  });
  return sorted;
}

const VISIBLE_PROJECT_LIMIT = 6;

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
  /** Whether the project section is currently folded. */
  projectsSectionCollapsed?: boolean;
  onToggleProjectsSection?: () => void;
  sessions: SessionListItemUi[];
  filteredSessions: SessionListItemUi[];
  /** General-scope sessions for the Conversations section (always visible). */
  generalSessions: SessionListItemUi[];
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
  onDeleteSession?: ((sessionId: string) => void) | undefined;
  onOpenSettings: () => void;
  knowledgeOpen?: boolean;
  onToggleKnowledge?: () => void;
  isOverlayPresentation?: boolean;
  onCloseOverlay?: () => void;
  locale?: DesktopLocale;
  /** Desktop: live sidebar width for aria + resize handle. */
  sidebarWidthPx?: number;
  isResizing?: boolean;
  onResizePointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  onResizeReset?: () => void;
  /**
   * Session IDs that currently have an active run (streaming / tool-running).
   * Sessions in this set show a right-side circular working indicator.
   */
  workingSessionIds?: Record<string, true> | undefined;
  /**
   * Session IDs that own an active backend service job. These take priority
   * over the regular working indicator and show a wave of three dots instead.
   */
  backendServiceSessionIds?: Record<string, true> | undefined;
};

function SessionActivityIndicator(props: {
  isWorking: boolean;
  hasActiveBackendService: boolean;
  workingLabel: string;
  backendServiceLabel: string;
}): ReactElement | null {
  if (props.hasActiveBackendService) {
    return (
      <span
        className="session-item-activity session-item-activity--service"
        data-testid="session-service-indicator"
        aria-label={props.backendServiceLabel}
        role="status"
      >
        <span className="session-item-activity-dot" aria-hidden />
        <span className="session-item-activity-dot" aria-hidden />
        <span className="session-item-activity-dot" aria-hidden />
      </span>
    );
  }

  if (props.isWorking) {
    return (
      <span
        className="session-item-activity session-item-activity--working"
        data-testid="session-working-indicator"
        aria-label={props.workingLabel}
        role="status"
      />
    );
  }

  return null;
}

function SessionRowItem({
  session,
  activeSessionId,
  onResumeSession,
  onOpenSessionMenu,
  workingSessionIds,
  backendServiceSessionIds,
  onTogglePin,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  copy,
}: {
  session: SessionListItemUi;
  activeSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  onOpenSessionMenu: (sessionId: string, x: number, y: number) => void;
  onTogglePin?: ((sessionId: string, currentlyPinned: boolean) => void) | undefined;
  onArchiveSession?: ((sessionId: string) => void) | undefined;
  onUnarchiveSession?: ((sessionId: string) => void) | undefined;
  onDeleteSession?: ((sessionId: string) => void) | undefined;
  copy: DesktopCopy['sidebar'];
  workingSessionIds?: Record<string, true> | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
}): ReactElement {
  const isPinned = session.isPinned === true;
  const isArchived = session.isArchived === true;
  const isActive = session.id === activeSessionId;
  const isWorking = workingSessionIds != null && session.id in workingSessionIds;
  const hasActiveBackendService =
    backendServiceSessionIds != null && session.id in backendServiceSessionIds;
  const hasActiveSessionWork = isWorking || hasActiveBackendService;

  return (
    <li
      key={session.id}
      className={hasActiveSessionWork ? 'session-row session-row--working' : 'session-row'}
    >
      <button
        type="button"
        data-testid="session-item"
        data-session-id={session.id}
        data-pinned={isPinned ? 'true' : 'false'}
        data-archived={isArchived ? 'true' : 'false'}
        className={
          isActive
            ? isWorking
              ? 'session-item active working'
              : 'session-item active'
            : isWorking
              ? 'session-item working'
              : 'session-item'
        }
        onClick={() => onResumeSession(session.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenSessionMenu(session.id, event.clientX, event.clientY);
        }}
      >
        <span className="session-item-body">
          <span className="session-item-name">
            {isArchived ? (
              <span className="session-archived-mark" aria-hidden title={copy.archived}>
                <IconDocument width={13} height={13} />
              </span>
            ) : null}
            {isPinned ? (
              <span className="session-pin-mark" aria-hidden>
                <IconPin width={12} height={12} />
              </span>
            ) : null}
            <span className="session-item-title-text">{session.name}</span>
          </span>
        </span>
        <SessionActivityIndicator
          isWorking={isWorking}
          hasActiveBackendService={hasActiveBackendService}
          workingLabel={copy.working}
          backendServiceLabel={copy.backendServiceActive}
        />
        {session.updatedAt && !isWorking && !hasActiveBackendService ? (
          <span className="session-item-time" aria-label={session.updatedAt}>
            {formatRelativeTime(session.updatedAt)}
          </span>
        ) : null}
      </button>
      <div
        className={
          isArchived ? 'session-row-actions session-row-actions--archived' : 'session-row-actions'
        }
      >
        {isArchived ? (
          <>
            <button
              type="button"
              className={
                isPinned
                  ? 'session-action-btn session-pin-btn active'
                  : 'session-action-btn session-pin-btn'
              }
              data-testid="session-pin-btn"
              title={isPinned ? copy.unpinSession : copy.pinSession}
              aria-label={isPinned ? copy.unpinSession : copy.pinSession}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin?.(session.id, isPinned);
              }}
            >
              <IconPin width={17} height={17} />
            </button>
            <button
              type="button"
              className="session-action-btn session-unarchive-btn"
              data-testid="session-unarchive-btn"
              title={copy.restoreSession}
              aria-label={copy.restoreSession}
              onClick={(event) => {
                event.stopPropagation();
                onUnarchiveSession?.(session.id);
              }}
            >
              <IconUnarchive width={17} height={17} />
            </button>
            <button
              type="button"
              className="session-action-btn session-delete-btn"
              data-testid="session-delete-btn"
              title={copy.deleteSessionPermanently}
              aria-label={copy.deleteSessionPermanently}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSession?.(session.id);
              }}
            >
              <IconTrash width={17} height={17} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="session-action-btn session-menu-btn"
              data-testid="session-menu-btn"
              title={copy.sessionActions}
              aria-label={copy.sessionActions}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenSessionMenu(session.id, rect.right - 8, rect.bottom + 4);
              }}
            >
              <IconMoreVertical width={17} height={17} />
            </button>
            <button
              type="button"
              className={
                isPinned
                  ? 'session-action-btn session-pin-btn active'
                  : 'session-action-btn session-pin-btn'
              }
              data-testid="session-pin-btn"
              title={isPinned ? copy.unpinSession : copy.pinSession}
              aria-label={isPinned ? copy.unpinSession : copy.pinSession}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin?.(session.id, isPinned);
              }}
            >
              <IconPin width={17} height={17} />
            </button>
            <button
              type="button"
              className="session-action-btn session-archive-btn"
              data-testid="session-archive-btn"
              title={copy.archived}
              aria-label={copy.archived}
              onClick={(event) => {
                event.stopPropagation();
                onArchiveSession?.(session.id);
              }}
            >
              <IconArchive width={17} height={17} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function ProjectSessionSidebar(props: ProjectSessionSidebarProps): ReactElement {
  const copy = getDesktopCopy(props.locale ?? 'zh-CN');
  const sidebarCopy = copy.sidebar;
  const [sortBy, setSortBy] = useState<'updated' | 'alphabetical'>('updated');
  const [groupBy, setGroupBy] = useState<'time' | 'none'>('time');
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [showAllProjectSessions, setShowAllProjectSessions] = useState<Record<string, boolean>>({});
  const [showAllGeneralSessions, setShowAllGeneralSessions] = useState<boolean>(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Keyboard navigation for session list (↑↓ Enter) when focus is inside the sidebar.
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') {
        return;
      }
      // Only handle when focus is inside the sidebar.
      const target = event.target;
      if (!(target instanceof Node) || !el!.contains(target)) {
        return;
      }
      // Skip if typing in an editable field.
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const items = el!.querySelectorAll<HTMLElement>('[data-session-id]');
        if (items.length === 0) return;
        const currentIndex = Array.from(items).findIndex((item) => item === document.activeElement);
        let nextIndex: number;
        if (event.key === 'ArrowDown') {
          nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        }
        items[nextIndex]?.focus();
        return;
      }

      if (event.key === 'Enter') {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.hasAttribute('data-session-id')) {
          event.preventDefault();
          active.click();
        }
      }
    }

    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, []);

  const sortedFilteredSessions = useMemo(() => {
    if (sortBy === 'alphabetical') {
      const list = [...props.filteredSessions];
      list.sort((a, b) => a.name.localeCompare(b.name));
      return list;
    }
    // 'updated' — pinned first, then updatedAt desc.
    return sortByPinnedThenUpdated(props.filteredSessions);
  }, [props.filteredSessions, sortBy]);

  const sortedGeneralSessions = useMemo(() => {
    if (sortBy === 'alphabetical') {
      const list = [...props.generalSessions];
      list.sort((a, b) => a.name.localeCompare(b.name));
      return list;
    }
    return sortByPinnedThenUpdated(props.generalSessions);
  }, [props.generalSessions, sortBy]);

  const visibleProjects = useMemo(() => {
    const activeProjectIndex = props.recentProjects.findIndex(
      (project) => project.path === props.projectPath,
    );
    if (activeProjectIndex < 0 || activeProjectIndex < VISIBLE_PROJECT_LIMIT) {
      return props.recentProjects.slice(0, VISIBLE_PROJECT_LIMIT);
    }

    const activeProject = props.recentProjects[activeProjectIndex];
    if (!activeProject) {
      return props.recentProjects.slice(0, VISIBLE_PROJECT_LIMIT);
    }

    return [
      activeProject,
      ...props.recentProjects.filter((project) => project.path !== activeProject.path),
    ].slice(0, VISIBLE_PROJECT_LIMIT);
  }, [props.projectPath, props.recentProjects]);

  const activeProject = props.projectPath
    ? props.recentProjects.find((project) => project.path === props.projectPath)
    : undefined;
  const activeProjectName =
    activeProject?.displayName ??
    (props.projectPath ? projectDisplayName(props.projectPath) : undefined);
  const projectsSectionCollapsed = props.projectsSectionCollapsed === true;
  const hasMoreProjects = props.recentProjects.length > VISIBLE_PROJECT_LIMIT;

  const showResizeHandle =
    !props.isOverlayPresentation && typeof props.onResizePointerDown === 'function';

  return (
    <aside
      className={`sidebar${props.isResizing ? ' is-resizing' : ''}`}
      ref={sidebarRef}
      aria-label={copy.workspace}
    >
      {showResizeHandle ? (
        <div
          className="sidebar-resize-handle"
          data-testid="sidebar-resize-handle"
          role="separator"
          aria-label={props.locale === 'zh-CN' ? '调整侧栏宽度' : 'Resize sidebar'}
          aria-orientation="vertical"
          aria-valuenow={props.sidebarWidthPx}
          title={
            props.locale === 'zh-CN'
              ? '拖动调整宽度，双击恢复默认'
              : 'Drag to resize. Double-click to reset.'
          }
          onPointerDown={props.onResizePointerDown}
          onDoubleClick={props.onResizeReset}
        />
      ) : null}
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
          <button
            type="button"
            className="sidebar-section-toggle"
            data-testid="projects-section-toggle"
            aria-expanded={!projectsSectionCollapsed}
            aria-label={
              projectsSectionCollapsed ? sidebarCopy.expandProjects : sidebarCopy.collapseProjects
            }
            title={
              projectsSectionCollapsed ? sidebarCopy.expandProjects : sidebarCopy.collapseProjects
            }
            onClick={() => props.onToggleProjectsSection?.()}
          >
            {projectsSectionCollapsed ? (
              <IconChevronRight width={12} height={12} aria-hidden />
            ) : (
              <IconChevronDown width={12} height={12} aria-hidden />
            )}
            <span>{sidebarCopy.projects}</span>
          </button>
          <div className="sidebar-section-label-actions">
            <span className="sidebar-section-count muted">{props.recentProjects.length}</span>

            {/* Display Options Dropdown (Sort, Group By, Filter) */}
            <DropdownMenu
              trigger={
                <IconButton
                  className="sidebar-icon-btn"
                  label={sidebarCopy.displayOptions}
                  title={sidebarCopy.displayOptions}
                  data-testid="display-options-btn"
                >
                  <IconSliders />
                </IconButton>
              }
              contentClassName="sidebar-display-menu"
              align="end"
              label={sidebarCopy.customizeSidebar}
              testId="display-options-menu"
            >
              <DropdownMenuLabel className="sidebar-display-menu-title">
                {sidebarCopy.customize}
              </DropdownMenuLabel>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger testId="display-options-ordering">
                  <span className="sidebar-display-row">
                    <span className="sidebar-display-row-label">{sidebarCopy.ordering}</span>
                    <span className="sidebar-display-row-value">
                      {sortBy === 'updated' ? sidebarCopy.updated : 'A-Z'}
                      <IconChevronRight width={12} height={12} />
                    </span>
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className="sidebar-display-submenu"
                  label={sidebarCopy.ordering}
                  testId="display-options-ordering-menu"
                >
                  <DropdownMenuItem
                    onSelect={() => setSortBy('updated')}
                    testId="display-sort-updated"
                  >
                    <span className="sidebar-display-option-label">{sidebarCopy.lastUpdated}</span>
                    {sortBy === 'updated' ? (
                      <span className="sidebar-display-check" aria-hidden>
                        <IconCheck width={13} height={13} />
                      </span>
                    ) : (
                      <span className="sidebar-display-check-spacer" aria-hidden />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setSortBy('alphabetical')}
                    testId="display-sort-alphabetical"
                  >
                    <span className="sidebar-display-option-label">{sidebarCopy.alphabetical}</span>
                    {sortBy === 'alphabetical' ? (
                      <span className="sidebar-display-check" aria-hidden>
                        <IconCheck width={13} height={13} />
                      </span>
                    ) : (
                      <span className="sidebar-display-check-spacer" aria-hidden />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger testId="display-options-group-by">
                  <span className="sidebar-display-row">
                    <span className="sidebar-display-row-label">{sidebarCopy.groupBy}</span>
                    <span className="sidebar-display-row-value">
                      {groupBy === 'time' ? sidebarCopy.dateTime : sidebarCopy.none}
                      <IconChevronRight width={12} height={12} />
                    </span>
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className="sidebar-display-submenu"
                  label={sidebarCopy.groupBy}
                  testId="display-options-group-by-menu"
                >
                  <DropdownMenuItem onSelect={() => setGroupBy('time')} testId="display-group-time">
                    <span className="sidebar-display-option-label">{sidebarCopy.dateTime}</span>
                    {groupBy === 'time' ? (
                      <span className="sidebar-display-check" aria-hidden>
                        <IconCheck width={13} height={13} />
                      </span>
                    ) : (
                      <span className="sidebar-display-check-spacer" aria-hidden />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setGroupBy('none')} testId="display-group-none">
                    <span className="sidebar-display-option-label">
                      {`${sidebarCopy.none} (${sidebarCopy.flatList})`}
                    </span>
                    {groupBy === 'none' ? (
                      <span className="sidebar-display-check" aria-hidden>
                        <IconCheck width={13} height={13} />
                      </span>
                    ) : (
                      <span className="sidebar-display-check-spacer" aria-hidden />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="sidebar-display-section-label">
                {sidebarCopy.filters}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => props.onToggleShowArchived()}
                testId="display-filter-archived"
              >
                <span className="sidebar-display-row">
                  <span className="sidebar-display-row-label">{sidebarCopy.archived}</span>
                  {props.showArchivedSessions ? (
                    <span className="sidebar-display-check" aria-hidden>
                      <IconCheck width={13} height={13} />
                    </span>
                  ) : (
                    <span className="sidebar-display-check-spacer" aria-hidden />
                  )}
                </span>
              </DropdownMenuItem>
            </DropdownMenu>

            {/* New Project / Open Workspace Dropdown */}
            <DropdownMenu
              trigger={
                <IconButton
                  className="sidebar-icon-btn"
                  label={sidebarCopy.openWorkspaceFolder}
                  data-testid="open-workspace-btn"
                  title={props.projectPath ?? sidebarCopy.openWorkspaceFolder}
                >
                  <IconFolderPlus />
                </IconButton>
              }
            >
              <DropdownMenuItem onSelect={() => props.onOpenWorkspace()}>
                <IconFolder width={14} height={14} /> {sidebarCopy.openWorkspaceFolderAction}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onSelectGeneral?.()}>
                <IconChat width={14} height={14} /> {sidebarCopy.generalChat}
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>

        {/* Project Folders list */}
        {!projectsSectionCollapsed ? (
          <div className="tree-node-list">
            {visibleProjects.map((project) => {
              const isActiveProject = project.path === props.projectPath;
              const isProjectOpen = openProjects[project.path] ?? isActiveProject;
              const displayName = project.displayName ?? projectDisplayName(project.path);
              const projectSessions = isActiveProject ? sortedFilteredSessions : [];

              const activeSessionIndex = projectSessions.findIndex(
                (s) => s.id === props.activeSessionId,
              );
              const hasActiveInHidden = activeSessionIndex >= 6;
              const isProjectExpanded = showAllProjectSessions[project.path] ?? hasActiveInHidden;
              const visibleProjectSessions = isProjectExpanded
                ? projectSessions
                : projectSessions.slice(0, 6);

              return (
                <details key={project.path} className="tree-folder-details" open={isProjectOpen}>
                  <summary
                    className={
                      isActiveProject ? 'tree-folder-summary active' : 'tree-folder-summary'
                    }
                    data-testid="repository-item"
                    data-project-path={project.path}
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenProjects((prev) => ({
                        ...prev,
                        [project.path]: !isProjectOpen,
                      }));
                      // Only open the project when expanding the folder.
                      // Collapsing should not reset the active session.
                      if (!isProjectOpen) {
                        props.onOpenProject(project.path);
                      }
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
                      title={sidebarCopy.newConversationInProject(displayName)}
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
                          workingSessionIds={props.workingSessionIds}
                          backendServiceSessionIds={props.backendServiceSessionIds}
                          onTogglePin={props.onTogglePin}
                          onArchiveSession={props.onArchiveSession}
                          onUnarchiveSession={props.onUnarchiveSession}
                          onDeleteSession={props.onDeleteSession}
                          copy={sidebarCopy}
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
                            {isProjectExpanded
                              ? sidebarCopy.showLess
                              : sidebarCopy.seeAll(projectSessions.length)}
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </details>
              );
            })}
          </div>
        ) : activeProjectName && props.projectPath ? (
          <button
            type="button"
            className="sidebar-active-project"
            data-testid="active-project-summary"
            title={props.projectPath}
            onClick={() => props.onToggleProjectsSection?.()}
          >
            <IconFolder width={15} height={15} aria-hidden />
            <span className="sidebar-active-project-name">{activeProjectName}</span>
            <IconChevronRight width={13} height={13} aria-hidden />
          </button>
        ) : null}

        {hasMoreProjects ? (
          <button
            type="button"
            className="sidebar-see-all-btn sidebar-projects-see-all-btn"
            data-testid="view-all-projects-btn"
            onClick={() => setProjectPickerOpen(true)}
          >
            {sidebarCopy.viewAllProjects(props.recentProjects.length)}
            <IconChevronRight width={13} height={13} aria-hidden />
          </button>
        ) : null}

        {/* SECTION 2: CONVERSATIONS (General / Non-Project Sessions) */}
        {(() => {
          // General sessions are maintained independently so the Conversations
          // section stays populated even when a project is active.
          const generalSessions = sortedGeneralSessions;
          const activeGeneralIndex = generalSessions.findIndex(
            (s) => s.id === props.activeSessionId,
          );
          const hasGeneralActiveInHidden = activeGeneralIndex >= 6;
          const isGeneralExpanded = showAllGeneralSessions || hasGeneralActiveInHidden;
          const visibleGeneralSessions = isGeneralExpanded
            ? generalSessions
            : generalSessions.slice(0, 6);

          return (
            <div className="sidebar-conversations-section">
              <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
                <span>{sidebarCopy.conversations}</span>
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
                        workingSessionIds={props.workingSessionIds}
                        onTogglePin={props.onTogglePin}
                        onArchiveSession={props.onArchiveSession}
                        onUnarchiveSession={props.onUnarchiveSession}
                        onDeleteSession={props.onDeleteSession}
                        copy={sidebarCopy}
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
                          {isGeneralExpanded
                            ? sidebarCopy.showLess
                            : sidebarCopy.seeAll(generalSessions.length)}
                        </button>
                      </li>
                    ) : null}
                  </>
                ) : (
                  <li className="sidebar-empty-hint muted">{sidebarCopy.noGeneralConversations}</li>
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

      <ProjectPickerDialog
        open={projectPickerOpen}
        onOpenChange={setProjectPickerOpen}
        projects={props.recentProjects}
        activeProjectPath={props.projectPath}
        onOpenProject={props.onOpenProject}
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
      />
    </aside>
  );
}
