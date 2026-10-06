/**
 * Composer model, context chips, and media/send stack.
 */
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import {
  ORCHESTRATION_SCHEME_OFF_ID,
  resolveNewSessionOrchestrationSchemeId,
} from '@piwin/contracts';
import type { AgentModeId } from '../agent-mode';
import { resolveComposerOrchestrationForSessionChange } from '../composer-orchestration-session';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import {
  resolveComposerAgentModeForSessionChange,
  type ComposerAgentModeSessionChange,
} from '../composer-agent-mode-session';
import type { HostClient } from '../host-client';
import { resolveActiveComposerAgentId, resolveActiveComposerBackendBinding } from '../composer-dock-assembly.js';
import { isConversationSessionChrome } from '../is-conversation-session';
import { useComposerContextRefs } from './use-composer-context-refs';
import { useComposerMedia } from './use-composer-media';
import { useComposerModelController } from './use-composer-model';
import {
  draftAgentOptionsFrom,
  useBackendSessionControls,
} from './use-backend-session-controls';
import { useEnabledSessionBackends } from './use-enabled-session-backends';
import { useSessionCapabilities } from './use-session-capabilities';
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
  const activeSessionIdRef = useRef(state.activeSessionId);
  activeSessionIdRef.current = state.activeSessionId;
  const configReady = host.config !== null;
  const newSessionSchemeId = configReady
    ? resolveNewSessionOrchestrationSchemeId({
        schemes: host.config?.subagents?.schemes,
        maxConcurrency: host.config?.subagents?.maxConcurrency,
        maxTasksPerRun: host.config?.subagents?.maxTasksPerRun,
        defaultSchemeId: host.config?.desktop?.defaultOrchestrationSchemeId,
      })
    : ORCHESTRATION_SCHEME_OFF_ID;
  const newSessionSchemeIdRef = useRef(newSessionSchemeId);
  newSessionSchemeIdRef.current = newSessionSchemeId;
  // A pick made on the blank composer before settings arrive stays put.
  // A later change of the saved default updates that same blank composer.
  const draftSchemeTouchedRef = useRef(false);
  const seenNewSessionSchemeRef = useRef<string | null>(null);

  const selectOrchestrationScheme = useCallback(
    (schemeId: string) => {
      if (activeSessionIdRef.current === null) {
        draftSchemeTouchedRef.current = true;
      }
      setOrchestrationSchemeId(schemeId);
    },
    [setOrchestrationSchemeId],
  );

  useEffect(() => {
    if (!configReady || state.activeSessionId !== null) return;
    const previous = seenNewSessionSchemeRef.current;
    seenNewSessionSchemeRef.current = newSessionSchemeId;
    if (previous === newSessionSchemeId) return;
    if (previous === null && draftSchemeTouchedRef.current) return;
    draftSchemeTouchedRef.current = false;
    setOrchestrationSchemeId((current) =>
      current === newSessionSchemeId ? current : newSessionSchemeId,
    );
  }, [configReady, newSessionSchemeId, setOrchestrationSchemeId, state.activeSessionId]);

  const resetComposerTurnControls = useCallback(
    (change?: ComposerAgentModeSessionChange) => {
      if (!change) {
        backendControls.clearDraftSelections();
        // Another New Agent from a draft: drop the unsent draft's choice.
        draftSchemeTouchedRef.current = false;
        setOrchestrationSchemeId(newSessionSchemeIdRef.current);
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
        newSessionSchemeId: newSessionSchemeIdRef.current,
      });
      if (change.nextSessionId === null) {
        backendControls.clearDraftSelections();
        draftSchemeTouchedRef.current = false;
      }
      orchestrationBySessionRef.current = resolvedScheme.parked;
      setOrchestrationSchemeId(resolvedScheme.controls.schemeId);
      setDelegationDisabled(resolvedScheme.controls.delegationDisabled);
      boundOrchestrationSessionRef.current = change.nextSessionId;
    },
    [backendControls.clearDraftSelections, setAgentMode, setDelegationDisabled, setOrchestrationSchemeId],
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
    onOrchestrationSchemeChange: selectOrchestrationScheme,
    onComposerSessionBound: (sessionId) => {
      backendControls.clearDraftSelections();
      boundOrchestrationSessionRef.current = sessionId;
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

  const enabledBackends = useEnabledSessionBackends(hostClient);
  const enabledDraftAgents = draftAgentOptionsFrom(state.externalAgents, enabledBackends);
  const draftAgentOptions =
    chrome.sidebarMode === 'chat'
      ? enabledDraftAgents.filter((option) => option.agentId === 'pi')
      : enabledDraftAgents;
  const capabilities = useSessionCapabilities({
    sessionId: state.activeSessionId,
    capabilitiesBySession: state.backendCapabilitiesBySession,
  });
  const draftAgentId = state.draftAgentId ?? 'pi';
  const activeAgentId = resolveActiveComposerAgentId(state);
  useEffect(() => {
    if (chrome.sidebarMode === 'chat' && activeAgentId !== undefined && activeAgentId !== 'pi') {
      chrome.setSidebarMode('code');
    }
  }, [activeAgentId, chrome.sidebarMode, chrome.setSidebarMode]);
  useEffect(() => {
    if (chrome.sidebarMode === 'chat' && draftAgentId !== 'pi') {
      dispatch({ type: 'draft/set-agent', agentId: 'pi' });
    }
  }, [chrome.sidebarMode, draftAgentId, dispatch]);
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
    backendControls,
    draftAgentOptions,
    draftAgentId,
    onDraftAgentChange,
    capabilities,
    selectOrchestrationScheme,
  };
}

export type WorkbenchComposerRuntime = ReturnType<typeof useWorkbenchComposerRuntime>;
