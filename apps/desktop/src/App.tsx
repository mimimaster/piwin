import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import {
  formatError,
  isJobActive,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  resolvePermissionPreset,
  remoteCommandRequiresIdempotencyKey,
  resolvePreset,
} from '@piwin/contracts';
import type {
  PermissionDecision,
  PermissionRememberScope,
  PermissionPreset,
  PiwinConfig,
  ProjectRecord,
  RunInterventionRecord,
  SessionListOrder,
  PromptContextRef,
  SessionScope,
  SettingsMutation,
  ThemeManifest,
  WalkthroughArtifact,
} from '@piwin/contracts';
import {
  listOrchestrationSchemes,
  ORCHESTRATION_SCHEME_OFF_ID,
  resolveUnpinnedOrchestrationDefaultRole,
} from '@piwin/contracts';
import {
  chatUiReducer,
  createInitialChatUiState,
  type PermissionPromptUi,
  type SessionListItemUi,
} from './chat-reducer';
import {
  resolveDesktopHostResolution,
  saveDesktopHostLaunchMode,
  subscribeDesktopHostLaunchModeChange,
} from './desktop-host-launch';
import { HostConnectWall, HostLaunchChooser } from './host-connect-wall';
import { isDesktopShellOnlyBuild } from './desktop-shell-build';
import {
  clearDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
  subscribeDesktopRemoteHostTargetChange,
} from './remote-host-session';
import { useWorkbenchHostClient } from './use-workbench-host-client';
import { MediaPreviewReadProvider } from './media-preview-read-context';
import { readMediaPreviewViaHost } from './transcript-media-preview';
import {
  settingsMutationsForHostApply,
  useHostRequestAdapters,
} from './host-request-adapters';
import { ProjectSessionSidebar } from './project-session-sidebar';
import { projectLabel } from './project-display-name';
import { reviewCardsForItemIds } from './resolve-conversation-flashcards';
import type { FlashcardItem } from '@piwin/contracts';
import { type ArtifactCanvasTarget } from './artifact-canvas-model';
import { useArtifactCanvas } from './hooks/use-artifact-canvas';
import { AppDialogs } from './app-dialogs';
import {
  createEmptyNotificationState,
  dismissDesktopNotification,
  emitDesktopNotification,
  notificationReducer,
  pushError,
  type NotificationAction,
} from './notification-queue';
import type { HostLogEntry } from './HostLogPanel';
import { activeDocumentMedia } from './active-document';
import { useActiveDocument } from './hooks/use-active-document';
import { useTerminalPanelState } from './hooks/use-terminal-panel-state';
import { useSessionListQuery } from './hooks/use-session-list-query';
import {
  resolveSessionDisplayName,
  routeSessionChromeMenuAction,
  useSessionListChrome,
} from './hooks/use-session-list-chrome';
import { collectSessionDocuments } from './session-documents';
import { type RightPanelTab } from './right-panel'; // right-panel portal v3
import { collectSessionTools } from './tool-call-card';
import type { DocumentOpenInput } from './tool-call-card';
import { useInspectorFileDiff } from './use-inspector-file-diff';
import { type AgentModeId } from './agent-mode';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  loadDesktopPreferences,
  resolveConversationWidth,
  saveDesktopPreferences,
  type DesktopPreferences,
} from './ui-preferences';
import { buildAppearanceTheme } from './appearance-tokens';
import {
  getDesktopCopy,
  loadDesktopLocale,
  saveDesktopLocale,
  type DesktopLocale,
} from './desktop-locale';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { useHostBootstrap } from './hooks/use-host-bootstrap';
import { useRunReconcile } from './hooks/use-run-reconcile';
import { useComposerMedia } from './hooks/use-composer-media';
import { useComposerContextRefs } from './hooks/use-composer-context-refs';
import { DesktopContextMenuProvider, type DesktopContextMenuValue } from './context-menu';
import { useSessionActions } from './hooks/use-session-actions';
import { useBranchActions } from './hooks/use-branch-actions';
import { useDocComments } from './hooks/use-doc-comments';
import { useComposerPlusMenu } from './hooks/use-composer-plus-menu';
import { useComposerModelController } from './hooks/use-composer-model';
import { useComposerDockProps } from './hooks/use-composer-dock-props';
import { TruncateAfterDialog } from './truncate-after-dialog';
import { BranchSwitchConfirmDialog } from './branch-switch-confirm-dialog';
import { useSessionLineage } from './hooks/use-session-lineage';
import { getDirectForkCountsByMessageId } from './session-lineage-tree';
import { SessionLineageHeaderPopover } from './session-lineage-popover';
import { useSubagentSessionInspector } from './hooks/use-subagent-session-inspector';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import {
  SubagentInspectorProvider,
  type SubagentInspectorPanelData,
  type SubagentInspectorToggle,
} from './subagent-inspector-context';
import { useJobs } from './hooks/use-jobs';
import type { ForegroundRunMismatchProblem } from '@piwin/contracts';
import { useConfirmDialog } from './use-confirm-dialog';
import { createGestureIdempotencyKey } from './gesture-idempotency.js';
import { settingsApplyInputFromSnapshot } from './settings-apply-input.js';
import { hostFailureNotice } from './host-problem-copy.js';
import {
  isRemoteDesktopTransport,
  mapListedProjects,
  mergeRecentProjects,
} from './remote-session-hydrate';
import { useShellLayout, type ShellSettingsSection } from './hooks/use-shell-layout';
import { CommandPalette } from './command-palette';
import { useDesktopShortcuts } from './use-desktop-shortcuts';
import type { DesktopCommandId } from './desktop-commands';
import { deriveRunStatus } from './run-status';
import { ContextBar } from './context-bar';
import { WorkspaceShell } from './workspace-shell';
import { WorkbenchInspector } from './workbench-inspector';
import {
  WorkbenchComposerColumn,
  WorkbenchPermissionBar,
  WorkbenchTranscript,
} from './workbench-conversation';
import { SessionColdRestoreDialog } from './session-cold-restore-dialog';
import { StatusBar } from './status-bar';
import { computeContextUsagePercent } from './context-usage-ring';
import { installRendererSelfHeal } from './renderer-self-heal';

import { useRightPanelResize } from './hooks/use-right-panel-resize';
import { useSidebarResize } from './hooks/use-sidebar-resize';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';
import { SIDEBAR_DEFAULT_WIDTH_PX } from './sidebar-width';
import { formatComposerModelKey } from './composer-model-selection-policy';
import { buildEnabledModelOptions, modelOptionsFromConfiguredModels } from './model-options';

import {
  DeferredKnowledgeCenterPanel,
  DeferredSettingsPanel,
  DeferredSurfaceBoundary,
} from './deferred-desktop-surfaces';

export type AppProps = {
  /** Resolved active manifest owned by DesktopThemeRoot. */
  activeTheme: ThemeManifest;
  /** Root callback that resolves, applies document tokens, and stores a manifest. */
  onThemeApplied: (theme: ThemeManifest) => void;
};

const ARTIFACT_CANVAS_MIN_PANEL_WIDTH_PX = 560;

/** Merge two session lists, deduplicating by id (first occurrence wins). */
function mergeSessionsForLookup(
  primary: SessionListItemUi[],
  secondary: SessionListItemUi[],
): SessionListItemUi[] {
  const seen = new Set(primary.map((session) => session.id));
  return [...primary, ...secondary.filter((session) => !seen.has(session.id))];
}

