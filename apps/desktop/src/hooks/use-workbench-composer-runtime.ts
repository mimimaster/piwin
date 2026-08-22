/**
 * Composer model, context chips, and media/send stack.
 */
import type { Dispatch } from 'react';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useComposerContextRefs } from './use-composer-context-refs';
import { useComposerMedia } from './use-composer-media';
import { useComposerModelController } from './use-composer-model';
import type { WorkbenchHostRuntime } from './use-workbench-host-runtime';
import type { WorkbenchSessionRuntime } from './use-workbench-session-runtime';
import type { WorkbenchShellChrome } from './use-workbench-shell-chrome';

export type UseWorkbenchComposerRuntimeArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  chrome: WorkbenchShellChrome;
  host: WorkbenchHostRuntime;
  session: WorkbenchSessionRuntime;
};

export function useWorkbenchComposerRuntime(args: UseWorkbenchComposerRuntimeArgs) {
  const { hostClient, state, dispatch, chrome, host, session } = args;
  const {
    agentMode,
    setAgentMode,
    orchestrationSchemeId,
    setOrchestrationSchemeId,
    delegationDisabled,
    composerSetterRef,
    selectedModelKey,
    setSelectedModelKey,
    thinkingLevel,
    setThinkingLevel,
    sessionComposerProfileRestoredRef,
    plusMenu,
    handleOpenKnowledge,
    handleOpenCardsPanel,
    confirmBusyRun,
    confirmForegroundReplace,
  } = chrome;
  const { menuSkills } = plusMenu;

  const {
    handleSelectModel,
    handleThinkingLevelChange,
    selectedModelLabel,
    selectedModelContextWindow,
    currentPromptModelRef,
  } = useComposerModelController({
    hostClient,
    config: host.config,
    setConfig: host.setConfig,
    modelOptions: host.modelOptions,
    defaultProviderId: host.defaultProviderId,
    defaultModelId: host.defaultModelId,
    selectedModelKey,
    setSelectedModelKey,
    thinkingLevel,
    setThinkingLevel,
    sessions: state.sessions,
    generalSessions: state.generalSessions,
    activeSessionId: state.activeSessionId,
    contextUsage: state.contextUsage,
    streaming: state.streaming,
    compacting: state.compacting,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    saveSettingsInOrder: session.saveSettingsInOrder,
    sessionComposerProfileRestoredRef,
  });

  const {
    pendingContextRefs,
    addContextRef,
    removeContextRef,
    clearContextRefs,
    snapshotContextRefs,
    snapshotContextRefTokens,
    consumeContextRefSnapshot,
    replaceContextRefs,
  } = useComposerContextRefs();

  const {
    composer,
    setComposer,
    draftSessions,
    activeDraftId,
    startNewDraft,
    resumeDraft,
    pendingAttachments,
    dropActive,
    setDropActive,
    revokePending,
    handleComposerPaste,
    handleComposerDrop,
    handlePickFiles,
    handlePickImageFiles,
    addWebElement,
    handleSend,
    retryPendingAttachment,
    retryFailedAttachments,
    discardFailedAttachments,
    handleSteer,
    handleFollowUp,
    steerQueueMessages,
    handleSteerQueueSendNow,
    handleSteerQueueEdit,
    handleSteerQueueRemove,
  } = useComposerMedia({
    hostClient,
    state,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    agentMode,
    orchestrationSchemeId,
    onOrchestrationSchemeChange: setOrchestrationSchemeId,
    onAgentModeChange: setAgentMode,
    menuSkills,
    conversationChat: state.activeScope.kind === 'general',
    onOpenKnowledge: handleOpenKnowledge,
    onOpenCardsPanel: handleOpenCardsPanel,
    onCompact: session.handleCompact,
    onAbort: session.handleAbort,
    ensureSession: session.ensureSession,
    onNeedWorkspace: session.handleOpenWorkspaceClick,
    selectedModelKey,
    modelOptions: host.modelOptions,
    thinkingLevel,
    delegationDisabled,
    visionDelegationEnabled: host.config?.visionDelegation?.enabled === true,
    confirmBusyRun,
    confirmForegroundReplace,
    confirmTextOnlyImageSend: async (message) => {
      // Lightweight confirm; host still path-injects if user continues.
      return window.confirm(message);
    },
    getPendingContextRefs: snapshotContextRefs,
    getPendingContextRefTokens: snapshotContextRefTokens,
    clearPendingContextRefs: clearContextRefs,
    consumePendingContextRefs: consumeContextRefSnapshot,
    restorePendingContextRefs: replaceContextRefs,
    addContextRefFromDrop: ({ relativePath }) => {
      if (!state.projectPath) {
        return false;
      }
      const result = addContextRef({
        kind: 'file',
        projectPath: state.projectPath,
        relativePath,
        label: relativePath,
      });
      if (!result.ok) {
        host.dispatchNotification({
          type: 'notify/push',
          notification: {
            level: 'warning',
            message: 'Context chip limit reached (12). Remove one first.',
          },
        });
        return false;
      }
      return true;
    },
  });
  composerSetterRef.current = setComposer;

  return {
    handleSelectModel,
    handleThinkingLevelChange,
    selectedModelLabel,
    selectedModelContextWindow,
    currentPromptModelRef,
    pendingContextRefs,
    addContextRef,
    removeContextRef,
    composer,
    setComposer,
    draftSessions,
    activeDraftId,
    startNewDraft,
    resumeDraft,
    pendingAttachments,
    dropActive,
    setDropActive,
    revokePending,
    handleComposerPaste,
    handleComposerDrop,
    handlePickFiles,
    handlePickImageFiles,
    addWebElement,
    handleSend,
    retryPendingAttachment,
    retryFailedAttachments,
    discardFailedAttachments,
    handleSteer,
    handleFollowUp,
    steerQueueMessages,
    handleSteerQueueSendNow,
    handleSteerQueueEdit,
    handleSteerQueueRemove,
  };
}

export type WorkbenchComposerRuntime = ReturnType<typeof useWorkbenchComposerRuntime>;
