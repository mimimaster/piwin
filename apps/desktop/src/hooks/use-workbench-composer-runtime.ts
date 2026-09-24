/**
 * Composer model, context chips, and media/send stack.
 */
import { useCallback, useRef, type Dispatch, type MutableRefObject } from 'react';
import { ORCHESTRATION_SCHEME_OFF_ID } from '@piwin/contracts';
import type { AgentModeId } from '../agent-mode';
import { resolveComposerOrchestrationForSessionChange } from '../composer-orchestration-session';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import {
  resolveComposerAgentModeForSessionChange,
  type ComposerAgentModeSessionChange,
} from '../composer-agent-mode-session';
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
  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;
  const agentModeBySessionRef = useRef(new Map<string, AgentModeId>());
  const orchestrationSchemeIdRef = useRef(orchestrationSchemeId);
  orchestrationSchemeIdRef.current = orchestrationSchemeId;
  const delegationDisabledRef = useRef(delegationDisabled);
  delegationDisabledRef.current = delegationDisabled;
  const orchestrationBySessionRef = useRef(
    new Map<string, { schemeId: string; delegationDisabled: boolean }>(),
  );
  // First-send binds the draft pill to the created session before any later
  // null gap (project/set, index remove) can park it as a different conversation.
  const boundOrchestrationSessionRef = useRef<string | null>(state.activeSessionId);

  const resetComposerTurnControls = useCallback(
    (change?: ComposerAgentModeSessionChange) => {
      if (!change) {
        // Another New Agent from a draft: drop the unsent draft's choice.
        setOrchestrationSchemeId(ORCHESTRATION_SCHEME_OFF_ID);
        setDelegationDisabled(false);
        setAgentMode('agent');
        return;
      }
      const resolvedMode = resolveComposerAgentModeForSessionChange({
        previousSessionId: change.previousSessionId,
        nextSessionId: change.nextSessionId,
        currentMode: agentModeRef.current,
        parked: agentModeBySessionRef.current,
      });
      agentModeBySessionRef.current = resolvedMode.parked;
      setAgentMode(resolvedMode.mode);
      const currentControls = {
        schemeId: orchestrationSchemeIdRef.current,
        delegationDisabled: delegationDisabledRef.current,
      };
      const leavingDraft =
        change.previousSessionId == null && change.nextSessionId != null;
      const schemePreviousSessionId =
        leavingDraft && boundOrchestrationSessionRef.current === change.nextSessionId
          ? change.nextSessionId
          : change.previousSessionId;
      const resolvedScheme = resolveComposerOrchestrationForSessionChange({
        previousSessionId: schemePreviousSessionId,
        nextSessionId: change.nextSessionId,
        current: currentControls,
        parked: orchestrationBySessionRef.current,
      });
      orchestrationBySessionRef.current = resolvedScheme.parked;
      setOrchestrationSchemeId(resolvedScheme.controls.schemeId);
      setDelegationDisabled(resolvedScheme.controls.delegationDisabled);
      boundOrchestrationSessionRef.current = change.nextSessionId;
    },
    [setAgentMode, setDelegationDisabled, setOrchestrationSchemeId],
  );

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
    notePauseRequested,
  } = useComposerMedia({
    hostClient,
    state,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    agentMode,
    permissionPreset: session.effectiveRunMode,
    orchestrationSchemeId,
    onOrchestrationSchemeChange: setOrchestrationSchemeId,
    onComposerSessionBound: (sessionId) => {
      boundOrchestrationSessionRef.current = sessionId;
    },
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
    draftMcpSwitches: {
      disabledServerIds: plusMenu.mcpSwitches.draftDisabledServerIds,
      clearDraft: plusMenu.mcpSwitches.clearDraft,
    },
    onNeedWorkspace: session.handleOpenWorkspaceClick,
    generalWorkspacePath: host.generalWorkspacePath ?? null,
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
    notePauseRequested,
  };
}

export type WorkbenchComposerRuntime = ReturnType<typeof useWorkbenchComposerRuntime>;
