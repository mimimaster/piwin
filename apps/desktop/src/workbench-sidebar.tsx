/**
 * Left navigator of the desktop workbench (extracted from App.tsx).
 * Host commands stay with App; this file owns archived hydration fan-out,
 * new-general-session sequencing, and capability-gated ProjectSessionSidebar props.
 */
import { useMemo, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import type { HostStatusData, ProjectRecord, SessionListOrder } from '@piwin/contracts';
import type { SidebarMode } from './sidebar-mode';
import type { ChatUiAction, ChatUiState, SessionListItemUi } from './chat-reducer';
import { prefetchSettingsPanel } from './deferred-desktop-surfaces';
import type { DesktopLocale } from './desktop-locale';
import type { DraftSessionItemUi } from './draft-session';
import type { HostClient } from './host-client';
import type { UseSidebarResizeResult } from './hooks/use-sidebar-resize';
import { resolveSessionDisplayName } from './hooks/use-session-list-chrome';
import { ProjectSessionSidebar } from './project-session-sidebar';
import { collectSessionsForLookup } from './session-list-lookup';
import type { SessionTimeGroup } from './session-groups';
import type { SessionRowMenuAction } from './session-row-menu';
import type { ShellSettingsSection } from './shell-navigation';
import { SIDEBAR_DEFAULT_WIDTH_PX } from './sidebar-width';
import { listArchivedHydrationRequests } from './workbench-chrome-assembly';
import { memoWithLatestCallbacks } from './memo-with-latest-callbacks';

export type WorkbenchSidebarHydrateSessions = (
  projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
  options?: {
    includeArchived?: boolean;
    order?: SessionListOrder;
  },
) => Promise<unknown>;

/** Window controls live in the titleband, so the sidebar only needs to close
 *  its own compact-drawer presentation. */
type SidebarShell = {
  closeOverlay: () => void;
};

/** Stable empty marker set so an empty permission queue does not churn memoized props. */
const EMPTY_SESSION_ID_MARKERS: Record<string, true> = {};

/**
 * Every chat reducer commit (each streamed delta) re-renders this file with new
 * inline handlers; only session-list data changes should repaint the navigator.
 */
const MemoProjectSessionSidebar = memoWithLatestCallbacks(ProjectSessionSidebar);

export type WorkbenchSidebarProps = {
  state: ChatUiState;
  hostClient: HostClient;
  hostStatus: HostStatusData | null;
  recentProjects: ProjectRecord[];
  filteredSessions: SessionListItemUi[];
  filteredGeneralSessions: SessionListItemUi[];
  sessionGroups: SessionTimeGroup<SessionListItemUi>[];
  sessionListOrder: SessionListOrder;
  onSessionListOrderChange: (order: SessionListOrder) => void;
  sessionSearch: string;
  onOpenSessionSearch: () => void;
  showArchivedSessions: boolean;
  setShowArchivedSessions: Dispatch<SetStateAction<boolean>>;
  hydrateSessions: WorkbenchSidebarHydrateSessions;
  settingsOpen: boolean;
  activeSubPage?:
    | 'chat'
    | 'library'
    | 'images'
    | 'videos'
    | 'flashcards'
    | 'knowledge'
    | 'marketplace'
    | null
    | undefined;
  onOpenLibrary?: () => void;
  onOpenImages?: () => void;
  onOpenVideos?: () => void;
  onOpenFlashcards?: () => void;
  onOpenKnowledge?: () => void;
  onOpenMarketplace?: () => void;
  onOpenWorkspace: () => void | Promise<void>;
  onOpenProject: (path: string) => void | Promise<void>;
  onRemoveProject: (path: string) => void | Promise<void>;
  onNewSession: (options?: {
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  }) => void | Promise<void>;
  onResumeSession: (sessionId: string) => void | Promise<void>;
  onResumeDraft: (draftId: string) => void | Promise<void>;
  draftSessions: DraftSessionItemUi[];
  activeDraftId: string | null | undefined;
  sessionMenu: { sessionId: string; x: number; y: number } | null | undefined;
  onOpenSessionMenu: (sessionId: string, x: number, y: number) => void;
  onSessionMenuAction: (sessionId: string, action: SessionRowMenuAction) => void | Promise<void>;
  onRequestDeleteSession: (sessionId: string, sessionName: string) => void;
  openSettingsSection: (section: ShellSettingsSection) => void;
  dispatch: Dispatch<ChatUiAction>;
  isOverlayPresentation: boolean;
  locale: DesktopLocale;
  sidebarResize: UseSidebarResizeResult;
  backendServiceSessionIds: Record<string, true>;
  shell: SidebarShell;
  sidebarMode: SidebarMode;
  onSidebarModeChange: (mode: SidebarMode) => void;
};

export function WorkbenchSidebar(props: WorkbenchSidebarProps): ReactElement {
  const {
    state,
    hostClient,
    hostStatus,
    recentProjects,
    filteredSessions,
    filteredGeneralSessions,
    sessionGroups,
    sessionListOrder,
    onSessionListOrderChange,
    sessionSearch,
    onOpenSessionSearch,
    showArchivedSessions,
    setShowArchivedSessions,
    hydrateSessions,
    settingsOpen,
    onOpenWorkspace,
    onOpenProject,
    onRemoveProject,
    onNewSession,
    onResumeSession,
    onResumeDraft,
    draftSessions,
    activeDraftId,
    sidebarMode,
    onSidebarModeChange,
    sessionMenu,
    onOpenSessionMenu,
    onSessionMenuAction,
    onRequestDeleteSession,
    openSettingsSection,
    dispatch,
    isOverlayPresentation,
    locale,
    sidebarResize,
    backendServiceSessionIds,
    shell,
  } = props;

  // Ink-line node "waiting-you" state: any session with a queued permission
  // prompt, foreground or background. Derived rather than reducer-tracked —
  // `permissionQueue` is already the single source of truth for this.
  const waitingPermissionSessionIds = useMemo(() => {
    if (state.permissionQueue.length === 0) {
      return EMPTY_SESSION_ID_MARKERS;
    }
    const ids: Record<string, true> = {};
    for (const prompt of state.permissionQueue) {
      ids[prompt.sessionId] = true;
    }
    return ids;
  }, [state.permissionQueue]);

  return (
    <MemoProjectSessionSidebar
      projectPath={state.projectPath}
      projectTrusted={state.projectTrusted}
      hostReady={state.hostReady}
      hostMock={state.hostMock}
      transportLabel={hostClient.getTransport()}
      hostStatus={hostStatus}
      recentProjects={recentProjects}
      sessions={state.sessions}
      filteredSessions={filteredSessions}
      generalSessions={filteredGeneralSessions}
      noRepoProjectPath={hostStatus?.generalWorkspacePath ?? null}
      projectSessionsByPath={state.projectSessionsByPath}
      sessionListScopes={state.sessionListScopes}
      sessionListOrder={sessionListOrder}
      onSessionListOrderChange={onSessionListOrderChange}
      sessionGroups={sessionGroups}
      activeSessionId={state.activeSessionId}
      sessionSearch={sessionSearch}
      onOpenSessionSearch={() => {
        if (isOverlayPresentation) {
          shell.closeOverlay();
        }
        onOpenSessionSearch();
      }}
      showArchivedSessions={showArchivedSessions}
      onToggleShowArchived={() => {
        const next = !showArchivedSessions;
        setShowArchivedSessions(next);
        for (const request of listArchivedHydrationRequests({
          includeArchived: next,
          order: sessionListOrder,
          recentProjects,
          activeProjectPath: state.projectPath,
        })) {
          void hydrateSessions(request.scope, request.options);
        }
      }}
      settingsOpen={settingsOpen}
      {...(hostClient.supportsCommand('project/open')
        ? { onOpenWorkspace: () => void onOpenWorkspace() }
        : {})}
      onOpenProject={(path) => void onOpenProject(path)}
      sidebarMode={sidebarMode}
      onSidebarModeChange={onSidebarModeChange}
      onOpenGeneral={() => {
        onSidebarModeChange('code');
        if (state.activeScope.kind === 'general') {
          return;
        }
        dispatch({ type: 'project/clear' });
        void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      }}
      {...(hostClient.supportsCommand('project/remove')
        ? {
            onRemoveProject: (path: string) => void onRemoveProject(path),
          }
        : {})}
      onNewSession={(options) => void onNewSession(options)}
      onNewGeneralSession={() => {
        void (async () => {
          // Conversations + stays on the chat pane and creates a general chat.
          // No Repo + is onNewSession(project) against the built-in workspace.
          dispatch({ type: 'project/clear' });
          await hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
          await onNewSession({ scope: { kind: 'general' } });
        })();
      }}
      onResumeSession={(sessionId) => void onResumeSession(sessionId)}
      onResumeDraft={onResumeDraft}
      draftSessions={draftSessions}
      activeDraftId={activeDraftId}
      sessionMenu={sessionMenu}
      onOpenSessionMenu={onOpenSessionMenu}
      onTogglePin={(sessionId, currentlyPinned) =>
        void onSessionMenuAction(sessionId, currentlyPinned ? 'unpin' : 'pin')
      }
      onArchiveSession={(sessionId) => void onSessionMenuAction(sessionId, 'archive')}
      onUnarchiveSession={(sessionId) => void onSessionMenuAction(sessionId, 'unarchive')}
      onDeleteSession={(sessionId) => {
        onRequestDeleteSession(
          sessionId,
          resolveSessionDisplayName(
            sessionId,
            collectSessionsForLookup({
              sessions: state.sessions,
              generalSessions: state.generalSessions,
              projectSessionsByPath: state.projectSessionsByPath,
            }),
          ),
        );
      }}
      onOpenSettings={() => openSettingsSection('general')}
      onPrefetchSettings={() => {
        void prefetchSettingsPanel();
      }}
      activeSubPage={props.activeSubPage}
      onOpenLibrary={props.onOpenLibrary}
      onOpenImages={props.onOpenImages}
      onOpenVideos={props.onOpenVideos}
      onOpenFlashcards={props.onOpenFlashcards}
      onOpenKnowledge={props.onOpenKnowledge}
      onOpenMarketplace={props.onOpenMarketplace}
      generalActive={state.activeScope.kind === 'general'}
      isOverlayPresentation={isOverlayPresentation}
      onCloseOverlay={() => shell.closeOverlay()}
      locale={locale}
      sidebarWidthPx={sidebarResize.widthPx}
      isResizing={sidebarResize.isResizing}
      onResizePointerDown={sidebarResize.onResizePointerDown}
      onResizeReset={() => sidebarResize.setWidthPx(SIDEBAR_DEFAULT_WIDTH_PX)}
      workingSessionIds={state.workingSessionIds}
      runPhase={state.runPhase}
      backendServiceSessionIds={backendServiceSessionIds}
      completedAttentionSessionIds={state.completedAttentionSessionIds}
      failedAttentionSessionIds={state.failedAttentionSessionIds}
      waitingPermissionSessionIds={waitingPermissionSessionIds}
      onDismissCompletedAttention={(sessionId) => {
        dispatch({ type: 'session/attention-dismiss', sessionId });
      }}
      onRetrySessionList={(scope) => {
        void hydrateSessions(scope, { includeArchived: showArchivedSessions });
      }}
    />
  );
}
