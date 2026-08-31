/**
 * Assemble ComposerDockProps for the bottom dock and in-place message edit card.
 * Wrappers exist so the dock memo does not thrash on every App render.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import type {
  HostResponse,
  HostStatusData,
  JobRecord,
  PermissionPreset,
  PiwinConfig,
  ProjectRecord,
  PromptContextRef,
  SpeechTranscribeInput,
  ThinkingLevel,
} from '@piwin/contracts';
import type { AgentModeId } from '../agent-mode';
import type { ChatUiState } from '../chat-reducer';
import type { ComposerDockProps, ComposerModelOption } from '../composer-dock';
import type { ComposerPlusSubmenu } from '../composer-plus-menu';
import { saveDesktopHostLaunchMode } from '../desktop-host-launch';
import type { HostClient } from '../host-client';
import type { AddContextRefResult, PendingContextRefItem } from './use-composer-context-refs';
import type { ExtensionUiRequestState } from './use-host-bootstrap';
import type { PendingComposerAttachment } from '../media-utils';
import type { OrchestrationSchemeOption } from '../OrchestrationSchemeControl';
import { showErrorNotification } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import {
  isChatCompactPendingOccupancy,
  selectContextRingView,
} from '../context-telemetry-selector.js';
import { liveStartErrorLabel, useLiveCall, type LiveCallController } from '../live/use-live-call.js';
import { readDelegatedTurnResult } from '../live/live-session-result.js';
import {
  clearDesktopRemoteHostTarget,
  formatDesktopRemoteHostDisplay,
} from '../remote-host-session';
import type { RightPanelTab } from '../right-panel';
import type { ShellSettingsSection } from '../shell-navigation';
import type { SteerQueueMessage } from '../steer-queue';
import {
  isGoalExtensionEnabled,
  listSessionUserPrompts,
  resolveComposerLayoutMode,
} from '../composer-dock-assembly';
import { desktopForegroundMutationsEnabled } from '../foreground-admission.js';

export type UseComposerDockPropsArgs = {
  hostClient: HostClient;
  hostStatus: HostStatusData | null | undefined;
  config: PiwinConfig | null;
  state: ChatUiState;
  composer: string;
  setComposer: Dispatch<SetStateAction<string>>;
  agentMode: AgentModeId;
  setAgentMode: Dispatch<SetStateAction<AgentModeId>>;
  pendingAttachments: PendingComposerAttachment[];
  revokePending: (localId: string) => void;
  retryPendingAttachment: (localId: string) => void;
  retryFailedAttachments: () => void;
  discardFailedAttachments: () => void;
  pendingContextRefs: PendingContextRefItem[];
  removeContextRef: (key: string) => void;
  addContextRef: (ref: PromptContextRef) => AddContextRefResult;
  activeCommentsCount: number;
  activeDocumentTitle: string | undefined;
  onRemoveDocComments: () => void;
  dropActive: boolean;
  setDropActive: Dispatch<SetStateAction<boolean>>;
  plusMenuOpen: boolean;
  setPlusMenuOpen: Dispatch<SetStateAction<boolean>>;
  plusSubmenu: ComposerPlusSubmenu;
  setPlusSubmenu: Dispatch<SetStateAction<ComposerPlusSubmenu>>;
  modelOptions: ComposerModelOption[];
  selectedModelKey: string;
  selectedModelLabel: string;
  selectedModelContextWindow: number | undefined;
  onSelectModel: (key: string) => void;
  menuSkills: ComposerDockProps['menuSkills'];
  menuMcp: ComposerDockProps['menuMcp'];
  refreshComposerMenus: () => void | Promise<void>;
  openSettingsSection: (section: ShellSettingsSection) => void;
  onOpenKnowledge: (subTab?: 'doccards' | 'cards' | 'wiki') => void;
  onOpenCardsPanel: () => void;
  onPickFiles: () => void | Promise<void>;
  onPickImageFiles: () => void | Promise<void>;
  onComposerPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void | Promise<void>;
  onComposerDrop: (event: DragEvent<HTMLElement>) => void | Promise<void>;
  onSendWithComments: () => void | Promise<unknown>;
  onSteer: () => void | Promise<unknown>;
  onFollowUp: () => void | Promise<unknown>;
  onPause: () => void | Promise<unknown>;
  onResumeRun: () => void | Promise<unknown>;
  onAbort: () => void | Promise<unknown>;
  onCompact: (customInstructions?: string) => void | Promise<unknown>;
  onOpenProject: (path: string) => void | Promise<void>;
  onExtensionUiResolve: (payload: {
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }) => void | Promise<void>;
  onExtensionUiAbort: () => void | Promise<void>;
  extensionUiRequest: ExtensionUiRequestState | null;
  extensionUiInput: string;
  setExtensionUiInput: Dispatch<SetStateAction<string>>;
  thinkingLevel: ThinkingLevel;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  speechConfigured: boolean;
  speechRequest: (input: SpeechTranscribeInput) => Promise<HostResponse>;
  runModePreset: PermissionPreset;
  onRunModeChange: (preset: PermissionPreset) => void;
  onRunModeSetDefault: (preset: PermissionPreset) => void;
  orchestrationSchemeId: string;
  orchestrationSchemeOptions: readonly OrchestrationSchemeOption[];
  delegationDisabled: boolean;
  setDelegationDisabled: Dispatch<SetStateAction<boolean>>;
  setOrchestrationSchemeId: Dispatch<SetStateAction<string>>;
  requestGit: (command: Parameters<HostClient['request']>[0]) => Promise<HostResponse>;
  recentProjects: readonly ProjectRecord[];
  activeJobs: readonly JobRecord[];
  stopJob: (jobId: string) => void | Promise<void>;
  openInspector: (tab?: RightPanelTab | null) => void;
  steerQueueMessages: readonly SteerQueueMessage[];
  onSteerQueueSendNow: (messageId: string) => void | Promise<void>;
  onSteerQueueEdit: (messageId: string, text: string) => void;
  onSteerQueueRemove: (messageId: string) => void;
  ensureSession: () => Promise<string | null>;
  /** Focused conversation pane session; Live follows this while a call is up. */
  liveSessionId: string | null;
};

