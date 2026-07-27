/**
 * Pure shell layout contract for the desktop product shell.
 * Single compact threshold: width <= 1023 is compact; >= 1024 is desktop.
 *
 * Right workspace chrome:
 * - Closed by default (no permanent signal rail).
 * - Opens as an outward overlay from the right edge when overlay === 'inspector'.
 */

export type ShellLayoutMode = 'desktop' | 'compact';

export type ShellOverlay = 'none' | 'sessions' | 'inspector';

/** Compact-shell threshold in CSS pixels (inclusive upper bound for compact). */
export const COMPACT_SHELL_MAX_WIDTH = 1023;

export function resolveLayoutMode(viewportWidth: number): ShellLayoutMode {
  return viewportWidth <= COMPACT_SHELL_MAX_WIDTH ? 'compact' : 'desktop';
}

export type ShellLayoutDerived = {
  layoutMode: ShellLayoutMode;
  isCompact: boolean;
  /** @deprecated Use layoutMode === 'compact' — retained for gradual migration. */
  isNarrow: boolean;
  navDrawerOpen: boolean;
  /** Content panel expanded (Files / Terminal / Changes body). */
  rightPanelOpen: boolean;
  /**
   * Whether the right panel chrome is mounted.
   * Same as rightPanelOpen — no permanent signal rail when closed.
   */
  signalRailVisible: boolean;
  sidebarOverlayOpen: boolean;
  inspectorOverlayOpen: boolean;
  showOverlayScrim: boolean;
};

/**
 * Derive panel/overlay presentation from viewport mode and active overlay.
 * Layout CSS must read `data-layout` for panel placement; media queries must
 * not independently switch shell panel vs overlay behavior.
 */
export function deriveShellLayoutState(
  layoutMode: ShellLayoutMode,
  overlay: ShellOverlay,
  /**
   * Desktop-only: titlebar control collapses the left navigator without
   * using the compact sessions overlay.
   */
  desktopSidebarCollapsed = false,
): ShellLayoutDerived {
  const isCompact = layoutMode === 'compact';
  const navDrawerOpen = isCompact
    ? overlay === 'sessions'
    : !desktopSidebarCollapsed;
  const rightPanelOpen = overlay === 'inspector';
  // No permanent rail; panel chrome only when inspector is open.
  const signalRailVisible = rightPanelOpen;
  const sidebarOverlayOpen = isCompact && overlay === 'sessions';
  // Desktop also uses an outward overlay so the stage is not compressed.
  const inspectorOverlayOpen = overlay === 'inspector';
  const showOverlayScrim = isCompact && overlay !== 'none';

  return {
    layoutMode,
    isCompact,
    isNarrow: isCompact,
    navDrawerOpen,
    rightPanelOpen,
    signalRailVisible,
    sidebarOverlayOpen,
    inspectorOverlayOpen,
    showOverlayScrim,
  };
}
