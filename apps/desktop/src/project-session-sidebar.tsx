/**
 * Left project/session rail: brand, repositories, agent list, host status footer.
 * Handlers stay in App — this component is presentation + local open menu state only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  HostStatusData,
  ProjectRecord,
  SessionListOrder,
  SessionScope,
} from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { SessionTimeGroup } from './session-groups';
import {
  draftSessionMatchesQuery,
  sortDraftSessions,
  type DraftSessionItemUi,
} from './draft-session';
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
import { WindowDragRegion, handleNativeWindowDragMouseDown } from './native-window-drag';
import {
  IconArchive,
  IconBook,
  IconChat,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDocument,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMoreVertical,
  IconPanelLeft,
  IconPin,
  IconPlus,
  IconPaperPlane,
  IconSearch,
  IconSettings,
  IconSliders,
  IconTrash,
  IconUnarchive,
} from './shell-icons';
import { getDesktopCopy, type DesktopCopy, type DesktopLocale } from './desktop-locale';
import {
  GENERAL_SESSION_PAGE_SIZE,
  PROJECT_SESSION_PAGE_SIZE,
  selectSessionSidebarPage,
} from './session-sidebar-page';
import {
  SESSION_LIST_WINDOW_MAX_PAGES,
  getSessionListWindow,
  getSessionListWindowBounds,
  sessionScopeKey,
  type SessionListWindowsState,
} from './session-list-page-state';
import { SessionListLazyBoundary } from './session-list-lazy-boundary';

const SESSION_LIST_PREVIEW_SIZE = 6;

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

type SidebarSessionItem = SessionListItemUi | DraftSessionItemUi;

/** Drafts are always shown first; normal sessions keep the selected ordering. */
function mergeDraftsIntoSessionList(
  drafts: readonly DraftSessionItemUi[],
  sessions: readonly SessionListItemUi[],
  sortBy: SessionListOrder,
): SidebarSessionItem[] {
  const sortedSessions =
    sortBy === 'alphabetical'
      ? [...sessions].sort((left, right) => left.name.localeCompare(right.name))
      : sortByPinnedThenUpdated([...sessions]);
  return [...sortDraftSessions(drafts), ...sortedSessions];
}