export function useComposerDockProps(args: UseComposerDockPropsArgs): {
  composerCard: ComposerDockProps;
  composerLayoutMode: 'centered' | 'docked';
  live: LiveCallController;
} {
  const {
    hostClient,
    hostStatus,
    config,
    state,
    composer,
    setComposer,
    agentMode,
    setAgentMode,
    pendingAttachments,
    revokePending,
    retryPendingAttachment,
    retryFailedAttachments,
    discardFailedAttachments,
    pendingContextRefs,
    removeContextRef,
    addContextRef,
    activeCommentsCount,
    activeDocumentTitle,
    onRemoveDocComments,
    dropActive,
    setDropActive,
    plusMenuOpen,
    setPlusMenuOpen,
    plusSubmenu,
    setPlusSubmenu,
    modelOptions,
    selectedModelKey,
    selectedModelLabel,
    selectedModelContextWindow,
    onSelectModel,
    menuSkills,
    menuMcp,
    refreshComposerMenus,
    openSettingsSection,
    onOpenKnowledge,
    onOpenCardsPanel,
    onPickFiles,
    onPickImageFiles,
    onComposerPaste,
    onComposerDrop,
    onSendWithComments,
    onSteer,
    onFollowUp,
    onPause,
    onResumeRun,
    onAbort,
    onCompact,
    onOpenProject,
    onExtensionUiResolve,
    onExtensionUiAbort,
    extensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
    thinkingLevel,
    onThinkingLevelChange,
    speechConfigured,
    speechRequest,
    runModePreset,
    onRunModeChange,
    onRunModeSetDefault,
    orchestrationSchemeId,
    orchestrationSchemeOptions,
    delegationDisabled,
    setDelegationDisabled,
    setOrchestrationSchemeId,
    requestGit,
    recentProjects,
    activeJobs,
    stopJob,
    openInspector,
    steerQueueMessages,
    onSteerQueueSendNow,
    onSteerQueueEdit,
    onSteerQueueRemove,
    ensureSession,
    liveSessionId,
  } = args;

  const { locale } = useDesktopLocale();
  const live = useLiveCall({
    hostClient,
    sessionId: liveSessionId,
    ensureSession,
    sessionStreaming: state.streaming === true,
    lastAssistant: readDelegatedTurnResult(state.messages),
    onFail: (error) => {
      showErrorNotification(liveStartErrorLabel(error, locale === 'zh-CN'));
    },
  });

  const composerLayoutMode = resolveComposerLayoutMode({
    messageCount: state.messages.length,
    awaitingTranscript: state.awaitingTranscript,
  });

  const handleRefreshComposerMenus = useCallback((): void => {
    void refreshComposerMenus();
  }, [refreshComposerMenus]);
  const handleOpenSkillsPanel = useCallback((): void => {
    openSettingsSection('skills');
  }, [openSettingsSection]);
  const handleOpenMcpPanel = useCallback((): void => {
    openSettingsSection('tools');
  }, [openSettingsSection]);
  const handleOpenModelSettings = useCallback((): void => {
    openSettingsSection('models');
  }, [openSettingsSection]);
  const handleOpenHostSettings = useCallback((): void => {
    openSettingsSection('general');
  }, [openSettingsSection]);
  const handleSelectLocalRuntime = useCallback((): void => {
    saveDesktopHostLaunchMode('sidecar');
    clearDesktopRemoteHostTarget();
  }, []);
  const handleSelectAttachRuntime = useCallback((): void => {
    saveDesktopHostLaunchMode('attach');
    clearDesktopRemoteHostTarget();
  }, []);
  const handleOpenPermissionsSettings = useCallback((): void => {
    openSettingsSection('permissions');
  }, [openSettingsSection]);
  const handleOpenOrchestrationSchemeSettings = useCallback((): void => {
    openSettingsSection('subagents');
  }, [openSettingsSection]);
  const handleComposerAttachImage = useCallback((): void => {
    void onPickImageFiles();
  }, [onPickImageFiles]);
  const handleComposerAttachFile = useCallback((): void => {
    void onPickFiles();
  }, [onPickFiles]);
  const handleComposerPasteEvent = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      void onComposerPaste(event);
    },
    [onComposerPaste],
  );
  const handleComposerDropEvent = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      void onComposerDrop(event);
    },
    [onComposerDrop],
  );
  const handleComposerSend = useCallback((): void => {
    void onSendWithComments();
  }, [onSendWithComments]);
  const handleComposerSteer = useCallback((): void => {
    void onSteer();
  }, [onSteer]);
  const handleComposerFollowUp = useCallback((): void => {
    void onFollowUp();
  }, [onFollowUp]);
  const handleComposerPause = useCallback((): void => {
    void onPause();
  }, [onPause]);
  const handleComposerResumeRun = useCallback((): void => {
    void onResumeRun();
  }, [onResumeRun]);
  const handleComposerExtensionUiResolve = useCallback(
    (payload: { confirmed?: boolean; value?: string; cancelled?: boolean }): void => {
      void onExtensionUiResolve(payload);
    },
    [onExtensionUiResolve],
  );
  const handleComposerExtensionUiAbort = useCallback((): void => {
    void onExtensionUiAbort();
  }, [onExtensionUiAbort]);
  const handleComposerAbort = useCallback((): void => {
    void onAbort();
  }, [onAbort]);
  const handleComposerCompact = useCallback((customInstructions?: string): void => {
    void onCompact(customInstructions);
  }, [onCompact]);

  const docCommentsAttachment = useMemo(
    () =>
      activeCommentsCount > 0
        ? {
            docTitle: activeDocumentTitle || 'Document',
            commentCount: activeCommentsCount,
          }
        : null,
    [activeCommentsCount, activeDocumentTitle],
  );

  const sessionUserPrompts = useMemo(
    () => listSessionUserPrompts(state.messages),
    [state.messages],
  );

  const goalExtensionEnabled = useMemo(
    () => isGoalExtensionEnabled(config?.extensions?.disabledIds),
    [config?.extensions?.disabledIds],
  );

  useEffect(() => {
    if (agentMode === 'goal' && !goalExtensionEnabled) {
      setAgentMode('agent');
    }
  }, [agentMode, goalExtensionEnabled, setAgentMode]);

  const runtimeRemoteConnected = hostClient.getTransport() === 'remote';
  const runtimeRemoteHostLabel = runtimeRemoteConnected
    ? formatDesktopRemoteHostDisplay(hostClient.getRemoteTarget()?.endpoint ?? '')
    : undefined;

  const composerCard: ComposerDockProps = useMemo(
    () => ({
      layoutMode: composerLayoutMode,
      projectPath: state.projectPath,
      projectTrusted: state.projectTrusted,
      activeSessionId: state.activeSessionId,
      streaming: state.streaming,
      runPhase: state.runPhase,
      compacting: state.compacting,
      composer,
      onComposerChange: setComposer,
      sessionUserPrompts,
      activeJobs,
      onStopJob: (jobId) => {
        void stopJob(jobId);
      },
      onViewJobLogs: () => {
        openInspector('terminal');
      },
      agentMode,
      onAgentModeChange: setAgentMode,
      goalExtensionEnabled,
      pendingAttachments,
      onRemoveAttachment: revokePending,
      onRetryAttachment: retryPendingAttachment,
      onRetryFailedAttachments: retryFailedAttachments,
      onDiscardFailedAttachments: discardFailedAttachments,
      pendingContextRefs,
      onRemoveContextRef: removeContextRef,
      onAddContextRef: (ref) => {
        addContextRef(ref);
      },
      docCommentsAttachment,
      onRemoveDocComments,
      dropActive,
      onDropActiveChange: setDropActive,
      plusMenuOpen,
      onPlusMenuOpenChange: setPlusMenuOpen,
      plusSubmenu,
      onPlusSubmenuChange: setPlusSubmenu,
      modelOptions,
      selectedModelKey,
      selectedModelLabel,
      onSelectModel,
      visionDelegationEnabled: config?.visionDelegation?.enabled === true,
      menuSkills,
      menuMcp,
      onRefreshComposerMenus: handleRefreshComposerMenus,
      onOpenSkillsPanel: handleOpenSkillsPanel,
      onOpenMcpPanel: handleOpenMcpPanel,
      onOpenKnowledge,
      onOpenCardsPanel,
      onAttachFile: handleComposerAttachFile,
      onAttachImage: handleComposerAttachImage,
      onPaste: handleComposerPasteEvent,
      onDrop: handleComposerDropEvent,
      onSend: handleComposerSend,
      mutationsEnabled: desktopForegroundMutationsEnabled(state),
      onSteer: handleComposerSteer,
      onFollowUp: handleComposerFollowUp,
      onPause: handleComposerPause,
      onResume: handleComposerResumeRun,
      paused: state.runTerminal.kind === 'paused',
      steerQueueMessages,
      onSteerQueueSendNow,
      onSteerQueueEdit,
      onSteerQueueRemove,
      extensionUiRequest,
      extensionUiInput,
      onExtensionUiInputChange: setExtensionUiInput,
      onExtensionUiResolve: handleComposerExtensionUiResolve,
      onExtensionUiAbort: handleComposerExtensionUiAbort,
      thinkingLevel,
      onThinkingLevelChange,
      ultraThinkingEnabled: config?.thinking?.ultraEnabled === true,
      onAbort: handleComposerAbort,
      onCompact: handleComposerCompact,
      compactionSupported: hostStatus?.capabilities?.compaction !== false,
      contextUsage: state.contextUsage,
      contextRingView: selectContextRingView({
        telemetry: state.contextTelemetry,
        locale: locale === 'en' ? 'en' : 'zh-CN',
        ...(typeof selectedModelContextWindow === 'number'
          ? { selectedModelContextWindow }
          : {}),
        ...(selectedModelKey.includes('::')
          ? {
              selectedModel: {
                providerId: selectedModelKey.slice(0, selectedModelKey.indexOf('::')),
                modelId: selectedModelKey.slice(selectedModelKey.indexOf('::') + 2),
              },
            }
          : {}),
        queuedTurnPending:
          ((state.activeSessionId && state.queuedTurnsBySession[state.activeSessionId]) ?? [])
            .length > 0,
        ...(state.compacting ? { compacting: true } : {}),
        ...(isChatCompactPendingOccupancy(state) ? { compactPendingOccupancy: true } : {}),
      }),
      ...(typeof selectedModelContextWindow === 'number'
        ? { modelContextWindow: selectedModelContextWindow }
        : {}),
      onOpenModelSettings: handleOpenModelSettings,
      speechConfigured,
      speechRequest,
      live: {
        enabled: true,
        canStart: live.canStart,
        starting: live.starting,
        call: live.call,
        error: live.error,
        missing: live.status?.missing ?? [],
        onStart: () => {
          void live.start();
        },
        onMute: (muted) => {
          void live.setMuted(muted);
        },
        onEnd: () => {
          void live.end();
        },
      },
      ...(hostStatus !== undefined ? { hostStatus } : {}),
      hostReady: state.hostReady,
      hostMock: state.hostMock,
      transportLabel: hostClient.getTransport(),
      onOpenHostSettings: handleOpenHostSettings,
      runModePreset,
      onRunModeChange,
      onRunModeSetDefault,
      onOpenPermissionsSettings: handleOpenPermissionsSettings,
      runModeYoloDisabled: state.projectPath !== null && !state.projectTrusted,
      orchestrationSchemeId,
      orchestrationSchemeOptions,
      delegationDisabled,
      onDelegationDisabledChange: setDelegationDisabled,
      onOrchestrationSchemeChange: setOrchestrationSchemeId,
      onOpenOrchestrationSchemeSettings: handleOpenOrchestrationSchemeSettings,
      isConversationSession: state.activeScope.kind === 'general',
      ...(hostClient.supportsCommand('git/status')
        ? { branchRequest: requestGit as ComposerDockProps['branchRequest'] }
        : {}),
      recentProjects,
      onOpenProject: (path) => {
        void onOpenProject(path);
      },
      runtimeRemoteConnected,
      ...(runtimeRemoteHostLabel ? { runtimeRemoteHostLabel } : {}),
      onSelectLocalRuntime: handleSelectLocalRuntime,
      onSelectAttachRuntime: handleSelectAttachRuntime,
    }),
    [
      addContextRef,
      agentMode,
      composer,
      composerLayoutMode,
      config?.thinking?.ultraEnabled,
      config?.visionDelegation?.enabled,
      delegationDisabled,
      discardFailedAttachments,
      docCommentsAttachment,
      dropActive,
      extensionUiInput,
      extensionUiRequest,
      goalExtensionEnabled,
      handleComposerAbort,
      handleComposerAttachFile,
      handleComposerAttachImage,
      handleComposerCompact,
      handleComposerDropEvent,
      handleComposerExtensionUiAbort,
      handleComposerExtensionUiResolve,
      handleComposerFollowUp,
      handleComposerPause,
      handleComposerPasteEvent,
      handleComposerResumeRun,
      handleComposerSend,
      handleComposerSteer,
      handleOpenHostSettings,
      handleOpenMcpPanel,
      handleOpenModelSettings,
      handleOpenOrchestrationSchemeSettings,
      handleOpenPermissionsSettings,
      handleOpenSkillsPanel,
      handleRefreshComposerMenus,
      handleSelectAttachRuntime,
      handleSelectLocalRuntime,
      hostClient,
      hostStatus,
      menuMcp,
      menuSkills,
      modelOptions,
      onOpenCardsPanel,
      onOpenKnowledge,
      onOpenProject,
      onRemoveDocComments,
      onRunModeChange,
      onRunModeSetDefault,
      onSelectModel,
      onSteerQueueEdit,
      onSteerQueueRemove,
      onSteerQueueSendNow,
      onThinkingLevelChange,
      openInspector,
      orchestrationSchemeId,
      orchestrationSchemeOptions,
      pendingAttachments,
      pendingContextRefs,
      plusMenuOpen,
      plusSubmenu,
      recentProjects,
      removeContextRef,
      requestGit,
      retryFailedAttachments,
      retryPendingAttachment,
      revokePending,
      runtimeRemoteConnected,
      runtimeRemoteHostLabel,
      runModePreset,
      selectedModelContextWindow,
      selectedModelKey,
      selectedModelLabel,
      sessionUserPrompts,
      setAgentMode,
      setComposer,
      setDelegationDisabled,
      setDropActive,
      setExtensionUiInput,
      setOrchestrationSchemeId,
      setPlusMenuOpen,
      setPlusSubmenu,
      speechConfigured,
      speechRequest,
      live,
      state.activeScope.kind,
      state.activeSessionId,
      state.foregroundAdmission,
      state.compacting,
      state.lastCompactionMessage,
      state.contextUsage,
      state.contextTelemetry,
      state.queuedTurnsBySession,
      locale,
      state.hostMock,
      state.hostReady,
      state.projectPath,
      state.projectTrusted,
      state.runPhase,
      state.runTerminal.kind,
      state.streaming,
      steerQueueMessages,
      stopJob,
      thinkingLevel,
      activeJobs,
    ],
  );

  return { composerCard, composerLayoutMode, live };
}
