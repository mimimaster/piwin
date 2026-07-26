import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  ExecutionMode,
  PiwinConfig,
  ProjectRecord,
  SessionSearchHit,
  ThemeManifest,
} from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { HostClient } from './host-client';
import { useHostRequestAdapters } from './host-request-adapters';
import { WorkspaceTitlebar } from './workspace-titlebar';
import { SettingsPanel } from './SettingsPanel';
import { NotificationRegion } from './NotificationRegion';
import { ProjectSessionSidebar } from './project-session-sidebar';
import { ChatThread } from './chat-thread';
import { ComposerDock } from './composer-dock';
import { FileTreePanel } from './file-tree-panel';
import { ReviewPanel } from './review-panel';
import { AppDialogs } from './app-dialogs';
import { ChatEmptyState } from './chat-empty-state';
import {
  createEmptyNotificationState,
  notificationReducer,
} from './notification-queue';
import { GitPanel } from './GitPanel';
import { applyThemeToDocument } from './ThemePanel';
import { resolveBuiltinAppearance, resolveDesktopAppearance } from './appearance-tokens';
import type { HostLogEntry } from './HostLogPanel';
import { NotesPanel } from './NotesPanel';
import { FlashcardsPanel } from './FlashcardsPanel';
import { RightPanel, type RightPanelTab } from './right-panel'; // right-panel portal v3
import { collectSessionTools } from './tool-call-card';
import { ChangesPanel } from './changes-panel';
import { TerminalDock, type PtyOutputLine } from './terminal-dock';
import { type AgentModeId } from './agent-mode';
import { groupSessionsByRecency } from './session-groups';
import {
  loadDesktopPreferences,
  saveDesktopPreferences,
  type DesktopPreferences,
} from './ui-preferences';
import {
  getDesktopCopy,
  loadDesktopLocale,
  saveDesktopLocale,
  type DesktopLocale,
} from './desktop-locale';
import { DesktopLocaleProvider } from './desktop-locale-context';
import type { ComposerPlusSubmenu } from './composer-plus-menu';
import { useHostBootstrap } from './hooks/use-host-bootstrap';
import { useComposerMedia } from './hooks/use-composer-media';
import { useSessionActions } from './hooks/use-session-actions';
import { useManagedProcesses } from './hooks/use-managed-processes';
import { Button, ConfirmDialog, Notice } from '@piwin/ui-kit';
import { useShellLayout } from './hooks/use-shell-layout';
import { CommandPalette } from './command-palette';
import { useDesktopShortcuts } from './use-desktop-shortcuts';
import type { DesktopCommandId } from './desktop-commands';
import { deriveRunStatus } from './run-status';
import { ContextBar } from './context-bar';
import { WorkspaceShell } from './workspace-shell';
import { TranscriptViewport } from './transcript-viewport';
import { ProjectTrustNotice } from './project-trust-notice';
import { SessionArchivedBanner } from './session-archived-banner';
import { StatusBar } from './status-bar';
import { ContextWindowPanel } from './context-window-panel';
import { useRightPanelResize } from './hooks/use-right-panel-resize';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';
import { adjustWindowOutwardForRightPanelWidth } from './window-outward-expand';
type ModelOption = {
  providerId: string;
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  modelId: string;
  label: string;
  contextWindow?: number;
};

function modelsFromConfig(config: PiwinConfig | null): ModelOption[] {
  if (!config) {
    return [];
  }
  const options: ModelOption[] = [];
  for (const provider of config.providers) {
    for (const model of provider.models) {
      options.push({
        providerId: provider.id,
        protocol: provider.protocol,
        modelId: model.id,
        label: `${provider.name} / ${model.label ?? model.id}`,
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
      });
    }
  }
  return options;
}

