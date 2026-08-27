/**
 * Left project/session rail: brand, repositories, agent list, host status footer.
 * Handlers stay in App — this component is presentation + local open menu state only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  HostStatusData,
  ProjectRecord,
  SessionListOrder,
  SessionScope,
} from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { SessionTimeGroup } from './session-groups';
import { type DraftSessionItemUi } from './draft-session';
import { shouldVirtualizeSidebar } from './session-list-policy';
import type { SessionListScopeState } from './session-list-scope';
import { createSessionListScopeState } from './session-list-scope';
import { SessionRowItem } from './session-row-item';
import {
  buildSidebarTreeRows,
  DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
  sidebarTreeRowKey,
  type SidebarTreeRow,
} from './sidebar-tree-rows';
import { getProjectSessionDisclosureCopy } from './project-session-disclosure-copy';
import {
  Button,
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
import { projectDisplayName } from './project-display-name';
import {
  IconBook,
  IconCards,
  IconChat,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconImage,
  IconPlus,
  IconPaperPlane,
  IconSearch,
  IconSettings,
  IconSliders,
  IconTrash,
  IconVideo,
} from './shell-icons';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

const SIDEBAR_SESSION_ROW_ESTIMATE_PX = 33;
const SIDEBAR_SECTION_ROW_ESTIMATE_PX = 34;
const SIDEBAR_FOLDER_ROW_ESTIMATE_PX = 32;
const SIDEBAR_HINT_ROW_ESTIMATE_PX = 28;
const SIDEBAR_VIRTUAL_OVERSCAN = 8;

function estimateSidebarTreeRowSize(row: SidebarTreeRow | undefined): number {
  if (row === undefined) {
    return SIDEBAR_SESSION_ROW_ESTIMATE_PX;
  }
  switch (row.kind) {
    case 'section-header':
      return SIDEBAR_SECTION_ROW_ESTIMATE_PX;
    case 'project-folder':
      return SIDEBAR_FOLDER_ROW_ESTIMATE_PX;
    case 'session':
      return SIDEBAR_SESSION_ROW_ESTIMATE_PX;
    case 'project-show-more':
      return SIDEBAR_FOLDER_ROW_ESTIMATE_PX;
    case 'empty-hint':
    case 'truncation-hint':
      return SIDEBAR_HINT_ROW_ESTIMATE_PX;
  }
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
  /** General-scope sessions for the Conversations section (always visible). */
  generalSessions: SessionListItemUi[];
  /** Local-only unsent composer drafts, grouped by their captured scope. */
  draftSessions?: DraftSessionItemUi[];
  activeDraftId?: string | null | undefined;
  onResumeDraft?: (draftId: string) => void;
  /** Per-project session lists for the folder tree, keyed by project path.
   *  Independent from `filteredSessions` (the active scope's list) so any
   *  number of project folders can stay open with their own conversations. */
  projectSessionsByPath?: Record<string, SessionListItemUi[]>;
  sessionListOrder?: SessionListOrder;
  onSessionListOrderChange?: (order: SessionListOrder) => void;
  sessionGroups: SessionTimeGroup<SessionListItemUi>[];
  activeSessionId: string | null;
  sessionSearch: string;
  onOpenSessionSearch: () => void;
  showArchivedSessions: boolean;
  onToggleShowArchived: () => void;
  settingsOpen: boolean;
  onOpenWorkspace?: () => void;
  onOpenProject: (path: string) => void;
  onRemoveProject?: (path: string) => void;
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
  /** Chromium-style intent prefetch of the Basic settings chunk. */
  onPrefetchSettings?: () => void;
  activeSubPage?: 'chat' | 'images' | 'videos' | 'flashcards' | null | undefined;
  onOpenImages?: (() => void) | undefined;
  onOpenVideos?: (() => void) | undefined;
  onOpenFlashcards?: (() => void) | undefined;
  knowledgeOpen?: boolean;
  onToggleKnowledge?: () => void;
  isOverlayPresentation?: boolean;
  onCloseOverlay?: () => void;
  locale?: DesktopLocale;
  sessionMenu?: { sessionId: string; x: number; y: number } | null | undefined;
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
  /** Foreground run phase; the open session spins only while streaming. */
  runPhase?: 'idle' | 'streaming' | 'pausing' | 'aborting' | undefined;
  /**
   * Session IDs that own an active backend service job. These take priority
   * over the regular working indicator and show a wave of three dots instead.
   */
  backendServiceSessionIds?: Record<string, true> | undefined;
  /**
   * Session IDs whose latest turn finished while the sidebar stayed mounted.
   * Cleared when the session is opened, or when the user clicks the checkmark.
   */
  completedAttentionSessionIds?: Record<string, true> | undefined;
  /** Click the completed checkmark without opening the session. */
  onDismissCompletedAttention?: ((sessionId: string) => void) | undefined;
  sessionListScopes?: SessionListScopeState;
};