function selectDraftsForScope(
  drafts: readonly DraftSessionItemUi[],
  scope: SessionScope,
  query: string,
): DraftSessionItemUi[] {
  return sortDraftSessions(
    drafts.filter((draft) => {
      const sameScope =
        draft.scope.kind === scope.kind &&
        (draft.scope.kind === 'general' ||
          (scope.kind === 'project' && draft.scope.projectPath === scope.projectPath));
      return sameScope && draftSessionMatchesQuery(draft, query);
    }),
  );
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
  /** Current bounded Host-page window per hydrated scope. */
  sessionListWindows?: SessionListWindowsState<SessionListItemUi>;
  sessionListOrder?: SessionListOrder;
  onSessionListOrderChange?: (order: SessionListOrder) => void;
  onSessionPageChange?: (
    scope: SessionScope,
    cursor: string,
    direction: 'previous' | 'next',
  ) => void | Promise<void>;
  /** Reload the first Host page after an expanded lazy list is collapsed. */
  onSessionWindowReset?: (scope: SessionScope) => void | Promise<void>;
  sessionGroups: SessionTimeGroup<SessionListItemUi>[];
  activeSessionId: string | null;
  sessionSearch: string;
  onSessionSearchChange: (value: string) => void;
  showArchivedSessions: boolean;
  onToggleShowArchived: () => void;
  settingsOpen: boolean;
  onOpenWorkspace: () => void;
  onOpenProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
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
  sessionsExpanded?: boolean;
  onToggleSessions?: () => void;
  canGoBack?: boolean | undefined;
  canGoForward?: boolean | undefined;
  onGoBack?: (() => void) | undefined;
  onGoForward?: (() => void) | undefined;
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
  /**
   * Session IDs whose latest turn finished while the sidebar stayed mounted.
   * Cleared when the session is opened, or when the user clicks the checkmark.
   */
  completedAttentionSessionIds?: Record<string, true> | undefined;
  /** Click the completed checkmark without opening the session. */
  onDismissCompletedAttention?: ((sessionId: string) => void) | undefined;
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
  completedAttentionSessionIds,
  onDismissCompletedAttention,
  onTogglePin,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  onResumeDraft,
  activeDraftId,
  copy,
}: {
  session: SessionListItemUi | DraftSessionItemUi;
  activeSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  onOpenSessionMenu: (sessionId: string, x: number, y: number) => void;
  onTogglePin?: ((sessionId: string, currentlyPinned: boolean) => void) | undefined;
  onArchiveSession?: ((sessionId: string) => void) | undefined;
  onUnarchiveSession?: ((sessionId: string) => void) | undefined;
  onDeleteSession?: ((sessionId: string) => void) | undefined;
  onResumeDraft?: ((draftId: string) => void) | undefined;
  activeDraftId?: string | null | undefined;
  copy: DesktopCopy['sidebar'];
  workingSessionIds?: Record<string, true> | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
  completedAttentionSessionIds?: Record<string, true> | undefined;
  onDismissCompletedAttention?: ((sessionId: string) => void) | undefined;
}): ReactElement {
  const isDraft = 'isDraft' in session && session.isDraft === true;
  const isPinned = 'isPinned' in session && session.isPinned === true;
  const isArchived = 'isArchived' in session && session.isArchived === true;
  const storageState =
    !isDraft && 'storage' in session ? session.storage?.state : undefined;
  const isActive = isDraft ? session.id === activeDraftId : session.id === activeSessionId;
  const isWorking = !isDraft && workingSessionIds != null && session.id in workingSessionIds;
  const hasActiveBackendService =
    !isDraft && backendServiceSessionIds != null && session.id in backendServiceSessionIds;
  const hasActiveSessionWork = isWorking || hasActiveBackendService;
  const hasCompletedAttention =
    !isDraft && completedAttentionSessionIds != null && session.id in completedAttentionSessionIds;

  return (
    <li
      key={session.id}
      className={[
        'session-row',
        ...(hasActiveSessionWork ? ['session-row--working'] : []),
        ...(hasCompletedAttention ? ['session-row--completed'] : []),
        ...(isDraft ? ['session-row--draft'] : []),
      ].join(' ')}
    >
      <button
        type="button"
        data-testid="session-item"
        data-session-id={session.id}
        data-pinned={isPinned ? 'true' : 'false'}
        data-archived={isArchived ? 'true' : 'false'}
        data-storage={storageState ?? 'local'}
        data-draft={isDraft ? 'true' : 'false'}
        data-completed={hasCompletedAttention ? 'true' : 'false'}
        aria-current={isActive ? 'page' : undefined}
        className={
          isActive
            ? isWorking
              ? 'session-item active working'
              : 'session-item active'
            : isWorking
              ? 'session-item working'
              : 'session-item'
        }
        onClick={() => (isDraft ? onResumeDraft?.(session.id) : onResumeSession(session.id))}
        onContextMenu={(event) => {
          if (isDraft) return;
          event.preventDefault();
          onOpenSessionMenu(session.id, event.clientX, event.clientY);
        }}
      >
        <span className="session-item-body">
          <span className="session-item-name">
            {isDraft ? <span className="session-draft-mark" aria-hidden /> : null}
            {isArchived ? (
              <span className="session-archived-mark" aria-hidden title={copy.archived}>
                <IconDocument width={13} height={13} />
              </span>
            ) : null}
            {storageState === 'offloaded' ? (
              <span
                className="session-storage-badge"
                data-testid="session-storage-badge"
                title={copy.offloaded}
              >
                {copy.offloaded}
              </span>
            ) : null}
            {storageState === 'missing-pack' ? (
              <span
                className="session-storage-badge session-storage-badge--missing"
                data-testid="session-storage-badge"
                title={copy.missingPack}
              >
                {copy.missingPack}
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
        {session.updatedAt && !isWorking && !hasActiveBackendService && !hasCompletedAttention ? (
          <span className="session-item-time" aria-label={session.updatedAt}>
            {formatRelativeTime(session.updatedAt)}
          </span>
        ) : null}
      </button>
      {hasCompletedAttention && !hasActiveSessionWork ? (
        <button
          type="button"
          className="session-item-completed-mark session-item-completed-dismiss"
          data-testid="session-completed-dismiss"
          aria-label={copy.dismissCompleted}
          title={copy.dismissCompleted}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDismissCompletedAttention?.(session.id);
          }}
        >
          <span data-testid="session-completed-indicator" aria-hidden>
            <IconCheck width={12} height={12} />
          </span>
        </button>
      ) : null}
      <div
        className={
          isDraft
            ? 'session-row-actions session-row-actions--draft'
            : isArchived
              ? 'session-row-actions session-row-actions--archived'
              : 'session-row-actions'
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
  const [localSortBy, setLocalSortBy] = useState<SessionListOrder>('updated');
  const sortBy = props.sessionListOrder ?? localSortBy;
  const [groupBy, setGroupBy] = useState<'time' | 'none'>('time');
  const [projectsSectionExpanded, setProjectsSectionExpanded] = useState(true);
  const [conversationsSectionExpanded, setConversationsSectionExpanded] = useState(true);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [expandedProjectSessionLists, setExpandedProjectSessionLists] = useState<
    Record<string, boolean>
  >({});
  const [generalSessionListExpanded, setGeneralSessionListExpanded] = useState(false);
  const pendingSessionWindowLoads = useRef(new Set<string>());
  const sessionListWindowsRef = useRef(props.sessionListWindows);
  sessionListWindowsRef.current = props.sessionListWindows;
  const sidebarRef = useRef<HTMLElement>(null);
  const sessionSearchInputRef = useRef<HTMLInputElement>(null);
  const hasActiveSessionSearch = props.sessionSearch.trim().length > 0;
  const [sessionSearchExpanded, setSessionSearchExpanded] = useState(hasActiveSessionSearch);
  const changeSortBy = (order: SessionListOrder): void => {
    setLocalSortBy(order);
    props.onSessionListOrderChange?.(order);
  };

  // Keep the expanded search field open while a query is active.
  useEffect(() => {
    if (hasActiveSessionSearch) {
      setSessionSearchExpanded(true);
    }
  }, [hasActiveSessionSearch]);

  const loadSessionWindowPage = useCallback(
    async (
      scope: SessionScope,
      cursor: string,
      direction: 'previous' | 'next',
    ): Promise<boolean> => {
      const scopeKey = sessionScopeKey(scope);
      if (
        props.onSessionPageChange === undefined ||
        pendingSessionWindowLoads.current.has(scopeKey)
      ) {
        return false;
      }
      pendingSessionWindowLoads.current.add(scopeKey);
      try {
        await props.onSessionPageChange(scope, cursor, direction);
        return true;
      } finally {
        pendingSessionWindowLoads.current.delete(scopeKey);
      }
    },
    [props.onSessionPageChange],
  );

  /**
   * See all must not leave the user with only the first Host page + Show less.
   * Eagerly append pages until the sliding window is full or Host has no next
   * cursor. Further pages still come from the lazy boundary while scrolling.
   */
  const fillExpandedSessionWindow = useCallback(
    async (scope: SessionScope): Promise<void> => {
      for (let attempt = 0; attempt < SESSION_LIST_WINDOW_MAX_PAGES; attempt += 1) {
        const windows = sessionListWindowsRef.current;
        if (windows === undefined) {
          return;
        }
        const window = getSessionListWindow(windows, scope);
        if (window === null) {
          return;
        }
        const bounds = getSessionListWindowBounds(window);
        if (bounds === null || bounds.nextCursor === undefined) {
          return;
        }
        if (window.pages.length >= SESSION_LIST_WINDOW_MAX_PAGES) {
          return;
        }
        const loaded = await loadSessionWindowPage(scope, bounds.nextCursor, 'next');
        if (!loaded) {
          return;
        }
      }
    },
    [loadSessionWindowPage],
  );

  const resetSessionWindow = useCallback(
    (scope: SessionScope): void => {
      if (props.onSessionWindowReset === undefined) {
        return;
      }
      void Promise.resolve(props.onSessionWindowReset(scope)).catch((error: unknown) => {
        console.warn(
          `[session-list] failed to reset ${sessionScopeKey(scope)} to its first page`,
          error,
        );
      });
    },
    [props.onSessionWindowReset],
  );

  useEffect(() => {
    if (!sessionSearchExpanded) {
      return;
    }
    sessionSearchInputRef.current?.focus();
  }, [sessionSearchExpanded]);

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
      <div
        className="sidebar-header sidebar-titlebar-box"
        data-testid="sidebar-titlebar"
        data-tauri-drag-region
        onMouseDown={handleNativeWindowDragMouseDown}
      >
        <div className="sidebar-header-left" data-no-window-drag>
          {props.onToggleSessions ? (
            <IconButton
              className="sidebar-sessions-toggle"
              data-testid="rail-chats-btn"
              label={
                props.sessionsExpanded ? copy.titlebar.collapseSidebar : copy.titlebar.expandSidebar
              }
              aria-expanded={props.sessionsExpanded}
              onClick={props.onToggleSessions}
            >
              <IconPanelLeft />
            </IconButton>
          ) : null}
        </div>

        <WindowDragRegion
          className="sidebar-titlebar-drag"
          data-testid="sidebar-titlebar-drag"
          aria-label={copy.titlebar.dragWindow}
        />

        <div className="sidebar-header-right sidebar-history" data-no-window-drag>
          <IconButton
            className="sidebar-history-btn"
            data-testid="sidebar-back-btn"
            label={copy.titlebar.back}
            disabled={!props.canGoBack}
            aria-disabled={!props.canGoBack}
            onClick={() => {
              if (props.canGoBack) {
                props.onGoBack?.();
              }
            }}
          >
            <IconChevronLeft />
          </IconButton>
          <IconButton
            className="sidebar-history-btn"
            data-testid="sidebar-forward-btn"
            label={copy.titlebar.forward}
            disabled={!props.canGoForward}
            aria-disabled={!props.canGoForward}
            onClick={() => {
              if (props.canGoForward) {
                props.onGoForward?.();
              }
            }}
          >
            <IconChevronRight />
          </IconButton>
        </div>
      </div>
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
            className="sidebar-action-row"
            data-testid="new-session-btn"
            onClick={() => props.onNewSession()}
            title={copy.newSession}
            aria-label={copy.newSession}
          >
            <IconPaperPlane />
            <span>{copy.newSession}</span>
          </button>

          {sessionSearchExpanded || hasActiveSessionSearch ? (
            <label className="search-field sidebar-search-field">
              <IconSearch />
              <input
                ref={sessionSearchInputRef}
                value={props.sessionSearch}
                onChange={(event) => props.onSessionSearchChange(event.target.value)}
                onBlur={() => {
                  if (!hasActiveSessionSearch) {
                    setSessionSearchExpanded(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    props.onSessionSearchChange('');
                    setSessionSearchExpanded(false);
                  }
                }}
                placeholder={copy.searchSessions}
                aria-label={copy.searchSessions}
                data-testid="session-search-input"
              />
            </label>
          ) : (
            <button
              type="button"
              className="sidebar-action-row"
              data-testid="session-search-btn"
              onClick={() => setSessionSearchExpanded(true)}
              title={copy.searchSessions}
              aria-label={copy.searchSessions}
            >
              <IconSearch />
              <span>{copy.searchSessions}</span>
            </button>
          )}
        </div>
      </div>

      {/* Unified Folder Tree (Antigravity project-conversation tree style) */}
      <div className="sidebar-folder-tree" data-testid="sessions-list">
        {/* Header Toolbar: Projects Title, Display Options, Add Project */}
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
        <div
          className="tree-node-list sidebar-section-content"
          id="projects-section-content"
          data-testid="projects-section-content"
          hidden={!projectsSectionExpanded}
        >
          {props.recentProjects.map((project) => {
            const isActiveProject = project.path === props.projectPath;
            const displayName = project.displayName ?? projectDisplayName(project.path);
            const projectScope: SessionScope = {
              kind: 'project',
              projectPath: project.path,
            };
            const hostProjectWindow =
              hasActiveSessionSearch || props.sessionListWindows === undefined
                ? null
                : getSessionListWindow(props.sessionListWindows, projectScope);
            const hostProjectBounds =
              hostProjectWindow === null ? null : getSessionListWindowBounds(hostProjectWindow);
            const projectPreviousCursor = hostProjectBounds?.previousCursor;
            const projectNextCursor = hostProjectBounds?.nextCursor;
            // Every project remains in the list. When a folder is expanded,
            // its sessions flow below the project row and push later projects
            // down naturally; the single folder-tree scrollbar handles the
            // full list.
            // Each folder shows its own sessions from the per-project map.
            // The active project falls back to the filtered active list so
            // search/archive filters still apply to the open project.
            const projectDrafts = selectDraftsForScope(
              props.draftSessions ?? [],
              projectScope,
              props.sessionSearch,
            );
            const projectHostSessions =
              (isActiveProject
                ? hostProjectWindow === null
                  ? sortedFilteredSessions
                  : props.filteredSessions
                : props.projectSessionsByPath?.[project.path]) ?? [];
            const projectSessions = mergeDraftsIntoSessionList(
              projectDrafts,
              projectHostSessions,
              sortBy,
            );

            const isProjectCollapsed = collapsedProjects[project.path] ?? false;
            const isProjectSessionListExpanded =
              hasActiveSessionSearch || (expandedProjectSessionLists[project.path] ?? false);
            const projectSessionTotalCount =
              (hostProjectBounds?.totalCount ?? projectHostSessions.length) + projectDrafts.length;
            const hasProjectSessionDisclosure =
              !hasActiveSessionSearch && projectSessionTotalCount > SESSION_LIST_PREVIEW_SIZE;
            const visibleProjectSessions = isProjectSessionListExpanded
              ? hostProjectWindow !== null
                ? projectSessions
                : selectSessionSidebarPage(
                    projectSessions,
                    PROJECT_SESSION_PAGE_SIZE * SESSION_LIST_WINDOW_MAX_PAGES,
                    null,
                    props.activeSessionId,
                  ).items
              : selectSessionSidebarPage(
                  projectSessions,
                  SESSION_LIST_PREVIEW_SIZE,
                  null,
                  props.activeSessionId,
                ).items;
            const projectScopeKey = sessionScopeKey(projectScope);
            const toggleProjectCollapsed = (): void => {
              setCollapsedProjects((previous) => ({
                ...previous,
                [project.path]: !(previous[project.path] ?? false),
              }));
            };

            return (
              <div key={project.path} className="tree-folder-details">
                <ContextMenu
                  label={sidebarCopy.projects}
                  testId="project-context-menu"
                  content={
                    <ContextMenuItem
                      testId="project-remove-from-sidebar"
                      onSelect={() => props.onRemoveProject(project.path)}
                    >
                      <IconTrash width={14} height={14} />
                      {sidebarCopy.removeProjectFromSidebar}
                    </ContextMenuItem>
                  }
                >
                  <div
                    className={
                      isActiveProject ? 'tree-folder-summary active' : 'tree-folder-summary'
                    }
                  >
                    {projectSessions.length > 0 ? (
                      <button
                        type="button"
                        className="tree-folder-toggle"
                        data-testid="project-fold-toggle"
                        aria-expanded={!isProjectCollapsed}
                        aria-label={
                          isProjectCollapsed
                            ? sidebarCopy.expandProject
                            : sidebarCopy.collapseProject
                        }
                        title={
                          isProjectCollapsed
                            ? sidebarCopy.expandProject
                            : sidebarCopy.collapseProject
                        }
                        onClick={toggleProjectCollapsed}
                      >
                        {isProjectCollapsed ? (
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
                      data-project-path={project.path}
                      aria-expanded={!isProjectCollapsed}
                      onClick={toggleProjectCollapsed}
                      title={project.path}
                    >
                      <span className="tree-folder-title">
                        <span>{displayName}</span>
                      </span>
                    </button>
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
                  </div>
                </ContextMenu>

                {/* Sessions under this project */}
                {!isProjectCollapsed && projectSessions.length > 0 ? (
                  <ul className="tree-session-list">
                    {isProjectSessionListExpanded && projectPreviousCursor !== undefined ? (
                      <SessionListLazyBoundary
                        scopeKey={projectScopeKey}
                        direction="previous"
                        cursor={projectPreviousCursor}
                        loadingLabel={sidebarCopy.loadingSessions}
                        onLoad={() =>
                          loadSessionWindowPage(projectScope, projectPreviousCursor, 'previous')
                        }
                      />
                    ) : null}
                    {visibleProjectSessions.map((session) => (
                      <SessionRowItem
                        key={session.id}
                        session={session}
                        activeSessionId={props.activeSessionId}
                        onResumeSession={props.onResumeSession}
                        onOpenSessionMenu={props.onOpenSessionMenu}
                        workingSessionIds={props.workingSessionIds}
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
                    ))}
                    {isProjectSessionListExpanded && projectNextCursor !== undefined ? (
                      <>
                        <SessionListLazyBoundary
                          scopeKey={projectScopeKey}
                          direction="next"
                          cursor={projectNextCursor}
                          loadingLabel={sidebarCopy.loadingSessions}
                          onLoad={() =>
                            loadSessionWindowPage(projectScope, projectNextCursor, 'next')
                          }
                        />
                        <li className="session-list-disclosure-row">
                          <Button
                            variant="ghost"
                            size="compact"
                            className="session-list-disclosure"
                            data-testid="load-more-project-sessions"
                            onClick={() => {
                              void loadSessionWindowPage(
                                projectScope,
                                projectNextCursor,
                                'next',
                              );
                            }}
                          >
                            {sidebarCopy.loadMoreSessions}
                          </Button>
                        </li>
                      </>
                    ) : null}
                    {hasProjectSessionDisclosure ? (
                      <li className="session-list-disclosure-row">
                        <Button
                          variant="ghost"
                          size="compact"
                          className="session-list-disclosure"
                          data-testid="see-all-btn"
                          onClick={() => {
                            const nextExpanded = !isProjectSessionListExpanded;
                            setExpandedProjectSessionLists((previous) => ({
                              ...previous,
                              [project.path]: nextExpanded,
                            }));
                            if (nextExpanded) {
                              void fillExpandedSessionWindow(projectScope);
                            } else {
                              resetSessionWindow(projectScope);
                            }
                          }}
                        >
                          {isProjectSessionListExpanded
                            ? sidebarCopy.showLess
                            : sidebarCopy.seeAll(projectSessionTotalCount)}
                        </Button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* SECTION 2: CONVERSATIONS (General / Non-Project Sessions) */}
        {(() => {
          // General sessions are maintained independently so the Conversations
          // section stays populated even when a project is active. The DOM owns
          // one small sliding Host-page window, never the complete collection.
          const generalScope: SessionScope = { kind: 'general' };
          const hostGeneralWindow =
            hasActiveSessionSearch || props.sessionListWindows === undefined
              ? null
              : getSessionListWindow(props.sessionListWindows, generalScope);
          const hostGeneralBounds =
            hostGeneralWindow === null ? null : getSessionListWindowBounds(hostGeneralWindow);
          const generalPreviousCursor = hostGeneralBounds?.previousCursor;
          const generalNextCursor = hostGeneralBounds?.nextCursor;
          const generalDrafts = selectDraftsForScope(
            props.draftSessions ?? [],
            generalScope,
            props.sessionSearch,
          );
          const generalHostSessions =
            hostGeneralWindow === null ? sortedGeneralSessions : props.generalSessions;
          const generalSessions = mergeDraftsIntoSessionList(
            generalDrafts,
            generalHostSessions,
            sortBy,
          );
          const isGeneralSessionListExpanded = hasActiveSessionSearch || generalSessionListExpanded;
          const generalSessionTotalCount =
            (hostGeneralBounds?.totalCount ?? generalHostSessions.length) + generalDrafts.length;
          const hasGeneralSessionDisclosure =
            !hasActiveSessionSearch && generalSessionTotalCount > SESSION_LIST_PREVIEW_SIZE;
          const visibleGeneralSessions = isGeneralSessionListExpanded
            ? hostGeneralWindow !== null
              ? generalSessions
              : selectSessionSidebarPage(
                  generalSessions,
                  GENERAL_SESSION_PAGE_SIZE * SESSION_LIST_WINDOW_MAX_PAGES,
                  null,
                  props.activeSessionId,
                ).items
            : selectSessionSidebarPage(
                generalSessions,
                SESSION_LIST_PREVIEW_SIZE,
                null,
                props.activeSessionId,
              ).items;
          const generalScopeKey = sessionScopeKey(generalScope);

          return (
            <div className="sidebar-conversations-section">
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
                    label={copy.newSession}
                    title={copy.newSession}
                    data-testid="general-workspace-btn"
                    onClick={() => props.onNewGeneralSession()}
                  >
                    <IconPlus width={14} height={14} />
                  </IconButton>
                </div>
              </div>

              <ul
                className="tree-session-list conversations-list sidebar-section-content"
                id="conversations-section-content"
                data-testid="conversations-section-content"
                hidden={!conversationsSectionExpanded}
              >
                {generalSessions.length > 0 ? (
                  <>
                    {isGeneralSessionListExpanded && generalPreviousCursor !== undefined ? (
                      <SessionListLazyBoundary
                        scopeKey={generalScopeKey}
                        direction="previous"
                        cursor={generalPreviousCursor}
                        loadingLabel={sidebarCopy.loadingSessions}
                        onLoad={() =>
                          loadSessionWindowPage(generalScope, generalPreviousCursor, 'previous')
                        }
                      />
                    ) : null}
                    {visibleGeneralSessions.map((session) => (
                      <SessionRowItem
                        key={session.id}
                        session={session}
                        activeSessionId={props.activeSessionId}
                        onResumeSession={props.onResumeSession}
                        onOpenSessionMenu={props.onOpenSessionMenu}
                        workingSessionIds={props.workingSessionIds}
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
                    ))}
                    {isGeneralSessionListExpanded && generalNextCursor !== undefined ? (
                      <>
                        <SessionListLazyBoundary
                          scopeKey={generalScopeKey}
                          direction="next"
                          cursor={generalNextCursor}
                          loadingLabel={sidebarCopy.loadingSessions}
                          onLoad={() =>
                            loadSessionWindowPage(generalScope, generalNextCursor, 'next')
                          }
                        />
                        <li className="session-list-disclosure-row">
                          <Button
                            variant="ghost"
                            size="compact"
                            className="session-list-disclosure"
                            data-testid="load-more-general-sessions"
                            onClick={() => {
                              void loadSessionWindowPage(
                                generalScope,
                                generalNextCursor,
                                'next',
                              );
                            }}
                          >
                            {sidebarCopy.loadMoreSessions}
                          </Button>
                        </li>
                      </>
                    ) : null}
                    {hasGeneralSessionDisclosure ? (
                      <li className="session-list-disclosure-row">
                        <Button
                          variant="ghost"
                          size="compact"
                          className="session-list-disclosure"
                          data-testid="see-all-general-btn"
                          onClick={() => {
                            const nextExpanded = !isGeneralSessionListExpanded;
                            setGeneralSessionListExpanded(nextExpanded);
                            if (nextExpanded) {
                              void fillExpandedSessionWindow(generalScope);
                            } else {
                              resetSessionWindow(generalScope);
                            }
                          }}
                        >
                          {isGeneralSessionListExpanded
                            ? sidebarCopy.showLess
                            : sidebarCopy.seeAll(generalSessionTotalCount)}
                        </Button>
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
    </aside>
  );
}
