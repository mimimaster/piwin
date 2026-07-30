import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type SetStateAction,
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
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import { FileTreePanel } from './file-tree-panel';
import { ReviewPanel } from './review-panel';
import { AppDialogs } from './app-dialogs';
import { ChatEmptyState } from './chat-empty-state';
import { createEmptyNotificationState, notificationReducer } from './notification-queue';
import { GitPanel } from './GitPanel';
import type { HostLogEntry } from './HostLogPanel';
import { NotesPanel } from './NotesPanel';
import { FlashcardsPanel } from './FlashcardsPanel';
import { KnowledgeCenterPanel } from './KnowledgeCenterPanel';
import { BrowserPanel } from './browser-panel';
import { CanvasPanel } from './canvas-panel';
import { SideChatPanel } from './side-chat-panel';
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
import { Button, ConfirmDialog, Dialog, IconButton, Notice } from '@piwin/ui-kit';
import { IconClose } from './shell-icons';
import { useShellLayout, type ShellSettingsSection } from './hooks/use-shell-layout';
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
import { PetSprite } from './components/PetSprite';

import { useRightPanelResize } from './hooks/use-right-panel-resize';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';

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

export type AppProps = {
  /** Resolved active manifest owned by DesktopThemeRoot. */
  activeTheme: ThemeManifest;
  /** Root callback that resolves, applies document tokens, and stores a manifest. */
  onThemeApplied: (theme: ThemeManifest) => void;
};

