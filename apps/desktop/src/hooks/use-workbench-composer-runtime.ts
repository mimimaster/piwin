/**
 * Composer model, context chips, and media/send stack.
 */
import { useCallback, useRef, type Dispatch, type MutableRefObject } from 'react';
import type { AgentModeId } from '../agents/agent-mode';
import type { ChatUiAction, ChatUiState } from '../conversation/chat-reducer';
import {
  resolveComposerAgentModeForSessionChange,
  type ComposerAgentModeSessionChange,
} from '../composer/composer-agent-mode-session';
import type { HostClient } from '../host/host-client';
import { resolveActiveComposerAgentId, resolveActiveComposerBackendBinding } from '../composer/composer-dock-assembly.js';
import { isConversationSessionChrome } from '../conversation/is-conversation-session';
import { useSyncSidebarModeForAgent } from './use-sync-sidebar-mode-for-agent';
import { useComposerContextRefs } from './use-composer-context-refs';
import { useComposerMedia } from './use-composer-media';
import { useComposerModelController } from './use-composer-model';
import { useComposerOrchestrationControls } from './use-composer-orchestration-controls';
import {
  draftAgentOptionsFrom,
  useBackendSessionControls,
} from './use-backend-session-controls';
import { useEnabledSessionBackends } from './use-enabled-session-backends';
import { useSessionCapabilities } from './use-session-capabilities';
import { useSessionHandoff, type StartSessionHandoff } from './use-session-handoff';
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
    sessionOrchestrationRestoredRef,
    plusMenu,
    handleOpenKnowledge,
    handleOpenCardsPanel,
    confirmBusyRun,
    confirmForegroundReplace,
  } = chrome;
  const { menuSkills } = plusMenu;
  const backendControls = useBackendSessionControls({
    hostClient,
    dispatch,
    sessionId: state.activeSessionId,
    optionsBySession: state.backendOptionsBySession,
    sessionBackend: resolveActiveComposerBackendBinding(state),
    draftAgentId: state.draftAgentId,
    externalAgents: state.externalAgents,
  });


  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;
  const agentModeBySessionRef = useRef(new Map<string, AgentModeId>());
  const orchestration = useComposerOrchestrationControls({
    hostClient,
    activeSessionId: state.activeSessionId,
    config: host.config,
    orchestrationSchemeId,
    setOrchestrationSchemeId,
    delegationDisabled,
    setDelegationDisabled,
  });
  const { selectOrchestrationScheme } = orchestration;
  sessionOrchestrationRestoredRef.current = orchestration.restoreSessionOrchestration;

  const resetComposerTurnControls = useCallback(
    (change?: ComposerAgentModeSessionChange) => {
      if (!change) {
        backendControls.clearDraftSelections();
        orchestration.resetOrchestrationForNewDraft();
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
      if (change.nextSessionId === null) {
        backendControls.clearDraftSelections();
      }
      orchestration.resetOrchestrationForSessionChange(change);
    },
    [
      backendControls.clearDraftSelections,
      orchestration.resetOrchestrationForNewDraft,
      orchestration.resetOrchestrationForSessionChange,
      setAgentMode,
    ],
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

  // Handoff seeds the composer that useComposerMedia builds below, while
  // `/handoff` inside that composer needs to start it.
  const startHandoffRef = useRef<StartSessionHandoff | null>(null);
  const {
    composer,
    setComposer,
    seedSessionContextRefs,
    draftSessions,
    activeDraftId,
    startNewDraft,
    resumeDraft,
    explicitDraftScopeRef,
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
    canAttachFiles,
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
    ...(session.runModeForPrompt !== undefined ? { permissionPreset: session.runModeForPrompt } : {}),
    orchestrationSchemeId,
    onOrchestrationSchemeChange: selectOrchestrationScheme,
    onComposerSessionBound: (sessionId) => {
      backendControls.clearDraftSelections();
      orchestration.bindOrchestrationSession(sessionId);
    },
    onResetComposerTurnControls: resetComposerTurnControls,
    onAgentModeChange: setAgentMode,
    menuSkills,
    conversationChat: isConversationSessionChrome(
      state.activeScope,
      chrome.sidebarMode,
      resolveActiveComposerAgentId(state),
    ),
    onOpenKnowledge: handleOpenKnowledge,
    onOpenCardsPanel: handleOpenCardsPanel,
    onCompact: session.handleCompact,
    onHandoff: (instructions) => {
      const sessionId = state.activeSessionId;
      const start = startHandoffRef.current;
      if (sessionId === null || start === null) return false;
      return start(sessionId, instructions ? { instructions } : undefined);
    },
    onAbort: session.handleAbort,
    onResumeRun: session.handleResumeRun,
    ensureSession: session.ensureSession,
    ...(knowledgeMountsRef ? { knowledgeMountsRef } : {}),
    draftMcpSwitches: {
      disabledServerIds: plusMenu.mcpSwitches.draftDisabledServerIds,
      clearDraft: plusMenu.mcpSwitches.clearDraft,
    },
    ...(backendControls.draftBackendModelId
      ? { draftBackendModelId: backendControls.draftBackendModelId }
      : {}),
    ...(backendControls.draftBackendEffortId
      ? { draftBackendEffortId: backendControls.draftBackendEffortId }
      : {}),
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
  const { startHandoff } = useSessionHandoff({
    hostClient,
    state,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    handleResumeSession: session.handleResumeSession,
    seedSessionContextRefs,
  });
  startHandoffRef.current = startHandoff;

  const enabledBackends = useEnabledSessionBackends(hostClient);
  const draftAgentOptions = draftAgentOptionsFrom(state.externalAgents, enabledBackends);
  const capabilities = useSessionCapabilities({
    sessionId: state.activeSessionId,
    capabilitiesBySession: state.backendCapabilitiesBySession,
  });
  const draftAgentId = state.draftAgentId ?? 'pi';
  const activeAgentId = resolveActiveComposerAgentId(state);
  useSyncSidebarModeForAgent(activeAgentId, chrome.setSidebarMode, state.activeScope.kind);
  const onDraftAgentChange = useCallback(
    (agentId: string) => dispatch({ type: 'draft/set-agent', agentId }),
    [dispatch],
  );

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
    seedSessionContextRefs,
    startHandoff,
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
    canAttachFiles,
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
    backendControls,
    draftAgentOptions,
    draftAgentId,
    onDraftAgentChange,
    explicitDraftScopeRef,
    capabilities,
    selectOrchestrationScheme,
    selectDelegationDisabled: orchestration.selectDelegationDisabled,
  };
}

export type WorkbenchComposerRuntime = ReturnType<typeof useWorkbenchComposerRuntime>;