export function ProjectSessionSidebar(props: ProjectSessionSidebarProps): ReactElement {
  const copy = getDesktopCopy(props.locale ?? 'zh-CN');
  const sidebarCopy = copy.sidebar;
  const disclosureCopy = getProjectSessionDisclosureCopy(props.locale ?? 'zh-CN');
  const newConversationLabel = props.locale === 'en' ? 'New Chat' : '新建 Chat';
  const newSessionLabel = props.generalActive ? newConversationLabel : copy.newSession;
  const [localSortBy, setLocalSortBy] = useState<SessionListOrder>('updated');
  const sortBy = props.sessionListOrder ?? localSortBy;
  const [groupBy, setGroupBy] = useState<'time' | 'none'>('time');
  const [projectsSectionExpanded, setProjectsSectionExpanded] = useState(true);
  const [conversationsSectionExpanded, setConversationsSectionExpanded] = useState(true);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [projectSessionVisibleCounts, setProjectSessionVisibleCounts] = useState<
    Record<string, number>
  >({});
  const sidebarRef = useRef<HTMLElement>(null);
  const folderTreeRef = useRef<HTMLDivElement>(null);
  const [folderTreeElement, setFolderTreeElement] = useState<HTMLDivElement | null>(null);
  const virtualizerRef = useRef<{ scrollToIndex: (index: number) => void } | null>(null);
  const changeSortBy = (order: SessionListOrder): void => {
    setLocalSortBy(order);
    props.onSessionListOrderChange?.(order);
  };

  const treeRows = useMemo(
    () =>
      buildSidebarTreeRows({
        recentProjects: props.recentProjects,
        projectSessionsByPath: props.projectSessionsByPath ?? {},
        generalSessions: props.generalSessions,
        ...(props.draftSessions ? { draftSessions: props.draftSessions } : {}),
        sessionSearch: props.sessionSearch,
        sessionListOrder: sortBy,
        projectsSectionExpanded,
        conversationsSectionExpanded,
        collapsedProjects,
        projectSessionVisibleCounts,
        sessionListScopes: props.sessionListScopes ?? createSessionListScopeState(),
        activeProjectPath: props.projectPath,
        activeProjectSessions: props.filteredSessions,
      }),
    [
      collapsedProjects,
      conversationsSectionExpanded,
      projectsSectionExpanded,
      projectSessionVisibleCounts,
      props.draftSessions,
      props.filteredSessions,
      props.generalSessions,
      props.projectPath,
      props.projectSessionsByPath,
      props.recentProjects,
      props.sessionListScopes,
      props.sessionSearch,
      sortBy,
    ],
  );
  const virtualizeTree = shouldVirtualizeSidebar(treeRows.length);
  const sessionRowIndexes = useMemo(
    () => treeRows.flatMap((row, index) => (row.kind === 'session' ? [index] : [])),
    [treeRows],
  );

  const virtualizer = useVirtualizer({
    count: treeRows.length,
    getScrollElement: () => folderTreeElement,
    estimateSize: (index) => estimateSidebarTreeRowSize(treeRows[index]),
    getItemKey: (index) =>
      sidebarTreeRowKey(
        treeRows[index] ?? {
          kind: 'section-header',
          sectionId: 'projects',
          key: `missing:${index}`,
        },
      ),
    measureElement: (element) => Math.max(element.getBoundingClientRect().height, 1),
    overscan: SIDEBAR_VIRTUAL_OVERSCAN,
    useFlushSync: false,
  });
  virtualizerRef.current = virtualizer;

  const focusSessionRow = useCallback(
    (rowIndex: number): void => {
      const focusMounted = (): void => {
        const row = treeRows[rowIndex];
        if (row?.kind !== 'session') {
          return;
        }
        const button = folderTreeRef.current?.querySelector<HTMLElement>(
          `[data-session-id="${CSS.escape(row.session.id)}"]`,
        );
        button?.focus();
      };
      if (virtualizeTree) {
        virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
        requestAnimationFrame(focusMounted);
        return;
      }
      focusMounted();
    },
    [treeRows, virtualizeTree, virtualizer],
  );

  // Keyboard navigation for session list (↑↓ Enter) when focus is inside the sidebar.
  useEffect(() => {
    const sidebarEl = sidebarRef.current;
    if (sidebarEl === null) return;
    const root: HTMLElement = sidebarEl;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node) || !root.contains(target)) {
        return;
      }
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      if (sessionRowIndexes.length === 0) {
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const activeId =
          document.activeElement instanceof HTMLElement
            ? document.activeElement.getAttribute('data-session-id')
            : null;
        const currentPosition = sessionRowIndexes.findIndex((rowIndex) => {
          const row = treeRows[rowIndex];
          return row?.kind === 'session' && row.session.id === activeId;
        });
        let nextPosition: number;
        if (event.key === 'ArrowDown') {
          nextPosition = currentPosition < sessionRowIndexes.length - 1 ? currentPosition + 1 : 0;
        } else {
          nextPosition = currentPosition > 0 ? currentPosition - 1 : sessionRowIndexes.length - 1;
        }
        const nextRowIndex = sessionRowIndexes[nextPosition];
        if (nextRowIndex !== undefined) {
          focusSessionRow(nextRowIndex);
        }
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

    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [focusSessionRow, sessionRowIndexes, treeRows]);

  const renderSidebarTreeRow = (row: SidebarTreeRow): ReactElement => {
    if (row.kind === 'section-header' && row.sectionId === 'projects') {
      return (
        <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
          <button
            type="button"
            className="sidebar-section-toggle"
            data-testid="projects-section-toggle"
            aria-expanded={projectsSectionExpanded}
            aria-controls="projects-section-content"
            aria-label={
              projectsSectionExpanded ? sidebarCopy.collapseProjects : sidebarCopy.expandProjects
            }
            title={
              projectsSectionExpanded ? sidebarCopy.collapseProjects : sidebarCopy.expandProjects
            }
            onClick={() => setProjectsSectionExpanded((expanded) => !expanded)}
          >
            <span className="sidebar-section-title" data-testid="projects-section-title">
              {sidebarCopy.projects}
            </span>
            <IconChevronDown className="sidebar-section-chevron" width={15} height={15} />
          </button>
          <div className="sidebar-section-label-actions">
            <span className="sidebar-section-count muted">{props.recentProjects.length}</span>
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
                    onSelect={() => changeSortBy('updated')}
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
                    onSelect={() => changeSortBy('alphabetical')}
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
              <DropdownMenuItem
                onSelect={() => props.onOpenWorkspace?.()}
                disabled={props.onOpenWorkspace === undefined}
              >
                <IconFolder width={14} height={14} /> {sidebarCopy.openWorkspaceFolderAction}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onSelectGeneral?.()}>
                <IconChat width={14} height={14} /> {sidebarCopy.generalChat}
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>
      );
    }

    if (row.kind === 'section-header') {
      return (
        <div className="sidebar-section-label sidebar-section-label-row tree-header-row">
          <button
            type="button"
            className="sidebar-section-toggle"
            data-testid="conversations-section-toggle"
            aria-expanded={conversationsSectionExpanded}
            aria-controls="conversations-section-content"
            aria-label={
              conversationsSectionExpanded
                ? sidebarCopy.collapseConversations
                : sidebarCopy.expandConversations
            }
            title={
              conversationsSectionExpanded
                ? sidebarCopy.collapseConversations
                : sidebarCopy.expandConversations
            }
            onClick={() => setConversationsSectionExpanded((expanded) => !expanded)}
          >
            <span className="sidebar-section-title">{sidebarCopy.conversations}</span>
            <IconChevronDown className="sidebar-section-chevron" width={15} height={15} />
          </button>
          <div className="sidebar-section-label-actions">
            <IconButton
              className="sidebar-icon-btn"
              label={newConversationLabel}
              title={newConversationLabel}
              data-testid="general-workspace-btn"
              onClick={() => props.onNewGeneralSession()}
            >
              <IconPlus width={14} height={14} />
            </IconButton>
          </div>
        </div>
      );
    }

    if (row.kind === 'project-folder') {
      const project = props.recentProjects.find((item) => item.path === row.projectPath);
      const displayName = project?.displayName ?? projectDisplayName(row.projectPath);
      const isActiveProject = row.projectPath === props.projectPath;
      const projectScope: SessionScope = { kind: 'project', projectPath: row.projectPath };
      const toggleProjectCollapsed = (): void => {
        if (!row.collapsed) {
          setProjectSessionVisibleCounts((previous) => {
            if (previous[row.projectPath] === undefined) {
              return previous;
            }
            const next = { ...previous };
            delete next[row.projectPath];
            return next;
          });
        }
        // Persist the opposite of the *computed* row state so the first
        // toggle on a default-collapsed (or default-expanded active)
        // project records an explicit override.
        setCollapsedProjects((previous) => ({
          ...previous,
          [row.projectPath]: !row.collapsed,
        }));
      };
      const hasChildSessions =
        (isActiveProject
          ? props.filteredSessions.length
          : (props.projectSessionsByPath?.[row.projectPath]?.length ?? 0)) > 0;
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
          <div className={isActiveProject ? 'tree-folder-summary active' : 'tree-folder-summary'}>
            {hasChildSessions ? (
              <button
                type="button"
                className="tree-folder-toggle"
                data-testid="project-fold-toggle"
                aria-expanded={!row.collapsed}
                aria-label={row.collapsed ? sidebarCopy.expandProject : sidebarCopy.collapseProject}
                title={row.collapsed ? sidebarCopy.expandProject : sidebarCopy.collapseProject}
                onClick={toggleProjectCollapsed}
              >
                {row.collapsed ? (
                  <IconFolder className="tree-folder-icon" />
                ) : (
                  <IconFolderOpen className="tree-folder-icon" />
                )}
              </button>
            ) : (
              <span className="tree-folder-toggle-spacer" aria-hidden />
            )}
            <button
              type="button"
              className="tree-folder-main"
              data-testid="repository-item"
              data-project-path={row.projectPath}
              aria-expanded={!row.collapsed}
              onClick={toggleProjectCollapsed}
              title={row.projectPath}
            >
              <span className="tree-folder-title">
                <span>{displayName}</span>
              </span>
            </button>
            <IconButton
              className="sidebar-icon-btn tree-folder-add-btn"
              label={sidebarCopy.newConversationInProject(displayName)}
              title={sidebarCopy.newConversationInProject(displayName)}
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenProject(row.projectPath);
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
            activeSessionId={props.activeSessionId}
            onResumeSession={props.onResumeSession}
            onOpenSessionMenu={props.onOpenSessionMenu}
            isContextActive={props.sessionMenu?.sessionId === row.session.id}
            workingSessionIds={props.workingSessionIds}
            {...(props.runPhase !== undefined ? { runPhase: props.runPhase } : {})}
            backendServiceSessionIds={props.backendServiceSessionIds}
            completedAttentionSessionIds={props.completedAttentionSessionIds}
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
            aria-label={disclosureCopy.showMoreSessions(row.batchSize)}
            onClick={() =>
              setProjectSessionVisibleCounts((previous) => ({
                ...previous,
                [row.projectPath]: Math.max(
                  previous[row.projectPath] ?? DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
                  row.nextVisibleCount,
                ),
              }))
            }
          >
            {disclosureCopy.showMore}
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

    return (
      <div className="sidebar-truncation-hint muted" data-testid="sidebar-truncation-hint">
        {sidebarCopy.olderSessionsHidden(row.hiddenCount)}
      </div>
    );
  };

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

        {/* Primary sidebar actions — Cursor-style flat menu rows */}
        <div className="sidebar-primary-actions">
          <button
            type="button"
            className={`sidebar-action-row${!props.activeSubPage || props.activeSubPage === 'chat' ? ' active' : ''}`}
            data-testid="new-session-btn"
            onClick={() => props.onNewSession()}
            title={newSessionLabel}
            aria-label={newSessionLabel}
          >
            <IconPaperPlane />
            <span>{newSessionLabel}</span>
          </button>

          <button
            type="button"
            className={`sidebar-action-row${props.activeSubPage === 'images' ? ' active' : ''}`}
            data-testid="sidebar-images-btn"
            onClick={() => props.onOpenImages?.()}
            title={sidebarCopy.images}
            aria-label={sidebarCopy.images}
          >
            <IconImage />
            <span>{sidebarCopy.images}</span>
          </button>

          <button
            type="button"
            className={`sidebar-action-row${props.activeSubPage === 'videos' ? ' active' : ''}`}
            data-testid="sidebar-videos-btn"
            onClick={() => props.onOpenVideos?.()}
            title={sidebarCopy.videos}
            aria-label={sidebarCopy.videos}
          >
            <IconVideo />
            <span>{sidebarCopy.videos}</span>
          </button>

          <button
            type="button"
            className={`sidebar-action-row${props.activeSubPage === 'flashcards' ? ' active' : ''}`}
            data-testid="sidebar-flashcards-btn"
            onClick={() => props.onOpenFlashcards?.()}
            title={sidebarCopy.flashcards}
            aria-label={sidebarCopy.flashcards}
          >
            <IconCards />
            <span>{sidebarCopy.flashcards}</span>
          </button>

          <button
            type="button"
            className="sidebar-action-row"
            data-testid="session-search-btn"
            onClick={props.onOpenSessionSearch}
            title={copy.searchSessions}
            aria-label={copy.searchSessions}
          >
            <IconSearch />
            <span>{copy.searchSessions}</span>
          </button>
        </div>
      </div>

      <div
        className="sidebar-folder-tree"
        data-testid="sessions-list"
        ref={(node) => {
          folderTreeRef.current = node;
          setFolderTreeElement(node);
        }}
      >
        {virtualizeTree ? (
          <div
            className="sidebar-folder-tree-virtual-window"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = treeRows[virtualRow.index];
              if (row === undefined) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="sidebar-tree-virtual-item"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {renderSidebarTreeRow(row)}
                </div>
              );
            })}
          </div>
        ) : (
          treeRows.map((row) => (
            <div key={sidebarTreeRowKey(row)} className="sidebar-tree-flow-item">
              {renderSidebarTreeRow(row)}
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        {/* Soft frosted edge where the session list meets Knowledge Center. */}
        <div className="sidebar-footer-fade" aria-hidden="true" />
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
          disabled={props.onToggleKnowledge === undefined}
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
          onPointerEnter={props.onPrefetchSettings}
          onMouseEnter={props.onPrefetchSettings}
          onFocus={props.onPrefetchSettings}
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
