/**
 * Composer model, context chips, and media/send stack.
 */
import { useCallback, type Dispatch, type MutableRefObject } from 'react';
import { ORCHESTRATION_SCHEME_OFF_ID } from '@piwin/contracts';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { isConversationSessionChrome } from '../is-conversation-session';
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
  /**
   * Draft's pending knowledge-base mount choice, carried into session
   * creation on first send. A ref (see `UseComposerMediaArgs.knowledgeMountsRef`)
   * because `useWorkbenchKnowledge` is constructed after this hook chain each
   * render and a plain value here would always be one render stale.
   */
  knowledgeMountsRef?: MutableRefObject<{
    mountedIds: readonly string[];
    clearDraft: () => void;
  } | null>;
};

export function useWorkbenchComposerRuntime(args: UseWorkbenchComposerRuntimeArgs) {
  const { hostClient, state, dispatch, chrome, host, session, knowledgeMountsRef } = args;
  const {
    agentMode,
    setAgentMode,
    orchestrationSchemeId,
    setOrchestrationSchemeId,
    delegationDisabled,
    setDelegationDisabled,
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

  const resetComposerTurnControls = useCallback(() => {
    setOrchestrationSchemeId(ORCHESTRATION_SCHEME_OFF_ID);
    setDelegationDisabled(false);
  }, [setDelegationDisabled, setOrchestrationSchemeId]);

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
    enqueueAttachmentFile,
    addExistingMediaAttachment,
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
    queuedTurnEditId,
    cancelQueuedTurnEdit,
  } = useComposerMedia({
    hostClient,
    state,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    agentMode,
    permissionPreset: session.effectiveRunMode,
    orchestrationSchemeId,
    onOrchestrationSchemeChange: setOrchestrationSchemeId,
    onResetComposerTurnControls: resetComposerTurnControls,
    onAgentModeChange: setAgentMode,
    menuSkills,
    conversationChat: isConversationSessionChrome(state.activeScope, chrome.sidebarMode),
    onOpenKnowledge: handleOpenKnowledge,
    onOpenCardsPanel: handleOpenCardsPanel,
    onCompact: session.handleCompact,
    onAbort: session.handleAbort,
    onResumeRun: session.handleResumeRun,
    ensureSession: session.ensureSession,
    ...(knowledgeMountsRef ? { knowledgeMountsRef } : {}),
    onNeedWorkspace: session.handleOpenWorkspaceClick,
    selectedModelKey,
    promptModel: currentPromptModelRef,
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
    onLeaveActiveSession: session.bumpToDraft,
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
    enqueueAttachmentFile,
    addExistingMediaAttachment,
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
    queuedTurnEditId,
    cancelQueuedTurnEdit,
  };
}

export type WorkbenchComposerRuntime = ReturnType<typeof useWorkbenchComposerRuntime>;
