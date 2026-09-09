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
import { SidebarShelfFooter } from './sidebar-shelf-footer';
import {
  buildSidebarTreeRows,
  collectPinnedSessionRows,
  DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
  sidebarSearchHidesReveal,
  sidebarTreeRowInWorktreeCluster,
  sidebarTreeRowKey,
  type SidebarTreeRow,
} from './sidebar-tree-rows';
import { getProjectSessionDisclosureCopy } from './project-session-disclosure-copy';
import { SidebarTreeRowView } from './sidebar-tree-row-view';
import { Button } from '@piwin/ui-kit';
import {
  IconCards,
  IconImage,
  IconPlus,
  IconPaperPlane,
  IconSearch,
} from './shell-icons';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

const SIDEBAR_SESSION_ROW_ESTIMATE_PX = 28;
const SIDEBAR_SECTION_ROW_ESTIMATE_PX = 22;
const SIDEBAR_FOLDER_ROW_ESTIMATE_PX = 26;
const SIDEBAR_HINT_ROW_ESTIMATE_PX = 22;
const SIDEBAR_VIRTUAL_OVERSCAN = 8;

function estimateSidebarTreeRowSize(row: SidebarTreeRow | undefined): number {
  if (row === undefined) {
    return SIDEBAR_SESSION_ROW_ESTIMATE_PX;
  }
  switch (row.kind) {
    case 'section-header':
      return SIDEBAR_SECTION_ROW_ESTIMATE_PX;
    case 'repo-group':
    case 'time-group':
      return SIDEBAR_HINT_ROW_ESTIMATE_PX;
    case 'project-folder':
    case 'no-repo-folder':
      return SIDEBAR_FOLDER_ROW_ESTIMATE_PX;
    case 'session':
      if (
        row.scope.kind === 'general' &&
        'lastPreview' in row.session &&
        typeof row.session.lastPreview === 'string' &&
        row.session.lastPreview.trim().length > 0
      ) {
        return 46;
      }
      return SIDEBAR_SESSION_ROW_ESTIMATE_PX;
    case 'project-show-more':
      return SIDEBAR_FOLDER_ROW_ESTIMATE_PX;
    case 'empty-hint':
    case 'query-error':
    case 'truncation-hint':
      return SIDEBAR_HINT_ROW_ESTIMATE_PX;
  }
}

export type ProjectSessionSidebarProps = {
  projectPath: string | null;
  projectTrusted: boolean;
  /** When true, General (no project) is the active scope. */
  generalActive?: boolean;
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
  onOpenGeneral: () => void;
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
  activeSubPage?: 'chat' | 'library' | 'images' | 'videos' | 'flashcards' | null | undefined;
  onOpenLibrary?: (() => void) | undefined;
  onOpenImages?: (() => void) | undefined;
  onOpenVideos?: (() => void) | undefined;
  onOpenFlashcards?: (() => void) | undefined;
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
  /** Same lifecycle as `completedAttentionSessionIds`, for a failed turn. */
  failedAttentionSessionIds?: Record<string, true> | undefined;
  /**
   * Session IDs with a queued permission prompt (foreground or background).
   * Outranks every other row state in the ink-line node vocabulary.
   */
  waitingPermissionSessionIds?: Record<string, true> | undefined;
  /** Click the completed checkmark without opening the session. */
  onDismissCompletedAttention?: ((sessionId: string) => void) | undefined;
  sessionListScopes?: SessionListScopeState;
  onRetrySessionList?: (scope: SessionScope) => void;
};

