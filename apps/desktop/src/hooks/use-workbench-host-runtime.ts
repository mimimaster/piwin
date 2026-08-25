/**
 * Host adapters, jobs, bootstrap, documents, and model catalog.
 * Session hydrate/restore stays in useWorkbenchSessionRuntime.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  isJobActive,
  listOrchestrationSchemes,
  ORCHESTRATION_SCHEME_OFF_ID,
  resolveUnpinnedOrchestrationDefaultRole,
  type ThemeManifest,
} from '@piwin/contracts';
import { activeDocumentMedia } from '../active-document';
import { collectSessionDocuments } from '../session-documents';
import type { HostLogEntry } from '../HostLogPanel';
import { useHostRequestAdapters } from '../host-request-adapters';
import { buildEnabledModelOptions, modelOptionsFromConfiguredModels } from '../model-options';
import {
  createEmptyNotificationState,
  dismissDesktopNotification,
  emitDesktopNotification,
  notificationReducer,
  type NotificationAction,
} from '../notification-queue';
import { getDirectForkCountsByMessageId } from '../session-lineage-tree';
import { readMediaPreviewViaHost } from '../transcript-media-preview';
import { useInspectorFileDiff } from '../use-inspector-file-diff';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useActiveDocument } from './use-active-document';
import { useArtifactCanvas } from './use-artifact-canvas';
import { useHostBootstrap } from './use-host-bootstrap';
import { useJobs } from './use-jobs';
import { useRunReconcile } from './use-run-reconcile';
import { useSessionLineage } from './use-session-lineage';
import { isSpeechConfigured, useWorkbenchPanelRequests } from './use-workbench-panel-requests';
import { useWorkbenchArtifactActions } from './use-workbench-artifact-actions';
import type { WorkbenchShellChrome } from './use-workbench-shell-chrome';

export type UseWorkbenchHostRuntimeArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  chrome: WorkbenchShellChrome;
  activeTheme: ThemeManifest;
  onThemeApplied: (theme: ThemeManifest) => void;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
};

export function useWorkbenchHostRuntime(args: UseWorkbenchHostRuntimeArgs) {
  const { hostClient, state, dispatch, chrome, activeTheme, onThemeApplied, setHostLogEntries } =
    args;
  const {
    shell,
    rightPanelOpen,
    revealDocPreview,
    terminal,
    setSelectedModelKey,
    orchestrationSchemeId,
    setOrchestrationSchemeId,
  } = chrome;
  const { setPtyOutput, markTerminalAttentionIfHidden } = terminal;
  const [, rawDispatchNotification] = useReducer(
    notificationReducer,
    undefined,
    createEmptyNotificationState,
  );
  const dispatchNotification = useCallback(
    (action: NotificationAction): void => {
      rawDispatchNotification(action);
      if (action.type === 'notify/push') {
        emitDesktopNotification(action.notification);
      } else if (action.type === 'notify/dismiss') {
        dismissDesktopNotification(action.id);
      }
    },
    [],
  );
  const artifactCanvas = useArtifactCanvas(state.activeSessionId);
  const sessionLineage = useSessionLineage(hostClient, state.activeSessionId);
  const forkCountsByMessageId = useMemo(
    () => getDirectForkCountsByMessageId(sessionLineage),
    [sessionLineage],
  );
  const {
    requestConfig,
    requestSubAgent,
    requestSkills,
    requestExtensions,
    requestPlugins,
    requestPrompts,
    requestMcp,
    requestGit,
    requestPet,
    requestPty,
    requestAutomation,
  } = useHostRequestAdapters(hostClient);

  const {
    jobs,
    refreshJobs,
    stopJob,
    appendJobLog: appendJobLogBase,
  } = useJobs(hostClient, {
    refreshWhenVisible:
      hostClient.supportsCommand('job/list') &&
      rightPanelOpen &&
      shell.inspectorTab === 'terminal',
  });
  const activeJobsForComposer = useMemo(() => {
    return jobs.filter(
      (job) => isJobActive(job.status) && job.ownerSessionId === state.activeSessionId,
    );
  }, [jobs, state.activeSessionId]);

  const backendServiceSessionIds = useMemo(() => {
    const sessionIds: Record<string, true> = {};
    for (const job of jobs) {
      if (job.kind !== 'service' || !isJobActive(job.status) || !job.ownerSessionId) {
        continue;
      }
      sessionIds[job.ownerSessionId] = true;
    }
    return sessionIds;
  }, [jobs]);

  const appendJobLog = useCallback(
    (jobId: string, text: string): void => {
      appendJobLogBase(jobId, text);
      markTerminalAttentionIfHidden();
    },
    [appendJobLogBase, markTerminalAttentionIfHidden],
  );

  const {
    hostStatus,
    config,
    setConfig,
    setActivePet,
    sessionPlan,
    extensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
    clearExtensionUiRequest,
    assemblySummariesByRunId,
    configuredChatModels,
    remoteCatchUpEpoch,
  } = useHostBootstrap({
    hostClient,
    activeSessionId: state.activeSessionId,
    dispatch,
    dispatchNotification,
    refreshJobs,
    appendJobLog,
    setPtyOutput,
    setHostLogEntries,
    setSelectedModelKey,
    onThemeResolved: onThemeApplied,
  });

  const inspectorFileDiff = useInspectorFileDiff();
  const { activeDocument, openDocument: openDocumentBase } = useActiveDocument({
    hostClient,
    revealPreview: revealDocPreview,
    activeSessionId: state.activeSessionId,
    projectPath: state.projectPath,
    ...(hostStatus?.piwinRoot ? { piwinRoot: hostStatus.piwinRoot } : {}),
    messages: state.messages,
  });
  useRunReconcile({
    hostClient,
    dispatch,
    activeSessionId: state.activeSessionId,
    activeRunId: state.activeRunId,
    runLive:
      state.runPhase === 'streaming' ||
      state.runPhase === 'pausing' ||
      state.runPhase === 'aborting',
    hostReady: state.hostReady,
    catchUpEpoch: remoteCatchUpEpoch,
  });

  const orchestrationSchemeOptions = useMemo(() => {
    const offOption = {
      id: ORCHESTRATION_SCHEME_OFF_ID,
      name: 'Freehand',
      description: 'Freehand — no scheme prompt; delegation remains available',
      source: 'off' as const,
    };
    const schemes = listOrchestrationSchemes({
      schemes: config?.subagents?.schemes,
      maxConcurrency: config?.subagents?.maxConcurrency,
      maxTasksPerRun: config?.subagents?.maxTasksPerRun,
    });
    return [
      offOption,
      ...schemes.map((scheme) => {
        const unpinnedDefaultRole = resolveUnpinnedOrchestrationDefaultRole(scheme);
        return {
          id: scheme.id,
          name: scheme.name,
          description: scheme.description,
          source: scheme.source,
          ...(unpinnedDefaultRole ? { unpinnedDefaultRole } : {}),
        };
      }),
    ];
  }, [
    config?.subagents?.schemes,
    config?.subagents?.maxConcurrency,
    config?.subagents?.maxTasksPerRun,
  ]);

  // ORCH §7.6: if the selected scheme was deleted from config, fall back to Off
  // before send so Desktop does not paint a bubble that Host will reject.
  useEffect(() => {
    if (!orchestrationSchemeId || orchestrationSchemeId === ORCHESTRATION_SCHEME_OFF_ID) {
      return;
    }
    const stillAvailable = orchestrationSchemeOptions.some(
      (option) => option.id === orchestrationSchemeId,
    );
    if (!stillAvailable) {
      setOrchestrationSchemeId(ORCHESTRATION_SCHEME_OFF_ID);
    }
  }, [orchestrationSchemeId, orchestrationSchemeOptions, setOrchestrationSchemeId]);

  const sessionDocuments = useMemo(
    () =>
      collectSessionDocuments({
        sessionPlan,
        messages: state.messages,
        ...(activeDocument
          ? {
              activeDocument: {
                title: activeDocument.title,
                ...(activeDocument.filePath !== undefined
                  ? { filePath: activeDocument.filePath }
                  : {}),
              },
            }
          : {}),
        walkthroughsByMessageId: state.walkthroughsByMessageId,
      }),
    [sessionPlan, state.messages, activeDocument, state.walkthroughsByMessageId],
  );

  const artifactThemeKey = `${activeTheme.mode}:${activeTheme.id}`;
  const modelOptions = useMemo(() => {
    if (config !== null && config.providers.length > 0) {
      return buildEnabledModelOptions(config.providers);
    }
    return modelOptionsFromConfiguredModels(configuredChatModels.models);
  }, [config, configuredChatModels]);
  const defaultProviderId = config?.defaultProviderId ?? configuredChatModels.defaultProviderId;
  const defaultModelId = config?.defaultModelId ?? configuredChatModels.defaultModelId;
  const speechConfigured = useMemo(() => isSpeechConfigured(config), [config]);
  const { handleArtifactAction, handleGenerateWalkthrough, handleCancelWalkthrough } =
    useWorkbenchArtifactActions({
      hostClient,
      state,
      dispatch,
      dispatchNotification,
    });
  const {
    requestNotesPanel,
    requestCardsPanel,
    resolveConversationFlashcards,
    requestKnowledgeCenter,
    requestFileTree,
    speechRequest,
  } = useWorkbenchPanelRequests({ hostClient });
  const activeMedia = activeDocumentMedia(activeDocument);
  const readTranscriptMedia = useCallback(
    (input: { sessionId: string; assetId: string }) => readMediaPreviewViaHost(hostClient, input),
    [hostClient],
  );

  return {
    requestConfig,
    requestSubAgent,
    requestSkills,
    requestExtensions,
    requestPlugins,
    requestPrompts,
    requestMcp,
    requestGit,
    requestPet,
    requestPty,
    requestAutomation,
    jobs,
    stopJob,
    activeJobsForComposer,
    backendServiceSessionIds,
    hostStatus,
    config,
    setConfig,
    setActivePet,
    sessionPlan,
    extensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
    clearExtensionUiRequest,
    assemblySummariesByRunId,
    inspectorFileDiff,
    activeDocument,
    openDocumentBase,
    sessionDocuments,
    artifactThemeKey,
    modelOptions,
    defaultProviderId,
    defaultModelId,
    speechConfigured,
    handleArtifactAction,
    handleGenerateWalkthrough,
    handleCancelWalkthrough,
    requestNotesPanel,
    requestCardsPanel,
    resolveConversationFlashcards,
    requestKnowledgeCenter,
    requestFileTree,
    speechRequest,
    dispatchNotification,
    artifactCanvas,
    sessionLineage,
    forkCountsByMessageId,
    remoteCatchUpEpoch,
    orchestrationSchemeOptions,
    activeMedia,
    readTranscriptMedia,
  };
}

export type WorkbenchHostRuntime = ReturnType<typeof useWorkbenchHostRuntime>;
