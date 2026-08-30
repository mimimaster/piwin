/**
 * Composer dock bindings assembled from host/session/composer runtimes.
 */
import type { ChatUiState } from '../chat-reducer';
import type { ExtensionUiResolvePayload } from '../extension-ui-prompt';
import type { HostClient } from '../host-client';
import type { ShellSettingsSection } from '../shell-navigation';
import { useComposerDockProps } from './use-composer-dock-props';
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
  onSendWithComments: () => void | Promise<unknown>;
  handleExtensionUiResolve: (payload: ExtensionUiResolvePayload) => void | Promise<void>;
  handleExtensionUiAbort: () => void | Promise<void>;
  openSettingsSection: (section: ShellSettingsSection) => void;
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
  } = args;
  const {
    agentMode,
    setAgentMode,
    plusMenu,
    selectedModelKey,
    thinkingLevel,
    handleOpenKnowledge,
    handleOpenCardsPanel,
    delegationDisabled,
    setDelegationDisabled,
    orchestrationSchemeId,
    setOrchestrationSchemeId,
    shell,
  } = chrome;
  const {
    plusMenuOpen,
    setPlusMenuOpen,
    plusSubmenu,
    setPlusSubmenu,
    menuSkills,
    menuMcp,
    refreshComposerMenus,
  } = plusMenu;

  return useComposerDockProps({
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
    refreshComposerMenus,
    openSettingsSection,
    onOpenKnowledge: handleOpenKnowledge,
    onOpenCardsPanel: handleOpenCardsPanel,
    onPickFiles: composer.handlePickFiles,
    onPickImageFiles: composer.handlePickImageFiles,
    onComposerPaste: composer.handleComposerPaste,
    onComposerDrop: composer.handleComposerDrop,
    onSendWithComments,
    onSteer: composer.handleSteer,
    onFollowUp: composer.handleFollowUp,
    onPause: session.handlePause,
    onResumeRun: session.handleResumeRun,
    onAbort: session.handleAbort,
    onCompact: session.handleCompact,
    onOpenProject: session.handleOpenProject,
    onExtensionUiResolve: handleExtensionUiResolve,
    onExtensionUiAbort: handleExtensionUiAbort,
    extensionUiRequest: host.extensionUiRequest,
    extensionUiInput: host.extensionUiInput,
    setExtensionUiInput: host.setExtensionUiInput,
    thinkingLevel,
    onThinkingLevelChange: composer.handleThinkingLevelChange,
    speechConfigured: host.speechConfigured,
    speechRequest: host.speechRequest,
    runModePreset: session.effectiveRunMode,
    onRunModeChange: session.handleRunModeChange,
    onRunModeSetDefault: session.handleRunModeSetDefault,
    orchestrationSchemeId,
    orchestrationSchemeOptions: host.orchestrationSchemeOptions,
    delegationDisabled,
    setDelegationDisabled,
    setOrchestrationSchemeId,
    requestGit: host.requestGit,
    recentProjects: session.recentProjects,
    activeJobs: host.activeJobsForComposer,
    stopJob: host.stopJob,
    openInspector: shell.openInspector,
    steerQueueMessages: composer.steerQueueMessages,
    onSteerQueueSendNow: composer.handleSteerQueueSendNow,
    onSteerQueueEdit: composer.handleSteerQueueEdit,
    onSteerQueueRemove: composer.handleSteerQueueRemove,
    ensureSession: session.ensureSession,
  });
}
