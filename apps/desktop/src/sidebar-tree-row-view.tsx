/**
 * Presentation component for single sidebar tree rows:
 * - Section headers (pinned, projects, conversations)
 * - Repository groups & project folders
 * - Session items (including pinned with project subtitles)
 * - Hints & show more rows
 */
import type { ReactElement } from 'react';
import type {
  ProjectRecord,
  SessionListOrder,
  SessionScope,
} from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { DesktopCopy, DesktopLocale } from './desktop-locale';
import type { SessionRowRunPhase } from './session-row-working';
import { resolveProjectFolderSessions, type SidebarTreeRow } from './sidebar-tree-rows';
import { projectDisplayName } from './project-display-name';
import { SessionRowItem } from './session-row-item';
import {
  ContextMenu,
  ContextMenuItem,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  IconButton,
} from '@piwin/ui-kit';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconListFilter,
  IconPlus,
  IconTrash,
} from './shell-icons';

export type SidebarTreeRowViewProps = {
  row: SidebarTreeRow;
  locale?: DesktopLocale | undefined;
  sidebarCopy: DesktopCopy['sidebar'];
  // Pinned state & count
  pinnedSectionExpanded: boolean;
  onTogglePinnedSection: () => void;
  pinnedCount: number;
  // Projects state
  projectsSectionExpanded: boolean;
  onToggleProjectsSection: () => void;
  recentProjectsCount: number;
  recentProjects: ProjectRecord[];
  projectPath: string | null;
  filteredSessions: SessionListItemUi[];
  projectSessionsByPath?: Record<string, SessionListItemUi[]> | undefined;
  collapsedProjects: Record<string, boolean>;
  onToggleProjectCollapsed: (projectPath: string, nextCollapsed: boolean) => void;
  onRemoveProject?: ((path: string) => void) | undefined;
  onNewSession: (options?: {
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  }) => void;
  onOpenWorkspace?: (() => void) | undefined;
  sortBy: SessionListOrder;
  onChangeSortBy: (order: SessionListOrder) => void;
  groupBy: 'time' | 'none';
  onChangeGroupBy: (group: 'time' | 'none') => void;
  showArchivedSessions: boolean;
  onToggleShowArchived: () => void;
  // Conversations state
  conversationsSectionExpanded: boolean;
  onToggleConversationsSection: () => void;
  generalSessionsCount: number;
  newConversationLabel: string;
  onNewGeneralSession: () => void;
  // Session actions
  activeSessionId: string | null;
  activeDraftId?: string | null | undefined;
  sessionMenu?: { sessionId: string; x: number; y: number } | null | undefined;
  onResumeSession: (sessionId: string) => void;
  onOpenSessionMenu: (sessionId: string, x: number, y: number) => void;
  onTogglePin?: ((sessionId: string, currentlyPinned: boolean) => void) | undefined;
  onArchiveSession?: ((sessionId: string) => void) | undefined;
  onUnarchiveSession?: ((sessionId: string) => void) | undefined;
  onDeleteSession?: ((sessionId: string) => void) | undefined;
  onResumeDraft?: ((draftId: string) => void) | undefined;
  workingSessionIds?: Record<string, true> | undefined;
  runPhase?: SessionRowRunPhase | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
  completedAttentionSessionIds?: Record<string, true> | undefined;
  failedAttentionSessionIds?: Record<string, true> | undefined;
  waitingPermissionSessionIds?: Record<string, true> | undefined;
  onDismissCompletedAttention?: ((sessionId: string) => void) | undefined;
  // Show more & retry
  onShowMoreSessions: (projectPath: string, batchSize: number, nextCount: number) => void;
  onRetrySessionList?: ((scope: SessionScope) => void) | undefined;
  showMoreAriaLabel: (batchSize: number) => string;
  showMoreText: string;
};

