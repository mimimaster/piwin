/**
 * Shell chrome: layout, panel resize, session-list query, locale, and
 * foreground-run confirms. Host commands stay with App / session hooks.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import {
  ORCHESTRATION_SCHEME_OFF_ID,
  type ForegroundRunMismatchProblem,
  type ModelRef,
  type ThinkingLevel,
} from '@piwin/contracts';
import type { AgentModeId } from '../agent-mode';
import type { ChatUiState } from '../chat-reducer';
import { getDesktopCopy, loadDesktopLocale, type DesktopLocale } from '../desktop-locale';
import type { HostClient } from '../host-client';
import { useComposerPlusMenu } from './use-composer-plus-menu';
import { useRightPanelResize } from './use-right-panel-resize';
import { useSessionListChrome } from './use-session-list-chrome';
import { useSessionListQuery } from './use-session-list-query';
import { isOverlayShellLayout } from '../shell-layout';
import { useShellLayout } from './use-shell-layout';
import { loadSidebarMode, saveSidebarMode, type SidebarMode } from '../sidebar-mode';
import { useSidebarResize } from './use-sidebar-resize';
import { useTerminalPanelState } from './use-terminal-panel-state';
import type { RightPanelTab } from '../right-panel';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from '../right-panel-width';
import { useConfirmDialog } from '../use-confirm-dialog';
import { loadDesktopPreferences, type DesktopPreferences } from '../ui-preferences';
import { appShellCssVars, desktopPreferencesCssVars } from '../workbench-preferences-style';

export type UseWorkbenchShellChromeArgs = {
  hostClient: HostClient;
  state: ChatUiState;
};

export function useWorkbenchShellChrome(args: UseWorkbenchShellChromeArgs) {
  const { hostClient, state } = args;
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
    inspectorPlacement,
  } = shell;
  const isOverlayPresentation = isOverlayShellLayout(layoutMode);
  const inspectorOverlay = isOverlayPresentation || inspectorPlacement === 'overlay';
  const rightPanelWidthRef = useRef(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  const [rightPanelView, setRightPanelView] = useState<'home' | 'detail'>('home');
  const sidebarResize = useSidebarResize({
    layoutMode,
    rightPanelOpen,
    rightPanelWidthPx: rightPanelWidthRef.current,
    onCollapseRequest: shell.collapseSessions,
    onExpandRequest: shell.expandSessions,
  });
  const rightPanelResize = useRightPanelResize({
    layoutMode,
    navDrawerOpen,
    sidebarWidthPx: sidebarResize.widthPx,
    onCollapseRequest: shell.closeOverlay,
    onExpandRequest: () => shell.openInspector(rightPanelTab),
    canEnterFullWidth: rightPanelView === 'detail' && inspectorPlacement === 'column',
  });
  if (rightPanelWidthRef.current !== rightPanelResize.widthPx) {
    rightPanelWidthRef.current = rightPanelResize.widthPx;
  }
  useEffect(() => {
    if (!rightPanelOpen) {
      rightPanelResize.setFullWidth(false);
    }
  }, [rightPanelOpen, rightPanelResize.setFullWidth]);
  const revealDocPreview = useCallback(() => {
    const inspectorTab: RightPanelTab = 'docPreview';
    shell.setInspectorTab(inspectorTab);
    if (!rightPanelOpen) {
      shell.openInspector(inspectorTab);
    }
  }, [rightPanelOpen, shell]);
  const knowledgeOpen = shell.knowledgeOpen ?? false;
  const setKnowledgeOpen = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof action === 'function' ? action(knowledgeOpen) : action;
      if (next) {
        shell.openKnowledge?.();
      } else {
        shell.closeSubPage?.();
      }
    },
    [knowledgeOpen, shell],
  );
  const activeSubPage = (shell.activeSubPage as 'chat' | 'library' | 'images' | 'videos' | 'flashcards' | 'knowledge' | 'marketplace' | null) ?? null;
  const setActiveSubPage = useCallback((subPage: 'chat' | 'library' | 'images' | 'videos' | 'flashcards' | 'knowledge' | 'marketplace' | null) => {
    if (!subPage || subPage === 'chat') {
      shell.closeSubPage?.();
    } else if (subPage === 'library') {
      shell.openLibrary?.();
    } else if (subPage === 'images') {
      shell.openImages?.();
    } else if (subPage === 'videos') {
      shell.openVideos?.();
    } else if (subPage === 'flashcards') {
      shell.openFlashcards?.();
    } else if (subPage === 'knowledge') {
      shell.openKnowledge?.();
    } else if (subPage === 'marketplace') {
      shell.openMarketplace?.();
    }
  }, [shell]);
  const openMarketplace = useCallback(() => {
    shell.openMarketplace?.();
  }, [shell]);
  const openKnowledge = useCallback(() => {
    shell.openKnowledge?.();
  }, [shell]);
  const openFlashcardsProduce = useCallback(
    (folderPath?: string) => {
      shell.openFlashcardsProduce?.(folderPath);
    },
    [shell],
  );
  const openLibrary = useCallback(() => {
    shell.openLibrary?.();
  }, [shell]);
  const openImages = useCallback(() => {
    shell.openImages?.();
  }, [shell]);
  const openVideos = useCallback(() => {
    shell.openVideos?.();
  }, [shell]);
  const openFlashcards = useCallback(() => {
    shell.openFlashcards?.();
  }, [shell]);
  const closeSubPage = useCallback(() => {
    shell.closeSubPage?.();
  }, [shell]);
  const handleOpenCardsPanel = useCallback(() => {
    shell.openFlashcards?.();
  }, [shell]);
  const handleOpenKnowledge = useCallback(
    (subTab: 'doccards' | 'cards' | 'knowledge' = 'doccards') => {
      if (subTab === 'knowledge') {
        shell.openKnowledge?.();
        return;
      }
      shell.openFlashcards?.();
    },
    [shell],
  );
  const sessionListChrome = useSessionListChrome();
  const [agentMode, setAgentMode] = useState<AgentModeId>('agent');
  const [sidebarMode, setSidebarModeState] = useState<SidebarMode>(() => loadSidebarMode());
  const setSidebarMode = useCallback((mode: SidebarMode) => {
    setSidebarModeState(mode);
    saveSidebarMode(mode);
  }, []);
  // Conversation-scoped UI memory. Reset on real session switches happens in
  // useComposerDrafts — first-send (draft → created session) must keep the pill.
  const [orchestrationSchemeId, setOrchestrationSchemeId] = useState<string>(
    ORCHESTRATION_SCHEME_OFF_ID,
  );
  const [delegationDisabled, setDelegationDisabled] = useState(false);
  const sessionListQuery = useSessionListQuery({
    hostClient,
    sessionSearch: sessionListChrome.sessionSearch,
    showArchivedSessions: sessionListChrome.showArchivedSessions,
    activeScope: state.activeScope,
    sessions: state.sessions,
    generalSessions: state.generalSessions,
  });
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const composerSetterRef = useRef<(value: SetStateAction<string>) => void>(() => undefined);
  const [preferences, setPreferences] = useState<DesktopPreferences>(() =>
    loadDesktopPreferences(),
  );
  const terminal = useTerminalPanelState({
    projectPath: state.projectPath,
    preferences,
    setPreferences,
  });
  const preferencesStyle = useMemo(() => desktopPreferencesCssVars(preferences), [preferences]);
  const appShellStyle = useMemo(
    () =>
      appShellCssVars({
        preferencesStyle,
        sidebarWidthPx: sidebarResize.widthPx,
        sidebarResizing: sidebarResize.isResizing,
        rightPanelWidthPx: rightPanelResize.widthPx,
        rightPanelResizing: rightPanelResize.isResizing,
      }),
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
  const activeSessionListItem =
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    state.generalSessions.find((session) => session.id === state.activeSessionId);
  const plusMenu = useComposerPlusMenu({
    hostClient,
    projectPath: state.projectPath,
    hostReady: state.hostReady,
    activeSessionId: state.activeSessionId,
    sessionDisabledMcpServerIds: activeSessionListItem?.disabledMcpServerIds,
  });
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off');
  const sessionComposerProfileRestoredRef = useRef<
    (profile: { model?: ModelRef; thinkingLevel?: ThinkingLevel }) => void
  >(() => undefined);
  const [runClock, setRunClock] = useState(() => Date.now());
  useEffect(() => {
    if (state.activeRunStartedAt === null) {
      return;
    }
    const timer = window.setInterval(() => setRunClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.activeRunStartedAt]);

  return {
    projectInput,
    setProjectInput,
    shell,
    settingsOpen,
    settingsSection,
    commandPaletteOpen,
    navDrawerOpen,
    rightPanelOpen,
    rightPanelTab,
    showOverlayScrim,
    layoutMode,
    inspectorPlacement,
    isOverlayPresentation,
    inspectorOverlay,
    sidebarResize,
    rightPanelResize,
    rightPanelView,
    setRightPanelView,
    revealDocPreview,
    knowledgeOpen,
    setKnowledgeOpen,
    activeSubPage,
    setActiveSubPage,
    openLibrary,
    openImages,
    openVideos,
    openFlashcards,
    closeSubPage,
    handleOpenCardsPanel,
    handleOpenKnowledge,
    openKnowledge,
    openMarketplace,
    openFlashcardsProduce,
    flashcardsEntry: shell.flashcardsEntry ?? 'gallery',
    flashcardsFolderPath: shell.flashcardsFolderPath,
    sessionListChrome,
    sidebarMode,
    setSidebarMode,
    agentMode,
    setAgentMode,
    orchestrationSchemeId,
    setOrchestrationSchemeId,
    delegationDisabled,
    setDelegationDisabled,
    sessionListQuery,
    editingMessageId,
    setEditingMessageId,
    composerSetterRef,
    preferences,
    setPreferences,
    terminal,
    appShellStyle,
    desktopLocale,
    setDesktopLocale,
    foregroundReplaceConfirm,
    confirmBusyRun,
    confirmForegroundReplace,
    plusMenu,
    selectedModelKey,
    setSelectedModelKey,
    thinkingLevel,
    setThinkingLevel,
    sessionComposerProfileRestoredRef,
    runClock,
  };
}

export type WorkbenchShellChrome = ReturnType<typeof useWorkbenchShellChrome>;
