/**
 * Left navigator of the desktop workbench (extracted from App.tsx).
 * Host commands stay with App; this file owns archived hydration fan-out,
 * new-general-session sequencing, and capability-gated ProjectSessionSidebar props.
 */
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import type { HostStatusData, ProjectRecord, SessionListOrder } from '@piwin/contracts';
import type { ChatUiAction, ChatUiState, SessionListItemUi } from './chat-reducer';
import type { DesktopLocale } from './desktop-locale';
import type { DraftSessionItemUi } from './draft-session';
import type { HostClient } from './host-client';
import type { UseSidebarResizeResult } from './hooks/use-sidebar-resize';
import { resolveSessionDisplayName } from './hooks/use-session-list-chrome';
import { ProjectSessionSidebar } from './project-session-sidebar';
import { mergeSessionsForLookup } from './session-list-lookup';
import type { SessionTimeGroup } from './session-groups';
import type { SessionRowMenuAction } from './session-row-menu';
import type { ShellSettingsSection } from './shell-navigation';
import { SIDEBAR_DEFAULT_WIDTH_PX } from './sidebar-width';
import { listArchivedHydrationRequests } from './workbench-chrome-assembly';

export type WorkbenchSidebarHydrateSessions = (
  projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
  options?: {
    includeArchived?: boolean;
    order?: SessionListOrder;
    fillActiveList?: boolean;
  },
) => Promise<unknown>;

type SidebarShell = {
  closeOverlay: () => void;
  toggleSessions: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
};

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
  onSessionSearchChange: (value: string) => void;
  showArchivedSessions: boolean;
  setShowArchivedSessions: Dispatch<SetStateAction<boolean>>;
  hydrateSessions: WorkbenchSidebarHydrateSessions;
  settingsOpen: boolean;
  knowledgeOpen: boolean;
  setKnowledgeOpen: Dispatch<SetStateAction<boolean>>;
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
  sessionsExpanded: boolean;
  shell: SidebarShell;
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
    onSessionSearchChange,
    showArchivedSessions,
    setShowArchivedSessions,
    hydrateSessions,
    settingsOpen,
    knowledgeOpen,
    setKnowledgeOpen,
    onOpenWorkspace,
    onOpenProject,
    onRemoveProject,
    onNewSession,
    onResumeSession,
    onResumeDraft,
    draftSessions,
    activeDraftId,
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
    sessionsExpanded,
    shell,
  } = props;

  return (
    <ProjectSessionSidebar
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
      projectSessionsByPath={state.projectSessionsByPath}
      sessionListScopes={state.sessionListScopes}
      sessionListOrder={sessionListOrder}
      onSessionListOrderChange={onSessionListOrderChange}
      sessionGroups={sessionGroups}
      activeSessionId={state.activeSessionId}
      sessionSearch={sessionSearch}
      onSessionSearchChange={onSessionSearchChange}
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
      {...(hostClient.supportsCommand('project/remove')
        ? {
            onRemoveProject: (path: string) => void onRemoveProject(path),
          }
        : {})}
      onNewSession={() => void onNewSession()}
      onNewGeneralSession={() => {
        void (async () => {
          // Sequence: switch scope → hydrate general list → create new
          // general session. Awaiting hydrate before create avoids the
          // session/hydrate dispatch clobbering session/add, and the
          // explicit general scope avoids reading stale activeScope.
          dispatch({ type: 'project/clear' });
          await hydrateSessions(
            { kind: 'general' },
            { includeArchived: showArchivedSessions },
          );
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
            mergeSessionsForLookup(state.sessions, state.generalSessions),
          ),
        );
      }}
      onOpenSettings={() => openSettingsSection('general')}
      knowledgeOpen={knowledgeOpen}
      {...(hostClient.supportsCommand('doccards/scan-folder')
        ? { onToggleKnowledge: () => setKnowledgeOpen((current) => !current) }
        : {})}
      generalActive={state.activeScope.kind === 'general'}
      onSelectGeneral={() => {
        dispatch({ type: 'project/clear' });
        void hydrateSessions(
          { kind: 'general' },
          { includeArchived: showArchivedSessions },
        );
      }}
      isOverlayPresentation={isOverlayPresentation}
      onCloseOverlay={() => shell.closeOverlay()}
      locale={locale}
      sidebarWidthPx={sidebarResize.widthPx}
      isResizing={sidebarResize.isResizing}
      onResizePointerDown={sidebarResize.onResizePointerDown}
      onResizeReset={() => sidebarResize.setWidthPx(SIDEBAR_DEFAULT_WIDTH_PX)}
      workingSessionIds={state.workingSessionIds}
      backendServiceSessionIds={backendServiceSessionIds}
      completedAttentionSessionIds={state.completedAttentionSessionIds}
      onDismissCompletedAttention={(sessionId) => {
        dispatch({ type: 'session/attention-dismiss', sessionId });
      }}
      sessionsExpanded={sessionsExpanded}
      onToggleSessions={() => {
        shell.toggleSessions();
      }}
      canGoBack={shell.canGoBack}
      canGoForward={shell.canGoForward}
      onGoBack={() => {
        shell.goBack();
      }}
      onGoForward={() => {
        shell.goForward();
      }}
    />
  );
}
