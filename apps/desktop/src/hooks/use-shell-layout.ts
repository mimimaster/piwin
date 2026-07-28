/**
 * Shell presentation state: overlays, inspector tab, settings, command palette.
 * Owns no host business state. Layout mode is the single authority for compact vs desktop.
 * Titleband back/forward uses the pure shell navigation stack (not browser history).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RightPanelTab } from '../right-panel';
import {
  expandWindowOutwardForRightPanel,
  shrinkWindowInwardAfterRightPanel,
} from '../window-outward-expand';
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
  type ShellNavigationState,
  type ShellSettingsSection,
} from '../shell-navigation';
import {
  normalizeSettingsSection,
  type SettingsSectionId,
} from '../settings/section-registry';

export type { ShellLayoutMode, ShellOverlay, SettingsSectionId, ShellSettingsSection };

export function useShellLayout() {
  const [overlay, setOverlay] = useState<ShellOverlay>('none');
  const [inspectorTab, setInspectorTab] = useState<RightPanelTab>('files');
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
    activeRoute.kind === 'settings'
      ? normalizeSettingsSection(activeRoute.section)
      : 'general';

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
    (tab: RightPanelTab = 'files') => {
      rememberTrigger();
      setInspectorTab(tab);
      void (async () => {
        // Grow OS window first so the third column does not steal stage pixels.
        await expandWindowOutwardForRightPanel();
        setOverlay('inspector');
      })();
    },
    [rememberTrigger],
  );

  const closeOverlay = useCallback(() => {
    setOverlay((current) => {
      if (current === 'inspector') {
        void shrinkWindowInwardAfterRightPanel();
      }
      return 'none';
    });
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

  const toggleInspector = useCallback(
    (tab: RightPanelTab = 'files') => {
      // Read via functional update for close; open always goes through expand.
      setOverlay((current) => {
        if (current === 'inspector') {
          void shrinkWindowInwardAfterRightPanel();
          restoreFocus();
          return 'none';
        }
        rememberTrigger();
        setInspectorTab(tab);
        void expandWindowOutwardForRightPanel().then(() => {
          setOverlay('inspector');
        });
        return current;
      });
    },
    [rememberTrigger, restoreFocus],
  );

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
      if (settingsOpen) {
        event.preventDefault();
        closeSettings();
        return;
      }
      if (overlay !== 'none') {
        event.preventDefault();
        closeOverlay();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closeOverlay,
    closeSettings,
    commandPaletteOpen,
    overlay,
    restoreFocus,
    settingsOpen,
  ]);

  return {
    overlay,
    inspectorTab,
    settingsOpen,
    settingsSection,
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
    toggleInspector,
    setInspectorTab,
    openSettings,
    closeSettings,
    setSettingsSection,
    setCommandPaletteOpen,
    rememberTrigger,
  };
}