export function ProjectSessionSidebar(props: ProjectSessionSidebarProps): ReactElement {
  const copy = getDesktopCopy(props.locale ?? 'zh-CN');
  const sidebarCopy = copy.sidebar;
  const disclosureCopy = getProjectSessionDisclosureCopy(props.locale ?? 'zh-CN');
  const newConversationLabel = props.locale === 'en' ? 'Clean Slate' : '素笺';
  const newSessionLabel = props.generalActive ? newConversationLabel : copy.newSession;
  const [localSortBy, setLocalSortBy] = useState<SessionListOrder>('updated');
  const sortBy = props.sessionListOrder ?? localSortBy;
  const [groupBy, setGroupBy] = useState<'time' | 'none'>('time');
  const [pinnedSectionExpanded, setPinnedSectionExpanded] = useState(true);
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

  const pinnedCount = useMemo(
    () =>
      collectPinnedSessionRows(
        {
          generalSessions: props.generalSessions,
          recentProjects: props.recentProjects,
          activeProjectPath: props.projectPath,
          activeProjectSessions: props.filteredSessions,
          projectSessionsByPath: props.projectSessionsByPath ?? {},
          sessionSearch: props.sessionSearch,
          sessionListOrder: sortBy,
        },
        false,
      ).length,
    [
      props.filteredSessions,
      props.generalSessions,
      props.projectPath,
      props.projectSessionsByPath,
      props.recentProjects,
      props.sessionSearch,
      sortBy,
    ],
  );

  const treeRows = useMemo(
    () =>
      buildSidebarTreeRows({
        recentProjects: props.recentProjects,
        projectSessionsByPath: props.projectSessionsByPath ?? {},
        generalSessions: props.generalSessions,
        ...(props.draftSessions ? { draftSessions: props.draftSessions } : {}),
        sessionSearch: props.sessionSearch,
        sessionListOrder: sortBy,
        pinnedSectionExpanded,
        projectsSectionExpanded,
        conversationsSectionExpanded,
        collapsedProjects,
        projectSessionVisibleCounts,
        sessionListScopes: props.sessionListScopes ?? createSessionListScopeState(),
        activeProjectPath: props.projectPath,
        activeProjectSessions: props.filteredSessions,
        revealSessionId: props.activeSessionId,
        revealDraftId: props.activeDraftId ?? null,
        groupBy,
      }),
    [
      collapsedProjects,
      conversationsSectionExpanded,
      groupBy,
      pinnedSectionExpanded,
      projectsSectionExpanded,
      projectSessionVisibleCounts,
      props.activeDraftId,
      props.activeSessionId,
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
  const searchHidesCurrent = sidebarSearchHidesReveal(
    treeRows,
    props.sessionSearch.trim().length > 0,
    props.activeSessionId,
    props.activeDraftId ?? null,
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

  useEffect(() => {
    const targetId = props.activeSessionId ?? props.activeDraftId ?? null;
    if (!targetId) {
      return;
    }
    const rowIndex = treeRows.findIndex(
      (row) => row.kind === 'session' && row.session.id === targetId,
    );
    if (rowIndex < 0) {
      return;
    }
    if (virtualizeTree) {
      virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    }
  }, [props.activeDraftId, props.activeSessionId, treeRows, virtualizeTree, virtualizer]);

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
        const activeElement = document.activeElement;
        const activeSessionControl =
          activeElement instanceof HTMLElement
            ? activeElement.closest<HTMLElement>('[data-session-id]') ??
              activeElement
                .closest<HTMLElement>('.session-row')
                ?.querySelector<HTMLElement>('[data-session-id]')
            : null;
        const activeId = activeSessionControl?.getAttribute('data-session-id') ?? null;
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

  const renderSidebarTreeRow = (row: SidebarTreeRow): ReactElement | null => {
    return (
      <SidebarTreeRowView
        row={row}
        locale={props.locale}
        sidebarCopy={sidebarCopy}
        pinnedSectionExpanded={pinnedSectionExpanded}
        onTogglePinnedSection={() => setPinnedSectionExpanded((expanded) => !expanded)}
        pinnedCount={pinnedCount}
        projectsSectionExpanded={projectsSectionExpanded}
        onToggleProjectsSection={() => setProjectsSectionExpanded((expanded) => !expanded)}
        recentProjectsCount={props.recentProjects.length + 1}
        recentProjects={props.recentProjects}
        projectPath={props.projectPath}
        filteredSessions={props.filteredSessions}
        projectSessionsByPath={props.projectSessionsByPath}
        collapsedProjects={collapsedProjects}
        onToggleProjectCollapsed={(projectPath, collapsed) => {
          if (!collapsed) {
            setProjectSessionVisibleCounts((previous) => {
              if (previous[projectPath] === undefined) {
                return previous;
              }
              const next = { ...previous };
              delete next[projectPath];
              return next;
            });
          }
          setCollapsedProjects((previous) => ({
            ...previous,
            [projectPath]: !collapsed,
          }));
        }}
        onRemoveProject={props.onRemoveProject}
        onOpenGeneral={props.onOpenGeneral}
        onNewSession={props.onNewSession}
        onOpenWorkspace={props.onOpenWorkspace}
        sortBy={sortBy}
        onChangeSortBy={changeSortBy}
        groupBy={groupBy}
        onChangeGroupBy={setGroupBy}
        showArchivedSessions={props.showArchivedSessions}
        onToggleShowArchived={props.onToggleShowArchived}
        conversationsSectionExpanded={conversationsSectionExpanded}
        onToggleConversationsSection={() => setConversationsSectionExpanded((expanded) => !expanded)}
        generalSessionsCount={props.generalSessions.length}
        newConversationLabel={newConversationLabel}
        onNewGeneralSession={props.onNewGeneralSession}
        activeSessionId={props.activeSessionId}
        activeDraftId={props.activeDraftId}
        sessionMenu={props.sessionMenu}
        onResumeSession={props.onResumeSession}
        onOpenSessionMenu={props.onOpenSessionMenu}
        onTogglePin={props.onTogglePin}
        onArchiveSession={props.onArchiveSession}
        onUnarchiveSession={props.onUnarchiveSession}
        onDeleteSession={props.onDeleteSession}
        onResumeDraft={props.onResumeDraft}
        workingSessionIds={props.workingSessionIds}
        runPhase={props.runPhase}
        backendServiceSessionIds={props.backendServiceSessionIds}
        completedAttentionSessionIds={props.completedAttentionSessionIds}
        failedAttentionSessionIds={props.failedAttentionSessionIds}
        waitingPermissionSessionIds={props.waitingPermissionSessionIds}
        onDismissCompletedAttention={props.onDismissCompletedAttention}
        onShowMoreSessions={(projectPath, _batchSize, nextCount) => {
          setProjectSessionVisibleCounts((previous) => ({
            ...previous,
            [projectPath]: Math.max(
              previous[projectPath] ?? DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
              nextCount,
            ),
          }));
        }}
        onRetrySessionList={props.onRetrySessionList}
        showMoreAriaLabel={(batchSize) => disclosureCopy.showMoreSessions(batchSize)}
        showMoreText={disclosureCopy.showMore}
      />
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

      {/* Prototype .sb-top: search plus the vermilion new-chat action. */}
      <div className="sb-top sidebar-sb-top" data-testid="sidebar-sb-top">
        <button
          type="button"
          className="search sidebar-search-box"
          data-testid="session-search-btn-sb-top"
          onClick={props.onOpenSessionSearch}
          title={copy.searchSessions}
          aria-label={copy.searchSessions}
        >
          <IconSearch width={14} height={14} />
          <span>{props.locale === 'zh-CN' ? '搜索或跳转…' : 'Search or jump…'}</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className="new sidebar-new-btn"
          data-testid="new-session-btn-sb-top"
          onClick={() => props.onNewSession()}
          title={newSessionLabel}
          aria-label={newSessionLabel}
        >
          <IconPlus width={15} height={15} />
        </button>
      </div>

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
            className={`sidebar-action-row${
              props.activeSubPage === 'library' ||
              props.activeSubPage === 'images' ||
              props.activeSubPage === 'videos'
                ? ' active'
                : ''
            }`}
            data-testid="sidebar-library-btn"
            onClick={() => (props.onOpenLibrary ?? props.onOpenImages)?.()}
            title={props.locale === 'en' ? 'Library' : '资料库'}
            aria-label={props.locale === 'en' ? 'Library' : '资料库'}
          >
            <IconImage />
            <span>{props.locale === 'en' ? 'Library' : '资料库'}</span>
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

      {searchHidesCurrent ? (
        <div className="sidebar-search-hides-current muted" data-testid="sidebar-search-hides-current">
          {props.locale === 'en'
            ? 'Search is hiding the current Chat. Clear search to locate it.'
            : '搜索结果未包含当前会话，清除搜索后可定位。'}
        </div>
      ) : null}

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
                  className={
                    sidebarTreeRowInWorktreeCluster(row)
                      ? 'sidebar-tree-virtual-item is-grouped'
                      : 'sidebar-tree-virtual-item'
                  }
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {renderSidebarTreeRow(row)}
                </div>
              );
            })}
          </div>
        ) : (
          treeRows.map((row) => (
            <div
              key={sidebarTreeRowKey(row)}
              className={
                sidebarTreeRowInWorktreeCluster(row)
                  ? 'sidebar-tree-flow-item is-grouped'
                  : 'sidebar-tree-flow-item'
              }
            >
              {renderSidebarTreeRow(row)}
            </div>
          ))
        )}
      </div>

      <SidebarShelfFooter
        activeSubPage={props.activeSubPage}
        onOpenLibrary={props.onOpenLibrary}
        onOpenImages={props.onOpenImages}
        onOpenFlashcards={props.onOpenFlashcards}
        settingsOpen={props.settingsOpen}
        onOpenSettings={props.onOpenSettings}
        onPrefetchSettings={props.onPrefetchSettings}
        hostReady={props.hostReady}
        hostMock={props.hostMock}
        transportLabel={props.transportLabel}
        locale={props.locale}
        flashcardsTitle={sidebarCopy.flashcards}
        settingsTitle={copy.settings}
      />
    </aside>
  );
}
