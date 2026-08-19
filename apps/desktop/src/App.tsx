import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type SetStateAction,
} from 'react';
import {
  formatError,
  isJobActive,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  modeToPreset,
  readContextOccupiedTokens,
  resolveModelContextBudget,
  resolvePreset,
} from '@piwin/contracts';
import type {
  ModelRef,
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
import { listOrchestrationSchemes, ORCHESTRATION_SCHEME_OFF_ID } from '@piwin/contracts';
import {
  chatUiReducer,
  createInitialChatUiState,
  type PermissionPromptUi,
  type SessionListItemUi,
} from './chat-reducer';
import { HostClient } from './host-client';
import {
  clearDesktopRemoteHostTarget,
  loadDesktopRemoteHostTarget,
  subscribeDesktopRemoteHostTargetChange,
} from './remote-host-session';
import { useHostRequestAdapters } from './host-request-adapters';
import { NotificationRegion } from './NotificationRegion';
import { MainErrorBanner } from './main-error-banner';
import { ProjectSessionSidebar } from './project-session-sidebar';
import { projectDisplayName } from './project-display-name';
import { ChatThread } from './chat-thread';
import { reviewCardsForItemIds } from './resolve-conversation-flashcards';
import type { FlashcardItem } from '@piwin/contracts';
import { formatPlanMarkdown } from './plan-card';
import { ArtifactCanvasPanel } from './artifact-canvas-panel';
import { appendComposerProposal, type ArtifactCanvasTarget } from './artifact-canvas-model';
import { useArtifactCanvas } from './hooks/use-artifact-canvas';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import { PermissionBar } from './permission-bar';
import { ExtensionUiPrompt } from './extension-ui-prompt';
import { AppDialogs } from './app-dialogs';
import { createEmptyNotificationState, notificationReducer } from './notification-queue';
import type { HostLogEntry } from './HostLogPanel';
import {
  activeDocumentContent,
  activeDocumentFilePath,
  activeDocumentMedia,
} from './active-document';
import { useActiveDocument } from './hooks/use-active-document';
import { useTerminalPanelState } from './hooks/use-terminal-panel-state';
import { useSessionListQuery } from './hooks/use-session-list-query';
import {
  resolveSessionDisplayName,
  routeSessionChromeMenuAction,
  useSessionListChrome,
} from './hooks/use-session-list-chrome';
import { collectSessionDocuments } from './session-documents';
import type { LineCommentItem } from './EnhancedMarkdownView';
import { mergeComposerWithDocComments } from './doc-comments';
import { RightPanel, type RightPanelTab } from './right-panel'; // right-panel portal v3
import { collectSessionTools } from './tool-call-card';
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
import type { ComposerPlusSubmenu } from './composer-plus-menu';
import { useHostBootstrap } from './hooks/use-host-bootstrap';
import { useRunReconcile } from './hooks/use-run-reconcile';
import { useComposerMedia } from './hooks/use-composer-media';
import { useComposerContextRefs } from './hooks/use-composer-context-refs';
import { DesktopContextMenuProvider, type DesktopContextMenuValue } from './context-menu';
import { useSessionActions } from './hooks/use-session-actions';
import { useSessionLineage } from './hooks/use-session-lineage';
import { getDirectForkCountsByMessageId } from './session-lineage-tree';
import { SessionLineageHeaderPopover } from './session-lineage-popover';
import { useSubagentSessionInspector } from './hooks/use-subagent-session-inspector';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import { useJobs } from './hooks/use-jobs';
import { Button, Dialog, Notice } from '@piwin/ui-kit';
import type { ForegroundRunMismatchProblem } from '@piwin/contracts';
import { useConfirmDialog } from './use-confirm-dialog';
import { isRemoteDesktopTransport } from './remote-session-hydrate';
import { useShellLayout, type ShellSettingsSection } from './hooks/use-shell-layout';
import { CommandPalette } from './command-palette';
import { useDesktopShortcuts } from './use-desktop-shortcuts';
import type { DesktopCommandId } from './desktop-commands';
import { deriveRunStatus } from './run-status';
import { ContextBar } from './context-bar';
import { WorkspaceShell } from './workspace-shell';
import { InkWashEmptyVignette } from './ink-wash-empty-vignette';
import { TranscriptViewport } from './transcript-viewport';
import { ProjectTrustNotice } from './project-trust-notice';
import { SessionArchivedBanner } from './session-archived-banner';
import { StatusBar } from './status-bar';
import { computeContextUsagePercent } from './context-usage-ring';

import { useRightPanelResize } from './hooks/use-right-panel-resize';
import { useSidebarResize } from './hooks/use-sidebar-resize';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';
import { SIDEBAR_DEFAULT_WIDTH_PX } from './sidebar-width';
import { resolveThinkingLevelForModel } from './model-thinking-policy';
import { buildEnabledModelOptions } from './model-options';

import {
  DeferredBrowserSessionPanel,
  DeferredChangesPanel,
  DeferredDocPreviewPanel,
  DeferredFileTreePanel,
  DeferredFlashcardsPanel,
  DeferredGitPanel,
  DeferredKnowledgeCenterPanel,
  DeferredMediaDocPreview,
  DeferredNotesPanel,
  DeferredReviewPanel,
  DeferredSettingsPanel,
  DeferredSideChatPanel,
  DeferredSubagentSessionDialog,
  DeferredSurfaceBoundary,
  DeferredTerminalDock,
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

function createAppHostClient(): HostClient {
  const remoteTarget = loadDesktopRemoteHostTarget();
  if (remoteTarget !== undefined) {
    return new HostClient({
      transport: 'remote',
      remoteTarget,
      hostMock: false,
    });
  }
  return new HostClient({ transport: 'auto', hostMock: false });
}

export function App({ activeTheme, onThemeApplied }: AppProps) {
  const [hostClient, setHostClient] = useState(createAppHostClient);
  const hostClientRef = useRef(hostClient);
  hostClientRef.current = hostClient;

  useEffect(() => {
    return subscribeDesktopRemoteHostTargetChange(() => {
      const previous = hostClientRef.current;
      const next = createAppHostClient();
      hostClientRef.current = next;
      setHostClient(next);
      void previous.dispose();
    });
  }, []);
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
  const artifactCanvas = useArtifactCanvas(state.activeSessionId);
  const sessionLineage = useSessionLineage(hostClient, state.activeSessionId);
  const forkCountsByMessageId = useMemo(
    () => getDirectForkCountsByMessageId(sessionLineage),
    [sessionLineage],
  );
  const [notificationState, dispatchNotification] = useReducer(
    notificationReducer,
    undefined,
    createEmptyNotificationState,
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

  const [pendingRevertEdit, setPendingRevertEdit] = useState<{
    messageId: string;
    text: string;
    isEdit?: boolean;
  } | null>(null);
  const [dontAskAgainChecked, setDontAskAgainChecked] = useState(false);
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
  const confirmForegroundReplace = useCallback(
    async (_problem: ForegroundRunMismatchProblem): Promise<boolean> => {
      const copy = getDesktopCopy(desktopLocale).composer;
      return foregroundReplaceConfirm.confirm({
        title: copy.foregroundReplaceTitle,
        description: copy.foregroundReplaceDescription,
        confirmLabel: copy.foregroundReplaceConfirm,
        cancelLabel: copy.foregroundReplaceCancel,
        tone: 'danger',
      });
    },
    [desktopLocale, foregroundReplaceConfirm],
  );
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusSubmenu, setPlusSubmenu] = useState<ComposerPlusSubmenu>('none');
  const [menuSkills, setMenuSkills] = useState<
    Array<{ id: string; name: string; enabled: boolean }>
  >([]);
  const [menuMcp, setMenuMcp] = useState<Array<{ id: string; name: string; running: boolean }>>([]);
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const modelSwitchInFlightRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(state.activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = state.activeSessionId;
  }, [state.activeSessionId]);
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
  const configSaveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    hasHydratedInitialGeneralSessions.current = false;
    hasRestoredDesktopSession.current = false;
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
      const data = response.data as { projects?: ProjectRecord[] };
      setRecentProjects((prev) => {
        const fetched = data.projects ?? [];
        if (prev.length === 0) {
          return fetched;
        }
        // Preserve stable order of existing projects in sidebar so clicking a project doesn't jump it to top
        const prevMap = new Map(prev.map((p) => [p.path, p]));
        const newProjects = fetched.filter((p) => !prevMap.has(p.path));
        const updatedExisting = prev
          .map((p) => fetched.find((f) => f.path === p.path) ?? p)
          .filter((p) => fetched.some((f) => f.path === p.path));
        return [...newProjects, ...updatedExisting];
      });
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
    refreshWhenVisible: rightPanelOpen && shell.inspectorTab === 'terminal',
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

  const { activeDocument, openDocument: handleOpenDocument } = useActiveDocument({
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
    runLive: state.runPhase === 'streaming' || state.runPhase === 'aborting',
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
      ...schemes.map((scheme) => ({
        id: scheme.id,
        name: scheme.name,
        description: scheme.description,
        source: scheme.source,
      })),
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

  const modelOptions = useMemo(() => buildEnabledModelOptions(config?.providers ?? []), [config]);

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
              console.warn(`[piwin] flashcard rate failed: ${response.error}`);
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
              console.warn(`[piwin] flashcard open-source failed: ${response.error}`);
              return;
            }
            const result = response.data as { path?: string } | undefined;
            if (result?.path) {
              // Open via Tauri shell opener (OS default editor).
              void import('@tauri-apps/plugin-shell')
                .then(({ open }) => open(result.path as string))
                .catch((error: unknown) => {
                  console.warn(`[piwin] open-source shell open failed: ${formatError(error)}`);
                });
            }
          });
      }
    },
    [hostClient],
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
            console.warn(`[piwin] walkthrough generate failed: ${response.error}`);
          }
        });
    },
    [hostClient, state.activeSessionId],
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
            console.warn(`[piwin] walkthrough cancel failed: ${response.error}`);
          }
        });
    },
    [hostClient, state.activeSessionId],
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
      hostClient.request(command),
    [hostClient],
  );
  const requestCardsPanel = useCallback(
    (command: Parameters<import('./FlashcardsPanel').FlashcardsPanelProps['request']>[0]) =>
      hostClient.request(command),
    [hostClient],
  );
  const resolveConversationFlashcards = useCallback(
    async (itemIds: string[]) => {
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
    handleLoadOlderTranscript,
    handleRenameSession,
    handleDuplicateSession,
    handleContinueSessionInProject,
    handleForkSession,
    handleSessionMenuAction,
    confirmDeleteSession,
    handleEditAndResend,
    handleRetryFromMessage,
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
    agentMode,
    orchestrationSchemeId,
    delegationDisabled,
    setEditingMessageId,
    setRenameDraft,
    setHostLogEntries,
    // Composer setter is owned by useComposerMedia (declared later). Bridge via ref.
    setComposer: (value) => {
      composerSetterRef.current(value);
    },
    onSessionComposerProfileRestored: (profile) => {
      sessionComposerProfileRestoredRef.current(profile);
    },
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
        setSelectedModelKey(`${next.defaultProviderId}::${next.defaultModelId}`);
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

  // Hydrate every recent project's session list so the sidebar folder tree can
  // show each open folder's conversations without forcing the user to click
  // into it. The reducer keeps these per-project lists independent from the
  // active scope, so multiple folders can stay open with their own sessions.
  useEffect(() => {
    if (recentProjects.length === 0 || !state.hostReady) return;
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

  /** Only re-apply session model when the active session id changes. */
  const lastAppliedSessionModelIdRef = useRef<string | null>(null);

  const applyComposerModelSelection = useCallback(
    (
      modelKey: string,
      requestedThinking: import('@piwin/contracts').ThinkingLevel | undefined,
    ): void => {
      const selected = modelOptions.find(
        (model) => `${model.providerId}::${model.modelId}` === modelKey,
      );
      const resolvedKey = selected ? `${selected.providerId}::${selected.modelId}` : modelKey;
      setSelectedModelKey(resolvedKey);
      const resolvedThinking = resolveThinkingLevelForModel(
        selected,
        requestedThinking ?? selected?.thinkingLevel ?? 'off',
        config?.thinking?.ultraEnabled === true,
      );
      setThinkingLevel(resolvedThinking ?? 'off');
    },
    [config?.thinking?.ultraEnabled, modelOptions],
  );

  // Resolve the effective model selection. Priority:
  //   1. active session last-used model (session index / resume)
  //   2. composerProfile.model (desktop default for new sessions)
  //   3. config.defaultProviderId / defaultModelId (product default)
  // When none resolve to a live model option, clear the selection so the
  // composer falls back to host defaults instead of holding a stale key.
  useEffect(() => {
    const activeSessionId = state.activeSessionId;
    const sessionChanged = lastAppliedSessionModelIdRef.current !== activeSessionId;
    const activeSession =
      activeSessionId == null
        ? undefined
        : (state.sessions.find((session) => session.id === activeSessionId) ??
          state.generalSessions.find((session) => session.id === activeSessionId));
    // Prefer the session's last-used model only when switching into the
    // session (or first apply). Do not re-stomp the picker while the user
    // is mid-edit on the same session before the next prompt persists.
    if (sessionChanged && activeSession?.model) {
      const sessionModel = modelOptions.find(
        (model) =>
          model.providerId === activeSession.model?.providerId &&
          model.modelId === activeSession.model?.modelId &&
          model.protocol === activeSession.model?.protocol,
      );
      if (sessionModel) {
        lastAppliedSessionModelIdRef.current = activeSessionId;
        applyComposerModelSelection(
          `${sessionModel.providerId}::${sessionModel.modelId}`,
          activeSession.thinkingLevel,
        );
        return;
      }
    }
    if (!sessionChanged && activeSessionId) {
      // Stay on the user/session selection; only re-resolve defaults when
      // providers/catalog change and the current key disappeared.
      const stillValid = modelOptions.some(
        (model) => `${model.providerId}::${model.modelId}` === selectedModelKey,
      );
      if (stillValid || !selectedModelKey) {
        return;
      }
    }

    const composerProfile = config?.desktop?.composerProfile;
    const desired = composerProfile?.model
      ? modelOptions.find(
          (model) =>
            model.providerId === composerProfile.model?.providerId &&
            model.modelId === composerProfile.model?.modelId &&
            model.protocol === composerProfile.model?.protocol,
        )
      : undefined;
    const fallback =
      config?.defaultProviderId && config?.defaultModelId
        ? modelOptions.find(
            (model) =>
              model.providerId === config.defaultProviderId &&
              model.modelId === config.defaultModelId,
          )
        : undefined;
    const resolved = desired ?? fallback;
    const resolvedKey = resolved ? `${resolved.providerId}::${resolved.modelId}` : '';
    lastAppliedSessionModelIdRef.current = activeSessionId;
    applyComposerModelSelection(
      resolvedKey,
      composerProfile?.thinkingLevel ?? resolved?.thinkingLevel ?? 'off',
    );
  }, [
    applyComposerModelSelection,
    config?.desktop?.composerProfile,
    config?.defaultProviderId,
    config?.defaultModelId,
    modelOptions,
    selectedModelKey,
    state.activeSessionId,
    state.generalSessions,
    state.sessions,
  ]);

  // Resume payload may carry model before the session list row is updated.
  useEffect(() => {
    sessionComposerProfileRestoredRef.current = (profile) => {
      if (profile.model) {
        const match = modelOptions.find(
          (model) =>
            model.providerId === profile.model?.providerId &&
            model.modelId === profile.model?.modelId &&
            model.protocol === profile.model?.protocol,
        );
        if (match) {
          lastAppliedSessionModelIdRef.current = state.activeSessionId;
          applyComposerModelSelection(
            `${match.providerId}::${match.modelId}`,
            profile.thinkingLevel,
          );
          return;
        }
      }
      if (profile.thinkingLevel) {
        const selected = modelOptions.find(
          (model) => `${model.providerId}::${model.modelId}` === selectedModelKey,
        );
        const resolvedThinking = resolveThinkingLevelForModel(
          selected,
          profile.thinkingLevel,
          config?.thinking?.ultraEnabled === true,
        );
        setThinkingLevel(resolvedThinking ?? profile.thinkingLevel);
      }
    };
  }, [
    applyComposerModelSelection,
    config?.thinking?.ultraEnabled,
    modelOptions,
    selectedModelKey,
    state.activeSessionId,
  ]);

  const saveSettingsInOrder = useCallback(
    (buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[]): Promise<void> => {
      const saveOperation = configSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const currentResponse = await hostClient.request({ type: 'settings/get' });
          if (!currentResponse.success) {
            dispatch({ type: 'error', message: `Settings read failed: ${currentResponse.error}` });
            return;
          }
          const data = currentResponse.data as {
            snapshot?: { config: PiwinConfig; revision: string };
          };
          if (!data.snapshot) {
            dispatch({ type: 'error', message: 'Settings read returned no snapshot' });
            return;
          }
          const applyResponse = await hostClient.request({
            type: 'settings/apply',
            input: {
              expectedRevision: data.snapshot.revision,
              mutations: buildMutations(data.snapshot.config),
            },
          });
          if (!applyResponse.success) {
            dispatch({ type: 'error', message: `Settings save failed: ${applyResponse.error}` });
          }
        })
        .catch((error: unknown) => {
          dispatch({ type: 'error', message: `Settings save failed: ${formatError(error)}` });
        });
      configSaveQueue.current = saveOperation;
      return saveOperation;
    },
    [dispatch, hostClient],
  );

  const handleRemoveProjectFromSidebar = useCallback(
    async (projectPath: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'project/remove',
        path: projectPath,
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
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

  const persistComposerProfile = useCallback(
    (nextModelKey: string, nextThinkingLevel: import('@piwin/contracts').ThinkingLevel): void => {
      if (!config) {
        return;
      }
      const selectedModel = modelOptions.find(
        (model) => `${model.providerId}::${model.modelId}` === nextModelKey,
      );
      const nextConfig: PiwinConfig = {
        ...config,
        desktop: {
          ...config.desktop,
          composerProfile: {
            ...(selectedModel
              ? {
                  model: {
                    protocol: selectedModel.protocol,
                    providerId: selectedModel.providerId,
                    modelId: selectedModel.modelId,
                  },
                }
              : {}),
            thinkingLevel: nextThinkingLevel,
          },
        },
      };
      setConfig(nextConfig);
      void saveSettingsInOrder((currentConfig) => [
        {
          kind: 'replace-domain',
          domain: 'desktop',
          value: {
            ...currentConfig.desktop,
            composerProfile: nextConfig.desktop?.composerProfile,
          } as NonNullable<PiwinConfig['desktop']>,
        },
      ]);
    },
    [config, modelOptions, saveSettingsInOrder, setConfig],
  );

  const handleSelectModel = useCallback(
    async (nextModelKey: string): Promise<void> => {
      const nextModel = modelOptions.find(
        (model) => `${model.providerId}::${model.modelId}` === nextModelKey,
      );
      if (!nextModel || nextModelKey === selectedModelKey || modelSwitchInFlightRef.current) {
        return;
      }
      const occupiedTokens = readContextOccupiedTokens(state.contextUsage);
      const targetBudget = resolveModelContextBudget({
        ...(nextModel.contextWindow !== undefined
          ? { contextWindow: nextModel.contextWindow }
          : {}),
        ...(nextModel.maxOutputTokens !== undefined
          ? { maxOutputTokens: nextModel.maxOutputTokens }
          : {}),
      });
      if (
        state.activeSessionId &&
        occupiedTokens !== undefined &&
        occupiedTokens > targetBudget.inputBudget
      ) {
        if (state.streaming || state.compacting) {
          dispatch({
            type: 'error',
            message: 'Wait for the current operation to finish before switching models.',
          });
          return;
        }
        modelSwitchInFlightRef.current = true;
        const preparedSessionId = state.activeSessionId;
        try {
          const response = await hostClient.request({
            type: 'session/compact',
            sessionId: preparedSessionId,
            targetModel: {
              protocol: nextModel.protocol,
              providerId: nextModel.providerId,
              modelId: nextModel.modelId,
            },
          });
          if (!response.success) {
            dispatch({ type: 'error', message: response.error });
            return;
          }
          if (activeSessionIdRef.current !== preparedSessionId) {
            return;
          }
        } catch (error) {
          dispatch({ type: 'error', message: formatError(error) });
          return;
        } finally {
          modelSwitchInFlightRef.current = false;
        }
      }
      const nextThinkingLevel =
        resolveThinkingLevelForModel(
          nextModel,
          thinkingLevel,
          config?.thinking?.ultraEnabled === true,
        ) ?? 'off';
      setSelectedModelKey(nextModelKey);
      setThinkingLevel(nextThinkingLevel);
      persistComposerProfile(nextModelKey, nextThinkingLevel);
    },
    [
      config?.thinking?.ultraEnabled,
      dispatch,
      hostClient,
      modelOptions,
      persistComposerProfile,
      selectedModelKey,
      state.activeSessionId,
      state.compacting,
      state.contextUsage,
      state.streaming,
      thinkingLevel,
    ],
  );

  const handleThinkingLevelChange = useCallback(
    (nextThinkingLevel: import('@piwin/contracts').ThinkingLevel): void => {
      setThinkingLevel(nextThinkingLevel);
      persistComposerProfile(selectedModelKey, nextThinkingLevel);
    },
    [persistComposerProfile, selectedModelKey],
  );

  // ADR 0024: Run Mode preset. Session-level override (in memory); "Set as
  // default" persists to config.permissions.preset. Derived from config when
  // no session override is set.
  const [runModeOverride, setRunModeOverride] = useState<PermissionPreset | null>(null);
  const configPreset: PermissionPreset =
    config?.permissions?.preset ??
    (config?.permissions?.mode ? modeToPreset(config.permissions.mode) : 'auto');
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
  const handleRetryMessage = useCallback(
    (messageId: string): void => {
      const visibleMessages = state.historyView?.messages ?? state.messages;
      const msg = visibleMessages.find((message) => message.id === messageId);
      if (!msg) return;
      if (preferences.dontAskRevertConfirm) {
        void handleRetryFromMessage(messageId);
        return;
      }
      setPendingRevertEdit({ messageId, text: msg.text, isEdit: false });
    },
    [
      handleRetryFromMessage,
      preferences.dontAskRevertConfirm,
      state.historyView,
      state.messages,
    ],
  );

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
        sideChatAvailable: Boolean(state.activeSessionId && state.hostReady),
        applyAvailable: true,
        openChangedFilesAvailable: Boolean(state.projectPath),
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

  const [docComments, setDocComments] = useState<Record<string, LineCommentItem[]>>({});

  const activeDocKey = activeDocument?.filePath || activeDocument?.title || 'default';
  const activeComments = docComments[activeDocKey] || [];

  const handleAddDocComment = useCallback(
    (comment: { lineId: string; lineText: string; commentText: string }) => {
      const newCommentItem: LineCommentItem = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lineId: comment.lineId,
        lineText: comment.lineText,
        commentText: comment.commentText,
      };

      setDocComments((prev) => ({
        ...prev,
        [activeDocKey]: [...(prev[activeDocKey] || []), newCommentItem],
      }));

      // Automatically focus composer after creating a comment
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="composer-input"]',
        );
        if (textarea) {
          textarea.focus();
        }
      }, 50);
    },
    [activeDocKey],
  );

  const handleEditDocComment = useCallback(
    (id: string, newText: string) => {
      setDocComments((prev) => ({
        ...prev,
        [activeDocKey]: (prev[activeDocKey] || []).map((c) =>
          c.id === id ? { ...c, commentText: newText } : c,
        ),
      }));
    },
    [activeDocKey],
  );

  const handleDeleteDocComment = useCallback(
    (id: string) => {
      setDocComments((prev) => ({
        ...prev,
        [activeDocKey]: (prev[activeDocKey] || []).filter((c) => c.id !== id),
      }));
    },
    [activeDocKey],
  );

  const handleSendWithComments = useCallback(async () => {
    const docTitle = activeDocument?.title || 'Document';
    const comments = activeComments;
    const text =
      comments.length > 0 ? mergeComposerWithDocComments(composer, docTitle, comments) : composer;
    if (comments.length > 0) {
      setDocComments((prev) => ({ ...prev, [activeDocKey]: [] }));
    }
    await handleSend(text);
  }, [activeDocument?.title, activeComments, composer, activeDocKey, handleSend]);

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

  const refreshComposerMenus = useCallback(async (): Promise<void> => {
    const skillsResponse = await hostClient.request({
      type: 'skills/list',
      ...(state.projectPath ? { projectPath: state.projectPath } : {}),
    } as never);
    if (skillsResponse.success && skillsResponse.data) {
      const data = skillsResponse.data as {
        skills?: Array<{ id: string; name?: string; enabled?: boolean }>;
      };
      setMenuSkills(
        (data.skills ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name ?? skill.id,
          enabled: skill.enabled !== false,
        })),
      );
    }
    const mcpResponse = await hostClient.request({ type: 'mcp/get' } as never);
    if (mcpResponse.success && mcpResponse.data) {
      const data = mcpResponse.data as {
        document?: { mcpServers?: Record<string, { command?: string }> };
      };
      const servers = Object.entries(data.document?.mcpServers ?? {});
      setMenuMcp(
        servers.map(([serverId]) => ({
          id: serverId,
          name: serverId,
          running: false,
        })),
      );
    }
  }, [hostClient, state.projectPath]);

  useEffect(() => {
    if (state.activeSessionId && state.projectTrusted) {
      void refreshComposerMenus();
    }
  }, [state.activeSessionId, state.projectTrusted, state.projectPath]);

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

  const selectedModelLabel = useMemo(() => {
    if (!selectedModelKey) {
      return 'Default model';
    }
    return (
      modelOptions.find((option) => `${option.providerId}::${option.modelId}` === selectedModelKey)
        ?.label ?? 'Default model'
    );
  }, [modelOptions, selectedModelKey]);

  const selectedModelContextWindow = useMemo(() => {
    if (!selectedModelKey) {
      const defaultModel = modelOptions.find(
        (option) =>
          option.providerId === config?.defaultProviderId &&
          option.modelId === config?.defaultModelId,
      );
      return defaultModel?.contextWindow;
    }
    return modelOptions.find(
      (option) => `${option.providerId}::${option.modelId}` === selectedModelKey,
    )?.contextWindow;
  }, [modelOptions, selectedModelKey, config?.defaultProviderId, config?.defaultModelId]);

  const currentPromptModelRef = useMemo<ModelRef | null>(() => {
    const matched = selectedModelKey
      ? modelOptions.find(
          (option) => `${option.providerId}::${option.modelId}` === selectedModelKey,
        )
      : modelOptions.find(
          (option) =>
            option.providerId === config?.defaultProviderId &&
            option.modelId === config?.defaultModelId,
        );
    if (!matched) return null;
    return {
      protocol: matched.protocol,
      providerId: matched.providerId,
      modelId: matched.modelId,
    };
  }, [modelOptions, selectedModelKey, config?.defaultProviderId, config?.defaultModelId]);

  /**
   * Status-bar percent must match ContextUsageRing (shared used/limit math).
   * Undefined until the first usage sample so chrome does not show a fake 0%.
   */
  const contextUsagePercent = useMemo(
    () => computeContextUsagePercent(state.contextUsage, selectedModelContextWindow),
    [state.contextUsage, selectedModelContextWindow],
  );

  // While resuming a session, keep docked layout even if paint is still
  // previous/warm rows or briefly empty — never treat that as a brand-new chat.
  const composerLayoutMode =
    state.messages.length === 0 && !state.awaitingTranscript
      ? ('centered' as const)
      : ('docked' as const);

  const lastUserMessageId = useMemo(() => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role === 'user') {
        return message.id;
      }
    }
    return null;
  }, [state.messages]);

  const activeSessionListItem =
    state.activeSessionMetadata ??
    state.sessions.find((item) => item.id === state.activeSessionId) ??
    null;
  const activeSessionName = activeSessionListItem?.name ?? 'New chat';
  const activeSessionOrigin = activeSessionListItem?.origin ?? null;
  const desktopCopy = getDesktopCopy(desktopLocale);

  // Stable callback identities so composerCard useMemo does not thrash on every App render.
  const handleRemoveDocComments = useCallback((): void => {
    setDocComments((prev) => ({
      ...prev,
      [activeDocKey]: [],
    }));
  }, [activeDocKey]);
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
    clearDesktopRemoteHostTarget();
  }, []);
  const handleOpenPermissionsSettings = useCallback((): void => {
    openSettingsSection('permissions');
  }, [openSettingsSection]);
  const handleOpenOrchestrationSchemeSettings = useCallback((): void => {
    openSettingsSection('subagents');
  }, [openSettingsSection]);
  const handleComposerAttachImage = useCallback((): void => {
    void handlePickImageFiles();
  }, [handlePickImageFiles]);
  const handleComposerAttachFile = useCallback((): void => {
    void handlePickFiles();
  }, [handlePickFiles]);
  const handleComposerPasteEvent = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      void handleComposerPaste(event);
    },
    [handleComposerPaste],
  );
  const handleComposerDropEvent = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      void handleComposerDrop(event);
    },
    [handleComposerDrop],
  );
  const handleComposerSend = useCallback((): void => {
    void handleSendWithComments();
  }, [handleSendWithComments]);
  const handleComposerSteer = useCallback((): void => {
    void handleSteer();
  }, [handleSteer]);
  const handleComposerFollowUp = useCallback((): void => {
    void handleFollowUp();
  }, [handleFollowUp]);
  const handleComposerExtensionUiResolve = useCallback(
    (payload: { confirmed?: boolean; value?: string; cancelled?: boolean }): void => {
      void handleExtensionUiResolve(payload);
    },
    // handleExtensionUiResolve closes over request state; rebind when request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extensionUiRequest],
  );
  const handleComposerExtensionUiAbort = useCallback((): void => {
    void handleExtensionUiAbort();
  }, [extensionUiRequest]);
  const handleComposerAbort = useCallback((): void => {
    void handleAbort();
  }, [handleAbort]);
  const handleComposerCompact = useCallback((): void => {
    void handleCompact();
  }, [handleCompact]);

  const docCommentsAttachment = useMemo(
    () =>
      activeComments.length > 0
        ? {
            docTitle: activeDocument?.title || 'Document',
            commentCount: activeComments.length,
          }
        : null,
    [activeComments.length, activeDocument?.title],
  );

  // Newest-first user prompts for Composer ↑ history list (max 10).
  const sessionUserPrompts = useMemo(() => {
    const prompts: string[] = [];
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role !== 'user') {
        continue;
      }
      const text = message.text.trim();
      if (!text || prompts.includes(text)) {
        continue;
      }
      prompts.push(text);
      if (prompts.length >= 10) {
        break;
      }
    }
    return prompts;
  }, [state.messages]);

  const isGoalExtensionEnabled = useMemo(() => {
    const disabledIds = config?.extensions?.disabledIds ?? [];
    return !disabledIds.some((id) => id.toLowerCase() === 'goal');
  }, [config?.extensions?.disabledIds]);

  useEffect(() => {
    if (agentMode === 'goal' && !isGoalExtensionEnabled) {
      setAgentMode('agent');
    }
  }, [agentMode, isGoalExtensionEnabled]);

  // Shared composer card props for the bottom dock and in-place message editing.
  // Local state fields (composer text, attachments, plus menu, etc.) are overridden
  // by the bottom dock or the edit card; this bundle carries the global config.
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
      activeJobs: activeJobsForComposer,
      onStopJob: (jobId) => {
        void stopJob(jobId);
      },
      onViewJobLogs: () => {
        shell.openInspector('terminal');
      },
      agentMode,
      onAgentModeChange: setAgentMode,
      goalExtensionEnabled: isGoalExtensionEnabled,
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
      onRemoveDocComments: handleRemoveDocComments,
      dropActive,
      onDropActiveChange: setDropActive,
      plusMenuOpen,
      onPlusMenuOpenChange: setPlusMenuOpen,
      plusSubmenu,
      onPlusSubmenuChange: setPlusSubmenu,
      modelOptions,
      selectedModelKey,
      selectedModelLabel,
      onSelectModel: handleSelectModel,
      visionDelegationEnabled: config?.visionDelegation?.enabled === true,
      menuSkills,
      menuMcp,
      onRefreshComposerMenus: handleRefreshComposerMenus,
      onOpenSkillsPanel: handleOpenSkillsPanel,
      onOpenMcpPanel: handleOpenMcpPanel,
      onOpenKnowledge: handleOpenKnowledge,
      onOpenCardsPanel: handleOpenCardsPanel,
      onAttachFile: handleComposerAttachFile,
      onAttachImage: handleComposerAttachImage,
      onPaste: handleComposerPasteEvent,
      onDrop: handleComposerDropEvent,
      onSend: handleComposerSend,
      onSteer: handleComposerSteer,
      onFollowUp: handleComposerFollowUp,
      steerQueueMessages,
      onSteerQueueSendNow: handleSteerQueueSendNow,
      onSteerQueueEdit: handleSteerQueueEdit,
      onSteerQueueRemove: handleSteerQueueRemove,
      extensionUiRequest,
      extensionUiInput,
      onExtensionUiInputChange: setExtensionUiInput,
      onExtensionUiResolve: handleComposerExtensionUiResolve,
      onExtensionUiAbort: handleComposerExtensionUiAbort,
      thinkingLevel,
      onThinkingLevelChange: handleThinkingLevelChange,
      ultraThinkingEnabled: config?.thinking?.ultraEnabled === true,
      onAbort: handleComposerAbort,
      onCompact: handleComposerCompact,
      compactionSupported: hostStatus?.capabilities?.compaction !== false,
      contextUsage: state.contextUsage,
      ...(typeof selectedModelContextWindow === 'number'
        ? { modelContextWindow: selectedModelContextWindow }
        : {}),
      onOpenModelSettings: handleOpenModelSettings,
      speechConfigured,
      speechRequest,
      hostStatus,
      hostReady: state.hostReady,
      hostMock: state.hostMock,
      transportLabel: hostClient.getTransport(),
      onOpenHostSettings: handleOpenHostSettings,
      runModePreset: effectiveRunMode,
      onRunModeChange: handleRunModeChange,
      onRunModeSetDefault: handleRunModeSetDefault,
      onOpenPermissionsSettings: handleOpenPermissionsSettings,
      runModeYoloDisabled: state.projectPath !== null && !state.projectTrusted,
      orchestrationSchemeId,
      orchestrationSchemeOptions,
      delegationDisabled,
      onDelegationDisabledChange: setDelegationDisabled,
      onOrchestrationSchemeChange: setOrchestrationSchemeId,
      onOpenOrchestrationSchemeSettings: handleOpenOrchestrationSchemeSettings,
      isConversationSession: state.activeScope.kind === 'general',
      branchRequest: requestGit as ComposerDockProps['branchRequest'],
      recentProjects,
      onOpenProject: (path) => {
        void handleOpenProject(path);
      },
      runtimeRemoteConnected: hostClient.getTransport() === 'remote',
      onSelectLocalRuntime: handleSelectLocalRuntime,
    }),
    [
      agentMode,
      orchestrationSchemeId,
      delegationDisabled,
      orchestrationSchemeOptions,
      composer,
      composerLayoutMode,
      config?.thinking?.ultraEnabled,
      config?.visionDelegation?.enabled,
      docCommentsAttachment,
      dropActive,
      effectiveRunMode,
      extensionUiInput,
      extensionUiRequest,
      handleComposerAbort,
      handleComposerAttachImage,
      handleComposerAttachFile,
      handleComposerCompact,
      handleComposerDropEvent,
      handleComposerExtensionUiAbort,
      handleComposerExtensionUiResolve,
      handleComposerFollowUp,
      handleComposerPasteEvent,
      handleComposerSend,
      handleComposerSteer,
      handleSteerQueueEdit,
      handleSteerQueueRemove,
      handleSteerQueueSendNow,
      handleOpenHostSettings,
      handleSelectLocalRuntime,
      handleOpenMcpPanel,
      handleOpenModelSettings,
      handleOpenPermissionsSettings,
      handleOpenProject,
      handleOpenSkillsPanel,
      handlePickFiles,
      handleRefreshComposerMenus,
      handleRemoveDocComments,
      handleRunModeChange,
      handleRunModeSetDefault,
      handleSelectModel,
      handleThinkingLevelChange,
      hostClient,
      hostStatus,
      menuMcp,
      menuSkills,
      modelOptions,
      pendingAttachments,
      pendingContextRefs,
      removeContextRef,
      plusMenuOpen,
      plusSubmenu,
      requestGit,
      recentProjects,
      retryPendingAttachment,
      retryFailedAttachments,
      discardFailedAttachments,
      revokePending,
      sessionUserPrompts,
      activeJobsForComposer,
      stopJob,
      shell.openInspector,
      selectedModelContextWindow,
      selectedModelKey,
      selectedModelLabel,
      setAgentMode,
      setComposer,
      setDropActive,
      setExtensionUiInput,
      setPlusMenuOpen,
      setPlusSubmenu,
      speechConfigured,
      speechRequest,
      steerQueueMessages,
      state.activeSessionId,
      state.compacting,
      state.contextUsage,
      state.hostMock,
      state.hostReady,
      state.projectPath,
      state.projectTrusted,
      state.runPhase,
      state.streaming,
      state.activeScope.kind,
      thinkingLevel,
    ],
  );

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
  const handleInspectSubagent = useCallback(
    (selection: SubagentInspectorSelection): void => {
      inspector.openInspector(selection);
    },
    [inspector.openInspector],
  );
  const handleSubagentPermission = useCallback(
    async (
      prompt: PermissionPromptUi,
      decision: PermissionDecision,
      rememberScope?: PermissionRememberScope,
    ): Promise<void> => {
      const response = await hostClient.request({
        type: 'permission/resolve',
        requestId: prompt.requestId,
        decision,
        ...(decision === 'allow' && rememberScope ? { rememberScope } : {}),
      });
      if (state.permissionPrompt?.requestId === prompt.requestId) {
        dispatch({ type: 'permission/clear', requestId: prompt.requestId });
      }
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
      }
    },
    [dispatch, hostClient, state.permissionPrompt?.requestId],
  );
  const handleContinueSubagent = useCallback(
    async (childSessionId: string, text: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'subagent/continue',
        childSessionId,
        text,
      });
      if (!response.success) throw new Error(response.error);
    },
    [hostClient],
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
        dispatch({ type: 'error', message: '这条调整已不能编辑，请重新发送。' });
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
        dispatch({ type: 'error', message: response.error });
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
    [hostClient, state.activeSessionId, state.messages],
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
        dispatch({ type: 'error', message: response.error });
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
      if (preferences.dontAskRevertConfirm && messageId === lastUserMessageId) {
        void handleEditAndResend(messageId, text);
        return;
      }
      setPendingRevertEdit({ messageId, text, isEdit: true });
    },
    [handleEditAndResend, lastUserMessageId, preferences.dontAskRevertConfirm],
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
  const handleDismissNotification = useCallback(
    (id: string): void => {
      dispatchNotification({ type: 'notify/dismiss', id });
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

  return (
    <DesktopLocaleProvider locale={desktopLocale} onLocaleChange={handleLocaleChange}>
      <DesktopContextMenuProvider value={desktopContextMenuValue}>
        <div
          className={`app-shell workbench${rightPanelOpen ? ' has-right-panel' : ''}${navDrawerOpen ? ' nav-open' : ''}${settingsOpen ? ' settings-open' : ''}${knowledgeOpen ? ' knowledge-open' : ''}${rightPanelResize.isResizing || sidebarResize.isResizing ? ' is-resizing-panels' : ''}`}
          style={appShellStyle}
          data-testid="app-shell"
          data-layout={layoutMode}
          data-right={rightPanelOpen ? 'expanded' : 'collapsed'}
          data-settings-open={settingsOpen ? 'true' : 'false'}
          data-knowledge-open={knowledgeOpen ? 'true' : 'false'}
        >
          <NotificationRegion
            items={notificationState.items}
            onDismiss={handleDismissNotification}
          />

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
                onOpenWorkspace={() => void handleOpenWorkspaceClick()}
                onOpenProject={(path) => void handleOpenProject(path)}
                onRemoveProject={(path) => void handleRemoveProjectFromSidebar(path)}
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
                onToggleKnowledge={() => setKnowledgeOpen((current) => !current)}
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
                    ? `${projectDisplayName(state.projectPath)} / ${activeSessionName}`
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
                {...(lastUserMessageId
                  ? {
                      onRetry: () => {
                        void handleRetryFromMessage(lastUserMessageId);
                      },
                    }
                  : {})}
                {...(state.activeScope.kind === 'general'
                  ? {}
                  : {
                      permissionMode: config?.permissions?.preset ?? configPreset,
                      onOpenPermissions: () => openSettingsSection('permissions'),
                    })}
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
              <>
                <MainErrorBanner
                  message={state.error}
                  onDismiss={() => dispatch({ type: 'error/clear' })}
                />
                {state.projectPath && !state.projectTrusted ? (
                  <div className="chat-inline-notice">
                    <ProjectTrustNotice
                      projectPath={state.projectPath}
                      onTrust={() => void handleTrustProject(true)}
                    />
                  </div>
                ) : null}
                {state.activeSessionArchived ? (
                  <div className="chat-inline-notice">
                    <SessionArchivedBanner
                      sessionName={activeSessionName}
                      onRestore={() => {
                        if (state.activeSessionId) {
                          void handleSessionMenuAction(state.activeSessionId, 'unarchive');
                        }
                      }}
                      onNewAgent={() => void handleStartNewSession()}
                    />
                  </div>
                ) : null}
                {state.awaitingTranscript ? (
                  <div
                    className="transcript-awaiting-banner"
                    data-testid="transcript-awaiting-banner"
                    role="status"
                    aria-live="polite"
                  >
                    {desktopLocale === 'zh-CN' ? '正在加载会话…' : 'Loading session…'}
                  </div>
                ) : null}
                <TranscriptViewport
                  key={state.activeSessionId ?? 'no-session'}
                  messageCount={visibleTranscriptMessages.length}
                  activitySignal={historyViewActive ? 'history-view' : activitySignal}
                  messages={visibleTranscriptMessages}
                  historyIndex={state.userMessageIndex}
                  onJumpToHistoryAnchor={handleJumpToHistoryAnchor}
                  historyViewActive={historyViewActive}
                  onReturnToLatest={handleReturnToLiveTranscript}
                  canLoadOlder={
                    !historyViewActive &&
                    state.transcriptWindow?.olderCursor !== undefined &&
                    state.transcriptWindow.cacheLimitReached !== true
                  }
                  historyLoading={transcriptHistoryLoading}
                  onLoadOlder={handleLoadOlderTranscript}
                  locale={desktopLocale}
                  liveTurnId={
                    !historyViewActive && state.streaming ? lastUserMessageId : null
                  }
                  {...(state.activeSessionId ? { sessionId: state.activeSessionId } : {})}
                >
                  {/*
                     * Keep the thread mounted during the pre-ACK window. The
                     * optimistic send marks the run as streaming before the
                     * Host returns a run id, and ChatThread owns the waiting
                     * activity locator for that state.
                     */}
                    {visibleTranscriptMessages.length > 0 ||
                    (!historyViewActive && state.streaming) ? (
                      <ChatThread
                        messages={visibleTranscriptMessages}
                        {...(state.activeSessionId ? { sessionId: state.activeSessionId } : {})}
                        streaming={!historyViewActive && state.streaming}
                        activeSessionId={state.activeSessionId}
                        docCardRequest={requestKnowledgeCenter as never}
                        isConversationSession={state.activeScope.kind === 'general'}
                        onResolveFlashcards={resolveConversationFlashcards}
                        livePromptModel={state.streaming ? currentPromptModelRef : null}
                        modelOptions={modelOptions}
                        {...(config?.providers !== undefined ? { configProviders: config.providers } : {})}
                        contextUsage={state.contextUsage}
                        editingMessageId={editingMessageId}
                        lastUserMessageId={lastUserMessageId}
                        activeTheme={activeTheme}
                        artifactThemeKey={artifactThemeKey}
                        runRecordsById={visibleRunRecordsById}
                        activeRunId={historyViewActive ? null : state.activeRunId}
                        activeSkill={historyViewActive ? null : state.activeSkill}
                        {...(preferences.agentLocatorAnimation
                          ? { agentLocatorAnimation: preferences.agentLocatorAnimation }
                          : {})}
                        permissionPrompt={state.permissionPrompt}
                        projectPath={state.projectPath}
                        toolDiffRequest={requestGit as never}
                        filesChangedRequest={requestGit as never}
                        onReviewChanges={() => openRightTab('review')}
                        onPermission={(decision, scope) => {
                          void handlePermission(decision, scope);
                        }}
                        workDetailsExpanded={preferences.workDetailsExpanded}
                        toolDensity={preferences.toolDensity}
                        showThinking={preferences.verboseAgentChat}
                        artifactPreviewEnabled={config?.artifact?.enabled ?? true}
                        artifactCodeFirst={preferences.artifactCodeFirst}
                        plan={sessionPlan}
                        {...(config?.artifact?.maxBytes !== undefined
                          ? { artifactMaxBytes: config.artifact.maxBytes }
                          : {})}
                        locale={desktopLocale}
                        assemblySummariesByRunId={assemblySummariesByRunId}
                        onInspectSubagent={handleInspectSubagent}
                        subagentChildren={state.subagentChildren}
                        subagentInvocations={state.subagentInvocations}
                        subagentStreams={state.subagentStreams}
                        onEdit={setEditingMessageId}
                        onCancelEdit={handleCancelMessageEdit}
                        onEditResend={handleEditAndResendMessage}
                        onRetry={handleRetryMessage}
                        onInterventionEdit={handleInterventionEdit}
                        onInterventionCancel={handleInterventionCancel}
                        onFeedback={handleMessageFeedback}
                        onArtifactAction={handleArtifactAction}
                        onOpenArtifactCanvas={handleOpenArtifactCanvas}
                        onOpenFile={(absolutePath, relativePath) => {
                          handleOpenDocument(
                            {
                              title:
                                (relativePath || absolutePath).split(/[\\/]/).pop() || absolutePath,
                              path: absolutePath,
                            },
                            'inspector',
                          );
                        }}
                        onOpenDocument={handleOpenDocument}
                        onPlanExecute={handlePlanExecute}
                        onPlanAbort={handlePlanAbort}
                        composerCard={composerCard}
                        walkthroughsByMessageId={state.walkthroughsByMessageId}
                        walkthroughEnabled={config?.walkthrough?.enabled !== false}
                        walkthroughAutoGenerate={false}
                        onGenerateWalkthrough={handleGenerateWalkthrough}
                        onCancelWalkthrough={handleCancelWalkthrough}
                        {...(state.activeSessionId
                          ? {
                              onDuplicateSession: () =>
                                void handleDuplicateSession(state.activeSessionId!),
                              onForkFromMessage: (messageId: string) =>
                                void handleForkSession(state.activeSessionId!, messageId),
                            }
                          : {})}
                        {...(sessionLineage ? { sessionLineage } : {})}
                        forkCountsByMessageId={forkCountsByMessageId}
                        onOpenSession={(sessionId: string) => void handleResumeSession(sessionId)}
                        derivedActionsDisabled={!state.activeSessionId || state.streaming || state.awaitingTranscript}
                      />
                    ) : null}
                </TranscriptViewport>
                {state.compacting ? (
                  <Notice
                    tone="info"
                    testId="compaction-progress-notice"
                    title="Compacting context…"
                    action={
                      <Button size="compact" onClick={() => void handleCompactAbort()}>
                        Cancel
                      </Button>
                    }
                  />
                ) : null}
                {!state.compacting && state.lastCompactionMessage ? (
                  <Notice
                    tone="success"
                    testId="compaction-result-notice"
                    title={state.lastCompactionMessage}
                    action={
                      <Button
                        size="compact"
                        onClick={() => dispatch({ type: 'compaction/dismiss' })}
                      >
                        Dismiss
                      </Button>
                    }
                    details={
                      <>
                        {typeof state.lastCompactionDurationMs === 'number' ? (
                          <span className="muted">Duration {state.lastCompactionDurationMs}ms</span>
                        ) : null}
                        {typeof state.lastCompactionTokensBefore === 'number' ||
                        typeof state.lastCompactionTokensAfter === 'number' ? (
                          <div className="muted banner-meta">
                            Tokens
                            {typeof state.lastCompactionTokensBefore === 'number'
                              ? ` before: ${state.lastCompactionTokensBefore}`
                              : ''}
                            {typeof state.lastCompactionTokensAfter === 'number'
                              ? ` → after: ${state.lastCompactionTokensAfter}`
                              : ''}
                          </div>
                        ) : null}
                        {state.lastCompactionSummary ? (
                          <details className="banner-details">
                            <summary>Summary</summary>
                            <pre className="banner-summary-pre">
                              {state.lastCompactionSummary.slice(0, 500)}
                            </pre>
                          </details>
                        ) : null}
                      </>
                    }
                  />
                ) : null}
              </>
            }
            permissionBar={
              state.activeScope.kind !== 'general' && state.permissionPrompt ? (
                <PermissionBar
                  prompt={state.permissionPrompt}
                  projectPath={state.projectPath}
                  onPermission={(decision, scope) => {
                    void handlePermission(decision, scope);
                  }}
                />
              ) : state.activeScope.kind !== 'general' && extensionUiRequest ? (
                <ExtensionUiPrompt
                  request={extensionUiRequest}
                  onResolve={(payload) => void handleExtensionUiResolve(payload)}
                />
              ) : null
            }
            composerDock={
              <>
                {state.messages.length === 0 && !state.awaitingTranscript ? (
                  <InkWashEmptyVignette theme={activeTheme} />
                ) : null}
                <ComposerDock {...composerCard} />
              </>
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
              <>
                {showOverlayScrim ? (
                  <button
                    type="button"
                    className="shell-overlay-scrim"
                    data-testid="shell-overlay-scrim"
                    aria-label="Close panel"
                    onClick={() => shell.closeOverlay()}
                  />
                ) : null}

                <RightPanel
                  open={rightPanelOpen}
                  onOpen={() => shell.openInspector(rightPanelTab)}
                  onClose={() => shell.closeOverlay()}
                  activeTab={rightPanelTab}
                  onTabChange={(tab) => {
                    shell.setInspectorTab(tab);
                    if (!rightPanelOpen) {
                      shell.openInspector(tab);
                    }
                  }}
                  panelWidthPx={rightPanelResize.widthPx}
                  isResizing={rightPanelResize.isResizing}
                  onResizePointerDown={rightPanelResize.onResizePointerDown}
                  onResizeReset={() => rightPanelResize.setWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX)}
                  isExpanded={rightPanelResize.widthPx > 450}
                  onToggleExpand={() =>
                    rightPanelResize.setWidthPx(
                      rightPanelResize.widthPx > 450 ? RIGHT_PANEL_DEFAULT_WIDTH_PX : 600,
                    )
                  }
                  isOverlayPresentation={isOverlayPresentation}
                  runningJobCount={jobs.length}
                  terminalAttention={terminalAttention}
                  onTerminalAttentionClear={() => setTerminalAttention(false)}
                  onViewChange={setRightPanelView}
                  locale={desktopLocale}
                  appearanceMode={activeTheme.mode === 'light' ? 'light' : 'dark'}
                  onToggleAppearance={handleToggleAppearance}
                  onOpenSkills={() => openSettingsSection('skills')}
                  onOpenMcp={() => openSettingsSection('tools')}
                  onOpenSettings={() => openSettingsSection('general')}
                  onToggleSessions={() => shell.toggleSessions()}
                  notesContent={<DeferredNotesPanel request={requestNotesPanel} />}
                  cardsContent={<DeferredFlashcardsPanel request={requestCardsPanel} />}
                  filesContent={
                    <DeferredFileTreePanel
                      projectPath={state.projectPath}
                      request={requestFileTree}
                      onAddContextRef={(ref) => {
                        const result = addContextRef(ref);
                        if (!result.ok) {
                          dispatchNotification({
                            type: 'notify/push',
                            notification: {
                              level: 'warning',
                              message: 'Context chip limit reached (12). Remove one first.',
                            },
                          });
                          return;
                        }
                      }}
                      onSendPreset={(text, refs) => {
                        for (const ref of refs) {
                          addContextRef(ref);
                        }
                        void handleSend(text);
                      }}
                      onInsertPath={(absolutePath) => {
                        setComposer((current) =>
                          current.trim().length > 0
                            ? `${current.replace(/\s+$/, '')}\n${absolutePath}`
                            : absolutePath,
                        );
                      }}
                      locale={desktopLocale}
                    />
                  }
                  canvasContent={
                    <ArtifactCanvasPanel
                      activeTarget={artifactCanvas.activeTarget}
                      artifactTheme={mapThemeToArtifactVariables(activeTheme)}
                      artifactThemeKey={artifactThemeKey}
                      {...(config?.artifact?.maxBytes !== undefined
                        ? { artifactMaxBytes: config.artifact.maxBytes }
                        : {})}
                      onInsertProposal={(proposal) =>
                        setComposer((current) => appendComposerProposal(current, proposal.text))
                      }
                    />
                  }
                  browserContent={
                    <DeferredBrowserSessionPanel
                      hostClient={hostClient}
                      onAddWebElement={addWebElement}
                    />
                  }
                  sideChatContent={
                    <DeferredSideChatPanel
                      sessionId={state.activeSessionId}
                      hostClient={hostClient}
                    />
                  }
                  docPreviewContent={
                    activeMedia ? (
                      <DeferredMediaDocPreview
                        title={activeDocument?.title}
                        displayRef={activeDocument?.displayRef}
                        media={activeMedia}
                        locale={desktopLocale}
                      />
                    ) : (
                    <DeferredDocPreviewPanel
                      title={activeDocument?.title}
                      content={activeDocumentContent(activeDocument)}
                      filePath={activeDocumentFilePath(activeDocument)}
                      status={activeDocument?.status}
                      displayRef={activeDocument?.displayRef}
                      provenance={
                        activeDocument?.status === 'ready' ? activeDocument.provenance : undefined
                      }
                      warning={
                        activeDocument?.status === 'ready' ? activeDocument.warning : undefined
                      }
                      skillId={
                        activeDocument?.status === 'ready' ? activeDocument.skillId : undefined
                      }
                      skillSource={
                        activeDocument?.status === 'ready' ? activeDocument.skillSource : undefined
                      }
                      readOnly={
                        activeDocument?.status === 'ready' ? activeDocument.readOnly : undefined
                      }
                      unavailableReason={
                        activeDocument?.status === 'unavailable' ? activeDocument.reason : undefined
                      }
                      suggestion={
                        activeDocument?.status === 'unavailable'
                          ? activeDocument.suggestion
                          : undefined
                      }
                      sessionDocuments={sessionDocuments}
                      onOpenFile={(filePath) => {
                        handleOpenDocument({
                          title: filePath.split(/[\\/]/).pop() || filePath,
                          path: filePath,
                        });
                      }}
                      onCommentLine={handleCommentLine}
                      comments={activeComments}
                      onAddComment={handleAddDocComment}
                      onEditComment={handleEditDocComment}
                      onDeleteComment={handleDeleteDocComment}
                      onSelectDocument={(doc) => {
                        const planDocument =
                          doc.path === `plans/${state.activeSessionId ?? ''}.md`
                            ? sessionPlan
                            : null;
                        // Walkthrough virtual docs: resolve markdown content from the
                        // in-memory artifact map (path: walkthroughs/<message-id>.md).
                        const walkthroughMatch = doc.path?.match(/^walkthroughs\/(.+)\.md$/);
                        const walkthroughArtifact = walkthroughMatch
                          ? state.walkthroughsByMessageId[walkthroughMatch[1] as string]
                          : undefined;
                        handleOpenDocument({
                          title: doc.title,
                          ...(doc.path ? { path: doc.path } : {}),
                          ...(planDocument ? { content: formatPlanMarkdown(planDocument) } : {}),
                          ...(walkthroughArtifact?.status === 'ready'
                            ? { content: walkthroughArtifact.markdown }
                            : {}),
                        });
                      }}
                      locale={desktopLocale}
                    />
                    )
                  }
                  terminalContent={
                    <DeferredTerminalDock
                      projectPath={state.projectPath}
                      projectTrusted={state.projectTrusted}
                      ptyOutput={ptyOutput}
                      onClearPtyOutput={() => setPtyOutput([])}
                      currentCwd={terminalCwd}
                      onCwdChange={handleTerminalCwdChange}
                      recentDirs={terminalRecentDirs}
                      request={requestPty}
                    />
                  }
                  reviewContent={
                    <DeferredReviewPanel
                      changesContent={
                        <DeferredChangesPanel
                          projectPath={state.projectPath}
                          request={requestGit as never}
                          onOpenFile={(absolutePath, relativePath) => {
                            // Workspace files open beside the file rail only — never the chat stage.
                            handleOpenDocument(
                              {
                                title: relativePath.split(/[\\/]/).pop() || relativePath,
                                path: absolutePath,
                              },
                              'inspector',
                            );
                          }}
                        />
                      }
                      gitContent={
                        <DeferredGitPanel
                          projectPath={state.projectPath}
                          request={requestGit as never}
                          variant="embedded"
                        />
                      }
                    />
                  }
                />
              </>
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

          {/* Revert checkpoint confirmation dialog matching exact design specifications */}
          {pendingRevertEdit ? (
            <Dialog
              label="Restore conversation to this message?"
              open
              onOpenChange={(open) => {
                if (!open) {
                  setPendingRevertEdit(null);
                  setDontAskAgainChecked(false);
                }
              }}
              testId="revert-edit-confirm"
            >
              <div className="revert-modal-content">
                <h3 className="revert-modal-title">Restore conversation to this message?</h3>
                <p className="revert-modal-subtitle muted">
                  Later messages will be removed from this chat. File changes on disk are not
                  undone.
                </p>
                <div className="revert-modal-footer">
                  <label className="revert-dont-ask">
                    <input
                      type="checkbox"
                      checked={dontAskAgainChecked}
                      onChange={(e) => setDontAskAgainChecked(e.target.checked)}
                      data-testid="revert-dont-ask-checkbox"
                    />
                    <span>Don't Ask Again</span>
                  </label>
                  <div className="modal-actions">
                    <Button
                      data-testid="revert-edit-cancel"
                      onClick={() => {
                        setPendingRevertEdit(null);
                        setDontAskAgainChecked(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      className="revert-continue-btn"
                      data-testid="revert-edit-confirm"
                      onClick={() => {
                        if (dontAskAgainChecked) {
                          const nextPrefs = { ...preferences, dontAskRevertConfirm: true };
                          setPreferences(nextPrefs);
                          saveDesktopPreferences(nextPrefs);
                        }
                        const target = pendingRevertEdit;
                        setPendingRevertEdit(null);
                        setDontAskAgainChecked(false);
                        if (target) {
                          if (target.isEdit) {
                            void handleEditAndResend(target.messageId, target.text);
                          } else {
                            void handleRetryFromMessage(target.messageId);
                          }
                        }
                      }}
                    >
                      Continue <span className="enter-symbol">↵</span>
                    </Button>
                  </div>
                </div>
              </div>
            </Dialog>
          ) : null}

          {inspector.selection !== null ? (
            <DeferredSurfaceBoundary
              label={desktopLocale === 'zh-CN' ? '正在加载子代理会话' : 'Loading subagent session'}
            >
              <DeferredSubagentSessionDialog
                open
                selection={inspector.selection}
                {...(state.subagentChildren[inspector.selection.childSessionId]
                  ? { child: state.subagentChildren[inspector.selection.childSessionId] }
                  : {})}
                status={inspector.status}
                messages={inspector.messages}
                liveTail={inspector.liveTail}
                loading={inspector.loading}
                error={inspector.error}
                showThinking={preferences.verboseAgentChat}
                projectPath={
                  state.subagentChildren[inspector.selection.childSessionId]?.projectPath ?? null
                }
                request={requestGit as never}
                filesChangedRequest={requestGit as never}
                onOpenFile={(absolutePath, relativePath) => {
                  handleOpenDocument(
                    {
                      title: (relativePath || absolutePath).split(/[\\/]/).pop() || absolutePath,
                      path: absolutePath,
                    },
                    'inspector',
                  );
                }}
                onOpenDocument={handleOpenDocument}
                onArtifactAction={handleArtifactAction}
                onOpenArtifactCanvas={handleOpenArtifactCanvas}
                artifactPreviewEnabled={config?.artifact?.enabled ?? true}
                {...(config?.artifact?.maxBytes !== undefined
                  ? { artifactMaxBytes: config.artifact.maxBytes }
                  : {})}
                onPermission={(prompt, decision, rememberScope) => {
                  void handleSubagentPermission(prompt, decision, rememberScope);
                }}
                onOpenChange={(open) => {
                  if (!open) {
                    inspector.closeInspector();
                  }
                }}
                onOpenFullSession={inspector.openFullSession}
                onRetry={inspector.retryLoad}
                onContinue={handleContinueSubagent}
                onWorktreeAction={handleSubagentWorktreeAction}
              />
            </DeferredSurfaceBoundary>
          ) : null}
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
            />
          </DeferredSurfaceBoundary>
        ) : null}
      </DesktopContextMenuProvider>
    </DesktopLocaleProvider>
  );
}
