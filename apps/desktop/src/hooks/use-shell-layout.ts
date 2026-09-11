/**
 * Shell presentation state: overlays, inspector tab, settings, command palette.
 * Owns no host business state. Layout mode is the single authority for compact vs desktop.
 * Titleband back/forward uses the pure shell navigation stack (not browser history).
 *
 * Desktop right panel: synchronous overlay flag only. Layout is pure CSS grid
 * (stage 1fr + panel track) — chat width adjusts in-flow; no OS setSize.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RightPanelTab } from '../right-panel';
import {
  COMPACT_SHELL_MAX_WIDTH,
  deriveShellLayoutState,
  resolveLayoutMode,
  type ShellLayoutMode,
  type ShellOverlay,
} from '../shell-layout';
import {
  canGoShellBack,
  canGoShellForward,
  createInitialShellNavigation,
  currentShellRoute,
  goShellBack,
  goShellForward,
  leaveSettingsRoute,
  pushShellRoute,
  resolveShellSubPage,
  type ShellNavigationState,
  type ShellSettingsSection,
} from '../shell-navigation';
import { normalizeSettingsSection, type SettingsSectionId } from '../settings/section-registry';

export type { ShellLayoutMode, ShellOverlay, SettingsSectionId, ShellSettingsSection };

export function useShellLayout() {
  const [overlay, setOverlay] = useState<ShellOverlay>('none');
  const [inspectorTab, setInspectorTab] = useState<RightPanelTab | null>(null);
  const [layoutMode, setLayoutMode] = useState<ShellLayoutMode>(() =>
    typeof window !== 'undefined' ? resolveLayoutMode(window.innerWidth) : 'desktop',
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  /** Desktop titlebar: collapse left navigator without compact overlay. */
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [navigation, setNavigation] = useState<ShellNavigationState>(createInitialShellNavigation);
  const focusReturnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onResize(): void {
      setLayoutMode(resolveLayoutMode(window.innerWidth));
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Closing sessions/inspector when leaving compact avoids a sticky overlay flag on desktop.
  useEffect(() => {
    if (layoutMode === 'desktop' && overlay === 'sessions') {
      setOverlay('none');
    }
  }, [layoutMode, overlay]);

  const derived = useMemo(
    () => deriveShellLayoutState(layoutMode, overlay, desktopSidebarCollapsed),
    [desktopSidebarCollapsed, layoutMode, overlay],
  );

  const activeRoute = currentShellRoute(navigation);
  const settingsOpen = activeRoute.kind === 'settings';
  const settingsSection: SettingsSectionId =
    activeRoute.kind === 'settings' ? normalizeSettingsSection(activeRoute.section) : 'general';
  const activeSubPage = resolveShellSubPage(activeRoute);
  const knowledgeOpen = false;

  const rememberTrigger = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      focusReturnRef.current = active;
    }
  }, []);

  const restoreFocus = useCallback(() => {
    const target = focusReturnRef.current;
    focusReturnRef.current = null;
    if (target && document.contains(target)) {
      target.focus();
    }
  }, []);

  const openSessions = useCallback(() => {
    rememberTrigger();
    setOverlay('sessions');
  }, [rememberTrigger]);

  const openInspector = useCallback(
    (tab: RightPanelTab | null = null) => {
      rememberTrigger();
      setInspectorTab(tab);
      // In-flow: stage 1fr shrinks as the panel track appears (one paint).
      setOverlay('inspector');
    },
    [rememberTrigger],
  );

  const closeOverlay = useCallback(() => {
    setOverlay('none');
    restoreFocus();
  }, [restoreFocus]);

  const toggleSessions = useCallback(() => {
    if (layoutMode === 'desktop') {
      setDesktopSidebarCollapsed((current) => !current);
      return;
    }
    setOverlay((current) => {
      if (current === 'sessions') {
        restoreFocus();
        return 'none';
      }
      rememberTrigger();
      return 'sessions';
    });
  }, [layoutMode, rememberTrigger, restoreFocus]);

  const collapseSessions = useCallback(() => {
    if (layoutMode === 'desktop') {
      setDesktopSidebarCollapsed(true);
      return;
    }
    setOverlay((current) => {
      if (current !== 'sessions') {
        return current;
      }
      restoreFocus();
      return 'none';
    });
  }, [layoutMode, restoreFocus]);

  const expandSessions = useCallback(() => {
    if (layoutMode === 'desktop') {
      setDesktopSidebarCollapsed(false);
      return;
    }
    rememberTrigger();
    setOverlay('sessions');
  }, [layoutMode, rememberTrigger]);

  const toggleInspector = useCallback(
    (tab: RightPanelTab | null = null) => {
      setOverlay((current) => {
        if (current === 'inspector') {
          restoreFocus();
          return 'none';
        }
        rememberTrigger();
        setInspectorTab(tab ?? inspectorTab ?? null);
        return 'inspector';
      });
    },
    [rememberTrigger, restoreFocus, inspectorTab],
  );

  const openLibrary = useCallback(() => {
    rememberTrigger();
    setNavigation((current) => pushShellRoute(current, { kind: 'library' }));
  }, [rememberTrigger]);

  const openImages = useCallback(() => {
    rememberTrigger();
    setNavigation((current) => pushShellRoute(current, { kind: 'images' }));
  }, [rememberTrigger]);

  const openVideos = useCallback(() => {
    rememberTrigger();
    setNavigation((current) => pushShellRoute(current, { kind: 'videos' }));
  }, [rememberTrigger]);

  const openFlashcards = useCallback(() => {
    rememberTrigger();
    setNavigation((current) => pushShellRoute(current, { kind: 'flashcards', entry: 'gallery' }));
  }, [rememberTrigger]);
  const openFlashcardsProduce = useCallback(
    (folderPath?: string) => {
      rememberTrigger();
      setNavigation((current) =>
        pushShellRoute(current, {
          kind: 'flashcards',
          entry: 'produce',
          ...(folderPath ? { folderPath } : {}),
        }),
      );
    },
    [rememberTrigger],
  );

  const openKnowledge = useCallback(() => {
    rememberTrigger();
    setNavigation((current) => pushShellRoute(current, { kind: 'knowledge' }));
  }, [rememberTrigger]);

  const openMarketplace = useCallback(() => {
    rememberTrigger();
    setNavigation((current) => pushShellRoute(current, { kind: 'marketplace' }));
  }, [rememberTrigger]);

  const openSettings = useCallback(
    (section: ShellSettingsSection = 'general') => {
      rememberTrigger();
      const normalized = normalizeSettingsSection(section);
      setNavigation((current) =>
        pushShellRoute(current, {
          kind: 'settings',
          section: normalized,
        }),
      );
    },
    [rememberTrigger],
  );

  const closeSubPage = useCallback(() => {
    setNavigation((current) => {
      if (canGoShellBack(current)) {
        return goShellBack(current);
      }
      return pushShellRoute(current, { kind: 'workspace' });
    });
    restoreFocus();
  }, [restoreFocus]);

  const closeSettings = useCallback(() => {
    setNavigation((current) => leaveSettingsRoute(current));
    restoreFocus();
  }, [restoreFocus]);

  const setSettingsSection = useCallback((section: ShellSettingsSection) => {
    const normalized = normalizeSettingsSection(section);
    setNavigation((current) => {
      if (currentShellRoute(current).kind !== 'settings') {
        return current;
      }
      return pushShellRoute(current, { kind: 'settings', section: normalized });
    });
  }, []);

  const goBack = useCallback(() => {
    setNavigation((current) => {
      if (!canGoShellBack(current)) {
        return current;
      }
      return goShellBack(current);
    });
    // Focus returns when we land on workspace; cheap to always restore after back.
    restoreFocus();
  }, [restoreFocus]);

  const goForward = useCallback(() => {
    setNavigation((current) => {
      if (!canGoShellForward(current)) {
        return current;
      }
      return goShellForward(current);
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }
      // Radix dialogs/menus handle Escape first when focused inside them.
      const target = event.target;
      if (target instanceof Element) {
        if (
          target.closest('[role="dialog"]') ||
          target.closest('[role="menu"]') ||
          target.closest('[data-radix-popper-content-wrapper]')
        ) {
          return;
        }
      }
      if (commandPaletteOpen) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        restoreFocus();
        return;
      }
      if (settingsOpen || knowledgeOpen || activeSubPage) {
        event.preventDefault();
        closeSubPage();
        return;
      }
      if (overlay !== 'none') {
        event.preventDefault();
        closeOverlay();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSubPage, closeOverlay, closeSubPage, commandPaletteOpen, knowledgeOpen, overlay, restoreFocus, settingsOpen]);

  return {
    overlay,
    inspectorTab,
    settingsOpen,
    settingsSection,
    activeSubPage,
    knowledgeOpen,
    layoutMode,
    isCompact: derived.isCompact,
    /** @deprecated Prefer layoutMode / isCompact */
    isNarrow: derived.isNarrow,
    commandPaletteOpen,
    navDrawerOpen: derived.navDrawerOpen,
    rightPanelOpen: derived.rightPanelOpen,
    signalRailVisible: derived.signalRailVisible,
    sidebarOverlayOpen: derived.sidebarOverlayOpen,
    inspectorOverlayOpen: derived.inspectorOverlayOpen,
    showOverlayScrim: derived.showOverlayScrim,
    compactMaxWidth: COMPACT_SHELL_MAX_WIDTH,
    canGoBack: canGoShellBack(navigation),
    canGoForward: canGoShellForward(navigation),
    goBack,
    goForward,
    openSessions,
    openInspector,
    closeOverlay,
    toggleSessions,
    collapseSessions,
    expandSessions,
    toggleInspector,
    setInspectorTab,
    openLibrary,
    openImages,
    openVideos,
    openFlashcards,
    openFlashcardsProduce,
    flashcardsEntry:
      activeRoute.kind === 'flashcards' ? (activeRoute.entry ?? 'gallery') : 'gallery',
    flashcardsFolderPath: activeRoute.kind === 'flashcards' ? activeRoute.folderPath : undefined,
    openKnowledge,
    openMarketplace,
    closeSubPage,
    openSettings,
    closeSettings,
    setSettingsSection,
    setCommandPaletteOpen,
    rememberTrigger,
  };
}
