/**
 * The workbench's stackable layers around the shell chrome: the stage content
 * `WorkspaceShell` renders in its stage region, the in-shell floating layers
 * (live bar, replace confirm, overlays), and the subpage/settings mounts that
 * sit beside the app shell.
 *
 * Extracted from `AppWorkbench`; every prop and its source is unchanged.
 */
import type { Dispatch, ReactNode } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { artifactSurfaceProps, resolveArtifactSurfacesForScope } from './artifact-surfaces';
import type { ChatUiAction, ChatUiState } from './chat-ui-types';
import { resolveNoRepoWorkspaceKey } from './file-browse-root';
import { sessionScopeKey } from './session-scope-key';
import { DesktopAttentionLayer } from './hooks/use-desktop-attention';
import type { useShellSessionOpen } from './hooks/use-shell-session-open';
import type { useWindowsShellOffer } from './hooks/use-windows-shell-offer';
import { useWorkbenchAppModel } from './hooks/use-workbench-app-model';
import type { useWorkbenchKnowledge } from './hooks/use-workbench-knowledge';
import type { useWorkbenchMedia } from './hooks/use-workbench-media';
import type { WorkbenchShellChrome } from './hooks/use-workbench-shell-chrome';
import type { HostClient } from './host-client';
import { LiveBar } from './live/LiveBar.js';
import type { useConversationPaneLayout } from './use-conversation-pane-layout';
import type { useDockingWorkspace } from './workbench/docking/use-docking-workspace';
import { WorkbenchConversationStage } from './workbench-conversation-stage';
import { WorkbenchOverlays, WorkbenchSettingsOverlay } from './workbench-overlays';
import { WorkbenchSubpageStage } from './workbench-subpage-stage';
import { WindowsShellOfferBanner } from './windows-shell-offer-banner';

type AppModel = ReturnType<typeof useWorkbenchAppModel>;
type Knowledge = ReturnType<typeof useWorkbenchKnowledge>;

export type WorkbenchStageLayerProps = {
  primaryPane: ReactNode;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  chrome: WorkbenchShellChrome;
  model: AppModel;
  windowsShellOffer: ReturnType<typeof useWindowsShellOffer>;
  dockingEnabled: boolean;
  dockingWorkspace: ReturnType<typeof useDockingWorkspace>;
  conversationPanesEnabled: boolean;
  conversationPaneController: ReturnType<typeof useConversationPaneLayout>;
  openSessionFromShell: ReturnType<typeof useShellSessionOpen>;
  handleCreatePaneConversation: (paneId: string) => Promise<string | null>;
};

