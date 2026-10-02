/**
 * Composer dock bindings assembled from host/session/composer runtimes.
 */
import type { ChatUiState } from '../chat-reducer';
import type { ExtensionUiResolvePayload } from '../extension-ui-prompt';
import type { HostClient } from '../host-client';
import type { ShellSettingsSection } from '../shell-navigation';
import { useMemo } from 'react';
import { resolveActiveComposerAgentId } from '../composer-dock-assembly.js';
import { useComposerDockProps } from './use-composer-dock-props';
import { useExtensionSlashCommands } from './use-extension-slash-commands';
import { useExtensionUiSurface } from './use-extension-ui-surface';
import { useSessionUsageTotals } from './use-session-usage-totals';
import type { WorkbenchComposerRuntime } from './use-workbench-composer-runtime';
import type { WorkbenchHostRuntime } from './use-workbench-host-runtime';
import type { WorkbenchSessionRuntime } from './use-workbench-session-runtime';
import type { WorkbenchShellChrome } from './use-workbench-shell-chrome';

export type UseWorkbenchComposerSurfaceArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  chrome: WorkbenchShellChrome;
  host: WorkbenchHostRuntime;
  session: WorkbenchSessionRuntime;
  composer: WorkbenchComposerRuntime;
  activeCommentsCount: number;
  activeDocumentTitle: string | undefined;
  onRemoveDocComments: () => void;
  onSendWithComments: (text?: string) => void | Promise<unknown>;
  handleExtensionUiResolve: (payload: ExtensionUiResolvePayload) => void | Promise<void>;
  handleExtensionUiAbort: () => void | Promise<void>;
  openSettingsSection: (section: ShellSettingsSection) => void;
  liveSessionId: string | null;
  onStartNewSession?: ((options?: {
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
    agentId?: string;
  }) => void | Promise<void>) | undefined;
};