export function App({ activeTheme, onThemeApplied }: AppProps) {
  const hostClient = useMemo(() => new HostClient({ transport: 'auto', hostMock: false }), []);
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
  // Panel width only drives CSS --right-panel-width (in-flow stage reflow).
  // No OS setSize — that path re-rasters the whole shell on every toggle.
  const rightPanelResizeOptions = useMemo(
    () => ({
      layoutMode,
      navDrawerOpen,
    }),
    [layoutMode, navDrawerOpen],
  );
  const rightPanelResize = useRightPanelResize(rightPanelResizeOptions);
  const [, setHostLogEntries] = useState<HostLogEntry[]>([]);
  const [ptyOutput, setPtyOutputBase] = useState<PtyOutputLine[]>([]);
  /** Quiet workbench: terminal produced output while directory home / panel collapsed. */
  const [terminalAttention, setTerminalAttention] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<'home' | 'detail'>('home');
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const watchingTerminalRef = useRef(false);
  watchingTerminalRef.current =
    rightPanelOpen && rightPanelTab === 'terminal' && rightPanelView === 'detail';
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
  // Pending edit-and-resend from a non-last user message. When set, the revert
  // confirmation dialog is open; confirming executes the truncate + resend.
  const [pendingRevertEdit, setPendingRevertEdit] = useState<{
    messageId: string;
    text: string;
  } | null>(null);
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
    () =>
      ({
        ...preferencesStyle,
        '--right-panel-width': `${rightPanelResize.widthPx}px`,
      }) as React.CSSProperties,
    [preferencesStyle, rightPanelResize.widthPx],
  );
  const [desktopLocale, setDesktopLocale] = useState<DesktopLocale>(() => loadDesktopLocale());
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusSubmenu, setPlusSubmenu] = useState<ComposerPlusSubmenu>('none');
  const [menuSkills, setMenuSkills] = useState<
    Array<{ id: string; name: string; enabled: boolean }>
  >([]);
  const [menuMcp, setMenuMcp] = useState<Array<{ id: string; name: string; running: boolean }>>([]);
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [thinkingLevel, setThinkingLevel] =
    useState<import('@piwin/contracts').ThinkingLevel>('off');
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
    appendProcessLog: appendProcessLogBase,
  } = useManagedProcesses(hostClient, {
    refreshWhenVisible: rightPanelOpen && shell.inspectorTab === 'terminal',
  });

  const markTerminalAttentionIfHidden = useCallback((): void => {
    // Hard rule: never auto-open the work panel; only pulse chrome.
    if (!watchingTerminalRef.current) {
      setTerminalAttention(true);
    }
  }, []);

  const appendProcessLog = useCallback(
    (processId: string, text: string): void => {
      appendProcessLogBase(processId, text);
      markTerminalAttentionIfHidden();
    },
    [appendProcessLogBase, markTerminalAttentionIfHidden],
  );

  const setPtyOutput = useCallback(
    (value: SetStateAction<PtyOutputLine[]>): void => {
      setPtyOutputBase((current) => {
        const next = typeof value === 'function' ? value(current) : value;
        // Only new lines (not clear/replace-empty) raise directory attention.
        if (next.length > current.length) {
          queueMicrotask(() => {
            markTerminalAttentionIfHidden();
          });
        }
        return next;
      });
    },
    [markTerminalAttentionIfHidden],
  );

  const {
    hostStatus,
    config,
    setConfig,
    activePet,
    setActivePet,
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
    onThemeResolved: onThemeApplied,
  });

  // Remount artifact iframes when the active theme changes so sandboxed
  // documents pick up new artifact variables (root owns the manifest itself).
  const [artifactThemeKey, setArtifactThemeKey] = useState(0);
  useEffect(() => {
    setArtifactThemeKey((previous) => previous + 1);
  }, [activeTheme]);

  const modelOptions = useMemo(() => modelsFromConfig(config), [config]);

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
                  console.warn(
                    `[piwin] open-source shell open failed: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  );
                });
            }
          });
      }
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
  // Knowledge Center forwards commands to the same host transport; the panel
  // accepts a union type internally.
  const requestKnowledgeCenter = useCallback(
    (
      command: Parameters<import('./KnowledgeCenterPanel').KnowledgeCenterPanelProps['request']>[0],
    ) => hostClient.request(command as unknown as Parameters<typeof hostClient.request>[0]),
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
  /**
   * Ensure a chat session, resume it, then send a prompt for doc-card generation.
   * Used by DocCardsPanel to trigger flashcard generation via session/prompt.
   */
  const sendSessionPrompt = useCallback(
    async (text: string, title?: string) => {
      const sessionId = await ensureSession({
        scope: { kind: 'general' },
        executionMode: 'chat',
        ...(title ? { sessionName: title } : {}),
      });
      if (!sessionId) {
        throw new Error('Could not create a chat session for doc-card generation.');
      }
      await handleResumeSession(sessionId);
      await hostClient.request({
        type: 'session/prompt',
        sessionId,
        input: { text },
      });
    },
    [ensureSession, handleResumeSession, hostClient],
  );

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
  }, [
    config?.desktop?.lastSession,
    dispatch,
    handleOpenProject,
    handleResumeSession,
    hydrateSessions,
    state.hostReady,
  ]);

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
    const nextId = activeTheme.mode === 'light' ? 'piwin-dark' : 'piwin-light';
    const response = await hostClient.request({ type: 'theme/set-active', themeId: nextId });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const theme = (response.data as { theme: ThemeManifest }).theme;
    onThemeApplied(theme);
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

  function openSettingsSection(section: ShellSettingsSection): void {
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
        openRightTab('terminal');
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

  const sessionGroups = useMemo(() => groupSessionsByRecency(filteredSessions), [filteredSessions]);

  const sessionTools = useMemo(() => collectSessionTools(state.messages), [state.messages]);

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

  // Shared composer card props for the bottom dock and in-place message editing.
  // Local state fields (composer text, attachments, plus menu, etc.) are overridden
  // by the bottom dock or the edit card; this bundle carries the global config.
  const composerCard: ComposerDockProps = {
    layoutMode: composerLayoutMode,
    projectPath: state.projectPath,
    projectTrusted: state.projectTrusted,
    activeSessionId: state.activeSessionId,
    streaming: state.streaming,
    runPhase: state.runPhase,
    compacting: state.compacting,
    composer,
    onComposerChange: setComposer,
    agentMode,
    onAgentModeChange: setAgentMode,
    pendingAttachments,
    onRemoveAttachment: revokePending,
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
    menuSkills,
    menuMcp,
    onRefreshComposerMenus: () => {
      void refreshComposerMenus();
    },
    onOpenSkillsPanel: () => openSettingsSection('skills'),
    onOpenMcpPanel: () => openSettingsSection('tools'),
    onAttachImage: () => void handlePickImageFiles(),
    onPaste: (event) => void handleComposerPaste(event),
    onDrop: (event) => void handleComposerDrop(event),
    onSend: () => void handleSend(),
    onSteer: () => void handleSteer(),
    onFollowUp: () => void handleFollowUp(),
    thinkingLevel,
    onThinkingLevelChange: handleThinkingLevelChange,
    ultraThinkingEnabled: config?.thinking?.ultraEnabled === true,
    onAbort: () => void handleAbort(),
    onCompact: () => void handleCompact(),
    compactionSupported: hostStatus?.capabilities?.compaction !== false,
    contextUsage: state.contextUsage,
    ...(typeof selectedModelContextWindow === 'number'
      ? { modelContextWindow: selectedModelContextWindow }
      : {}),
    onOpenModelSettings: () => openSettingsSection('models'),
  };

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
      // Editing the last user message sends immediately — no history is lost.
      // Editing an earlier message opens the revert confirmation dialog first,
      // because truncate-from will discard everything after that message.
      if (messageId === lastUserMessageId) {
        void handleEditAndResend(messageId, text);
        return;
      }
      setPendingRevertEdit({ messageId, text });
    },
    [handleEditAndResend, lastUserMessageId],
  );
  // Revert = truncate session at the edited message and resend the new text.
  const handleConfirmRevertEdit = useCallback((): void => {
    if (!pendingRevertEdit) return;
    const { messageId, text } = pendingRevertEdit;
    setPendingRevertEdit(null);
    void handleEditAndResend(messageId, text);
  }, [handleEditAndResend, pendingRevertEdit]);
  // Don't revert = exit edit mode without sending (no truncate, no resend).
  const handleDeclineRevertEdit = useCallback((): void => {
    setPendingRevertEdit(null);
    setEditingMessageId(null);
  }, []);
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

  return (
    <DesktopLocaleProvider
      locale={desktopLocale}
      onLocaleChange={(locale) => {
        setDesktopLocale(locale);
        saveDesktopLocale(locale);
      }}
    >
      <div
        className={`app-shell workbench${rightPanelOpen ? ' has-right-panel' : ''}${navDrawerOpen ? ' nav-open' : ''}${settingsOpen ? ' settings-open' : ''}${knowledgeOpen ? ' knowledge-open' : ''}`}
        style={appShellStyle}
        data-testid="app-shell"
        data-layout={layoutMode}
        data-right={rightPanelOpen ? 'expanded' : 'collapsed'}
        data-settings-open={settingsOpen ? 'true' : 'false'}
        data-knowledge-open={knowledgeOpen ? 'true' : 'false'}
      >
        <NotificationRegion
          items={notificationState.items}
          onDismiss={(id) => dispatchNotification({ type: 'notify/dismiss', id })}
        />

        <WorkspaceTitlebar
          executionMode={executionMode}
          onExecutionModeChange={setExecutionMode}
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
              onViewActivity={() => openRightTab('terminal')}
              onReviewPermission={() => {
                // Focus the inline permission gate in the stream when present.
                const gate = document.querySelector<HTMLElement>('[data-testid="permission-gate"]');
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
              permissionMode={config?.permissions?.mode ?? null}
              onOpenPermissions={() => openSettingsSection('permissions')}
              locale={desktopLocale}
            />
          }
          chatColumnClassName={composerLayoutMode === 'centered' ? 'chat-column-empty' : undefined}
          knowledgePanel={
            knowledgeOpen ? (
              <section
                className="knowledge-stage"
                data-testid="knowledge-stage"
                aria-label={desktopCopy.knowledgeCenter}
              >
                <header className="knowledge-stage-header">
                  <span className="knowledge-stage-kicker">{desktopCopy.knowledgeCenter}</span>
                  <IconButton
                    label={desktopLocale === 'zh-CN' ? '关闭知识中心' : 'Close Knowledge Center'}
                    data-testid="knowledge-stage-close-btn"
                    onClick={() => setKnowledgeOpen(false)}
                  >
                    <IconClose />
                  </IconButton>
                </header>
                <div className="knowledge-stage-body">
                  <KnowledgeCenterPanel
                    projectPath={state.projectPath}
                    request={requestKnowledgeCenter}
                    sendSessionPrompt={sendSessionPrompt}
                  />
                </div>
              </section>
            ) : undefined
          }
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
                    projectPath={state.projectPath}
                    toolDiffRequest={requestGit as never}
                    onPermission={(decision, scope) => {
                      void handlePermission(decision, scope);
                    }}
                    workDetailsExpanded={preferences.workDetailsExpanded}
                    toolDensity={preferences.toolDensity}
                    artifactPreviewEnabled={preferences.artifactPreviewEnabled}
                    plan={sessionPlan}
                    {...(config?.artifact?.maxBytes !== undefined
                      ? { artifactMaxBytes: config.artifact.maxBytes }
                      : {})}
                    locale={desktopLocale}
                    onOpenSubagentSession={handleOpenSubagentSession}
                    onEdit={setEditingMessageId}
                    onCancelEdit={handleCancelMessageEdit}
                    onEditResend={handleEditAndResendMessage}
                    onRetry={handleRetryMessage}
                    onFeedback={handleMessageFeedback}
                    onArtifactAction={handleArtifactAction}
                    composerCard={composerCard}
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
              {state.error ? (
                <Notice tone="error" testId="chat-error-notice">
                  {state.error}
                </Notice>
              ) : null}
            </>
          }
          composerDock={<ComposerDock {...composerCard} />}
          statusBar={
            <StatusBar
              modelLabel={selectedModelLabel}
              skillsCount={menuSkills.filter((s) => s.enabled).length}
              mcpCount={menuMcp.filter((m) => m.running).length}
              agentState={state.streaming ? 'running' : state.error ? 'error' : 'idle'}
              terminalAttention={terminalAttention}
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
                terminalAttention={terminalAttention}
                onTerminalAttentionClear={() => setTerminalAttention(false)}
                onViewChange={setRightPanelView}
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
                browserContent={<BrowserPanel />}
                canvasContent={<CanvasPanel />}
                sideChatContent={<SideChatPanel sessionId={state.activeSessionId} />}
                terminalContent={
                  <TerminalDock
                    projectPath={state.projectPath}
                    projectTrusted={state.projectTrusted}
                    ptyOutput={ptyOutput}
                    onClearPtyOutput={() => setPtyOutput([])}
                    request={requestPty}
                  />
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
          {...(deleteConfirm?.sessionName ? { affectedObject: deleteConfirm.sessionName } : {})}
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

        {/* Revert confirmation when editing/resending a non-last user message.
            Three actions: Cancel (stay in edit), Don't revert (exit edit, no
            resend), Revert (truncate session at the message and resend). */}
        <Dialog
          label="Submit from a previous message?"
          open={Boolean(pendingRevertEdit)}
          onOpenChange={(open) => {
            if (!open) {
              // Esc / backdrop: just close the dialog, keep edit mode intact
              // so the user can reconsider without losing their draft.
              setPendingRevertEdit(null);
            }
          }}
          testId="revert-edit-confirm"
        >
          <h3>Submit from a previous message?</h3>
          <div className="ui-confirm-description muted">
            Submitting from a previous message will revert file changes to before this message and
            clear the messages after this one.
          </div>
          <div className="modal-actions">
            <Button data-testid="revert-edit-cancel" onClick={() => setPendingRevertEdit(null)}>
              Cancel
            </Button>
            <Button data-testid="revert-edit-decline" onClick={handleDeclineRevertEdit}>
              Don&apos;t revert
            </Button>
            <Button
              variant="danger"
              data-testid="revert-edit-confirm"
              onClick={handleConfirmRevertEdit}
            >
              Revert
            </Button>
          </div>
        </Dialog>

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
            projectTrusted={state.projectTrusted}
            requestSkills={requestSkills}
            requestMcp={requestMcp}
            requestExtensions={requestExtensions}
            requestPrompts={requestPrompts}
            requestTheme={requestTheme}
            requestPet={requestPet}
            requestAutomation={requestAutomation}
            requestSubAgent={requestSubAgent as never}
            activeSessionId={state.activeSessionId}
            onOpenSubagentSession={(sessionId) => {
              void handleResumeSession(sessionId);
            }}
            onThemeApplied={onThemeApplied}
            onPetActiveChanged={setActivePet}
            onSaved={(next) => {
              setConfig(next);
              if (next.defaultProviderId && next.defaultModelId) {
                setSelectedModelKey(`${next.defaultProviderId}::${next.defaultModelId}`);
              }
            }}
          />
        ) : null}

        {activePet ? (
          <PetSprite
            pet={activePet}
            onOpenSettings={() => openSettingsSection('general')}
            onToggleOverlay={async () => {
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('pet_overlay_toggle');
              } catch {
                // not in Tauri — ignore
              }
            }}
          />
        ) : null}
      </div>
    </DesktopLocaleProvider>
  );
}
