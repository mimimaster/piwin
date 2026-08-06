import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import { formatError } from '@piwin/contracts';
import {
  isJobActive,
  modeToPreset,
  resolvePreset,
} from '@piwin/contracts';
import type {
  PermissionPreset,
  PiwinConfig,
  ProjectRecord,
  SessionSearchHit,
  SettingsMutation,
  ThemeManifest,
  WalkthroughArtifact,
} from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, type SessionListItemUi } from './chat-reducer';
import { HostClient } from './host-client';
import { useHostRequestAdapters } from './host-request-adapters';
import { WorkspaceTitlebar } from './workspace-titlebar';
import { SettingsPanel } from './SettingsPanel';
import { NotificationRegion } from './NotificationRegion';
import { MainErrorBanner } from './main-error-banner';
import { ProjectSessionSidebar } from './project-session-sidebar';
import { projectDisplayName } from './project-display-name';
import { ChatThread } from './chat-thread';
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import { PermissionBar } from './permission-bar';
import { ExtensionUiPrompt } from './extension-ui-prompt';
import { FileTreePanel } from './file-tree-panel';
import { ReviewPanel } from './review-panel';
import { AppDialogs } from './app-dialogs';
import { createEmptyNotificationState, notificationReducer } from './notification-queue';
import { GitPanel } from './GitPanel';
import type { HostLogEntry } from './HostLogPanel';
import { NotesPanel } from './NotesPanel';
import { FlashcardsPanel } from './FlashcardsPanel';
import { KnowledgeCenterPanel } from './KnowledgeCenterPanel';
import { CanvasPanel } from './canvas-panel';
import { SideChatPanel } from './side-chat-panel';
import { DocPreviewPanel, type SessionDocItem } from './DocPreviewPanel';
import type { LineCommentItem } from './EnhancedMarkdownView';
import { mergeComposerWithDocComments } from './doc-comments';
import { RightPanel, type RightPanelTab } from './right-panel'; // right-panel portal v3
import { BrowserSessionPanel } from './browser-session-panel';
import { collectSessionTools } from './tool-call-card';
import { ChangesPanel } from './changes-panel';
import { TerminalDock, type PtyOutputLine } from './terminal-dock';
import { type AgentModeId } from './agent-mode';
import { groupSessionsByRecency } from './session-groups';
import {
  loadDesktopPreferences,
  resolveConversationWidth,
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
import { useSubagentSessionInspector } from './hooks/use-subagent-session-inspector';
import {
  selectActiveSubagents,
  type ActiveSubagentView,
  type SubagentInspectorSelection,
} from './subagent-activity-model';
import { SubagentWorkingDock } from './subagent-working-dock';
import { SubagentSessionDialog } from './subagent-session-dialog';
import { useJobs } from './hooks/use-jobs';
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

import { useRightPanelResize } from './hooks/use-right-panel-resize';
import { useSidebarResize } from './hooks/use-sidebar-resize';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';
import { SIDEBAR_DEFAULT_WIDTH_PX } from './sidebar-width';
import { resolveThinkingLevelForModel } from './model-thinking-policy';

import {
  ArtifactHeightSignalProvider,
  type ArtifactHeightSignalContextValue,
} from './artifact-height-signal';

type ModelOption = {
  providerId: string;
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  modelId: string;
  label: string;
  contextWindow?: number;
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  thinkingLevels?: readonly import('@piwin/contracts').ThinkingLevel[];
  reasoning?: boolean;
  supportsImage?: boolean;
  supportsImageGeneration?: boolean;
};

function modelsFromConfig(config: PiwinConfig | null): ModelOption[] {
  if (!config) {
    return [];
  }
  const options: ModelOption[] = [];
  for (const provider of config.providers) {
    for (const model of provider.models) {
      if (model.enabled === false) continue;
      options.push({
        providerId: provider.id,
        protocol: provider.protocol,
        modelId: model.id,
        label: `${provider.name} / ${model.label ?? model.id}`,
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
        ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}),
        ...(model.thinkingLevels ? { thinkingLevels: model.thinkingLevels } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
        ...(model.input?.includes('image') ? { supportsImage: true } : {}),
        ...(model.capabilities?.includes('image-generation')
          ? { supportsImageGeneration: true }
          : {}),
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

/** Merge two session lists, deduplicating by id (first occurrence wins). */
function mergeSessionsForLookup(
  primary: SessionListItemUi[],
  secondary: SessionListItemUi[],
): SessionListItemUi[] {
  const seen = new Set(primary.map((session) => session.id));
  return [...primary, ...secondary.filter((session) => !seen.has(session.id))];
}

export function App({ activeTheme, onThemeApplied }: AppProps) {
  const hostClient = useMemo(() => new HostClient({ transport: 'auto', hostMock: false }), []);
  const {
    requestConfig,
    requestSubAgent,
    requestSkills,
    requestExtensions,
    requestPlugins,
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
  const [ptyOutput, setPtyOutputBase] = useState<PtyOutputLine[]>([]);
  /** Quiet workbench: terminal produced output while directory home / panel collapsed. */
  const [terminalAttention, setTerminalAttention] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<'home' | 'detail'>('home');
  const [activeDocument, setActiveDocument] = useState<{
    title?: string | undefined;
    content?: string | undefined;
    filePath?: string | null | undefined;
  } | null>(null);
  const [documentPreviewTarget, setDocumentPreviewTarget] = useState<'stage' | 'inspector'>(
    'inspector',
  );

  const handleOpenDocument = useCallback(
    (
      doc: { title: string; path?: string; content?: string },
      target: 'stage' | 'inspector' = 'inspector',
    ) => {
      const filePath = doc.path ?? doc.title;
      const cleanPath = (filePath || '').replace(/^file:\/\//, '');
      const rawName = cleanPath ? cleanPath.split(/[\\/]/).pop() || doc.title : doc.title;
      const cleanTitle = (rawName || 'Implementation Plan').replace(/\.md$/i, '');

      setDocumentPreviewTarget(target);
      setActiveDocument({
        title: cleanTitle,
        content: doc.content || (filePath ? '加载文档内容中...' : undefined),
        filePath: cleanPath,
      });
      const inspectorTab = target === 'stage' ? 'files' : 'docPreview';
      shell.setInspectorTab(inspectorTab);
      if (!rightPanelOpen) {
        shell.openInspector(inspectorTab);
      }

      if (!doc.content && cleanPath) {
        // Search messages for inline tool outputs or message text as fallback
        const searchInMessages = (): string | null => {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const msg = state.messages[i];
            if (!msg) continue;
            if (msg.text && (msg.text.includes(cleanTitle) || msg.text.includes(cleanPath))) {
              const codeBlockMatch = new RegExp(
                '```(?:markdown|md)?\\n([\\s\\S]*?)\\n```',
                'i',
              ).exec(msg.text);
              if (codeBlockMatch && codeBlockMatch[1]) {
                return codeBlockMatch[1];
              }
            }
            for (const tool of msg.tools) {
              if (
                tool.output &&
                (tool.output.includes(cleanTitle) || tool.output.includes(cleanPath))
              ) {
                return tool.output;
              }
            }
          }
          return null;
        };

        // Determine projectPath & relativePath for host command
        let projPath = state.projectPath;
        let relPath = cleanPath;

        if (
          state.projectPath &&
          (cleanPath === state.projectPath ||
            cleanPath.startsWith(`${state.projectPath}/`) ||
            cleanPath.startsWith(`${state.projectPath}\\`))
        ) {
          projPath = state.projectPath;
          relPath = cleanPath.slice(state.projectPath.length).replace(/^[/\\]+/, '');
        } else if (cleanPath.startsWith('/')) {
          const lastSlash = cleanPath.lastIndexOf('/');
          if (lastSlash > 0) {
            projPath = cleanPath.slice(0, lastSlash);
            relPath = cleanPath.slice(lastSlash + 1);
          }
        } else if (state.projectPath && cleanPath.startsWith(state.projectPath)) {
          relPath = cleanPath.slice(state.projectPath.length).replace(/^[/\\]+/, '');
        }

        if (projPath) {
          void hostClient
            .request({
              type: 'project/read-file',
              projectPath: projPath,
              relativePath: relPath,
            })
            .then((response) => {
              if (response.success && response.data) {
                const fileData = response.data as { content?: string };
                if (typeof fileData.content === 'string') {
                  setActiveDocument({
                    title: cleanTitle,
                    content: fileData.content,
                    filePath: cleanPath,
                  });
                  return;
                }
              }
              const msgFallback = searchInMessages();
              setActiveDocument({
                title: cleanTitle,
                content: msgFallback || `# ${cleanTitle}\n\n*暂未在路径 ${cleanPath} 找到文件内容*`,
                filePath: cleanPath,
              });
            });
        } else {
          const msgFallback = searchInMessages();
          setActiveDocument({
            title: cleanTitle,
            content: msgFallback || `# ${cleanTitle}\n\n*暂未在路径 ${cleanPath} 找到文件内容*`,
            filePath: cleanPath,
          });
        }
      }
    },
    [hostClient, rightPanelOpen, shell, state.messages, state.projectPath],
  );

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
  const [remoteSearchHits, setRemoteSearchHits] = useState<SessionSearchHit[] | null>(null);
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

  // Terminal working directory state.
  // Initialized from saved preference, then falls back to project path or home.
  const [terminalCwd, setTerminalCwd] = useState<string>(() => {
    return preferences.terminalLastCwd || state.projectPath || '';
  });
  const [terminalRecentDirs, setTerminalRecentDirs] = useState<string[]>(() => {
    return preferences.terminalRecentDirs || [];
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
        '--sidebar-width': `${sidebarResize.widthPx}px`,
        '--right-panel-width': `${rightPanelResize.widthPx}px`,
      }) as React.CSSProperties,
    [preferencesStyle, sidebarResize.widthPx, rightPanelResize.widthPx],
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

  // Initialize terminal CWD from home directory when no project/preference is set.
  useEffect(() => {
    if (terminalCwd) return;
    let cancelled = false;
    void (async () => {
      try {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = await homeDir();
        if (!cancelled && home) {
          setTerminalCwd(home);
        }
      } catch {
        // Tauri API not available (browser mock) — use '/' as fallback.
        if (!cancelled) {
          setTerminalCwd('/');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [terminalCwd]);

  // Sync terminal CWD with the project path when a project is opened.
  useEffect(() => {
    if (state.projectPath && !preferences.terminalLastCwd) {
      setTerminalCwd(state.projectPath);
    }
  }, [state.projectPath, preferences.terminalLastCwd]);

  const handleTerminalCwdChange = useCallback(
    (cwd: string) => {
      const resolved = cwd || state.projectPath || '';
      setTerminalCwd(resolved);

      // Update recent directories.
      setTerminalRecentDirs((prev) => {
        const filtered = prev.filter((d) => d !== resolved);
        return [resolved, ...filtered].slice(0, 5);
      });

      // Persist to preferences immediately.
      setPreferences((prev) => {
        const filtered = (prev.terminalRecentDirs ?? []).filter((d) => d !== resolved);
        const next: DesktopPreferences = {
          ...prev,
          terminalLastCwd: resolved,
          terminalRecentDirs: [resolved, ...filtered].slice(0, 5),
        };
        saveDesktopPreferences(next);
        return next;
      });
    },
    [state.projectPath],
  );

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
  }, [hostClient, state.projectPath]);

  const {
    jobs,
    refreshJobs,
    appendJobLog: appendJobLogBase,
  } = useJobs(hostClient, {
    refreshWhenVisible: rightPanelOpen && shell.inspectorTab === 'terminal',
  });
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

  const markTerminalAttentionIfHidden = useCallback((): void => {
    // Hard rule: never auto-open the work panel; only pulse chrome.
    if (!watchingTerminalRef.current) {
      setTerminalAttention(true);
    }
  }, []);

  const appendJobLog = useCallback(
    (jobId: string, text: string): void => {
      appendJobLogBase(jobId, text);
      markTerminalAttentionIfHidden();
    },
    [appendJobLogBase, markTerminalAttentionIfHidden],
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
    setActivePet,
    sessionPlan,
    extensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
    clearExtensionUiRequest,
  } = useHostBootstrap({
    hostClient,
    dispatch,
    dispatchNotification,
    refreshJobs,
    appendJobLog,
    setPtyOutput,
    setHostLogEntries,
    setSelectedModelKey,
    onThemeResolved: onThemeApplied,
  });

  const sessionDocuments = useMemo<SessionDocItem[]>(() => {
    const items: SessionDocItem[] = [];
    const seenPaths = new Set<string>();

    const addDoc = (title: string, path?: string, iconKind?: 'doc' | 'book' | 'plan') => {
      const cleanTitle = (title || 'Document').replace(/\.md$/i, '');
      const docPath = path || title;
      if (seenPaths.has(docPath)) return;
      seenPaths.add(docPath);
      items.push({
        id: docPath,
        title: cleanTitle,
        ...(path ? { path } : {}),
        iconKind: iconKind || (cleanTitle.toLowerCase().includes('walkthrough') ? 'book' : 'doc'),
      });
    };

    if (sessionPlan) {
      addDoc(sessionPlan.title || 'Implementation Plan', 'implementation_plan.md', 'plan');
    }

    const pathRegex = /(?:file:\/\/|\/|[A-Za-z]:[\\/]|(?:\.\.?\/))+[\w\u4e00-\u9fa5_./-]+\.md\b/g;
    for (const msg of state.messages) {
      if (!msg) continue;
      const mdMatches = msg.text ? msg.text.match(pathRegex) : null;
      if (mdMatches) {
        for (const fullPath of mdMatches) {
          const baseName = fullPath.split(/[\\/]/).pop() || fullPath;
          addDoc(baseName, fullPath);
        }
      }
    }

    if (activeDocument?.title) {
      addDoc(activeDocument.title, activeDocument.filePath ?? activeDocument.title);
    }

    // Walkthrough documents: one virtual markdown doc per ready artifact
    // (spec §5.4). Path is virtual: walkthroughs/<message-id>.md.
    for (const messageId of Object.keys(state.walkthroughsByMessageId)) {
      const artifact = state.walkthroughsByMessageId[messageId];
      if (artifact && artifact.status === 'ready') {
        addDoc('Walkthrough', `walkthroughs/${messageId}.md`, 'book');
      }
    }

    return items;
  }, [sessionPlan, state.messages, activeDocument, state.walkthroughsByMessageId]);

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
                    `[piwin] open-source shell open failed: ${formatError(error)}`,
                  );
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
    void hostClient
      .request({ type: 'walkthrough/list', sessionId: state.activeSessionId })
      .then((response) => {
        if (!response.success) return;
        const data = response.data as { artifacts?: WalkthroughArtifact[] } | undefined;
        if (data?.artifacts) {
          dispatch({ type: 'walkthrough/hydrate', artifacts: data.artifacts });
        }
      });
    // Only re-run when the active session changes (not on every message delta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId, hostClient]);

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
    handleDuplicateSession,
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
    selectedModelKey,
    modelOptions,
    thinkingLevel,
    agentMode,
    setEditingMessageId,
    setRenameDraft,
    setHostLogEntries,
    // Composer setter is owned by useComposerMedia (declared later). Bridge via ref.
    setComposer: (value) => {
      composerSetterRef.current(value);
    },
  });
  /**
   * Ensure a chat session, resume it, then send a prompt for doc-card generation.
   * Used by DocCardsPanel to trigger flashcard generation via session/prompt.
   */
  const sendSessionPrompt = useCallback(
    async (text: string, title?: string) => {
      const sessionId = await ensureSession({
        scope: { kind: 'general' },
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

  // Resolve the effective model selection. Priority:
  //   1. composerProfile.model (per-desktop persisted selection)
  //   2. config.defaultProviderId / defaultModelId (product default)
  // When neither resolves to a live model option, clear the selection so the
  // composer falls back to host defaults instead of holding a stale key.
  useEffect(() => {
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
    setSelectedModelKey(resolvedKey);

    const requestedThinking = composerProfile?.thinkingLevel ?? resolved?.thinkingLevel ?? 'off';
    const resolvedThinking = resolveThinkingLevelForModel(
      resolved,
      requestedThinking,
      config?.thinking?.ultraEnabled === true,
    );
    setThinkingLevel(resolvedThinking ?? 'off');
  }, [
    config?.desktop?.composerProfile,
    config?.defaultProviderId,
    config?.defaultModelId,
    modelOptions,
  ]);

  const saveSettingsInOrder = useCallback(
    (buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[]): void => {
      configSaveQueue.current = configSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const currentResponse = await hostClient.request({ type: 'settings/get' });
          if (!currentResponse.success) {
            return;
          }
          const data = currentResponse.data as {
            snapshot?: { config: PiwinConfig; revision: string };
          };
          if (!data.snapshot) {
            return;
          }
          await hostClient.request({
            type: 'settings/apply',
            input: {
              expectedRevision: data.snapshot.revision,
              mutations: buildMutations(data.snapshot.config),
            },
          });
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
      saveSettingsInOrder((currentConfig) => [
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
    (nextModelKey: string): void => {
      const nextModel = modelOptions.find(
        (model) => `${model.providerId}::${model.modelId}` === nextModelKey,
      );
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
    [config?.thinking?.ultraEnabled, modelOptions, persistComposerProfile, thinkingLevel],
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
      saveSettingsInOrder(() => [
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
    saveSettingsInOrder((currentConfig) => [
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
    composer,
    setComposer,
    pendingAttachments,
    dropActive,
    setDropActive,
    revokePending,
    handleComposerPaste,
    handleComposerDrop,
    handlePickImageFiles,
    addWebElement,
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
    visionDelegationEnabled: config?.visionDelegation?.enabled === true,
    confirmTextOnlyImageSend: async (message) => {
      // Lightweight confirm; host still path-injects if user continues.
      return window.confirm(message);
    },
  });
  composerSetterRef.current = setComposer;

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

  async function handleToggleAppearance(): Promise<void> {
    // Quick toggle: dark ↔ light (black / white). Full theme list stays in Settings.
    const nextId = activeTheme.mode === 'light' ? 'piwin-dark' : 'piwin-light';
    const response = await hostClient.request({ type: 'theme/set-active', themeId: nextId });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const theme = (response.data as { theme: ThemeManifest }).theme;
    const nextPreferences: DesktopPreferences = {
      ...preferences,
      appearanceMode: theme.mode,
    };
    setPreferences(nextPreferences);
    saveDesktopPreferences(nextPreferences);
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

  // General sessions are maintained independently so the Conversations sidebar
  // section stays populated even when a project is active. Client-side filter
  // only — remote search is scope-specific and doesn't cover general sessions.
  const filteredGeneralSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) {
      return state.generalSessions;
    }
    return state.generalSessions.filter((session) => {
      const haystack = `${session.name} ${session.lastPreview ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [sessionSearch, state.generalSessions]);

  const sessionGroups = useMemo(() => groupSessionsByRecency(filteredSessions), [filteredSessions]);

  const sessionTools = useMemo(() => collectSessionTools(state.messages), [state.messages]);

  const runStatus = useMemo(
    () =>
      deriveRunStatus({
        chat: state,
        tools: sessionTools,
        plan: sessionPlan,
        jobs,
      }),
    [state, sessionTools, sessionPlan, jobs, runClock],
  );

  // Artifact height signal: bumped whenever an ArtifactFrame's iframe grows
  // via the postMessage height bridge. Included in activitySignal so the
  // transcript scroll system re-fires follow-tail scrolling even when the
  // markdown text length hasn't changed (e.g. SVG growing inside iframe).
  const [artifactHeightTick, setArtifactHeightTick] = useState(0);
  const artifactHeightSignal = useMemo<ArtifactHeightSignalContextValue>(
    () => ({
      notifyHeightChange: () => {
        setArtifactHeightTick((tick) => tick + 1);
      },
    }),
    [],
  );

  const activitySignal = useMemo(() => {
    const latestMessage = state.messages[state.messages.length - 1];
    const latestVisibleLength = latestMessage
      ? latestMessage.text.length + latestMessage.thinking.length
      : 0;
    const toolStates = sessionTools
      .map((tool) => `${tool.toolCallId}:${tool.status}:${tool.output.length}`)
      .join(',');
    return `${state.runPhase}:${state.messages.length}:${latestVisibleLength}:${toolStates}:ah${artifactHeightTick}`;
  }, [state.runPhase, state.messages, sessionTools, artifactHeightTick]);

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
  const activeSessionOrigin =
    state.sessions.find((item) => item.id === state.activeSessionId)?.origin ?? null;
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
    docCommentsAttachment:
      activeComments.length > 0
        ? {
            docTitle: activeDocument?.title || 'Document',
            commentCount: activeComments.length,
          }
        : null,
    onRemoveDocComments: () => {
      setDocComments((prev) => ({
        ...prev,
        [activeDocKey]: [],
      }));
    },
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
    onRefreshComposerMenus: () => {
      void refreshComposerMenus();
    },
    onOpenSkillsPanel: () => openSettingsSection('skills'),
    onOpenMcpPanel: () => openSettingsSection('tools'),
    onAttachImage: () => void handlePickImageFiles(),
    onPaste: (event) => void handleComposerPaste(event),
    onDrop: (event) => void handleComposerDrop(event),
    onSend: () => void handleSendWithComments(),
    onSteer: () => void handleSteer(),
    onFollowUp: () => void handleFollowUp(),
    extensionUiRequest,
    extensionUiInput,
    onExtensionUiInputChange: setExtensionUiInput,
    onExtensionUiResolve: (payload) => void handleExtensionUiResolve(payload),
    onExtensionUiAbort: () => void handleExtensionUiAbort(),
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
    hostStatus,
    hostReady: state.hostReady,
    hostMock: state.hostMock,
    transportLabel: hostClient.getTransport(),
    onOpenHostSettings: () => openSettingsSection('general'),
    runModePreset: effectiveRunMode,
    onRunModeChange: handleRunModeChange,
    onRunModeSetDefault: handleRunModeSetDefault,
    onOpenPermissionsSettings: () => openSettingsSection('permissions'),
    runModeYoloDisabled: state.projectPath !== null && !state.projectTrusted,
  };

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
  // Shared activity model drives the dock/ticker; every entry opens the same
  // read-only inspector so no surface interprets lifecycle state itself.
  const activeSubagentViews = useMemo<ActiveSubagentView[]>(
    () =>
      state.activeSessionId !== null
        ? selectActiveSubagents({
            parentSessionId: state.activeSessionId,
            children: state.subagentChildren,
            streams: state.subagentStreams,
          })
        : [],
    [state.activeSessionId, state.subagentChildren, state.subagentStreams],
  );
  const handleCancelMessageEdit = useCallback((): void => {
    setEditingMessageId(null);
  }, []);
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
  const handleRetryMessage = useCallback(
    (messageId: string): void => {
      const msg = state.messages.find((m) => m.id === messageId);
      if (!msg) return;
      if (preferences.dontAskRevertConfirm) {
        void handleRetryFromMessage(messageId);
        return;
      }
      setPendingRevertEdit({ messageId, text: msg.text, isEdit: false });
    },
    [handleRetryFromMessage, preferences.dontAskRevertConfirm, state.messages],
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

  const handlePlanExecute = useCallback(
    async (mode: import('@piwin/contracts').PlanExecutionMode): Promise<void> => {
      if (!state.activeSessionId || !sessionPlan) return;
      const response = await hostClient.request({
        type: 'plan/execute',
        request: {
          sessionId: state.activeSessionId,
          planId: sessionPlan.id,
          mode,
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
          sessionName={activeSessionName}
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
              projectsSectionCollapsed={preferences.projectsSectionCollapsed === true}
              onToggleProjectsSection={() => {
                const nextPreferences: DesktopPreferences = {
                  ...preferences,
                  projectsSectionCollapsed: !(preferences.projectsSectionCollapsed === true),
                };
                setPreferences(nextPreferences);
                saveDesktopPreferences(nextPreferences);
              }}
              sessions={state.sessions}
              filteredSessions={filteredSessions}
              generalSessions={filteredGeneralSessions}
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
                  // Also refresh general sessions so the Conversations section
                  // respects the archive filter while a project is active.
                  void hydrateSessions({ kind: 'general' }, { includeArchived: next });
                } else {
                  void hydrateSessions({ kind: 'general' }, { includeArchived: next });
                }
              }}
              settingsOpen={settingsOpen}
              onOpenWorkspace={() => void handleOpenWorkspaceClick()}
              onOpenProject={(path) => void handleOpenProject(path)}
              onNewSession={() => void handleNewSession()}
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
                  await handleNewSession({ scope: { kind: 'general' } });
                })();
              }}
              onResumeSession={(sessionId) => void handleResumeSession(sessionId)}
              onOpenSessionMenu={(sessionId, x, y) => setSessionMenu({ sessionId, x, y })}
              onTogglePin={(sessionId, currentlyPinned) =>
                void handleSessionMenuAction(sessionId, currentlyPinned ? 'unpin' : 'pin')
              }
              onArchiveSession={(sessionId) => void handleSessionMenuAction(sessionId, 'archive')}
              onUnarchiveSession={(sessionId) =>
                void handleSessionMenuAction(sessionId, 'unarchive')
              }
              onDeleteSession={(sessionId) => {
                const session = mergeSessionsForLookup(state.sessions, state.generalSessions).find(
                  (item) => item.id === sessionId,
                );
                setDeleteConfirm({
                  sessionId,
                  sessionName: session?.name ?? sessionId.slice(0, 8),
                });
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
              permissionMode={config?.permissions?.preset ?? configPreset}
              onOpenPermissions={() => openSettingsSection('permissions')}
              locale={desktopLocale}
              {...(activeSessionOrigin ? { origin: activeSessionOrigin } : {})}
              {...(activeSessionOrigin?.kind === 'fork'
                ? {
                    onReturnToRoot: () =>
                      void handleResumeSession(activeSessionOrigin.rootSessionId),
                  }
                : {})}
            />
          }
          chatColumnClassName={composerLayoutMode === 'centered' ? 'chat-column-empty' : undefined}
          activityDock={
            activeSubagentViews.length > 0 ? (
              <SubagentWorkingDock items={activeSubagentViews} onInspect={handleInspectSubagent} />
            ) : undefined
          }
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
                    onNewAgent={() => void handleNewSession()}
                  />
                </div>
              ) : null}
              {documentPreviewTarget === 'stage' && activeDocument ? (
                <div className="workspace-document-stage" data-testid="workspace-document-stage">
                  <DocPreviewPanel
                    title={activeDocument.title}
                    content={activeDocument.content}
                    filePath={activeDocument.filePath}
                    sessionDocuments={sessionDocuments}
                    onClose={() => {
                      setActiveDocument(null);
                      setDocumentPreviewTarget('inspector');
                    }}
                    onOpenFile={(filePath) => {
                      handleOpenDocument(
                        {
                          title: filePath.split(/[\\/]/).pop() || filePath,
                          path: filePath,
                        },
                        'stage',
                      );
                    }}
                    onCommentLine={handleCommentLine}
                    comments={activeComments}
                    onAddComment={handleAddDocComment}
                    onEditComment={handleEditDocComment}
                    onDeleteComment={handleDeleteDocComment}
                    onSelectDocument={(doc) => {
                      const walkthroughMatch = doc.path?.match(/^walkthroughs\/(.+)\.md$/);
                      const walkthroughArtifact = walkthroughMatch
                        ? state.walkthroughsByMessageId[walkthroughMatch[1] as string]
                        : undefined;
                      handleOpenDocument(
                        {
                          title: doc.title,
                          ...(doc.path ? { path: doc.path } : {}),
                          ...(walkthroughArtifact?.status === 'ready'
                            ? { content: walkthroughArtifact.markdown }
                            : {}),
                        },
                        'stage',
                      );
                    }}
                    locale={desktopLocale}
                  />
                </div>
              ) : (
                <TranscriptViewport
                  messageCount={state.messages.length}
                  activitySignal={activitySignal}
                  messages={state.messages}
                >
                  <ArtifactHeightSignalProvider value={artifactHeightSignal}>
                    {state.messages.length > 0 ? (
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
                        onInspectSubagent={handleInspectSubagent}
                        onEdit={setEditingMessageId}
                        onCancelEdit={handleCancelMessageEdit}
                        onEditResend={handleEditAndResendMessage}
                        onRetry={handleRetryMessage}
                        onFeedback={handleMessageFeedback}
                        onArtifactAction={handleArtifactAction}
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
                        derivedActionsDisabled={!state.activeSessionId || state.streaming}
                      />
                    ) : null}
                  </ArtifactHeightSignalProvider>
                </TranscriptViewport>
              )}
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
            </>
          }
          permissionBar={
            state.permissionPrompt ? (
              <PermissionBar
                prompt={state.permissionPrompt}
                projectPath={state.projectPath}
                onPermission={(decision, scope) => {
                  void handlePermission(decision, scope);
                }}
              />
            ) : extensionUiRequest ? (
              <ExtensionUiPrompt
                request={extensionUiRequest}
                onResolve={(payload) => void handleExtensionUiResolve(payload)}
              />
            ) : null
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
                runningJobCount={jobs.length}
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
                    onOpenFile={(absolutePath, relativePath) => {
                      handleOpenDocument({
                        title: relativePath.split(/[\\/]/).pop() || relativePath,
                        path: absolutePath,
                      }, 'stage');
                    }}
                    locale={desktopLocale}
                  />
                }
                canvasContent={<CanvasPanel />}
                browserContent={
                  <BrowserSessionPanel
                    hostClient={hostClient}
                    onAddWebElement={addWebElement}
                    agentRunning={state.streaming}
                  />
                }
               sideChatContent={<SideChatPanel sessionId={state.activeSessionId} hostClient={hostClient} />}
                docPreviewContent={
                  <DocPreviewPanel
                    title={activeDocument?.title}
                    content={activeDocument?.content}
                    filePath={activeDocument?.filePath}
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
                      // Walkthrough virtual docs: resolve markdown content from the
                      // in-memory artifact map (path: walkthroughs/<message-id>.md).
                      const walkthroughMatch = doc.path?.match(/^walkthroughs\/(.+)\.md$/);
                      const walkthroughArtifact = walkthroughMatch
                        ? state.walkthroughsByMessageId[walkthroughMatch[1] as string]
                        : undefined;
                      handleOpenDocument({
                        title: doc.title,
                        ...(doc.path ? { path: doc.path } : {}),
                        ...(walkthroughArtifact?.status === 'ready'
                          ? { content: walkthroughArtifact.markdown }
                          : {}),
                      });
                    }}
                    locale={desktopLocale}
                  />
                }
                terminalContent={
                  <TerminalDock
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
                  <ReviewPanel
                    changesContent={
                      <ChangesPanel
                        projectPath={state.projectPath}
                        request={requestGit as never}
                        onOpenFile={(absolutePath, relativePath) => {
                          handleOpenDocument(
                            {
                              title: relativePath.split(/[\\/]/).pop() || relativePath,
                              path: absolutePath,
                            },
                            'stage',
                          );
                        }}
                      />
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
          onOpenProject={(path) => {
            if (path) {
              void handleOpenProject(path);
            }
          }}
          onBrowseProject={() => void handleBrowseProject()}
          projectPath={state.projectPath}
          trustDialogOpen={state.trustDialogOpen}
          onTrustProject={(trust) => void handleTrustProject(trust)}
          sessionMenu={sessionMenu}
          onCloseSessionMenu={() => setSessionMenu(null)}
          sessions={mergeSessionsForLookup(state.sessions, state.generalSessions)}
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
                Later messages will be removed from this chat. File changes on disk are not undone.
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

        {settingsOpen ? (
          <SettingsPanel
            hostStatus={hostStatus}
            hostClient={hostClient}
            request={requestConfig}
            preferences={preferences}
            activeTheme={activeTheme}
            onPreferencesChange={(next) => {
              setPreferences(next);
              saveDesktopPreferences(next);
            }}
            initialSection={settingsSection}
            onSectionChange={shell.setSettingsSection}
            projectPath={state.projectPath}
            projectTrusted={state.projectTrusted}
            requestSkills={requestSkills}
            requestMcp={requestMcp}
            requestExtensions={requestExtensions}
            requestPlugins={requestPlugins}
            requestPrompts={requestPrompts}
            requestTheme={requestTheme}
            requestPet={requestPet}
            requestAutomation={requestAutomation}
            requestSubAgent={requestSubAgent as never}
            subagentChildren={state.subagentChildren}
            subagentBatches={state.subagentBatches}
            activeSessionId={state.activeSessionId}
            onOpenSubagentSession={(sessionId) => {
              void handleResumeSession(sessionId);
            }}
            onThemeApplied={onThemeApplied}
            onPetActiveChanged={setActivePet}
            onClose={shell.closeSettings}
            onSaved={(next) => {
              setConfig(next);
              if (next.defaultProviderId && next.defaultModelId) {
                setSelectedModelKey(`${next.defaultProviderId}::${next.defaultModelId}`);
              }
            }}
          />
        ) : null}
        <SubagentSessionDialog
          open={inspector.selection !== null}
          selection={inspector.selection}
          status={inspector.status}
          messages={inspector.messages}
          liveTail={inspector.liveTail}
          loading={inspector.loading}
          error={inspector.error}
          showThinking={preferences.verboseAgentChat}
          onOpenChange={(open) => {
            if (!open) {
              inspector.closeInspector();
            }
          }}
          onOpenFullSession={inspector.openFullSession}
          onRetry={inspector.retryLoad}
        />
      </div>
    </DesktopLocaleProvider>
  );
}