export function WorkbenchStageLayer(props: WorkbenchStageLayerProps) {
  const { primaryPane, state, dispatch, hostClient, activeTheme, chrome, model } = props;
  const { windowsShellOffer, dockingEnabled, dockingWorkspace } = props;
  const { conversationPanesEnabled, conversationPaneController } = props;
  const { openSessionFromShell, handleCreatePaneConversation } = props;
  const { activeSubPage, desktopLocale, isOverlayPresentation, layoutMode, settingsOpen } = chrome;
  const { activeSessionName, artifactThemeKey, config, extensionUiRequest } = model;
  const { handleOpenArtifactCanvas, handleOpenDocument, handleResumeSession } = model;
  const { fileBrowseRoot, hostStatus, readTranscriptMedia, recentProjects } = model;
  return (
    <>
      <WindowsShellOfferBanner
        visible={windowsShellOffer.offer}
        locale={desktopLocale}
        onUseGitBash={windowsShellOffer.useGitBash}
        onDecline={windowsShellOffer.declineGitBash}
      />
      <DesktopAttentionLayer
        hostClient={hostClient}
        state={state}
        dispatch={dispatch}
        locale={desktopLocale}
        hostStatus={hostStatus}
        extensionUiRequest={extensionUiRequest}
        isOverlayPresentation={isOverlayPresentation}
        activeSubPage={activeSubPage}
        dockingEnabled={dockingEnabled}
        dockingWorkspace={dockingWorkspace}
        conversationPanesEnabled={conversationPanesEnabled}
        conversationPaneController={conversationPaneController}
        openSessionFromShell={openSessionFromShell}
        recentProjects={recentProjects}
      >
        <WorkbenchConversationStage
          primaryPane={primaryPane}
          dockingEnabled={dockingEnabled}
          docking={dockingWorkspace}
          conversationPanesEnabled={conversationPanesEnabled}
          conversationPaneController={conversationPaneController}
          phoneSinglePane={layoutMode === 'phone'}
          primarySessionId={state.activeSessionId}
          onPromoteSession={(sessionId) => void handleResumeSession(sessionId)}
          activeProjectScopeKey={sessionScopeKey(state.activeScope)}
          primarySessionName={
            activeSessionName || (desktopLocale === 'zh-CN' ? '素笺' : 'Clean Slate')
          }
          sessions={state.activeScope.kind === 'general' ? state.generalSessions : state.sessions}
          hostClient={hostClient}
          activeTheme={activeTheme}
          artifactThemeKey={artifactThemeKey}
          {...artifactSurfaceProps(
            resolveArtifactSurfacesForScope(config?.artifact, state.activeScope),
          )}
          readMedia={readTranscriptMedia}
          locale={desktopLocale}
          keyboardEnabled={!settingsOpen && !activeSubPage}
          onCreateConversation={handleCreatePaneConversation}
          onOpenDocument={handleOpenDocument}
          onOpenArtifactCanvas={handleOpenArtifactCanvas}
          fileBrowseRoot={fileBrowseRoot}
        />
      </DesktopAttentionLayer>
    </>
  );
}

/**
 * In-shell floating layers: the live-call bar, the foreground-replace confirm,
 * and the modal overlays. They sit inside the app-shell element, so they ride
 * on the same contexts as the shell they float over.
 */
export type WorkbenchShellOverlaysProps = {
  state: ChatUiState;
  hostClient: HostClient;
  chrome: WorkbenchShellChrome;
  sessionListChrome: WorkbenchShellChrome['sessionListChrome'];
  sessionListQuery: WorkbenchShellChrome['sessionListQuery'];
  model: AppModel;
  liveSessionId: string | null;
};