export function useWorkbenchComposerSurface(args: UseWorkbenchComposerSurfaceArgs) {
  const {
    hostClient,
    state,
    chrome,
    host,
    session,
    composer,
    activeCommentsCount,
    activeDocumentTitle,
    onRemoveDocComments,
    onSendWithComments,
    handleExtensionUiResolve,
    handleExtensionUiAbort,
    openSettingsSection,
    liveSessionId,
  } = args;
  const {
    agentMode,
    setAgentMode,
    plusMenu,
    selectedModelKey,
    thinkingLevel,
    delegationDisabled,
    setDelegationDisabled,
    orchestrationSchemeId,
    sidebarMode,
    shell,
    openMarketplace,
  } = chrome;
  const {
    plusMenuOpen,
    setPlusMenuOpen,
    plusSubmenu,
    setPlusSubmenu,
    menuSkills,
    menuMcp,
    mcpSwitches,
    refreshComposerMenus,
  } = plusMenu;

  const extensionSurface = useExtensionUiSurface(hostClient, state.activeSessionId);
  const sessionUsageTotals = useSessionUsageTotals(hostClient, state.activeSessionId);
  const menuExtensionCommands = useExtensionSlashCommands(hostClient, state.hostReady);

  const dock = useComposerDockProps({
    hostClient,
    hostStatus: host.hostStatus,
    config: host.config,
    state,
    composer: composer.composer,
    setComposer: composer.setComposer,
    agentMode,
    setAgentMode,
    pendingAttachments: composer.pendingAttachments,
    revokePending: composer.revokePending,
    retryPendingAttachment: composer.retryPendingAttachment,
    retryFailedAttachments: composer.retryFailedAttachments,
    discardFailedAttachments: composer.discardFailedAttachments,
    pendingContextRefs: composer.pendingContextRefs,
    removeContextRef: composer.removeContextRef,
    addContextRef: composer.addContextRef,
    activeCommentsCount,
    activeDocumentTitle,
    onRemoveDocComments,
    dropActive: composer.dropActive,
    setDropActive: composer.setDropActive,
    plusMenuOpen,
    setPlusMenuOpen,
    plusSubmenu,
    setPlusSubmenu,
    modelOptions: host.modelOptions,
    selectedModelKey,
    selectedModelLabel: composer.selectedModelLabel,
    selectedModelContextWindow: composer.selectedModelContextWindow,
    onSelectModel: composer.handleSelectModel,
    menuSkills,
    menuMcp,
    menuMcpSwitches: mcpSwitches,
    refreshComposerMenus,
    openSettingsSection,
    onPickFiles: composer.handlePickFiles,
    onPickImageFiles: composer.handlePickImageFiles,
    onComposerPaste: composer.handleComposerPaste,
    onComposerDrop: composer.handleComposerDrop,
    onSendWithComments,
    onSteer: composer.handleSteer,
    onFollowUp: composer.handleFollowUp,
    onPause: () => {
      // Snapshot before the pause lands: a prompt with no visible reply yet
      // goes back to the composer once Host confirms the pause.
      composer.notePauseRequested();
      return session.handlePause();
    },
    onResumeRun: session.handleResumeRun,
    onAbort: session.handleAbort,
    onCompact: session.handleCompact,
    onOpenProject: session.handleOpenProject,
    onOpenWorktreeProject: (worktreePath) =>
      session.handleOpenProject(worktreePath, { switchSession: true }),
    onExtensionUiResolve: handleExtensionUiResolve,
    onExtensionUiAbort: handleExtensionUiAbort,
    extensionUiRequest: host.extensionUiRequest,
    extensionUiInput: host.extensionUiInput,
    setExtensionUiInput: host.setExtensionUiInput,
    thinkingLevel,
    onThinkingLevelChange: composer.handleThinkingLevelChange,
    backendControls: composer.backendControls,
    draftAgentOptions: composer.draftAgentOptions,
    draftAgentId: composer.draftAgentId,
    onDraftAgentChange: composer.onDraftAgentChange,
    onStartNewSession: args.onStartNewSession,
    capabilities: composer.capabilities,
    speechConfigured: host.speechConfigured,
    speechRequest: host.speechRequest,
    runModePreset: session.effectiveRunMode,
    onRunModeChange: session.handleRunModeChange,
    onRunModeSetDefault: session.handleRunModeSetDefault,
    orchestrationSchemeId,
    orchestrationSchemeOptions: host.orchestrationSchemeOptions,
    delegationDisabled,
    setDelegationDisabled,
    setOrchestrationSchemeId: composer.selectOrchestrationScheme,
    requestGit: host.requestGit,
    recentProjects: session.recentProjects,
    activeJobs: host.activeJobsForComposer,
    stopJob: host.stopJob,
    viewJobLogs: host.viewJobLogs,
    openInspector: shell.openInspector,
    steerQueueMessages: composer.steerQueueMessages,
    onSteerQueueSendNow: composer.handleSteerQueueSendNow,
    onSteerQueueEdit: composer.handleSteerQueueEdit,
    onSteerQueueRemove: composer.handleSteerQueueRemove,
    queuedTurnEditId: composer.queuedTurnEditId,
    onQueuedEditCancel: composer.cancelQueuedTurnEdit,
    ensureSession: session.ensureSession,
    liveSessionId,
    sidebarMode,
  });
  // Extension surface and commands are merged here so the large dock-props
  // assembly does not grow another dependency list.
  const activeAgentId = resolveActiveComposerAgentId(state);
  const composerCard = useMemo(
    () => ({
      ...dock.composerCard,
      ...(activeAgentId !== undefined ? { activeAgentId } : {}),
      extensionSurface,
      menuExtensionCommands,
      sessionUsageTotals,
      onOpenExtensionsPanel: () => openSettingsSection('extensions'),
      onOpenMarketplace: openMarketplace,
      onOpenAgentSettings: () => openSettingsSection('agent-backends'),
    }),
    [
      dock.composerCard,
      activeAgentId,
      extensionSurface,
      menuExtensionCommands,
      sessionUsageTotals,
      openSettingsSection,
      openMarketplace,
    ],
  );
  return { ...dock, composerCard };
}