export function SidebarTreeRowView(props: SidebarTreeRowViewProps): ReactElement | null {
  const { row, sidebarCopy } = props;

  if (row.kind === 'section-header' && row.sectionId === 'pinned') {
    return (
      <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
        <button
          type="button"
          className="sidebar-section-toggle"
          data-testid="pinned-section-toggle"
          aria-expanded={props.pinnedSectionExpanded}
          aria-controls="pinned-section-content"
          aria-label={
            props.pinnedSectionExpanded
              ? sidebarCopy.collapsePinned
              : sidebarCopy.expandPinned
          }
          title={
            props.pinnedSectionExpanded
              ? sidebarCopy.collapsePinned
              : sidebarCopy.expandPinned
          }
          onClick={props.onTogglePinnedSection}
        >
          <span className="sidebar-section-title" data-testid="pinned-section-title">
            {sidebarCopy.pinned}
          </span>
          <IconChevronDown className="sidebar-section-chevron" width={15} height={15} />
        </button>
        <div className="sidebar-section-label-actions">
          <span className="sidebar-section-count muted" data-testid="pinned-section-count">
            {props.pinnedCount}
          </span>
        </div>
      </div>
    );
  }

  if (row.kind === 'section-header' && row.sectionId === 'projects') {
    return (
      <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
        <button
          type="button"
          className="sidebar-section-toggle"
          data-testid="projects-section-toggle"
          aria-expanded={props.projectsSectionExpanded}
          aria-controls="projects-section-content"
          aria-label={
            props.projectsSectionExpanded ? sidebarCopy.collapseProjects : sidebarCopy.expandProjects
          }
          title={
            props.projectsSectionExpanded ? sidebarCopy.collapseProjects : sidebarCopy.expandProjects
          }
          onClick={props.onToggleProjectsSection}
        >
          <span className="sidebar-section-title" data-testid="projects-section-title">
            {sidebarCopy.projects}
          </span>
          <IconChevronDown className="sidebar-section-chevron" width={15} height={15} />
        </button>
        <div className="sidebar-section-label-actions">
          <span className="sidebar-section-count muted">{props.recentProjectsCount}</span>
          <DropdownMenu
            trigger={
              <IconButton
                className="sidebar-icon-btn"
                label={sidebarCopy.displayOptions}
                title={sidebarCopy.displayOptions}
                data-testid="display-options-btn"
              >
                <IconListFilter />
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
                    {props.sortBy === 'updated' ? sidebarCopy.updated : 'A-Z'}
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
                  onSelect={() => props.onChangeSortBy('updated')}
                  testId="display-sort-updated"
                >
                  <span className="sidebar-display-option-label">{sidebarCopy.lastUpdated}</span>
                  {props.sortBy === 'updated' ? (
                    <span className="sidebar-display-check" aria-hidden>
                      <IconCheck width={13} height={13} />
                    </span>
                  ) : (
                    <span className="sidebar-display-check-spacer" aria-hidden />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => props.onChangeSortBy('alphabetical')}
                  testId="display-sort-alphabetical"
                >
                  <span className="sidebar-display-option-label">{sidebarCopy.alphabetical}</span>
                  {props.sortBy === 'alphabetical' ? (
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
                    {props.groupBy === 'time' ? sidebarCopy.dateTime : sidebarCopy.none}
                    <IconChevronRight width={12} height={12} />
                  </span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className="sidebar-display-submenu"
                label={sidebarCopy.groupBy}
                testId="display-options-group-by-menu"
              >
                <DropdownMenuItem
                  onSelect={() => props.onChangeGroupBy('time')}
                  testId="display-group-time"
                >
                  <span className="sidebar-display-option-label">{sidebarCopy.dateTime}</span>
                  {props.groupBy === 'time' ? (
                    <span className="sidebar-display-check" aria-hidden>
                      <IconCheck width={13} height={13} />
                    </span>
                  ) : (
                    <span className="sidebar-display-check-spacer" aria-hidden />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => props.onChangeGroupBy('none')}
                  testId="display-group-none"
                >
                  <span className="sidebar-display-option-label">
                    {`${sidebarCopy.none} (${sidebarCopy.flatList})`}
                  </span>
                  {props.groupBy === 'none' ? (
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
          <IconButton
            className="sidebar-icon-btn"
            label={sidebarCopy.openWorkspaceFolder}
            data-testid="open-workspace-btn"
            title={props.projectPath ?? sidebarCopy.openWorkspaceFolder}
            disabled={props.onOpenWorkspace === undefined}
            onClick={() => props.onOpenWorkspace?.()}
          >
            <IconFolderPlus />
          </IconButton>
        </div>
      </div>
    );
  }

  if (row.kind === 'section-header' && row.sectionId === 'conversations') {
    return (
      <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
        <button
          type="button"
          className="sidebar-section-toggle"
          data-testid="conversations-section-toggle"
          aria-expanded={props.conversationsSectionExpanded}
          aria-controls="conversations-section-content"
          aria-label={
            props.conversationsSectionExpanded
              ? sidebarCopy.collapseConversations
              : sidebarCopy.expandConversations
          }
          title={
            props.conversationsSectionExpanded
              ? sidebarCopy.collapseConversations
              : sidebarCopy.expandConversations
          }
          onClick={props.onToggleConversationsSection}
        >
          <span className="sidebar-section-title">{sidebarCopy.conversations}</span>
          <span className="sidebar-section-count n">{props.generalSessionsCount}</span>
          <IconChevronDown className="sidebar-section-chevron" width={15} height={15} />
        </button>
        <div className="sidebar-section-label-actions">
          <IconButton
            className="sidebar-icon-btn"
            label={props.newConversationLabel}
            title={props.newConversationLabel}
            data-testid="general-workspace-btn"
            onClick={() => props.onNewGeneralSession()}
          >
            <IconPlus width={14} height={14} />
          </IconButton>
        </div>
      </div>
    );
  }

  if (row.kind === 'repo-group') {
    return (
      <div
        className="tree-repo-group"
        data-testid="sidebar-repo-group"
        title={row.title}
      >
        <span className="tree-repo-group-title">{row.title}</span>
      </div>
    );
  }

  if (row.kind === 'time-group') {
    return (
      <div
        className="tree-time-group sidebar-time-group"
        data-testid="sidebar-time-group"
        data-group-id={row.id}
        key={row.key}
      >
        <span className="tree-time-group-title">
          {props.locale === 'en'
            ? row.title
            : ({
                pinned: '置顶',
                today: '今天',
                yesterday: '昨天',
                week: '过去 7 天',
                older: '更早',
              } as Record<string, string>)[row.id] ?? row.title}
        </span>
      </div>
    );
  }

  if (row.kind === 'project-folder') {
    const project = props.recentProjects.find((item) => item.path === row.projectPath);
    const displayName = project?.displayName ?? projectDisplayName(row.projectPath);
    const isActiveProject = row.projectPath === props.projectPath;
    const projectScope: SessionScope = { kind: 'project', projectPath: row.projectPath };
    const hasChildSessions =
      resolveProjectFolderSessions({
        projectPath: row.projectPath,
        projectSessionsByPath: props.projectSessionsByPath ?? {},
        activeProjectPath: props.projectPath,
        activeProjectSessions: props.filteredSessions,
      }).length > 0;
    return (
      <ContextMenu
        label={sidebarCopy.projects}
        testId="project-context-menu"
        content={
          <ContextMenuItem
            testId="project-remove-from-sidebar"
            onSelect={() => props.onRemoveProject?.(row.projectPath)}
            disabled={props.onRemoveProject === undefined}
          >
            <IconTrash width={14} height={14} />
            {sidebarCopy.removeProjectFromSidebar}
          </ContextMenuItem>
        }
      >
        <div
          className={`tree-folder-summary${isActiveProject ? ' active' : ''}${row.grouped ? ' is-grouped' : ''}`}
        >
          {hasChildSessions ? (
            <button
              type="button"
              className="tree-folder-toggle"
              data-testid="project-fold-toggle"
              aria-expanded={!row.collapsed}
              aria-label={row.collapsed ? sidebarCopy.expandProject : sidebarCopy.collapseProject}
              title={row.collapsed ? sidebarCopy.expandProject : sidebarCopy.collapseProject}
              onClick={() => props.onToggleProjectCollapsed(row.projectPath, row.collapsed)}
            >
              {row.collapsed ? (
                <IconFolder className="tree-folder-icon" />
              ) : (
                <IconFolderOpen className="tree-folder-icon" />
              )}
            </button>
          ) : (
            <span className="tree-folder-toggle-spacer" aria-hidden>
              <IconFolder className="tree-folder-icon" />
            </span>
          )}
          <button
            type="button"
            className="tree-folder-main"
            data-testid="repository-item"
            data-project-path={row.projectPath}
            aria-expanded={!row.collapsed}
            onClick={() => props.onToggleProjectCollapsed(row.projectPath, row.collapsed)}
            title={row.projectPath}
          >
            <span className="tree-folder-title">
              <span>{displayName}</span>
              {row.currentBranch ? (
                <span className="tree-folder-branch" title={row.currentBranch}>
                  {row.currentBranch}
                </span>
              ) : null}
            </span>
          </button>
          <IconButton
            className="sidebar-icon-btn tree-folder-add-btn"
            label={sidebarCopy.newConversationInProject(displayName)}
            title={sidebarCopy.newConversationInProject(displayName)}
            onClick={(event) => {
              event.stopPropagation();
              props.onNewSession({ scope: projectScope });
            }}
          >
            <IconPlus width={14} height={14} />
          </IconButton>
        </div>
      </ContextMenu>
    );
  }

  if (row.kind === 'session') {
    return (
      <div
        className={
          row.scope.kind === 'project'
            ? 'sidebar-tree-row sidebar-tree-row--project-session'
            : 'sidebar-tree-row sidebar-tree-row--general-session'
        }
      >
        <SessionRowItem
          session={row.session}
          projectSubtitle={row.projectSubtitle}
          activeSessionId={props.activeSessionId}
          onResumeSession={props.onResumeSession}
          onOpenSessionMenu={props.onOpenSessionMenu}
          isContextActive={props.sessionMenu?.sessionId === row.session.id}
          workingSessionIds={props.workingSessionIds}
          {...(props.runPhase !== undefined ? { runPhase: props.runPhase } : {})}
          backendServiceSessionIds={props.backendServiceSessionIds}
          completedAttentionSessionIds={props.completedAttentionSessionIds}
          failedAttentionSessionIds={props.failedAttentionSessionIds}
          waitingPermissionSessionIds={props.waitingPermissionSessionIds}
          onDismissCompletedAttention={props.onDismissCompletedAttention}
          onTogglePin={props.onTogglePin}
          onArchiveSession={props.onArchiveSession}
          onUnarchiveSession={props.onUnarchiveSession}
          onDeleteSession={props.onDeleteSession}
          onResumeDraft={props.onResumeDraft}
          activeDraftId={props.activeDraftId}
          copy={sidebarCopy}
        />
      </div>
    );
  }

  if (row.kind === 'project-show-more') {
    return (
      <div className="sidebar-tree-row sidebar-tree-row--project-session">
        <button
          type="button"
          className="project-session-show-more"
          data-testid="project-session-show-more"
          aria-label={props.showMoreAriaLabel(row.batchSize)}
          onClick={() =>
            props.onShowMoreSessions(row.projectPath, row.batchSize, row.nextVisibleCount)
          }
        >
          {props.showMoreText}
        </button>
      </div>
    );
  }

  if (row.kind === 'empty-hint') {
    return (
      <div className="sidebar-empty-hint muted" data-testid="sidebar-empty-hint">
        {sidebarCopy.noGeneralConversations}
      </div>
    );
  }

  if (row.kind === 'query-error') {
    const retryLabel = props.locale === 'en' ? 'Retry' : '重试';
    const errorLabel =
      props.locale === 'en' ? 'Could not load conversations.' : '会话列表加载失败。';
    return (
      <div className="sidebar-query-error muted" data-testid="sidebar-query-error">
        <span>{errorLabel}</span>
        {props.onRetrySessionList ? (
          <button
            type="button"
            className="sidebar-query-error-retry"
            onClick={() => props.onRetrySessionList?.(row.scope)}
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    );
  }

  if (row.kind === 'truncation-hint') {
    return (
      <div className="sidebar-truncation-hint muted" data-testid="sidebar-truncation-hint">
        {sidebarCopy.olderSessionsHidden(row.hiddenCount)}
      </div>
    );
  }

  return null;
}