export function WorkbenchShellOverlays(props: WorkbenchShellOverlaysProps) {
  const { state, hostClient, chrome, sessionListChrome, sessionListQuery, model, liveSessionId } =
    props;
  const { commandPaletteOpen, desktopLocale, foregroundReplaceConfirm } = chrome;
  const { projectInput, setProjectInput, shell } = chrome;
  const { closeContinueInProject, closeDeleteConfirm, closeSessionMenu } = sessionListChrome;
  const { continueInProject, continueInProjectBusy, deleteBusy, deleteConfirm } = sessionListChrome;
  const { projectPickerOpen, renameDraft, requestContinueInProject, requestDeleteSession } =
    sessionListChrome;
  const { runContinueInProject, runDeleteConfirm, sessionMenu, sessionSearch } = sessionListChrome;
  const { sessionSearchOpen, setProjectPickerOpen, setRenameDraft, setSessionSearch } =
    sessionListChrome;
  const { setSessionSearchOpen } = sessionListChrome;
  const { filteredGeneralSessions, filteredSessions } = sessionListQuery;
  const { cancelBranchLeaves, cancelRetryDiscard, cancelSwitchBranch } = model;
  const { cancelTruncateAfter, clearColdRestorePrompt, coldRestorePrompt } = model;
  const { confirmBranchLeaves, confirmColdRestore, confirmDeleteSession } = model;
  const { confirmRetryDiscard, confirmSwitchBranch, confirmTruncateAfter } = model;
  const { handleBrowseProject, handleContinueSessionInProject, handleDesktopCommand } = model;
  const { handleOpenProject, handlePermission, handleRenameSession } = model;
  const { handleResumeSession, handleSessionMenuAction, handleTrustProject, hostStatus } = model;
  const { live, pendingBranchLeaves, pendingRetryDiscard, pendingSwitchConfirm } = model;
  const { pendingTruncate, recentProjects, startBackendSession, stashThenSwitchBranch } = model;
  return (
    <>
      {live.starting || live.call ? (
        <div className="live-bar-host">
          <LiveBar
            call={live.call}
            starting={live.starting}
            peer={live.peer}
            error={live.error}
            intendedSessionId={liveSessionId}
            onRetry={() => {
              // Start-failure chrome only; LiveBar hides Retry while a call is up.
              if (live.call) return;
              void live.start();
            }}
            onDismiss={live.dismissError}
            onMute={(muted) => {
              void live.setMuted(muted);
            }}
            onEnd={() => {
              void live.end();
            }}
          />
        </div>
      ) : null}

      {foregroundReplaceConfirm.dialog}

      <WorkbenchOverlays
        state={state}
        hostClient={hostClient}
        locale={desktopLocale}
        projectInput={projectInput}
        setProjectInput={setProjectInput}
        projectPickerOpen={projectPickerOpen}
        setProjectPickerOpen={setProjectPickerOpen}
        onOpenProject={handleOpenProject}
        onBrowseProject={handleBrowseProject}
        onTrustProject={handleTrustProject}
        sessionMenu={sessionMenu}
        closeSessionMenu={closeSessionMenu}
        onSessionMenuAction={handleSessionMenuAction}
        requestDeleteSession={requestDeleteSession}
        requestContinueInProject={requestContinueInProject}
        renameDraft={renameDraft}
        setRenameDraft={setRenameDraft}
        onRenameSession={handleRenameSession}
        onPermission={handlePermission}
        deleteConfirm={deleteConfirm}
        deleteBusy={deleteBusy}
        closeDeleteConfirm={closeDeleteConfirm}
        runDeleteConfirm={runDeleteConfirm}
        confirmDeleteSession={confirmDeleteSession}
        continueInProject={continueInProject}
        continueInProjectBusy={continueInProjectBusy}
        closeContinueInProject={closeContinueInProject}
        runContinueInProject={runContinueInProject}
        onContinueSessionInProject={handleContinueSessionInProject}
        recentProjects={recentProjects}
        noRepoProjectPath={resolveNoRepoWorkspaceKey({
          generalWorkspacePath: hostStatus?.generalWorkspacePath,
          generalWorkspaceProjectId: hostStatus?.generalWorkspaceProjectId,
        })}
        sessionSearchOpen={sessionSearchOpen}
        onSessionSearchOpenChange={setSessionSearchOpen}
        sessionSearch={sessionSearch}
        onSessionSearchChange={setSessionSearch}
        filteredSessions={filteredSessions}
        filteredGeneralSessions={filteredGeneralSessions}
        onOpenSession={handleResumeSession}
        commandPaletteOpen={commandPaletteOpen}
        setCommandPaletteOpen={shell.setCommandPaletteOpen}
        onRunCommand={handleDesktopCommand}
        onStartBackendSession={startBackendSession}
        coldRestorePrompt={coldRestorePrompt}
        clearColdRestorePrompt={clearColdRestorePrompt}
        confirmColdRestore={confirmColdRestore}
        pendingTruncate={pendingTruncate}
        cancelTruncateAfter={cancelTruncateAfter}
        confirmTruncateAfter={confirmTruncateAfter}
        pendingSwitchConfirm={pendingSwitchConfirm}
        cancelSwitchBranch={cancelSwitchBranch}
        confirmSwitchBranch={confirmSwitchBranch}
        stashThenSwitchBranch={stashThenSwitchBranch}
        pendingRetryDiscard={pendingRetryDiscard}
        cancelRetryDiscard={cancelRetryDiscard}
        confirmRetryDiscard={confirmRetryDiscard}
        pendingBranchLeaves={pendingBranchLeaves}
        cancelBranchLeaves={cancelBranchLeaves}
        confirmBranchLeaves={confirmBranchLeaves}
      />
    </>
  );
}

/**
 * The subpage stage and the settings overlay: mounted beside the app-shell
 * element rather than inside it, so a full-screen subpage cannot be clipped by
 * the shell's layout.
 */