export function App() {
  const hostClient = useMemo(
    () => new HostClient({ transport: 'auto', hostMock: false }),
    [],
  );
  const {
    requestConfig,
    requestSubAgent,
    requestSkills,
    requestExtensions,
    requestPrompts,
    requestMcp,
    requestGit,
    requestTheme,
    requestPet,
    requestMemory,
    requestPty,
    requestAutomation,
  } = useHostRequestAdapters(hostClient);

  const [state, dispatch] = useReducer(chatUiReducer, undefined, createInitialChatUiState);
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
  const handleRightPanelWidthChange = useCallback(
    (widthPx: number): void => {
      if (rightPanelOpen && layoutMode === 'desktop') {
        void adjustWindowOutwardForRightPanelWidth(widthPx);
      }
    },
    [layoutMode, rightPanelOpen],
  );
  const rightPanelResizeOptions = useMemo(
    () => ({
      layoutMode,
      navDrawerOpen,
      onLiveWidthCommit: handleRightPanelWidthChange,
    }),
    [handleRightPanelWidthChange, layoutMode, navDrawerOpen],
  );
  const rightPanelResize = useRightPanelResize(rightPanelResizeOptions);
  const [hostLogEntries, setHostLogEntries] = useState<HostLogEntry[]>([]);
  const [ptyOutput, setPtyOutput] = useState<PtyOutputLine[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{
    sessionId: string;
    name: string;
  } | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    sessionId: string;
    sessionName: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentModeId>('agent');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('agent');
  const [remoteSearchHits, setRemoteSearchHits] = useState<SessionSearchHit[] | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<DesktopPreferences>(() =>
    loadDesktopPreferences(),
  );

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
    return {
      '--chat-font-size': chatFontSize,
      '--code-font-size': codeFontSize,
      '--code-wrap': codeWrap,
    } as React.CSSProperties;
  }, [preferences]);
  const appShellStyle = useMemo(
    () => ({
      ...preferencesStyle,
      '--right-panel-width': `${rightPanelResize.widthPx}px`,
    }) as React.CSSProperties,
    [preferencesStyle, rightPanelResize.widthPx],
  );
  const [desktopLocale, setDesktopLocale] = useState<DesktopLocale>(() =>
    loadDesktopLocale(),
  );
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusSubmenu, setPlusSubmenu] = useState<ComposerPlusSubmenu>('none');
  const [menuSkills, setMenuSkills] = useState<
    Array<{ id: string; name: string; enabled: boolean }>
  >([]);
  const [menuMcp, setMenuMcp] = useState<
    Array<{ id: string; name: string; running: boolean }>
  >([]);
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<import('@piwin/contracts').ThinkingLevel>('off');
  const [recentProjects, setRecentProjects] = useState<ProjectRecord[]>([]);
  const [runClock, setRunClock] = useState(() => Date.now());
  const hasHydratedInitialGeneralSessions = useRef(false);
  const hasRestoredDesktopSession = useRef(false);
  const configSaveQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (state.activeRunStartedAt === null) {
      return;
    }
    const timer = window.setInterval(() => setRunClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.activeRunStartedAt]);

  useEffect(() => {
    let cancelled = false;
    async function loadRecentProjects(): Promise<void> {
      const response = await hostClient.request({ type: 'project/list' });
      if (!response.success || cancelled) {
        return;
      }
      const data = response.data as { projects?: ProjectRecord[] };
      setRecentProjects(data.projects ?? []);
    }
    void loadRecentProjects();
    return () => {
      cancelled = true;
    };
  }, [hostClient, state.projectPath]);

  const {
    managedProcesses,
    refreshManagedProcesses,
    appendProcessLog,
  } = useManagedProcesses(hostClient, {
    refreshWhenVisible: rightPanelOpen && shell.inspectorTab === 'activity',
  });

  const {
    hostStatus,
    config,
    setConfig,
    activeTheme,
    setActiveTheme,
    setActivePet,
    artifactThemeKey,
    setArtifactThemeKey,
    sessionPlan,
    extensionUiRequest,
    setExtensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
  } = useHostBootstrap({
    hostClient,
    dispatch,
    dispatchNotification,
    refreshManagedProcesses,
    appendProcessLog,
    setPtyOutput,
    setHostLogEntries,
    setSelectedModelKey,
  });

  const modelOptions = useMemo(() => modelsFromConfig(config), [config]);

  // Flashcard rating from artifact flip cards (ADR 0018 S5c): validated
  // whitelisted action → flashcards/rate HostCommand → FSRS state update.
  const handleArtifactAction = useCallback(
    (action: import('@piwin/artifact').ArtifactActionMessage) => {
      if (action.action !== 'flashcard/rate') {
        return;
      }
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
    },
    [hostClient],
  );

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
  const {
    hydrateSessions,
    handleOpenWorkspaceClick,
    handleBrowseProject,
    handleOpenProject,
    handleTrustProject,
    ensureSession,
    handleNewSession,
    handleResumeSession,
    handleRenameSession,
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
    executionMode,
    selectedModelKey,
    modelOptions,
    agentMode,
    setEditingMessageId,
    setRenameDraft,
    setHostLogEntries,
  });

  // Cold start: hydrate General sessions once the host is ready.
  useEffect(() => {
    if (
      !state.hostReady ||
      state.projectPath ||
      config === null ||
      config.desktop?.lastSession ||
      hasHydratedInitialGeneralSessions.current
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
  }, [config, state.hostReady, state.projectPath]);

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
        await handleOpenProject(lastSession.scope.projectPath, lastSession.sessionId, {
          autoTrust: false,
        });
        return;
      }
      dispatch({ type: 'project/clear' });
      await hydrateSessions({ kind: 'general' }, { includeArchived: false });
      await handleResumeSession(lastSession.sessionId);
    })();
  }, [config?.desktop?.lastSession, dispatch, handleOpenProject, handleResumeSession, hydrateSessions, state.hostReady]);

  useEffect(() => {
    const composerProfile = config?.desktop?.composerProfile;
    if (!composerProfile) {
      return;
    }
    if (composerProfile.model) {
      const matchingModel = modelOptions.find(
        (model) =>
          model.providerId === composerProfile.model?.providerId &&
          model.modelId === composerProfile.model?.modelId &&
          model.protocol === composerProfile.model?.protocol,
      );
      if (matchingModel) {
        setSelectedModelKey(`${matchingModel.providerId}::${matchingModel.modelId}`);
      }
    }
    if (composerProfile.thinkingLevel) {
      setThinkingLevel(composerProfile.thinkingLevel);
    }
  }, [config?.desktop?.composerProfile, modelOptions]);

  const saveConfigInOrder = useCallback(
    (nextConfig: PiwinConfig): void => {
      configSaveQueue.current = configSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          await hostClient.request({ type: 'config/set', config: nextConfig });
        });
    },
    [hostClient],
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
      saveConfigInOrder(nextConfig);
    },
    [config, modelOptions, saveConfigInOrder, setConfig],
  );

  const handleSelectModel = useCallback(
    (nextModelKey: string): void => {
      setSelectedModelKey(nextModelKey);
      persistComposerProfile(nextModelKey, thinkingLevel);
    },
    [persistComposerProfile, thinkingLevel],
  );

  const handleThinkingLevelChange = useCallback(
    (nextThinkingLevel: import('@piwin/contracts').ThinkingLevel): void => {
      setThinkingLevel(nextThinkingLevel);
      persistComposerProfile(selectedModelKey, nextThinkingLevel);
    },
    [persistComposerProfile, selectedModelKey],
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
    saveConfigInOrder(nextConfig);
  }, [config, saveConfigInOrder, setConfig, state.activeScope, state.activeSessionId]);

  const {
    composer,
    setComposer,
    pendingAttachments,
    dropActive,
    setDropActive,
    revokePending,
    handleComposerPaste,
    handleComposerDrop,
    handlePickImageFiles,
    handleSend,
    handleSteer,
    handleFollowUp,
  } = useComposerMedia({
    hostClient,
    state,
    dispatch,
    agentMode,
    onAgentModeChange: setAgentMode,
    menuSkills,
    onCompact: handleCompact,
    onAbort: handleAbort,
    ensureSession,
    onNeedWorkspace: handleOpenWorkspaceClick,
    selectedModelKey,
    modelOptions,
    thinkingLevel,
  });

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
    setExtensionUiRequest(null);
    setExtensionUiInput('');
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handleToggleAppearance(): Promise<void> {
    const nextId = activeTheme?.mode === 'light' ? 'piwin-dark' : 'piwin-light';
    const response = await hostClient.request({ type: 'theme/set-active', themeId: nextId });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const theme = (response.data as { theme: ThemeManifest }).theme;
    const resolved = resolveBuiltinAppearance(theme.id);
    const isBuiltin = theme.id === 'piwin-dark' || theme.id === 'piwin-light';
    const next = isBuiltin
      ? {
          ...theme,
          ...resolved,
          tokens: { ...theme.tokens, ...resolved.tokens },
          artifact: { ...theme.artifact, ...resolved.artifact },
          mode: resolved.mode,
        }
      : {
          ...resolved,
          ...theme,
          tokens: { ...resolved.tokens, ...theme.tokens },
          artifact: { ...resolved.artifact, ...theme.artifact },
          mode: theme.mode ?? resolved.mode,
        };
    setActiveTheme(next);
    applyThemeToDocument(next);
    setArtifactThemeKey((previous) => previous + 1);
  }

  async function refreshComposerMenus(): Promise<void> {
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
  }

  useEffect(() => {
    if (state.activeSessionId && state.projectTrusted) {
      void refreshComposerMenus();
    }
  }, [state.activeSessionId, state.projectTrusted, state.projectPath]);

  function openRightTab(tab: RightPanelTab): void {
    shell.openInspector(tab);
  }

  function openSettingsSection(
    section:
      | 'general'
      | 'appearance'
      | 'skills'
      | 'extensions'
      | 'prompts'
      | 'tools'
      | 'web'
      | 'models'
      | 'agents'
      | 'memory'
      | 'automation'
      | 'session',
  ): void {
    shell.openSettings(section);
  }

  function runDesktopCommand(commandId: DesktopCommandId): void {
    switch (commandId) {
      case 'new-session':
        void handleNewSession();
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
        openRightTab('activity');
        break;
      case 'open-settings':
        shell.openSettings('general');
        break;
      case 'open-workspace':
        void handleOpenWorkspaceClick();
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

  useEffect(() => {
    const query = sessionSearch.trim();
    if (!query || !state.projectPath) {
      setRemoteSearchHits(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const searchQuery: import('@piwin/contracts').SessionSearchQuery = {
          query,
          limit: 30,
        };
        if (state.projectPath) {
          searchQuery.projectPath = state.projectPath;
        }
        const response = await hostClient.request({
          type: 'session/search',
          query: searchQuery,
        });
        if (cancelled) return;
        if (!response.success) {
          setRemoteSearchHits([]);
          return;
        }
        const data = response.data as { hits?: SessionSearchHit[] } | undefined;
        setRemoteSearchHits(data?.hits ?? []);
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionSearch, state.projectPath, hostClient]);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) {
      return state.sessions;
    }
    if (remoteSearchHits) {
      const byId = new Map(state.sessions.map((session) => [session.id, session]));
      return remoteSearchHits.map((hit) => {
        const existing = byId.get(hit.sessionId);
        if (existing) {
          return {
            ...existing,
            ...(hit.snippet ? { lastPreview: hit.snippet } : {}),
            ...(hit.isPinned === true ? { isPinned: true } : {}),
          };
        }
        return {
          id: hit.sessionId,
          name: hit.name ?? `session-${hit.sessionId.slice(0, 8)}`,
          ...(hit.snippet ? { lastPreview: hit.snippet } : {}),
          ...(hit.updatedAt ? { updatedAt: hit.updatedAt } : {}),
          ...(hit.isPinned === true ? { isPinned: true } : {}),
        };
      });
    }
    return state.sessions.filter((session) => {
      const haystack = `${session.name} ${session.lastPreview ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [sessionSearch, state.sessions, remoteSearchHits]);

  const sessionGroups = useMemo(
    () => groupSessionsByRecency(filteredSessions),
    [filteredSessions],
  );

  const sessionTools = useMemo(
    () => collectSessionTools(state.messages),
    [state.messages],
  );

  const runStatus = useMemo(
    () =>
      deriveRunStatus({
        chat: state,
        tools: sessionTools,
        plan: sessionPlan,
        processes: managedProcesses,
      }),
    [state, sessionTools, sessionPlan, managedProcesses, runClock],
  );

  const activitySignal = useMemo(
    () => {
      const latestMessage = state.messages[state.messages.length - 1];
      const latestVisibleLength = latestMessage
        ? latestMessage.text.length + latestMessage.thinking.length
        : 0;
      const toolStates = sessionTools
        .map((tool) => `${tool.toolCallId}:${tool.status}:${tool.output.length}`)
        .join(',');
      return `${state.runPhase}:${state.messages.length}:${latestVisibleLength}:${toolStates}`;
    },
    [state.runPhase, state.messages, sessionTools],
  );

  const selectedModelLabel = useMemo(() => {
    if (!selectedModelKey) {
      return 'Default model';
    }
    return modelOptions.find(
      (option) => `${option.providerId}::${option.modelId}` === selectedModelKey,
    )?.label ?? 'Default model';
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

  const composerLayoutMode =
    state.messages.length === 0 ? ('centered' as const) : ('docked' as const);

  const lastUserMessageId = useMemo(() => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role === 'user') {
        return message.id;
      }
    }
    return null;
  }, [state.messages]);

  const activeSessionName =
    state.sessions.find((item) => item.id === state.activeSessionId)?.name ?? 'New chat';
  const desktopCopy = getDesktopCopy(desktopLocale);

  const handleOpenSubagentSession = useCallback(
    (sessionId: string): void => {
      void handleResumeSession(sessionId);
    },
    [handleResumeSession],
  );
  const handleCancelMessageEdit = useCallback((): void => {
    setEditingMessageId(null);
  }, []);
  const handleEditAndResendMessage = useCallback(
    (messageId: string, text: string): void => {
      void handleEditAndResend(messageId, text);
    },
    [handleEditAndResend],
  );
  const handleRetryMessage = useCallback(
    (messageId: string): void => {
      void handleRetryFromMessage(messageId);
    },
    [handleRetryFromMessage],
  );
  const handleMessageFeedback = useCallback(
    (message: string, level: 'success' | 'error'): void => {
      dispatchNotification({
        type: 'notify/push',
        notification: { level, message },
      });
    },
    [dispatchNotification],
  );

  useEffect(() => {
    document.documentElement.lang = desktopLocale;
  }, [desktopLocale]);

  useEffect(() => {
    if (rightPanelOpen && layoutMode === 'desktop') {
      void adjustWindowOutwardForRightPanelWidth(rightPanelResize.widthPx);
    }
  }, [layoutMode, rightPanelOpen, rightPanelResize.widthPx]);

  return (
    <DesktopLocaleProvider
      locale={desktopLocale}
      onLocaleChange={(locale) => {
        setDesktopLocale(locale);
        saveDesktopLocale(locale);
      }}
    >
      <div
      className={`app-shell workbench${rightPanelOpen ? ' has-right-panel' : ''}${navDrawerOpen ? ' nav-open' : ''}${settingsOpen ? ' settings-open' : ''}`}
      style={appShellStyle}
      data-testid="app-shell"
      data-layout={layoutMode}
      data-right={rightPanelOpen ? 'expanded' : 'collapsed'}
      data-settings-open={settingsOpen ? 'true' : 'false'}
    >
      <NotificationRegion
        items={notificationState.items}
        onDismiss={(id) => dispatchNotification({ type: 'notify/dismiss', id })}
      />

      <WorkspaceTitlebar
        executionMode={executionMode}
        onExecutionModeChange={setExecutionMode}
        appearanceMode={activeTheme?.mode === 'light' ? 'light' : 'dark'}
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
        onToggleAppearance={() => void handleToggleAppearance()}
        onOpenSettings={() => openSettingsSection('general')}
        workPanelOpen={rightPanelOpen}
        onToggleWorkPanel={() => shell.toggleInspector(rightPanelTab)}
        locale={desktopLocale}
      />

      <WorkspaceShell
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
            sessionGroups={sessionGroups}
            activeSessionId={state.activeSessionId}
            sessionSearch={sessionSearch}
            onSessionSearchChange={setSessionSearch}
            showArchivedSessions={showArchivedSessions}
            onToggleShowArchived={() => {
              const next = !showArchivedSessions;
              setShowArchivedSessions(next);
              if (state.projectPath) {
                void hydrateSessions(state.projectPath, { includeArchived: next });
              } else {
                void hydrateSessions({ kind: 'general' }, { includeArchived: next });
              }
            }}
            settingsOpen={settingsOpen}
            onOpenWorkspace={() => void handleOpenWorkspaceClick()}
            onOpenProject={(path) => void handleOpenProject(path)}
            onNewSession={() => void handleNewSession()}
            onResumeSession={(sessionId) => void handleResumeSession(sessionId)}
            onOpenSessionMenu={(sessionId, x, y) => setSessionMenu({ sessionId, x, y })}
            onOpenSettings={() => openSettingsSection('general')}
            generalActive={state.activeScope.kind === 'general'}
            onSelectGeneral={() => {
              dispatch({ type: 'project/clear' });
              void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
            }}
            isOverlayPresentation={isOverlayPresentation}
            onCloseOverlay={() => shell.closeOverlay()}
            locale={desktopLocale}
          />
        }
        contextBar={
          <ContextBar
            session={{
              title: activeSessionName,
              scopeLabel:
                state.activeScope.kind === 'general'
                  ? desktopCopy.general
                  : desktopLocale === 'zh-CN'
                    ? '项目'
                    : 'Project',
            }}
            runState={runStatus}
            onStop={() => void handleAbort()}
            onViewActivity={() => openRightTab('activity')}
            onReviewPermission={() => {
              // Focus the permission dialog when present; it is already open from state.
              const dialog = document.querySelector<HTMLElement>(
                '[data-testid="permission-dialog"], [role="dialog"][aria-label*="permission" i], .permission-dialog',
              );
              dialog?.focus?.();
              dialog?.scrollIntoView?.({ block: 'nearest' });
            }}
            onViewPlan={() => openRightTab('activity')}
            onCancelCompact={() => void handleCompactAbort()}
            {...(lastUserMessageId
              ? {
                  onRetry: () => {
                    void handleRetryFromMessage(lastUserMessageId);
                  },
                }
              : {})}
            locale={desktopLocale}
          />
        }
        chatColumnClassName={composerLayoutMode === 'centered' ? 'chat-column-empty' : undefined}
        transcript={
          <>
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
                onNewAgent={() => void handleNewSession()}
              />
            </div>
          ) : null}
          <TranscriptViewport
            messageCount={state.messages.length}
            activitySignal={activitySignal}
            messages={state.messages}
          >
            {state.messages.length === 0 ? (
              <ChatEmptyState
                projectPath={state.projectPath}
                projectTrusted={state.projectTrusted}
                activeSessionId={state.activeSessionId}
                onOpenWorkspace={() => void handleOpenWorkspaceClick()}
                onCreateSession={() => void handleNewSession()}
                onSuggest={(mode, text) => {
                  void (async () => {
                    if (!state.activeSessionId && state.projectTrusted) {
                      await handleNewSession();
                    }
                    setAgentMode(mode);
                    setComposer(text);
                  })();
                }}
              />
            ) : (
              <ChatThread
                messages={state.messages}
                streaming={state.streaming}
                editingMessageId={editingMessageId}
                lastUserMessageId={lastUserMessageId}
                activeTheme={activeTheme}
                artifactThemeKey={artifactThemeKey}
                runRecordsById={state.runRecordsById}
                activeRunId={state.activeRunId}
                permissionPrompt={state.permissionPrompt}
                workDetailsExpanded={preferences.workDetailsExpanded}
                toolDensity={preferences.toolDensity}
                onOpenSubagentSession={handleOpenSubagentSession}
                onEdit={setEditingMessageId}
                onCancelEdit={handleCancelMessageEdit}
                onEditResend={handleEditAndResendMessage}
                onRetry={handleRetryMessage}
                onFeedback={handleMessageFeedback}
                onArtifactAction={handleArtifactAction}
              />
            )}
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
                <Button size="compact" onClick={() => dispatch({ type: 'compaction/dismiss' })}>
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
          {state.error ? <Notice tone="error" testId="chat-error-notice">{state.error}</Notice> : null}
          </>
        }
        composerDock={
          <ComposerDock
            layoutMode={composerLayoutMode}
            projectPath={state.projectPath}
            projectTrusted={state.projectTrusted}
            activeSessionId={state.activeSessionId}
            streaming={state.streaming}
            runPhase={state.runPhase}
            compacting={state.compacting}
            composer={composer}
            onComposerChange={setComposer}
            agentMode={agentMode}
            onAgentModeChange={setAgentMode}
            pendingAttachments={pendingAttachments}
            onRemoveAttachment={revokePending}
            dropActive={dropActive}
            onDropActiveChange={setDropActive}
            plusMenuOpen={plusMenuOpen}
            onPlusMenuOpenChange={setPlusMenuOpen}
            plusSubmenu={plusSubmenu}
            onPlusSubmenuChange={setPlusSubmenu}
            modelOptions={modelOptions}
            selectedModelKey={selectedModelKey}
            selectedModelLabel={selectedModelLabel}
            onSelectModel={handleSelectModel}
            menuSkills={menuSkills}
            menuMcp={menuMcp}
            onRefreshComposerMenus={() => {
              void refreshComposerMenus();
            }}
            onOpenSkillsPanel={() => openSettingsSection('skills')}
            onOpenMcpPanel={() => openSettingsSection('tools')}
            onAttachImage={() => void handlePickImageFiles()}
            onPaste={(event) => void handleComposerPaste(event)}
            onDrop={(event) => void handleComposerDrop(event)}
            onSend={() => void handleSend()}
            onSteer={() => void handleSteer()}
            onFollowUp={() => void handleFollowUp()}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={handleThinkingLevelChange}
            ultraThinkingEnabled={config?.thinking?.ultraEnabled === true}
            onAbort={() => void handleAbort()}
            onCompact={() => void handleCompact()}
            compactionSupported={hostStatus?.capabilities?.compaction !== false}
            contextUsage={state.contextUsage}
            {...(typeof selectedModelContextWindow === 'number'
              ? { modelContextWindow: selectedModelContextWindow }
              : {})}
            onOpenModelSettings={() => shell.openSettings('models')}
          />
        }
        statusBar={
          <StatusBar
            modelLabel={selectedModelLabel}
            skillsCount={menuSkills.filter((s) => s.enabled).length}
            mcpCount={menuMcp.filter((m) => m.running).length}
            agentState={state.streaming ? 'running' : state.error ? 'error' : 'idle'}
            contextPercent={
              typeof state.contextUsage?.contextRatio === 'number'
                ? Math.round(state.contextUsage.contextRatio * 100)
                : 0
            }
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
        isOverlayPresentation={isOverlayPresentation}
        runningProcessCount={managedProcesses.length}
        locale={desktopLocale}
        notesContent={<NotesPanel request={requestNotesPanel} />}
        cardsContent={<FlashcardsPanel request={requestCardsPanel} />}
        filesContent={
          <FileTreePanel
            projectPath={state.projectPath}
            request={(command) => hostClient.request(command)}
            onInsertPath={(absolutePath) => {
              setComposer((current) =>
                current.trim().length > 0
                  ? `${current.replace(/\s+$/, '')}\n${absolutePath}`
                  : absolutePath,
              );
            }}
          />
        }
        activityContent={
          <>
            <ContextWindowPanel
              usage={state.contextUsage}
              modelContextWindow={selectedModelContextWindow}
              locale={desktopLocale}
            />
            <TerminalDock
              entries={hostLogEntries}
              onClearLogs={() => setHostLogEntries([])}
              projectPath={state.projectPath}
              projectTrusted={state.projectTrusted}
              ptyOutput={ptyOutput}
              onClearPtyOutput={() => setPtyOutput([])}
              request={requestPty}
            />
          </>
        }
        reviewContent={
          <ReviewPanel
            changesContent={
              <ChangesPanel projectPath={state.projectPath} request={requestGit as never} />
            }
            gitContent={
              <GitPanel
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

      <AppDialogs
        projectInput={projectInput}
        onProjectInputChange={setProjectInput}
        projectPickerOpen={projectPickerOpen}
        onProjectPickerOpenChange={setProjectPickerOpen}
        onOpenProject={(path) => void handleOpenProject(path)}
        onBrowseProject={() => void handleBrowseProject()}
        projectPath={state.projectPath}
        trustDialogOpen={state.trustDialogOpen}
        onTrustProject={(trust) => void handleTrustProject(trust)}
        extensionUiRequest={extensionUiRequest}
        extensionUiInput={extensionUiInput}
        onExtensionUiInputChange={setExtensionUiInput}
        onExtensionUiResolve={(payload) => void handleExtensionUiResolve(payload)}
        sessionMenu={sessionMenu}
        onCloseSessionMenu={() => setSessionMenu(null)}
        sessions={state.sessions}
        showArchivedSessions={showArchivedSessions}
        onSessionMenuAction={(sessionId, action) => {
          if (action === 'delete') {
            const session = state.sessions.find((item) => item.id === sessionId);
            setDeleteConfirm({
              sessionId,
              sessionName: session?.name ?? sessionId.slice(0, 8),
            });
            setSessionMenu(null);
            return;
          }
          void handleSessionMenuAction(sessionId, action);
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
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={shell.setCommandPaletteOpen}
        hasProject={Boolean(state.projectPath)}
        projectTrusted={state.projectTrusted}
        hasActiveSession={Boolean(state.activeSessionId)}
        onRun={runDesktopCommand}
      />

      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) {
            setDeleteConfirm(null);
          }
        }}
        title="Delete permanently?"
        description="Transcript files will be removed. This cannot be undone."
        {...(deleteConfirm?.sessionName
          ? { affectedObject: deleteConfirm.sessionName }
          : {})}
        confirmLabel="Delete permanently"
        tone="danger"
        busy={deleteBusy}
        testId="session-delete-confirm"
        onConfirm={() => {
          if (!deleteConfirm) return;
          setDeleteBusy(true);
          void confirmDeleteSession(deleteConfirm.sessionId).finally(() => {
            setDeleteBusy(false);
            setDeleteConfirm(null);
          });
        }}
      />

      {settingsOpen ? (
        <SettingsPanel
          hostStatus={hostStatus}
          request={requestConfig}
          preferences={preferences}
          onPreferencesChange={(next) => {
            setPreferences(next);
            saveDesktopPreferences(next);
          }}
          initialSection={settingsSection}
          projectPath={state.projectPath}
          requestSkills={requestSkills}
          requestMcp={requestMcp}
          requestExtensions={requestExtensions}
          requestPrompts={requestPrompts}
          requestTheme={requestTheme}
          requestPet={requestPet}
          requestMemory={requestMemory}
          requestAutomation={requestAutomation}
          requestSubAgent={requestSubAgent as never}
          activeSessionId={state.activeSessionId}
          onOpenSubagentSession={(sessionId) => {
            void handleResumeSession(sessionId);
          }}
          onThemeApplied={(theme) => {
            const resolvedTheme = resolveDesktopAppearance(theme);
            setActiveTheme(resolvedTheme);
            applyThemeToDocument(resolvedTheme);
            setArtifactThemeKey((previous) => previous + 1);
          }}
          onPetActiveChanged={setActivePet}
          onSaved={(next) => {
            setConfig(next);
            if (next.defaultProviderId && next.defaultModelId) {
              setSelectedModelKey(`${next.defaultProviderId}::${next.defaultModelId}`);
            }
          }}
        />
      ) : null}
      </div>
    </DesktopLocaleProvider>
  );
}