function AppWorkbench({ activeTheme, onThemeApplied }: AppProps) {
  const hostClient = useWorkbenchHostClient();
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

  const [state, dispatch] = useReducer(chatUiReducer, undefined, createInitialChatUiState);

  // Renderer self-heal: relaunch WebContent when critical pressure holds while
  // hidden and idle (pinned IOSurface leak; see renderer-self-heal.ts). The
  // busy flag rides a ref so the installer effect never re-subscribes.
  const selfHealBusyRef = useRef(false);
  selfHealBusyRef.current = state.streaming || state.compacting;
  useEffect(() => installRendererSelfHeal(() => selfHealBusyRef.current), []);

  const artifactCanvas = useArtifactCanvas(state.activeSessionId);
  const sessionLineage = useSessionLineage(hostClient, state.activeSessionId);
  const forkCountsByMessageId = useMemo(
    () => getDirectForkCountsByMessageId(sessionLineage),
    [sessionLineage],
  );
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

  // Shell UI state (panels / search / chrome) — not host business logic.
  const [projectInput, setProjectInput] = useState('');
  const shell = useShellLayout();
  const {
    settingsOpen,
    settingsSection,
    commandPaletteOpen,
    navDrawerOpen,
    rightPanelOpen,
    inspectorTab: rightPanelTab,
    showOverlayScrim,
    layoutMode,
  } = shell;
  const isOverlayPresentation = layoutMode === 'compact';
  // Panel widths only drive CSS vars (in-flow stage reflow).
  // No OS setSize — that path re-rasters the whole shell on every toggle.
  // Cross-panel clamp: right panel reads live sidebar width; sidebar reads a
  // ref of the right panel width (one-frame lag is fine for clamp only).
  const rightPanelWidthRef = useRef(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  const sidebarResize = useSidebarResize({
    layoutMode,
    rightPanelOpen,
    rightPanelWidthPx: rightPanelWidthRef.current,
  });
  const rightPanelResize = useRightPanelResize({
    layoutMode,
    navDrawerOpen,
    sidebarWidthPx: sidebarResize.widthPx,
  });
  // Keep ref in sync for the next render's sidebar clamp.
  if (rightPanelWidthRef.current !== rightPanelResize.widthPx) {
    rightPanelWidthRef.current = rightPanelResize.widthPx;
  }
  const [, setHostLogEntries] = useState<HostLogEntry[]>([]);
  const [rightPanelView, setRightPanelView] = useState<'home' | 'detail'>('home');
  // Doc Preview orchestration lives in use-active-document (ADR 0052):
  // request-id guard, tool snapshot recovery, and resource-kind routing.
  const revealDocPreview = useCallback(() => {
    const inspectorTab: RightPanelTab = 'docPreview';
    shell.setInspectorTab(inspectorTab);
    if (!rightPanelOpen) {
      shell.openInspector(inspectorTab);
    }
  }, [rightPanelOpen, shell]);

  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const handleOpenCardsPanel = useCallback(() => {
    shell.openInspector('cards');
  }, [shell]);
  const handleOpenKnowledge = useCallback(
    (subTab: 'doccards' | 'cards' | 'wiki' = 'doccards') => {
      if (subTab === 'cards') {
        handleOpenCardsPanel();
        return;
      }
      setKnowledgeOpen(true);
    },
    [handleOpenCardsPanel],
  );
  const watchingTerminalRef = useRef(false);
  watchingTerminalRef.current =
    rightPanelOpen && rightPanelTab === 'terminal' && rightPanelView === 'detail';
  const {
    sessionSearch,
    setSessionSearch,
    showArchivedSessions,
    setShowArchivedSessions,
    sessionListOrder,
    setSessionListOrder,
    sessionMenu,
    renameDraft,
    setRenameDraft,
    projectPickerOpen,
    setProjectPickerOpen,
    deleteConfirm,
    deleteBusy,
    continueInProject,
    continueInProjectBusy,
    openSessionMenu,
    closeSessionMenu,
    requestDeleteSession,
    requestContinueInProject,
    closeDeleteConfirm,
    closeContinueInProject,
    runDeleteConfirm,
    runContinueInProject,
  } = useSessionListChrome();
  const [agentMode, setAgentMode] = useState<AgentModeId>('agent');
  const [orchestrationSchemeId, setOrchestrationSchemeId] = useState<string>(
    ORCHESTRATION_SCHEME_OFF_ID,
  );
  const [delegationDisabled, setDelegationDisabled] = useState(false);
  // ORCH: scheme picker stays visible; switching sessions resets to freehand (no injection).
  useEffect(() => {
    setOrchestrationSchemeId(ORCHESTRATION_SCHEME_OFF_ID);
    setDelegationDisabled(false);
  }, [state.activeSessionId]);

  const {
    filteredSessions,
    filteredGeneralSessions,
    sessionGroups,
    remoteSearchHitsByScope,
  } = useSessionListQuery({
    hostClient,
    sessionSearch,
    showArchivedSessions,
    activeScope: state.activeScope,
    sessions: state.sessions,
    generalSessions: state.generalSessions,
  });
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  /** Filled after useComposerMedia mounts so Revert can restore text without reordering hooks. */
  const composerSetterRef = useRef<(value: SetStateAction<string>) => void>(() => undefined);

  const [preferences, setPreferences] = useState<DesktopPreferences>(() =>
    loadDesktopPreferences(),
  );

  const {
    ptyOutput,
    setPtyOutput,
    terminalAttention,
    setTerminalAttention,
    terminalCwd,
    terminalRecentDirs,
    handleTerminalCwdChange,
    markTerminalAttentionIfHidden,
  } = useTerminalPanelState({
    projectPath: state.projectPath,
    watchingTerminalRef,
    preferences,
    setPreferences,
  });

  // Map DesktopPreferences to CSS custom properties on the app-shell element.
  const preferencesStyle = useMemo(() => {
    const chatFontSize =
      preferences.assistantTextSize === 'small'
        ? '13px'
        : preferences.assistantTextSize === 'large'
          ? '17px'
          : '15px';
    const codeFontSize =
      preferences.codeTextSize === 'small'
        ? '11.5px'
        : preferences.codeTextSize === 'large'
          ? '14.5px'
          : '13px';
    const codeWrap = preferences.codeWrap ? 'break-word' : 'unset';
    const conversationWidth = resolveConversationWidth(preferences.conversationWidth);
    return {
      '--chat-font-size': chatFontSize,
      '--code-font-size': codeFontSize,
      '--code-wrap': codeWrap,
      '--conversation-width': conversationWidth,
    } as React.CSSProperties;
  }, [preferences]);
  const appShellStyle = useMemo(
    () =>
      ({
        ...preferencesStyle,
        ...(sidebarResize.isResizing ? {} : { '--sidebar-width': `${sidebarResize.widthPx}px` }),
        ...(rightPanelResize.isResizing
          ? {}
          : { '--right-panel-width': `${rightPanelResize.widthPx}px` }),
      }) as React.CSSProperties,
    [
      preferencesStyle,
      sidebarResize.isResizing,
      sidebarResize.widthPx,
      rightPanelResize.isResizing,
      rightPanelResize.widthPx,
    ],
  );
  const [desktopLocale, setDesktopLocale] = useState<DesktopLocale>(() => loadDesktopLocale());
  const foregroundReplaceConfirm = useConfirmDialog();
  const confirmBusyRun = useCallback(
    async (problem: ForegroundRunMismatchProblem) => {
      const copy = getDesktopCopy(desktopLocale).composer;
      if (problem.data.reason !== 'active') {
        return 'dismiss' as const;
      }
      const choice = await foregroundReplaceConfirm.choose({
        title: copy.busyOtherClientTitle,
        description: copy.busyOtherClient,
        confirmLabel: copy.busyReplace,
        alternateLabel: copy.busyQueue,
        cancelLabel: copy.busyDismiss,
        tone: 'danger',
      });
      if (choice === 'confirm') return 'replace' as const;
      if (choice === 'alternate') return 'queue' as const;
      return 'dismiss' as const;
    },
    [desktopLocale, foregroundReplaceConfirm],
  );
  const confirmForegroundReplace = useCallback(
    async (problem: ForegroundRunMismatchProblem): Promise<boolean> => {
      return (await confirmBusyRun(problem)) === 'replace';
    },
    [confirmBusyRun],
  );
  const {
    plusMenuOpen,
    setPlusMenuOpen,
    plusSubmenu,
    setPlusSubmenu,
    menuSkills,
    menuMcp,
    refreshComposerMenus,
  } = useComposerPlusMenu({
    hostClient,
    projectPath: state.projectPath,
    projectTrusted: state.projectTrusted,
    activeSessionId: state.activeSessionId,
  });
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [thinkingLevel, setThinkingLevel] =
    useState<import('@piwin/contracts').ThinkingLevel>('off');
  /**
   * Bridge for session-resume model restore. useSessionActions is declared
   * before the restore callback, so we keep a stable ref it can call.
   */
  const sessionComposerProfileRestoredRef = useRef<
    (profile: {
      model?: import('@piwin/contracts').ModelRef;
      thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
    }) => void
  >(() => undefined);
  const [recentProjects, setRecentProjects] = useState<ProjectRecord[]>([]);
  const [runClock, setRunClock] = useState(() => Date.now());
  const hasHydratedInitialGeneralSessions = useRef(false);
  const hasRestoredDesktopSession = useRef(false);
  const hydratedProjectKeyRef = useRef('');
  const configSaveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    hasHydratedInitialGeneralSessions.current = false;
    hasRestoredDesktopSession.current = false;
    hydratedProjectKeyRef.current = '';
  }, [hostClient]);

  useEffect(() => {
    if (state.activeRunStartedAt === null) {
      return;
    }
    const timer = window.setInterval(() => setRunClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.activeRunStartedAt]);

  useEffect(() => {
    // Wait for the host bridge. Early `project/list` against a cold sidecar
    // fails silently and left the sidebar permanently empty (count 0) because
    // the effect never re-ran after hostReady flipped true.
    if (!state.hostReady) {
      return;
    }
    let cancelled = false;
    async function loadRecentProjects(): Promise<void> {
      const response = await hostClient.request({ type: 'project/list' });
      if (cancelled) {
        return;
      }
      if (!response.success) {
        console.warn('project/list failed; sidebar projects stay empty', response.error);
        return;
      }
      const fetched = mapListedProjects(response.data);
      setRecentProjects((prev) =>
        mergeRecentProjects(prev, fetched, state.projectPath ? [state.projectPath] : []),
      );
    }
    void loadRecentProjects();
    return () => {
      cancelled = true;
    };
  }, [hostClient, state.hostReady, state.projectPath]);

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
  // AJB: active jobs owned by the current session drive the composer strip.
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
  const handleOpenDocument = useCallback(
    (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => {
      inspectorFileDiff.clear();
      openDocumentBase(doc, target);
    },
    [inspectorFileDiff, openDocumentBase],
  );
  const handleOpenDiff = useCallback(
    (absolutePath: string, relativePath?: string) => {
      if (!state.projectPath || !hostClient.supportsCommand('git/diff-file')) {
        handleOpenDocument(
          {
            title: (relativePath || absolutePath).split(/[\\/]/).pop() || absolutePath,
            path: absolutePath,
          },
          'inspector',
        );
        return;
      }
      inspectorFileDiff.open(absolutePath, relativePath);
      revealDocPreview();
    },
    [
      handleOpenDocument,
      hostClient,
      inspectorFileDiff,
      revealDocPreview,
      state.projectPath,
    ],
  );

  useRunReconcile({
    hostClient,
    dispatch,
    activeSessionId: state.activeSessionId,
    activeRunId: state.activeRunId,
    runLive: state.runPhase === 'streaming' || state.runPhase === 'aborting',
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
  }, [orchestrationSchemeId, orchestrationSchemeOptions]);

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

  // Remount artifact iframes only when mode/id changes. Sandboxed srcdoc bakes
  // theme vars at build time; full remount is still required for mode flips, but
  // avoid remounting on every parent re-render of the same theme identity.
  const artifactThemeKey = `${activeTheme.mode}:${activeTheme.id}`;

  const modelOptions = useMemo(() => {
    if (config !== null && config.providers.length > 0) {
      return buildEnabledModelOptions(config.providers);
    }
    return modelOptionsFromConfiguredModels(configuredChatModels.models);
  }, [config, configuredChatModels]);
  const defaultProviderId = config?.defaultProviderId ?? configuredChatModels.defaultProviderId;
  const defaultModelId = config?.defaultModelId ?? configuredChatModels.defaultModelId;

  const speechConfigured = useMemo(() => {
    const modelRef = config?.speech?.asr?.defaultModel;
    if (!modelRef || !config) return false;
    const provider = config.providers.find((item) => item.id === modelRef.providerId);
    const model = provider?.models.find((item) => item.id === modelRef.modelId);
    return Boolean(
      provider &&
      isProviderEnabled(provider) &&
      model &&
      isModelEnabled(model) &&
      modelSupportsCapability(model, 'speech-to-text'),
    );
  }, [config]);

  const speechRequest = useCallback(
    (input: import('@piwin/contracts').SpeechTranscribeInput) =>
      hostClient.request({ type: 'speech/transcribe', input }),
    [hostClient],
  );

  // Flashcard actions from artifact flip cards (ADR 0018 S5c, doc-flashcards §12):
  // - flashcard/rate → flashcards/rate HostCommand → FSRS state update
  // - flashcard/open-source → doccards/open-source HostCommand → resolve + open file
  const handleArtifactAction = useCallback(
    (action: import('@piwin/artifact').ArtifactActionMessage) => {
      if (action.action === 'flashcard/rate') {
        void hostClient
          .request({
            type: 'flashcards/rate',
            cardId: action.payload.cardId,
            rating: action.payload.rating,
          })
          .then((response) => {
            if (!response.success) {
              dispatchNotification(pushError(`Flashcard rating failed: ${response.error}`));
            }
          });
        return;
      }
      if (action.action === 'flashcard/open-source') {
        void hostClient
          .request({
            type: 'doccards/open-source',
            cardId: action.payload.cardId,
          })
          .then((response) => {
            if (!response.success) {
              dispatchNotification(pushError(`Could not resolve source: ${response.error}`));
              return;
            }
            const result = response.data as { path?: string } | undefined;
            if (result?.path) {
              // Open via Tauri shell opener (OS default editor).
              void import('@tauri-apps/plugin-shell')
                .then(({ open }) => open(result.path as string))
                .catch((error: unknown) => {
                  dispatchNotification(pushError(`Failed to open source file: ${formatError(error)}`));
                });
            }
          });
      }
    },
    [hostClient, dispatchNotification],
  );

  // Walkthrough generation (spec §5.2): request the host generate/cancel a
  // walkthrough artifact for an assistant message. The host publishes
  // `walkthrough/updated` pushes that the bootstrap hook forwards to the reducer.
  const handleGenerateWalkthrough = useCallback(
    (messageId: string, force?: boolean) => {
      if (!state.activeSessionId) return;
      void hostClient
        .request({
          type: 'walkthrough/generate',
          sessionId: state.activeSessionId,
          messageId,
          ...(force ? { force: true } : {}),
        })
        .then((response) => {
          if (!response.success) {
            dispatchNotification(pushError(`Walkthrough generation failed: ${response.error}`));
          }
        });
    },
    [hostClient, state.activeSessionId, dispatchNotification],
  );

  const handleCancelWalkthrough = useCallback(
    (messageId: string, generationId?: string) => {
      if (!state.activeSessionId) return;
      void hostClient
        .request({
          type: 'walkthrough/cancel',
          sessionId: state.activeSessionId,
          messageId,
          ...(generationId !== undefined ? { generationId } : {}),
        })
        .then((response) => {
          if (!response.success) {
            dispatchNotification(pushError(`Walkthrough cancel failed: ${response.error}`));
          }
        });
    },
    [hostClient, state.activeSessionId, dispatchNotification],
  );

  // Hydrate walkthrough artifacts whenever the active session changes.
  // We intentionally do NOT guard on messages.length === 0: session/set fires
  // first (clearing messages), so an early return would skip the hydrate call
  // and the later session/load-messages dispatch doesn't change activeSessionId,
  // meaning the effect would never re-run. The host returns persisted artifacts
  // (empty list when none exist) which we dispatch into the reducer map.
  useEffect(() => {
    if (!state.activeSessionId) return;
    // Wait until transcript hydrate finishes so walkthrough chips attach to the
    // real rows (session switch keeps previous rows painted while awaiting).
    if (state.awaitingTranscript) return;
    if (hostClient.supportsCommand?.('walkthrough/list') === false) return;
    const sessionId = state.activeSessionId;
    const knownMessageIds = state.messages.map((message) => message.id);
    void hostClient
      .request({ type: 'walkthrough/list', sessionId, knownMessageIds })
      .then((response) => {
        if (!response.success) return;
        const data = response.data as { artifacts?: WalkthroughArtifact[] } | undefined;
        if (data?.artifacts) {
          dispatch({ type: 'walkthrough/hydrate', artifacts: data.artifacts });
        }
      });
    // Re-run when session changes or when transcript hydrate completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId, state.awaitingTranscript, hostClient]);

  // Stable identities: panels reload via useEffect([request]) — a fresh
  // closure per render would re-fire full loads on every App render.
  const requestNotesPanel = useCallback(
    (command: Parameters<import('./NotesPanel').NotesPanelProps['request']>[0]) =>
      remoteCommandRequiresIdempotencyKey(command.type)
        ? hostClient.request(command, { idempotencyKey: createGestureIdempotencyKey() })
        : hostClient.request(command),
    [hostClient],
  );
  const requestCardsPanel = useCallback(
    (command: Parameters<import('./FlashcardsPanel').FlashcardsPanelProps['request']>[0]) =>
      hostClient.request(command),
    [hostClient],
  );
  const resolveConversationFlashcards = useCallback(
    async (itemIds: string[]) => {
      if (hostClient.supportsCommand('flashcards/list') === false) return [];
      const response = await hostClient.request({ type: 'flashcards/list' });
      if (!response.success) return [];
      const items = ((response.data as { cards?: FlashcardItem[] } | undefined)?.cards ?? []).filter(
        (item) => itemIds.includes(item.id),
      );
      return reviewCardsForItemIds(items, itemIds);
    },
    [hostClient],
  );
  // Knowledge Center forwards commands to the same host transport; the panel
  // accepts a union type internally.
  const requestKnowledgeCenter = useCallback(
    async (
      command: Parameters<import('./KnowledgeCenterPanel').KnowledgeCenterPanelProps['request']>[0],
    ) => {
      const response = await hostClient.request(
        command as unknown as Parameters<typeof hostClient.request>[0],
      );
      if (command.type === 'doccards/open-source' && response.success) {
        const data = response.data as { path?: string } | undefined;
        if (data?.path) {
          void import('@tauri-apps/plugin-shell')
            .then(({ open }) => open(data.path as string))
            .catch((err: unknown) => {
              console.warn(`[piwin] open-source failed: ${formatError(err)}`);
            });
        }
      }
      return response;
    },
    [hostClient],
  );
  // File tree reloads on request identity change — keep this stable so right-panel
  // resize (which re-renders App every rAF) does not re-fetch the whole tree.
  const requestFileTree = useCallback(
    (command: import('./file-tree-panel').FileTreeRequest) => hostClient.request(command),
    [hostClient],
  );
  const resolveSessionScopeHint = useCallback(
    (sessionId: string): SessionScope | undefined => {
      if (remoteSearchHitsByScope === null) {
        return undefined;
      }
      for (const hits of Object.values(remoteSearchHitsByScope)) {
        const hit = hits.find((candidate) => candidate.sessionId === sessionId);
        if (!hit) {
          continue;
        }
        if (hit.scope) {
          return hit.scope;
        }
        return hit.projectPath.trim().length > 0
          ? { kind: 'project', projectPath: hit.projectPath }
          : { kind: 'general' };
      }
      return undefined;
    },
    [remoteSearchHitsByScope],
  );
  const {
    hydrateSessions,
    transcriptHistoryLoading,
    loadUserMessageIndex,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleOpenWorkspaceClick,
    handleBrowseProject,
    handleOpenProject,
    handleTrustProject,
    ensureSession,
    handleNewSession,
    handleResumeSession,
    coldRestorePrompt,
    confirmColdRestore,
    clearColdRestorePrompt,
    handleLoadOlderTranscript,
    handleRenameSession,
    handleDuplicateSession,
    handleContinueSessionInProject,
    handleForkSession,
    handleSessionMenuAction,
    confirmDeleteSession,
    handleAbort,
    handleCompact,
    handleCompactAbort,
    handlePermission,
  } = useSessionActions({
    hostClient,
    state,
    dispatch,
    dispatchNotification,
    projectInput,
    setProjectInput,
    setProjectPickerOpen,
    showArchivedSessions,
    sessionListOrder,
    resolveSessionScopeHint,
    selectedModelKey,
    modelOptions,
    thinkingLevel,
    setRenameDraft,
    setHostLogEntries,
    onSessionComposerProfileRestored: (profile) => {
      sessionComposerProfileRestoredRef.current(profile);
    },
  });

  const {
    branchPoints,
    switchBranch,
    branchResend,
    requestTruncateAfter,
    pendingTruncate,
    confirmTruncateAfter,
    cancelTruncateAfter,
    pendingSwitchConfirm,
    confirmSwitchBranch,
    cancelSwitchBranch,
  } = useBranchActions({
    hostClient,
    activeSessionId: state.activeSessionId,
    streaming: state.streaming,
    projectTrusted: state.projectTrusted,
    isGeneralScope: state.activeScope.kind === 'general' || !state.projectPath,
    transcriptOwnerSessionId: state.transcriptOwnerSessionId,
    visibleMessages: state.historyView?.messages ?? state.messages,
    dispatch,
    dispatchNotification,
    setEditingMessageId,
    locale: desktopLocale,
    selectedModelKey,
    modelOptions,
    thinkingLevel,
    agentMode,
    orchestrationSchemeId,
    delegationDisabled,
    confirmForegroundReplace,
  });

  useEffect(() => {
    const sessionId = state.activeSessionId;
    if (!sessionId || state.userMessageIndex !== null || state.streaming) {
      return;
    }
    // The index is a small independent query. Keep transcript hydration and
    // the live tail responsive while it arrives.
    void loadUserMessageIndex(sessionId, state.userMessageIndexEpoch);
  }, [
    loadUserMessageIndex,
    state.activeSessionId,
    state.streaming,
    state.userMessageIndex,
    state.userMessageIndexEpoch,
  ]);

  const handleSessionListOrderChange = useCallback(
    (order: SessionListOrder): void => {
      setSessionListOrder(order);
      void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions, order });
      for (const project of recentProjects) {
        void hydrateSessions(
          { kind: 'project', projectPath: project.path },
          {
            includeArchived: showArchivedSessions,
            order,
            ...(project.path === state.projectPath ? { fillActiveList: true } : {}),
          },
        );
      }
    },
    [hydrateSessions, recentProjects, showArchivedSessions, state.projectPath],
  );

  // Settings is a separate presentation surface. Keep the callback handed to
  // it stable while the active session streams; the latest session action is
  // read through the ref when the user explicitly opens a child session.
  const handleResumeSessionRef = useRef(handleResumeSession);
  handleResumeSessionRef.current = handleResumeSession;
  const handleSettingsOpenSubagentSession = useCallback((sessionId: string): void => {
    void handleResumeSessionRef.current(sessionId);
  }, []);
  const handleSettingsPreferencesChange = useCallback((next: DesktopPreferences): void => {
    setPreferences(next);
    saveDesktopPreferences(next);
  }, []);
  const handleSettingsSaved = useCallback(
    (next: PiwinConfig): void => {
      setConfig(next);
      if (next.defaultProviderId && next.defaultModelId) {
        setSelectedModelKey(formatComposerModelKey(next.defaultProviderId, next.defaultModelId));
      }
    },
    [setConfig],
  );

  // Cold start: hydrate General sessions once the host is ready.
  // Remote config/get is not allowed; do not wait on config === null there.
  useEffect(() => {
    const remote = isRemoteDesktopTransport(hostClient.getTransport());
    if (
      !state.hostReady ||
      state.projectPath ||
      hasHydratedInitialGeneralSessions.current ||
      (!remote && (config === null || Boolean(config.desktop?.lastSession)))
    ) {
      return;
    }
    hasHydratedInitialGeneralSessions.current = true;
    void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
    // Do not depend on hydrateSessions: it intentionally captures current UI
    // state and changes identity after every reducer update. Depending on it
    // here creates a session/list request loop that starves prompt requests.
    // General is refreshed explicitly on scope selection and archive toggles.
    // hydrateSessions is intentionally omitted; its identity changes with UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, hostClient, state.hostReady, state.projectPath]);

  // Remote snapshot / journal-gap recovery: re-list sessions even when the
  // shell was already ready (cold-start guard would otherwise skip).
  useEffect(() => {
    if (remoteCatchUpEpoch === 0 || !state.hostReady) {
      return;
    }
    hasHydratedInitialGeneralSessions.current = false;
    hydratedProjectKeyRef.current = '';
    const remote = isRemoteDesktopTransport(hostClient.getTransport());
    if (!remote) {
      return;
    }
    hasHydratedInitialGeneralSessions.current = true;
    if (state.projectPath) {
      void hydrateSessions(
        { kind: 'project', projectPath: state.projectPath },
        { includeArchived: showArchivedSessions },
      );
    } else {
      void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteCatchUpEpoch, state.hostReady]);

  // Hydrate every recent project's session list so the sidebar folder tree can
  // show each open folder's conversations without forcing the user to click
  // into it. The reducer keeps these per-project lists independent from the
  // active scope, so multiple folders can stay open with their own sessions.
  useEffect(() => {
    if (!state.hostReady) return;
    dispatch({
      type: 'session/retain-project-paths',
      projectPaths: recentProjects.map((project) => project.path),
    });
    if (recentProjects.length === 0) return;
    const projectKey = recentProjects.map((project) => project.path).join('\0');
    if (projectKey === hydratedProjectKeyRef.current) {
      return;
    }
    hydratedProjectKeyRef.current = projectKey;
    let cancelled = false;
    void (async () => {
      for (const project of recentProjects) {
        if (cancelled) return;
        // hydrateSessions dispatches session/hydrate-project for non-active
        // projects and session/hydrate for the active one.
        await hydrateSessions(
          { kind: 'project', projectPath: project.path },
          { includeArchived: showArchivedSessions },
        ).catch(() => {
          // A single project failing to load should not block the rest.
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when the set of recent projects changes. hydrateSessions is
    // intentionally omitted (its identity changes with UI state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentProjects, state.hostReady]);

  useEffect(() => {
    if (!state.hostReady || config === null || hasRestoredDesktopSession.current) {
      return;
    }
    // Consume the restore opportunity on the FIRST loaded config, whether or
    // not it carries a lastSession. Otherwise a later config save (e.g. the
    // lastSession write after the user explicitly opens a project) re-fires
    // this effect and silently re-opens the project with autoTrust: false,
    // popping a spurious trust dialog over an already-trusted session.
    hasRestoredDesktopSession.current = true;
    const lastSession = config.desktop?.lastSession;
    if (!lastSession) {
      return;
    }
    void (async () => {
      if (lastSession.scope.kind === 'project') {
        await handleOpenProject(lastSession.scope.projectPath, {
          autoTrust: false,
          resumeSessionId: lastSession.sessionId,
        });
        return;
      }
      dispatch({ type: 'project/clear' });
      await hydrateSessions({ kind: 'general' }, { includeArchived: false });
      await handleResumeSession(lastSession.sessionId);
    })();
  }, [
    config?.desktop?.lastSession,
    dispatch,
    handleOpenProject,
    handleResumeSession,
    hydrateSessions,
    state.hostReady,
  ]);

  const saveSettingsInOrder = useCallback(
    (buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[]): Promise<void> => {
      const saveOperation = configSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const currentResponse = await hostClient.request({ type: 'settings/get' });
          if (!currentResponse.success) {
            dispatchNotification(
              pushError(`Settings read failed: ${currentResponse.error}`),
            );
            return;
          }
          const data = currentResponse.data as {
            snapshot?: {
              config: PiwinConfig;
              revision: string;
              domainRevisions?: import('@piwin/contracts').SettingsSnapshot['domainRevisions'];
            };
          };
          if (!data.snapshot) {
            dispatchNotification(pushError('Settings read returned no snapshot'));
            return;
          }
          const mutations = settingsMutationsForHostApply(
            buildMutations(data.snapshot.config),
            hostClient.getTransport(),
          );
          if (mutations.length === 0) {
            return;
          }
          const applyResponse = await hostClient.request(
            {
              type: 'settings/apply',
              input: settingsApplyInputFromSnapshot(
                {
                  revision: data.snapshot.revision,
                  domainRevisions: data.snapshot.domainRevisions ?? {},
                },
                mutations,
              ),
            },
            { idempotencyKey: createGestureIdempotencyKey() },
          );
          if (!applyResponse.success) {
            const notice = hostFailureNotice(applyResponse, desktopLocale);
            if (notice.length > 0) {
              dispatchNotification(pushError(notice));
            }
          }
        })
        .catch((error: unknown) => {
          dispatchNotification(
            pushError(`Settings save failed: ${formatError(error)}`),
          );
        });
      configSaveQueue.current = saveOperation;
      return saveOperation;
    },
    [desktopLocale, dispatchNotification, hostClient],
  );

  const {
    handleSelectModel,
    handleThinkingLevelChange,
    selectedModelLabel,
    selectedModelContextWindow,
    currentPromptModelRef,
  } = useComposerModelController({
    hostClient,
    config,
    setConfig,
    modelOptions,
    defaultProviderId,
    defaultModelId,
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
    dispatchNotification,
    saveSettingsInOrder,
    sessionComposerProfileRestoredRef,
  });

  const handleRemoveProjectFromSidebar = useCallback(
    async (projectPath: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'project/remove',
        path: projectPath,
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }

      setRecentProjects((projects) => projects.filter((project) => project.path !== projectPath));
      if (state.projectPath !== projectPath) {
        return;
      }

      // Removing the active project also clears desktop restore state, otherwise
      // startup would reopen it and add it back to the sidebar.
      if (
        config?.desktop?.lastSession?.scope.kind === 'project' &&
        config.desktop.lastSession.scope.projectPath === projectPath
      ) {
        const nextDesktop = config.desktop ? { ...config.desktop } : {};
        delete nextDesktop.lastSession;
        const nextConfig: PiwinConfig = { ...config, desktop: nextDesktop };
        setConfig(nextConfig);
        void saveSettingsInOrder((currentConfig) => {
          const desktop = { ...(currentConfig.desktop ?? {}) };
          delete desktop.lastSession;
          return [
            {
              kind: 'replace-domain',
              domain: 'desktop',
              value: desktop as NonNullable<PiwinConfig['desktop']>,
            },
          ];
        });
      }

      dispatch({ type: 'project/clear' });
      await hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
    },
    [
      config,
      dispatch,
      hostClient,
      hydrateSessions,
      saveSettingsInOrder,
      setConfig,
      showArchivedSessions,
      state.projectPath,
    ],
  );

  // ADR 0024: Run Mode preset. Session-level override (in memory); "Set as
  // default" persists to config.permissions.preset. Derived from config when
  // no session override is set.
  const [runModeOverride, setRunModeOverride] = useState<PermissionPreset | null>(null);
  const configPreset: PermissionPreset = resolvePermissionPreset(config?.permissions);
  const effectiveRunMode: PermissionPreset = runModeOverride ?? configPreset;

  const handleRunModeChange = useCallback((nextPreset: PermissionPreset): void => {
    setRunModeOverride(nextPreset);
  }, []);

  const handleRunModeSetDefault = useCallback(
    (nextPreset: PermissionPreset): void => {
      if (!config) return;
      const resolved = resolvePreset(nextPreset);
      const nextConfig: PiwinConfig = {
        ...config,
        permissions: { mode: resolved.mode, preset: nextPreset },
      };
      setConfig(nextConfig);
      void saveSettingsInOrder(() => [
        {
          kind: 'replace-domain',
          domain: 'permissions',
          value: nextConfig.permissions,
        },
      ]);
    },
    [config, saveSettingsInOrder, setConfig],
  );

  useEffect(() => {
    if (!config || !state.activeSessionId) {
      return;
    }
    const lastSession = {
      sessionId: state.activeSessionId,
      scope: state.activeScope,
    };
    if (
      config.desktop?.lastSession?.sessionId === lastSession.sessionId &&
      JSON.stringify(config.desktop.lastSession.scope) === JSON.stringify(lastSession.scope)
    ) {
      return;
    }
    const nextConfig: PiwinConfig = {
      ...config,
      desktop: { ...config.desktop, lastSession },
    };
    setConfig(nextConfig);
    void saveSettingsInOrder((currentConfig) => [
      {
        kind: 'replace-domain',
        domain: 'desktop',
        value: {
          ...currentConfig.desktop,
          lastSession,
        } as NonNullable<PiwinConfig['desktop']>,
      },
    ]);
  }, [config, saveSettingsInOrder, setConfig, state.activeScope, state.activeSessionId]);

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
    dispatchNotification,
    agentMode,
    orchestrationSchemeId,
    onOrchestrationSchemeChange: setOrchestrationSchemeId,
    onAgentModeChange: setAgentMode,
    menuSkills,
    conversationChat: state.activeScope.kind === 'general',
    onOpenKnowledge: handleOpenKnowledge,
    onOpenCardsPanel: handleOpenCardsPanel,
    onCompact: handleCompact,
    onAbort: handleAbort,
    ensureSession,
    onNeedWorkspace: handleOpenWorkspaceClick,
    selectedModelKey,
    modelOptions,
    thinkingLevel,
    delegationDisabled,
    visionDelegationEnabled: config?.visionDelegation?.enabled === true,
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
        dispatchNotification({
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

  const handleOpenArtifactCanvas = useCallback(
    (target: ArtifactCanvasTarget): void => {
      artifactCanvas.openTarget(target);
      if (
        layoutMode !== 'compact' &&
        rightPanelResize.widthPx < ARTIFACT_CANVAS_MIN_PANEL_WIDTH_PX
      ) {
        rightPanelResize.setWidthPx(ARTIFACT_CANVAS_MIN_PANEL_WIDTH_PX);
      }
      shell.openInspector('canvas');
    },
    [
      artifactCanvas.openTarget,
      layoutMode,
      rightPanelResize.setWidthPx,
      rightPanelResize.widthPx,
      shell.openInspector,
    ],
  );

  const handleStartNewSession = useCallback(
    async (options?: {
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
    }): Promise<void> => {
      startNewDraft(options?.scope);
      await handleNewSession(options);
    },
    [handleNewSession, startNewDraft],
  );

  const handleResumeDraft = useCallback(
    async (draftId: string): Promise<void> => {
      const draft = draftSessions.find((item) => item.id === draftId);
      if (!draft) return;

      const isSameScope =
        state.activeScope.kind === draft.scope.kind &&
        (draft.scope.kind === 'general' ||
          (state.activeScope.kind === 'project' &&
            state.activeScope.projectPath === draft.scope.projectPath));
      if (!isSameScope) {
        if (draft.scope.kind === 'general') {
          dispatch({ type: 'project/clear' });
          await hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
        } else {
          await handleOpenProject(draft.scope.projectPath);
        }
      }
      resumeDraft(draftId);
    },
    [
      dispatch,
      draftSessions,
      handleOpenProject,
      hydrateSessions,
      resumeDraft,
      showArchivedSessions,
      state.activeScope,
    ],
  );
  // CM P1: single app-level dispatcher set shared by all context-menu surfaces.
  // Deep components consume this through DesktopContextMenuProvider, so no
  // surface owns its own half-wired dispatcher set anymore.
  const handleRetryMessage = useCallback((messageId: string): void => {
    setEditingMessageId(messageId);
  }, []);

  const desktopContextMenuValue = useMemo<DesktopContextMenuValue>(() => {
    const notify = (message: string, level: 'success' | 'error' | 'info'): void => {
      dispatchNotification({ type: 'notify/push', notification: { level, message } });
    };
    const addRef = (ref: PromptContextRef): boolean => {
      const result = addContextRef(ref);
      if (!result.ok) {
        notify('Context chip limit reached (12). Remove one first.', 'error');
        return false;
      }
      return true;
    };
    return {
      caps: {
        hasProject: Boolean(state.projectPath),
        canReveal: false,
        sideChatAvailable: Boolean(
          state.activeSessionId &&
            state.hostReady &&
            hostClient.supportsCommand('side-chat/open'),
        ),
        applyAvailable: hostClient.supportsCommand('project/read-file'),
        openChangedFilesAvailable: Boolean(
          state.projectPath && hostClient.supportsCommand('project/read-file'),
        ),
        locale: desktopLocale,
      },
      dispatchers: {
        addToChat: (ref) => {
          addRef(ref);
        },
        focusComposer: () => {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            '[data-testid="composer-input"]',
          );
          textarea?.focus();
        },
        sendPreset: (text, refs) => {
          for (const ref of refs) {
            addRef(ref);
          }
          void handleSend(text);
        },
        openPath: (absolutePath, relativePath) => {
          const title = (relativePath || absolutePath).split(/[\\/]/).pop() || 'File';
          handleOpenDocument({ title, path: relativePath || absolutePath });
        },
        revealPath: (_absolutePath) => {
          notify('Reveal in file manager is not available in this build', 'info');
        },
        copyText: (value) => {
          void navigator.clipboard.writeText(value).catch(() => {
            notify('Could not copy to clipboard', 'error');
          });
        },
        quoteInComposer: (text) => {
          const quoted = text
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
          setComposer((current) =>
            current.trim().length > 0 ? `${current.trimEnd()}\n\n${quoted}` : quoted,
          );
          window.setTimeout(() => {
            document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus();
          }, 0);
        },
        retryMessage: (messageId) => {
          handleRetryMessage(messageId);
        },
        truncateAfterMessage: (messageId) => {
          requestTruncateAfter(messageId);
        },
        forkMessage: (messageId) => {
          if (!state.activeSessionId) return;
          void handleForkSession(state.activeSessionId, messageId);
        },
        openSideChat: (input) => {
          if (!state.activeSessionId) return;
          void hostClient
            .sideChatOpen(state.activeSessionId, {
              ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
              ...(input.refs && input.refs.length > 0 ? { refs: input.refs } : {}),
            })
            .then((response) => {
              if (!response.success) {
                notify(`Could not open side chat: ${response.error}`, 'error');
                return;
              }
              shell.openInspector('sideChat');
            });
        },
        applyToFile: (payload) => {
          // Apply P1a only (write-file host command is not part of this
          // integration): copy + preview + notice; never a silent write.
          void navigator.clipboard.writeText(payload.text).catch(() => undefined);
          if (payload.suggestedPath) {
            const title = payload.suggestedPath.split(/[\\/]/).pop() || 'File';
            handleOpenDocument({ title, path: payload.suggestedPath });
          }
          notify(
            payload.suggestedPath
              ? `Code copied. Preview opened for ${payload.suggestedPath} — paste to apply.`
              : 'Code copied to clipboard — paste to apply.',
            'info',
          );
        },
        openChangedFiles: () => {
          shell.openInspector('review');
        },
        notify,
      },
    };
  }, [
    addContextRef,
    desktopLocale,
    dispatchNotification,
    handleForkSession,
    handleOpenDocument,
    handleRetryMessage,
    requestTruncateAfter,
    handleSend,
    hostClient,
    setComposer,
    shell,
    state.activeSessionId,
    state.hostReady,
    state.projectPath,
  ]);

  const handleCommentLine = useCallback((_lineContent: string) => {
    // Chip is the attachment; do not inject quote text into the textarea.
    setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="composer-input"]',
      );
      textarea?.focus();
    }, 50);
  }, []);

  const {
    activeComments,
    addDocComment: handleAddDocComment,
    editDocComment: handleEditDocComment,
    deleteDocComment: handleDeleteDocComment,
    clearDocComments: handleRemoveDocComments,
    sendWithComments: handleSendWithComments,
  } = useDocComments({ activeDocument, composer, send: handleSend });

  async function handleExtensionUiResolve(payload: {
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }): Promise<void> {
    const active = extensionUiRequest;
    if (!active) {
      return;
    }
    const response = await hostClient.request({
      type: 'extension/ui_resolve',
      requestId: active.requestId,
      ...(payload.confirmed !== undefined ? { confirmed: payload.confirmed } : {}),
      ...(payload.value !== undefined ? { value: payload.value } : {}),
      ...(payload.cancelled !== undefined ? { cancelled: payload.cancelled } : {}),
    });
    // Resolving one question can synchronously cause Pi to emit the next
    // question. Only clear the request that this response belongs to; an
    // unconditional clear would erase the next questionnaire page.
    clearExtensionUiRequest(active.requestId);
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handleExtensionUiAbort(): Promise<void> {
    const active = extensionUiRequest;
    if (active) {
      clearExtensionUiRequest(active.requestId);
    }
    await handleAbort();
  }

  function handleToggleAppearance(): void {
    if (activeTheme.visualStyle !== undefined) {
      dispatchNotification({
        type: 'notify/push',
        notification: {
          level: 'info',
          message:
            desktopLocale === 'zh-CN'
              ? '当前主题包已接管外观；请在设置 → 外观 → 主题包中切换。'
              : 'The active theme package owns appearance. Switch it from Settings → Appearance → Theme Library.',
        },
      });
      return;
    }
    // Instant local flip: same Appearance prefs path as Settings (no host IPC wait).
    const nextMode = activeTheme.mode === 'light' ? 'dark' : 'light';
    const nextThemeSettings =
      nextMode === 'light'
        ? (preferences.lightTheme ?? DEFAULT_LIGHT_THEME_SETTINGS)
        : (preferences.darkTheme ?? DEFAULT_DARK_THEME_SETTINGS);
    const nextPreferences: DesktopPreferences = {
      ...preferences,
      appearanceMode: nextMode,
    };
    setPreferences(nextPreferences);
    saveDesktopPreferences(nextPreferences);
    onThemeApplied(buildAppearanceTheme(nextMode, nextThemeSettings));
  }

  function openRightTab(tab: RightPanelTab): void {
    shell.openInspector(tab);
  }

  const openSettingsSection = useCallback(
    (section: ShellSettingsSection): void => {
      shell.openSettings(section);
    },
    [shell.openSettings],
  );

  function runDesktopCommand(commandId: DesktopCommandId): void {
    switch (commandId) {
      case 'new-session':
        void handleStartNewSession();
        break;
      case 'search-sessions':
        shell.openSessions();
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('[aria-label="Search conversations"]')?.focus();
        }, 0);
        break;
      case 'focus-composer':
        document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus();
        break;
      case 'toggle-inspector':
        shell.toggleInspector('files');
        break;
      case 'open-activity':
        openRightTab('terminal');
        break;
      case 'open-settings':
        shell.openSettings('general');
        break;
      case 'open-workspace':
        void handleOpenWorkspaceClick();
        break;
      case 'toggle-sidebar':
        shell.toggleSessions();
        break;
      case 'toggle-right-panel':
        shell.toggleInspector(null);
        break;
      case 'stop-run':
        void handleAbort();
        break;
      case 'switch-tab-1':
        openRightTab('files');
        break;
      case 'switch-tab-2':
        openRightTab('terminal');
        break;
      case 'switch-tab-3':
        openRightTab('review');
        break;
      case 'switch-tab-4':
        openRightTab('browser');
        break;
      case 'switch-tab-5':
        openRightTab('docPreview');
        break;
      default:
        break;
    }
  }

  useDesktopShortcuts({
    onOpenPalette: () => {
      shell.rememberTrigger();
      shell.setCommandPaletteOpen(true);
    },
    onCommand: runDesktopCommand,
  });

  const sessionTools = useMemo(() => collectSessionTools(state.messages), [state.messages]);

  const runStatus = useMemo(
    () =>
      deriveRunStatus({
        chat: state,
        tools: sessionTools,
        plan: sessionPlan,
        jobs,
        locale: desktopLocale,
      }),
    [state, sessionTools, sessionPlan, jobs, runClock, desktopLocale],
  );

  const activitySignal = useMemo(() => {
    const latestMessage = state.messages[state.messages.length - 1];
    const latestVisibleLength = latestMessage
      ? latestMessage.text.length + latestMessage.thinking.length
      : 0;
    const toolStates = sessionTools
      .map((tool) => `${tool.toolCallId}:${tool.status}:${tool.output.length}`)
      .join(',');
    return `${state.runPhase}:${state.messages.length}:${latestVisibleLength}:${toolStates}`;
  }, [state.runPhase, state.messages, sessionTools]);

  const historyViewActive = state.historyView !== null;
  const visibleTranscriptMessages = state.historyView?.messages ?? state.messages;
  const visibleRunRecordsById = state.historyView?.runRecordsById ?? state.runRecordsById;

  /**
   * Status-bar percent must match ContextUsageRing (shared used/limit math).
   * Undefined until the first usage sample so chrome does not show a fake 0%.
   */
  const contextUsagePercent = useMemo(
    () => computeContextUsagePercent(state.contextUsage, selectedModelContextWindow),
    [state.contextUsage, selectedModelContextWindow],
  );

  const lastUserMessage = useMemo(() => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role === 'user') {
        return message;
      }
    }
    return null;
  }, [state.messages]);
  const lastUserMessageId = lastUserMessage?.id ?? null;

  const activeSessionListItem =
    state.activeSessionMetadata ??
    state.sessions.find((item) => item.id === state.activeSessionId) ??
    null;
  const activeSessionName = activeSessionListItem?.name ?? 'New chat';
  const activeSessionOrigin = activeSessionListItem?.origin ?? null;
  const desktopCopy = getDesktopCopy(desktopLocale);

  const { composerCard, composerLayoutMode } = useComposerDockProps({
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
    activeCommentsCount: activeComments.length,
    activeDocumentTitle: activeDocument?.title,
    onRemoveDocComments: handleRemoveDocComments,
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
    onSelectModel: handleSelectModel,
    menuSkills,
    menuMcp,
    refreshComposerMenus,
    openSettingsSection,
    onOpenKnowledge: handleOpenKnowledge,
    onOpenCardsPanel: handleOpenCardsPanel,
    onPickFiles: handlePickFiles,
    onPickImageFiles: handlePickImageFiles,
    onComposerPaste: handleComposerPaste,
    onComposerDrop: handleComposerDrop,
    onSendWithComments: handleSendWithComments,
    onSteer: handleSteer,
    onFollowUp: handleFollowUp,
    onAbort: handleAbort,
    onCompact: handleCompact,
    onOpenProject: handleOpenProject,
    onExtensionUiResolve: handleExtensionUiResolve,
    onExtensionUiAbort: handleExtensionUiAbort,
    extensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
    thinkingLevel,
    onThinkingLevelChange: handleThinkingLevelChange,
    speechConfigured,
    speechRequest,
    runModePreset: effectiveRunMode,
    onRunModeChange: handleRunModeChange,
    onRunModeSetDefault: handleRunModeSetDefault,
    orchestrationSchemeId,
    orchestrationSchemeOptions,
    delegationDisabled,
    setDelegationDisabled,
    setOrchestrationSchemeId,
    requestGit,
    recentProjects,
    activeJobs: activeJobsForComposer,
    stopJob,
    openInspector: shell.openInspector,
    steerQueueMessages,
    onSteerQueueSendNow: handleSteerQueueSendNow,
    onSteerQueueEdit: handleSteerQueueEdit,
    onSteerQueueRemove: handleSteerQueueRemove,
  });

  // Subagent session inspector: preview stays in-place, promotion navigates.
  const handleEnterSubagentSession = useCallback(
    (sessionId: string): void => {
      void handleResumeSession(sessionId);
    },
    [handleResumeSession],
  );
  const inspector = useSubagentSessionInspector({
    hostClient,
    streamFor: useCallback(
      (childSessionId: string) => state.subagentStreams[childSessionId],
      [state.subagentStreams],
    ),
    childFor: useCallback(
      (childSessionId: string) => state.subagentChildren[childSessionId],
      [state.subagentChildren],
    ),
    onOpenFullSession: handleEnterSubagentSession,
  });
  const inspectorInvocation = inspector.selection
    ? Object.values(state.subagentInvocations).find(
        (item) => item.childSessionId === inspector.selection?.childSessionId,
      )
    : undefined;
  // Anchor toggle: clicking the anchor that owns the expanded panel collapses
  // it; clicking any other anchor moves the single inline panel there.
  const handleInspectSubagent = useCallback(
    (selection: SubagentInspectorSelection): void => {
      const current = inspector.selection;
      if (
        current !== null &&
        current.childSessionId === selection.childSessionId &&
        current.anchorId === selection.anchorId
      ) {
        inspector.closeInspector();
        return;
      }
      inspector.openInspector(selection);
    },
    [inspector.selection, inspector.openInspector, inspector.closeInspector],
  );
  const handleSubagentPermission = useCallback(
    async (
      prompt: PermissionPromptUi,
      decision: PermissionDecision,
      rememberScope?: PermissionRememberScope,
    ): Promise<void> => {
      const response = await hostClient.request(
        {
          type: 'permission/resolve',
          requestId: prompt.requestId,
          decision,
          ...(decision === 'allow' && rememberScope ? { rememberScope } : {}),
        },
        { idempotencyKey: createGestureIdempotencyKey() },
      );
      if (state.permissionPrompt?.requestId === prompt.requestId) {
        dispatch({ type: 'permission/clear', requestId: prompt.requestId });
      }
      if (!response.success) {
        dispatchNotification(pushError(hostFailureNotice(response, desktopLocale)));
      }
    },
    [desktopLocale, dispatch, dispatchNotification, hostClient, state.permissionPrompt?.requestId],
  );
  const handleSubagentWorktreeAction = useCallback(
    async (
      childSessionId: string,
      action: 'apply' | 'retain' | 'discard',
    ): Promise<void> => {
      const response = await hostClient.request({
        type: 'subagent/worktree-action',
        childSessionId,
        action,
      });
      if (!response.success) throw new Error(response.error);
    },
    [hostClient],
  );
  const subagentInspectorToggle = useMemo<SubagentInspectorToggle>(
    () => ({ selection: inspector.selection, toggle: handleInspectSubagent }),
    [inspector.selection, handleInspectSubagent],
  );
  const subagentInspectorChild = inspector.selection
    ? state.subagentChildren[inspector.selection.childSessionId]
    : undefined;
  const subagentInspectorPanel = useMemo<SubagentInspectorPanelData>(
    () => ({
      status: inspector.status,
      messages: inspector.messages,
      liveTail: inspector.liveTail,
      loading: inspector.loading,
      error: inspector.error,
      ...(subagentInspectorChild ? { child: subagentInspectorChild } : {}),
      ...(inspectorInvocation ? { invocation: inspectorInvocation } : {}),
      ...(modelOptions.length > 0 ? { modelOptions } : {}),
      showThinking: preferences.verboseAgentChat,
      projectPath: subagentInspectorChild?.projectPath ?? null,
      ...(hostClient.supportsCommand('git/diff-file')
        ? { request: requestGit as never }
        : {}),
      ...(hostClient.supportsCommand('git/diff-summary')
        ? { filesChangedRequest: requestGit as never }
        : {}),
      ...(hostClient.supportsCommand('project/read-file')
        ? {
            onOpenFile: (absolutePath: string, relativePath?: string) => {
              handleOpenDocument(
                {
                  title: (relativePath || absolutePath).split(/[\\/]/).pop() || absolutePath,
                  path: absolutePath,
                },
                'inspector',
              );
            },
            onOpenDocument: handleOpenDocument,
          }
        : {}),
      onOpenDiff: handleOpenDiff,
      onArtifactAction: handleArtifactAction,
      onOpenArtifactCanvas: handleOpenArtifactCanvas,
      artifactPreviewEnabled: config?.artifact?.enabled ?? true,
      ...(config?.artifact?.maxBytes !== undefined
        ? { artifactMaxBytes: config.artifact.maxBytes }
        : {}),
      onPermission: (prompt, decision, rememberScope) => {
        void handleSubagentPermission(prompt, decision, rememberScope);
      },
      onOpenFullSession: inspector.openFullSession,
      onRetry: inspector.retryLoad,
      onClose: inspector.closeInspector,
      onWorktreeAction: handleSubagentWorktreeAction,
    }),
    [
      inspector.status,
      inspector.messages,
      inspector.liveTail,
      inspector.loading,
      inspector.error,
      inspector.openFullSession,
      inspector.retryLoad,
      inspector.closeInspector,
      subagentInspectorChild,
      inspectorInvocation,
      modelOptions,
      preferences.verboseAgentChat,
      hostClient,
      requestGit,
      handleOpenDocument,
      handleOpenDiff,
      handleArtifactAction,
      handleOpenArtifactCanvas,
      config?.artifact?.enabled,
      config?.artifact?.maxBytes,
      handleSubagentPermission,
      handleSubagentWorktreeAction,
    ],
  );
  const handleCancelMessageEdit = useCallback((): void => {
    setEditingMessageId(null);
  }, []);
  const handleInterventionEdit = useCallback(
    async (messageId: string, text: string): Promise<void> => {
      const message = state.messages.find((candidate) => candidate.id === messageId);
      const delivery = message?.instructionDelivery;
      if (
        !state.activeSessionId ||
        delivery?.kind !== 'run-intervention' ||
        delivery.status !== 'pending' ||
        !delivery.targetRunId
      ) {
        dispatchNotification(pushError('这条调整已不能编辑，请重新发送。'));
        return;
      }
      const response = await hostClient.request({
        type: 'run/intervention-edit',
        sessionId: state.activeSessionId,
        runId: delivery.targetRunId,
        interventionId: delivery.instructionId,
        expectedRevision: delivery.revision,
        input: { text },
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const responseData = response.data as { intervention?: RunInterventionRecord } | undefined;
      if (responseData?.intervention !== undefined) {
        dispatch({
          type: 'run/intervention-updated',
          intervention: responseData.intervention,
        });
      }
      setEditingMessageId(null);
    },
    [dispatch, dispatchNotification, hostClient, state.activeSessionId, state.messages],
  );
  const handleInterventionCancel = useCallback(
    async (messageId: string): Promise<void> => {
      const message = state.messages.find((candidate) => candidate.id === messageId);
      const delivery = message?.instructionDelivery;
      if (
        !state.activeSessionId ||
        delivery?.kind !== 'run-intervention' ||
        delivery.status !== 'pending' ||
        !delivery.targetRunId
      ) {
        return;
      }
      const response = await hostClient.request({
        type: 'run/intervention-cancel',
        sessionId: state.activeSessionId,
        runId: delivery.targetRunId,
        interventionId: delivery.instructionId,
        expectedRevision: delivery.revision,
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const responseData = response.data as { intervention?: RunInterventionRecord } | undefined;
      if (responseData?.intervention !== undefined) {
        dispatch({
          type: 'run/intervention-updated',
          intervention: responseData.intervention,
        });
      }
    },
    [hostClient, state.activeSessionId, state.messages],
  );
  const handleEditAndResendMessage = useCallback(
    (messageId: string, text: string): void => {
      void branchResend(messageId, text);
    },
    [branchResend],
  );
  const handleMessageFeedback = useCallback(
    (message: string, level: 'info' | 'success' | 'error'): void => {
      dispatchNotification({
        type: 'notify/push',
        notification: { level, message },
      });
    },
    [dispatchNotification],
  );

  const handlePlanExecute = useCallback(
    async (mode: import('@piwin/contracts').PlanExecutionMode): Promise<void> => {
      if (!state.activeSessionId || !sessionPlan) return;
      const response = await hostClient.request({
        type: 'plan/execute',
        request: {
          sessionId: state.activeSessionId,
          planId: sessionPlan.id,
          mode,
          expectedRevision: sessionPlan.revision,
          ...(sessionPlan.status === 'draft' ? { approveDraft: true } : {}),
        },
      });
      if (!response.success) {
        dispatchNotification({
          type: 'notify/push',
          notification: { level: 'error', message: response.error },
        });
      }
    },
    [hostClient, state.activeSessionId, sessionPlan, dispatchNotification],
  );

  const handlePlanAbort = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId || !sessionPlan) return;
    const response = await hostClient.request({
      type: 'plan/abort',
      sessionId: state.activeSessionId,
      planId: sessionPlan.id,
    });
    if (!response.success) {
      dispatchNotification({
        type: 'notify/push',
        notification: { level: 'error', message: response.error },
      });
    }
  }, [hostClient, state.activeSessionId, sessionPlan, dispatchNotification]);

  useEffect(() => {
    document.documentElement.lang = desktopLocale;
  }, [desktopLocale]);

  const handleLocaleChange = useCallback((locale: DesktopLocale): void => {
    setDesktopLocale(locale);
    saveDesktopLocale(locale);
  }, []);

  // Media documents render through the media viewer; text through DocPreviewPanel.
  const activeMedia = activeDocumentMedia(activeDocument);
  const readTranscriptMedia = useCallback(
    (input: { sessionId: string; assetId: string }) => readMediaPreviewViaHost(hostClient, input),
    [hostClient],
  );

  return (
    <DesktopLocaleProvider locale={desktopLocale} onLocaleChange={handleLocaleChange}>
      <MediaPreviewReadProvider sessionId={state.activeSessionId} readMedia={readTranscriptMedia}>
      <DesktopContextMenuProvider value={desktopContextMenuValue}>
      <SubagentInspectorProvider toggle={subagentInspectorToggle} panel={subagentInspectorPanel}>
        <div
          className={`app-shell workbench${rightPanelOpen ? ' has-right-panel' : ''}${navDrawerOpen ? ' nav-open' : ''}${settingsOpen ? ' settings-open' : ''}${knowledgeOpen ? ' knowledge-open' : ''}${rightPanelResize.isResizing || sidebarResize.isResizing ? ' is-resizing-panels' : ''}`}
          style={appShellStyle}
          data-testid="app-shell"
          data-layout={layoutMode}
          data-right={rightPanelOpen ? 'expanded' : 'collapsed'}
          data-settings-open={settingsOpen ? 'true' : 'false'}
          data-knowledge-open={knowledgeOpen ? 'true' : 'false'}
        >
          <WorkspaceShell
            workspaceClassName={settingsOpen ? 'settings-workspace-suspended' : undefined}
            sidebar={
              <ProjectSessionSidebar
                projectPath={state.projectPath}
                projectTrusted={state.projectTrusted}
                hostReady={state.hostReady}
                hostMock={state.hostMock}
                transportLabel={hostClient.getTransport()}
                hostStatus={hostStatus}
                recentProjects={recentProjects}
                sessions={state.sessions}
                filteredSessions={filteredSessions}
                generalSessions={filteredGeneralSessions}
                projectSessionsByPath={state.projectSessionsByPath}
                sessionListScopes={state.sessionListScopes}
                sessionListOrder={sessionListOrder}
                onSessionListOrderChange={handleSessionListOrderChange}
                sessionGroups={sessionGroups}
                activeSessionId={state.activeSessionId}
                sessionSearch={sessionSearch}
                onSessionSearchChange={setSessionSearch}
                showArchivedSessions={showArchivedSessions}
                onToggleShowArchived={() => {
                  const next = !showArchivedSessions;
                  setShowArchivedSessions(next);
                  void hydrateSessions(
                    { kind: 'general' },
                    { includeArchived: next, order: sessionListOrder },
                  );
                  for (const project of recentProjects) {
                    void hydrateSessions(
                      { kind: 'project', projectPath: project.path },
                      {
                        includeArchived: next,
                        order: sessionListOrder,
                        ...(project.path === state.projectPath ? { fillActiveList: true } : {}),
                      },
                    );
                  }
                }}
                settingsOpen={settingsOpen}
                {...(hostClient.supportsCommand('project/open')
                  ? { onOpenWorkspace: () => void handleOpenWorkspaceClick() }
                  : {})}
                onOpenProject={(path) => void handleOpenProject(path)}
                {...(hostClient.supportsCommand('project/remove')
                  ? {
                      onRemoveProject: (path: string) =>
                        void handleRemoveProjectFromSidebar(path),
                    }
                  : {})}
                onNewSession={() => void handleStartNewSession()}
                onNewGeneralSession={() => {
                  void (async () => {
                    // Sequence: switch scope → hydrate general list → create new
                    // general session. Awaiting hydrate before create avoids the
                    // session/hydrate dispatch clobbering session/add, and the
                    // explicit general scope avoids reading stale activeScope.
                    dispatch({ type: 'project/clear' });
                    await hydrateSessions(
                      { kind: 'general' },
                      { includeArchived: showArchivedSessions },
                    );
                    await handleStartNewSession({ scope: { kind: 'general' } });
                  })();
                }}
                onResumeSession={(sessionId) => void handleResumeSession(sessionId)}
                onResumeDraft={handleResumeDraft}
                draftSessions={draftSessions}
                activeDraftId={activeDraftId}
                sessionMenu={sessionMenu}
                onOpenSessionMenu={openSessionMenu}
                onTogglePin={(sessionId, currentlyPinned) =>
                  void handleSessionMenuAction(sessionId, currentlyPinned ? 'unpin' : 'pin')
                }
                onArchiveSession={(sessionId) => void handleSessionMenuAction(sessionId, 'archive')}
                onUnarchiveSession={(sessionId) =>
                  void handleSessionMenuAction(sessionId, 'unarchive')
                }
                onDeleteSession={(sessionId) => {
                  requestDeleteSession(
                    sessionId,
                    resolveSessionDisplayName(
                      sessionId,
                      mergeSessionsForLookup(state.sessions, state.generalSessions),
                    ),
                  );
                }}
                onOpenSettings={() => openSettingsSection('general')}
                knowledgeOpen={knowledgeOpen}
                {...(hostClient.supportsCommand('doccards/scan-folder')
                  ? { onToggleKnowledge: () => setKnowledgeOpen((current) => !current) }
                  : {})}
                generalActive={state.activeScope.kind === 'general'}
                onSelectGeneral={() => {
                  dispatch({ type: 'project/clear' });
                  void hydrateSessions(
                    { kind: 'general' },
                    { includeArchived: showArchivedSessions },
                  );
                }}
                isOverlayPresentation={isOverlayPresentation}
                onCloseOverlay={() => shell.closeOverlay()}
                locale={desktopLocale}
                sidebarWidthPx={sidebarResize.widthPx}
                isResizing={sidebarResize.isResizing}
                onResizePointerDown={sidebarResize.onResizePointerDown}
                onResizeReset={() => sidebarResize.setWidthPx(SIDEBAR_DEFAULT_WIDTH_PX)}
                workingSessionIds={state.workingSessionIds}
                backendServiceSessionIds={backendServiceSessionIds}
                completedAttentionSessionIds={state.completedAttentionSessionIds}
                onDismissCompletedAttention={(sessionId) => {
                  dispatch({ type: 'session/attention-dismiss', sessionId });
                }}
                sessionsExpanded={navDrawerOpen}
                onToggleSessions={() => {
                  shell.toggleSessions();
                }}
                canGoBack={shell.canGoBack}
                canGoForward={shell.canGoForward}
                onGoBack={() => {
                  shell.goBack();
                }}
                onGoForward={() => {
                  shell.goForward();
                }}
              />
            }
            contextBar={
              <ContextBar
                session={{
                  title: state.projectPath
                    ? `${projectLabel(state.projectPath, recentProjects)} / ${activeSessionName}`
                    : activeSessionName,
                  scopeLabel:
                    state.activeScope.kind === 'general'
                      ? desktopCopy.general
                      : desktopLocale === 'zh-CN'
                        ? '项目'
                        : 'Project',
                }}
                {...(state.activeSessionId
                  ? {
                      sessionTreeControl: (
                        <SessionLineageHeaderPopover
                          lineage={sessionLineage}
                          activeSessionId={state.activeSessionId}
                          activeSessionName={activeSessionName}
                          activeSessionArchived={state.activeSessionArchived}
                          onOpenSession={(sessionId) => void handleResumeSession(sessionId)}
                          locale={desktopLocale}
                        />
                      ),
                    }
                  : {})}
                isConversationSession={state.activeScope.kind === 'general'}
                runState={runStatus}
                onStop={() => void handleAbort()}
                onViewActivity={() => openRightTab('terminal')}
                onReviewPermission={() => {
                  // Focus the inline permission gate in the stream when present.
                  const gate = document.querySelector<HTMLElement>(
                    '[data-testid="permission-gate"]',
                  );
                  gate?.focus?.();
                  gate?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
                }}
                onViewPlan={() => openRightTab('terminal')}
                onCancelCompact={() => void handleCompactAbort()}
                {...(lastUserMessage
                  ? {
                      onRetry: () => {
                        void branchResend(lastUserMessage.id, lastUserMessage.text);
                      },
                    }
                  : {})}
                permissionMode={effectiveRunMode}
                onOpenPermissions={() => openSettingsSection('permissions')}
                locale={desktopLocale}
                appearanceMode={activeTheme.mode === 'light' ? 'light' : 'dark'}
                sessionsExpanded={navDrawerOpen}
                onToggleSessions={() => {
                  shell.toggleSessions();
                }}
                canGoBack={shell.canGoBack}
                canGoForward={shell.canGoForward}
                onGoBack={() => {
                  shell.goBack();
                }}
                onGoForward={() => {
                  shell.goForward();
                }}
                onOpenSkills={() => openSettingsSection('skills')}
                onOpenMcp={() => openSettingsSection('tools')}
                onToggleAppearance={handleToggleAppearance}
                onOpenSettings={() => openSettingsSection('general')}
                workPanelOpen={rightPanelOpen}
                onToggleWorkPanel={() => shell.toggleInspector(rightPanelTab)}
                {...(activeSessionOrigin ? { origin: activeSessionOrigin } : {})}
                {...(activeSessionOrigin?.kind === 'fork'
                  ? {
                      onReturnToRoot: () =>
                        void handleResumeSession(activeSessionOrigin.rootSessionId),
                    }
                  : {})}
              />
            }
            chatColumnClassName={
              [
                composerLayoutMode === 'centered' ? 'chat-column-empty' : '',
                activeTheme.visualStyle === 'ink-wash' ? 'theme-visual-ink-wash' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            knowledgePanel={
              knowledgeOpen ? (
                <section
                  className="knowledge-stage"
                  data-testid="knowledge-stage"
                  aria-label={desktopCopy.knowledgeCenter}
                >
                  <DeferredSurfaceBoundary
                    label={desktopLocale === 'zh-CN' ? '正在加载知识中心' : 'Loading knowledge'}
                  >
                    <DeferredKnowledgeCenterPanel
                      projectPath={state.projectPath}
                      recentProjects={recentProjects}
                      request={requestKnowledgeCenter}
                      onClose={() => setKnowledgeOpen(false)}
                      onOpenSession={(sessionId) => void handleResumeSession(sessionId)}
                      onOpenCardsPanel={handleOpenCardsPanel}
                      onConfigureEmbedding={() => openSettingsSection('knowledge')}
                      onSendToChat={(text) => {
                        setKnowledgeOpen(false);
                        setComposer((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
                        window.setTimeout(() => {
                          const el = document.querySelector<HTMLTextAreaElement>(
                            '[data-testid="composer-input"]',
                          );
                          el?.focus();
                        }, 50);
                      }}
                    />
                  </DeferredSurfaceBoundary>
                </section>
              ) : undefined
            }
            transcript={
              <WorkbenchTranscript
                locale={desktopLocale}
                hostClient={hostClient}
                state={state}
                dispatch={dispatch}
                visibleMessages={visibleTranscriptMessages}
                visibleRunRecordsById={visibleRunRecordsById}
                historyViewActive={historyViewActive}
                activitySignal={activitySignal}
                transcriptHistoryLoading={transcriptHistoryLoading}
                lastUserMessageId={lastUserMessageId}
                composerCard={composerCard}
                config={config}
                preferences={preferences}
                sessionPlan={sessionPlan}
                currentPromptModel={currentPromptModelRef}
                modelOptions={modelOptions}
                requestKnowledgeCenter={requestKnowledgeCenter}
                resolveFlashcards={resolveConversationFlashcards}
                requestGit={requestGit}
                editingMessageId={editingMessageId}
                activeTheme={activeTheme}
                artifactThemeKey={artifactThemeKey}
                assemblySummariesByRunId={assemblySummariesByRunId}
                sessionLineage={sessionLineage}
                forkCountsByMessageId={forkCountsByMessageId}
                branchPoints={branchPoints}
                onJumpToHistoryAnchor={handleJumpToHistoryAnchor}
                onReturnToLatest={handleReturnToLiveTranscript}
                onLoadOlder={handleLoadOlderTranscript}
                onOpenReview={() => openRightTab('review')}
                onPermission={handlePermission}
                onInspectSubagent={handleInspectSubagent}
                onEdit={setEditingMessageId}
                onCancelEdit={handleCancelMessageEdit}
                onEditResend={handleEditAndResendMessage}
                onRetry={handleRetryMessage}
                onBranchResend={branchResend}
                onSwitchBranch={switchBranch}
                onInterventionEdit={handleInterventionEdit}
                onInterventionCancel={handleInterventionCancel}
                onFeedback={handleMessageFeedback}
                onArtifactAction={handleArtifactAction}
                onOpenArtifactCanvas={handleOpenArtifactCanvas}
                onOpenDocument={handleOpenDocument}
                onOpenDiff={handleOpenDiff}
                onPlanExecute={handlePlanExecute}
                onPlanAbort={handlePlanAbort}
                onGenerateWalkthrough={handleGenerateWalkthrough}
                onCancelWalkthrough={handleCancelWalkthrough}
                onDuplicateSession={handleDuplicateSession}
                onForkFromMessage={handleForkSession}
                onOpenSession={handleResumeSession}
                onCompactAbort={handleCompactAbort}
              />
            }
            permissionBar={
              <WorkbenchPermissionBar
                state={state}
                extensionUiRequest={extensionUiRequest}
                onPermission={handlePermission}
                onExtensionUiResolve={handleExtensionUiResolve}
              />
            }
            composerDock={
              <WorkbenchComposerColumn
                state={state}
                activeTheme={activeTheme}
                activeSessionName={activeSessionName}
                composerCard={composerCard}
                onTrustProject={handleTrustProject}
                onUnarchiveSession={(sessionId) =>
                  void handleSessionMenuAction(sessionId, 'unarchive')
                }
                onNewSession={handleStartNewSession}
              />
            }
            statusBar={
              <StatusBar
                modelLabel={selectedModelLabel}
                agentState={state.streaming ? 'running' : state.error ? 'error' : 'idle'}
                terminalAttention={terminalAttention}
                isConversationSession={state.activeScope.kind === 'general'}
                {...(state.activeScope.kind === 'general'
                  ? {}
                  : {
                      skillsCount: menuSkills.filter((s) => s.enabled).length,
                      mcpCount: menuMcp.filter((m) => m.running).length,
                    })}
                {...(typeof contextUsagePercent === 'number'
                  ? { contextPercent: contextUsagePercent }
                  : {})}
                {...(state.contextUsage
                  ? { contextUsage: state.contextUsage }
                  : {})}
                {...(typeof selectedModelContextWindow === 'number'
                  ? { modelContextWindow: selectedModelContextWindow }
                  : {})}
                onOpenSkills={() => openSettingsSection('skills')}
                onOpenMcp={() => openSettingsSection('tools')}
                locale={desktopLocale}
              />
            }
            rightPanel={
              <WorkbenchInspector
                showOverlayScrim={showOverlayScrim}
                shell={shell}
                rightPanelOpen={rightPanelOpen}
                rightPanelTab={rightPanelTab}
                rightPanelResize={rightPanelResize}
                isOverlayPresentation={isOverlayPresentation}
                runningJobCount={jobs.length}
                terminalAttention={terminalAttention}
                onTerminalAttentionClear={() => setTerminalAttention(false)}
                onViewChange={setRightPanelView}
                locale={desktopLocale}
                activeTheme={activeTheme}
                onToggleAppearance={handleToggleAppearance}
                openSettingsSection={openSettingsSection}
                hostClient={hostClient}
                requestNotesPanel={requestNotesPanel}
                requestCardsPanel={requestCardsPanel}
                requestFileTree={requestFileTree}
                requestGit={requestGit}
                requestPty={requestPty}
                projectPath={state.projectPath}
                projectTrusted={state.projectTrusted}
                activeSessionId={state.activeSessionId}
                walkthroughsByMessageId={state.walkthroughsByMessageId}
                addContextRef={addContextRef}
                dispatchNotification={dispatchNotification}
                handleSend={handleSend}
                setComposer={setComposer}
                artifactTarget={artifactCanvas.activeTarget}
                artifactThemeKey={artifactThemeKey}
                {...(config?.artifact?.maxBytes !== undefined
                  ? { artifactMaxBytes: config.artifact.maxBytes }
                  : {})}
                addWebElement={addWebElement}
                inspectorDiff={inspectorFileDiff.diff}
                activeMedia={activeMedia}
                activeDocument={activeDocument}
                sessionDocuments={sessionDocuments}
                handleOpenDocument={handleOpenDocument}
                handleCommentLine={handleCommentLine}
                activeComments={activeComments}
                handleAddDocComment={handleAddDocComment}
                handleEditDocComment={handleEditDocComment}
                handleDeleteDocComment={handleDeleteDocComment}
                sessionPlan={sessionPlan}
                ptyOutput={ptyOutput}
                setPtyOutput={setPtyOutput}
                terminalCwd={terminalCwd}
                handleTerminalCwdChange={handleTerminalCwdChange}
                terminalRecentDirs={terminalRecentDirs}
              />
            }
          />

          {foregroundReplaceConfirm.dialog}

          <AppDialogs
            projectInput={projectInput}
            onProjectInputChange={setProjectInput}
            projectPickerOpen={projectPickerOpen}
            onProjectPickerOpenChange={setProjectPickerOpen}
            onOpenProject={(path) => {
              const requestedPath = path?.trim() || projectInput.trim();
              if (requestedPath) {
                void handleOpenProject(requestedPath);
              }
            }}
            onBrowseProject={() => void handleBrowseProject()}
            projectPath={state.projectPath}
            trustDialogOpen={state.trustDialogOpen}
            onTrustProject={(trust) => void handleTrustProject(trust)}
            sessionMenu={sessionMenu}
            onCloseSessionMenu={closeSessionMenu}
            sessions={mergeSessionsForLookup(state.sessions, state.generalSessions)}
            showArchivedSessions={showArchivedSessions}
            onSessionMenuAction={(sessionId, action) => {
              routeSessionChromeMenuAction({
                sessionId,
                action,
                sessions: mergeSessionsForLookup(state.sessions, state.generalSessions),
                requestDelete: requestDeleteSession,
                requestContinueInProject,
                handleHostMenuAction: (nextSessionId, nextAction) => {
                  void handleSessionMenuAction(nextSessionId, nextAction);
                },
              });
            }}
            {...(hostClient.supportsCommand('session/export') ? {} : { sessionMenuCanExport: false })}
            {...(hostClient.supportsCommand('session/duplicate')
              ? {}
              : { sessionMenuCanDuplicate: false })}
            {...(hostClient.supportsCommand('session/duplicate')
              ? {}
              : { sessionMenuCanContinueInProject: false })}
            renameDraft={renameDraft}
            onRenameDraftChange={setRenameDraft}
            onRenameSession={(sessionId, name) => {
              void handleRenameSession(sessionId, name);
            }}
            permissionPrompt={state.permissionPrompt}
            onPermission={(decision, scope) => {
              void handlePermission(decision, scope);
            }}
            deleteConfirm={deleteConfirm}
            deleteBusy={deleteBusy}
            onDeleteOpenChange={(open) => {
              if (!open) {
                closeDeleteConfirm();
              }
            }}
            onConfirmDelete={() => {
              runDeleteConfirm(confirmDeleteSession);
            }}
            continueInProject={continueInProject}
            continueInProjectBusy={continueInProjectBusy}
            trustedProjects={recentProjects.filter((project) => project.trust === 'trusted')}
            locale={desktopLocale}
            onContinueInProjectOpenChange={(open) => {
              if (!open) {
                closeContinueInProject();
              }
            }}
            onContinueInProject={(projectPath) => {
              runContinueInProject(projectPath, handleContinueSessionInProject);
            }}
            onCancelContinueInProject={closeContinueInProject}
          />

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={shell.setCommandPaletteOpen}
            hasProject={Boolean(state.projectPath)}
            projectTrusted={state.projectTrusted}
            hasActiveSession={Boolean(state.activeSessionId)}
            onRun={runDesktopCommand}
          />

          {coldRestorePrompt ? (
            <SessionColdRestoreDialog
              sessionId={coldRestorePrompt.sessionId}
              storage={coldRestorePrompt.storage}
              onCancel={clearColdRestorePrompt}
              onRestore={(packPath) => {
                void confirmColdRestore(packPath);
              }}
            />
          ) : null}

          <TruncateAfterDialog
            open={pendingTruncate !== null}
            locale={desktopLocale}
            onCancel={cancelTruncateAfter}
            onConfirm={() => {
              void confirmTruncateAfter();
            }}
          />

          <BranchSwitchConfirmDialog
            open={pendingSwitchConfirm !== null}
            locale={desktopLocale}
            offPathWrites={pendingSwitchConfirm?.offPathWrites ?? null}
            onCancel={cancelSwitchBranch}
            onConfirm={confirmSwitchBranch}
          />

        </div>
        {settingsOpen ? (
          <DeferredSurfaceBoundary
            label={desktopLocale === 'zh-CN' ? '正在加载设置' : 'Loading settings'}
          >
            <DeferredSettingsPanel
              hostStatus={hostStatus}
              hostClient={hostClient}
              request={requestConfig}
              preferences={preferences}
              activeTheme={activeTheme}
              onPreferencesChange={handleSettingsPreferencesChange}
              initialSection={settingsSection}
              onSectionChange={shell.setSettingsSection}
              projectPath={state.projectPath}
              projectTrusted={state.projectTrusted}
              requestSkills={requestSkills}
              requestMcp={requestMcp}
              requestExtensions={requestExtensions}
              requestPlugins={requestPlugins}
              requestPrompts={requestPrompts}
              requestPet={requestPet}
              requestAutomation={requestAutomation}
              requestSubAgent={requestSubAgent as never}
              subagentChildren={state.subagentChildren}
              subagentBatches={state.subagentBatches}
              activeSessionId={state.activeSessionId}
              onOpenSubagentSession={handleSettingsOpenSubagentSession}
              onThemeApplied={onThemeApplied}
              onPetActiveChanged={setActivePet}
              onClose={shell.closeSettings}
              onSaved={handleSettingsSaved}
              {...(config ? { seedConfig: config } : {})}
            />
          </DeferredSurfaceBoundary>
        ) : null}
      </SubagentInspectorProvider>
      </DesktopContextMenuProvider>
      </MediaPreviewReadProvider>
    </DesktopLocaleProvider>
  );
}

/**
 * Boot gate: choose sidecar vs attach before any host_start. Attach without a
 * saved target stays on the connect wall (zero local Host processes).
 */
export function App(props: AppProps) {
  const [locale, setLocale] = useState<DesktopLocale>(() => loadDesktopLocale());
  const [, setGateEpoch] = useState(0);

  useEffect(() => {
    const refresh = (): void => {
      setGateEpoch((current) => current + 1);
    };
    const unsubscribeTarget = subscribeDesktopRemoteHostTargetChange(refresh);
    const unsubscribeLaunch = subscribeDesktopHostLaunchModeChange(refresh);
    return () => {
      unsubscribeTarget();
      unsubscribeLaunch();
    };
  }, []);

  const resolution = resolveDesktopHostResolution();

  if (resolution.kind === 'undecided') {
    return (
      <DesktopLocaleProvider
        locale={locale}
        onLocaleChange={(next) => {
          saveDesktopLocale(next);
          setLocale(next);
        }}
      >
        <HostLaunchChooser
          onChooseSidecar={() => {
            saveDesktopHostLaunchMode('sidecar');
          }}
          onChooseAttach={() => {
            saveDesktopHostLaunchMode('attach');
          }}
        />
      </DesktopLocaleProvider>
    );
  }

  if (resolution.kind === 'attach-wall') {
    return (
      <DesktopLocaleProvider
        locale={locale}
        onLocaleChange={(next) => {
          saveDesktopLocale(next);
          setLocale(next);
        }}
      >
        <HostConnectWall
          allowLocal={!isDesktopShellOnlyBuild()}
          onConnected={(target) => {
            saveDesktopHostLaunchMode('attach');
            saveDesktopRemoteHostTarget(target);
          }}
          {...(isDesktopShellOnlyBuild()
            ? {}
            : {
                onUseLocal: () => {
                  clearDesktopRemoteHostTarget();
                  saveDesktopHostLaunchMode('sidecar');
                },
              })}
        />
      </DesktopLocaleProvider>
    );
  }

  return <AppWorkbench key={resolution.kind} {...props} />;
}