export type WorkbenchStageMountsProps = {
  state: ChatUiState;
  hostClient: HostClient;
  chrome: WorkbenchShellChrome;
  model: AppModel;
  activeTheme: ThemeManifest;
  knowledge: Knowledge;
  knowledgeSupported: boolean;
  mediaLibraryEpoch: number;
  handleRemixToComposer: ReturnType<typeof useWorkbenchMedia>['handleRemixToComposer'];
  onThemeApplied: (theme: ThemeManifest) => void;
  children?: ReactNode;
};

export function WorkbenchStageMounts(props: WorkbenchStageMountsProps) {
  const { state, hostClient, chrome, model, knowledge, knowledgeSupported } = props;
  const { activeTheme, mediaLibraryEpoch, handleRemixToComposer, onThemeApplied } = props;
  const { activeSubPage, closeSubPage, desktopLocale, flashcardsEntry } = chrome;
  const { flashcardsFolderPath, openFlashcardsProduce, preferences } = chrome;
  const { settingsOpen, settingsSection, shell } = chrome;
  const { config, handleResumeSession, handleSettingsOpenSubagentSession } = model;
  const { handleSettingsPreferencesChange, handleSettingsSaved, hostStatus } = model;
  const { openSettingsSection, requestAutomation, requestConfig, requestExtensions } = model;
  const { requestMcp, requestPet, requestPlugins, requestPrompts } = model;
  const { requestSkills, requestSubAgent, setActivePet } = model;
  return (
    <>
      <WorkbenchSubpageStage
        activeSubPage={activeSubPage}
        locale={desktopLocale}
        onClose={closeSubPage}
        request={(command) => hostClient.request(command)}
        requestFlashcards={(command, options) => hostClient.request(command, options)}
        refreshToken={mediaLibraryEpoch}
        onRemixToComposer={handleRemixToComposer}
        subscribeHostMessages={(listener) => hostClient.subscribe(listener)}
        projectPath={state.projectPath}
        sessionId={state.activeSessionId}
        onConfigureEmbedding={() => {
          closeSubPage();
          openSettingsSection('knowledge');
        }}
        subscribePush={(listener) =>
          hostClient.subscribe((message) => {
            if (message.type === 'flashcards/study/changed') listener(message);
          })
        }
        subscribeConnected={(listener) => {
          listener(hostClient.isReady());
          return hostClient.subscribe((message) => {
            if (message.type === 'host/status') listener(message.ready);
          });
        }}
        hasStudyCapability={() => hostStatus?.capabilities.flashcardStudy === true}
        flashcardsEntry={flashcardsEntry}
        flashcardsFolderPath={flashcardsFolderPath}
        onOpenSession={handleResumeSession}
        subscribeKnowledgePush={knowledge.subscribeKnowledgePush}
        knowledgeSupported={knowledgeSupported}
        onOpenIngest={openFlashcardsProduce}
        onUseKnowledgeInChat={knowledge.useInChat}
        onOpenKnowledgeCitation={knowledge.citationActions.openCitation}
      />
      <WorkbenchSettingsOverlay
        settingsOpen={settingsOpen}
        locale={desktopLocale}
        hostStatus={hostStatus}
        hostClient={hostClient}
        requestConfig={requestConfig}
        preferences={preferences}
        activeTheme={activeTheme}
        onPreferencesChange={handleSettingsPreferencesChange}
        settingsSection={settingsSection}
        onSettingsSectionChange={shell.setSettingsSection}
        state={state}
        requestSkills={requestSkills}
        requestMcp={requestMcp}
        requestExtensions={requestExtensions}
        requestPlugins={requestPlugins}
        requestPrompts={requestPrompts}
        requestPet={requestPet}
        requestAutomation={requestAutomation}
        requestSubAgent={requestSubAgent}
        onOpenSubagentSession={handleSettingsOpenSubagentSession}
        onThemeApplied={onThemeApplied}
        onPetActiveChanged={setActivePet}
        onCloseSettings={shell.closeSettings}
        onSettingsSaved={handleSettingsSaved}
        config={config}
      />
    </>
  );
}
