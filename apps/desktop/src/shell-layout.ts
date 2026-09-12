/**
 * Pure shell layout contract for the desktop product shell.
 * Width thresholds: phone <= 767; compact <= 1023; desktop >= 1024.
 *
 * Web/Safari skips compact: 768+ is the normal desktop page (iPad included).
 * Compact remains a Tauri-only narrow-window drawer.
 *
 * Right workspace chrome:
 * - Closed by default (no permanent signal rail).
 * - Desktop open at >= 1024: in-flow third grid column; stage (chat) narrows.
 * - Narrower desktop (Web 768–1023), compact, and phone: fixed drawer overlay.
 *
 * Phone reuses compact overlay ownership; CSS may refine presentation via
 * data-layout="phone" without a second overlay state machine.
 */

export type ShellLayoutMode = 'desktop' | 'compact' | 'phone';

export type ShellOverlay = 'none' | 'sessions' | 'inspector';

export type InspectorPlacement = 'column' | 'overlay';

/** Phone-shell threshold in CSS pixels (inclusive upper bound for phone). */
export const PHONE_SHELL_MAX_WIDTH = 767;

/** Compact-shell threshold in CSS pixels (inclusive upper bound for compact). */
export const COMPACT_SHELL_MAX_WIDTH = 1023;

/**
 * Floor where sidebar + stage-min (420) + inspector + deck chrome still fit.
 * Below this, a desktop inspector stays an overlay so the stage is not crushed.
 */
export const DESKTOP_INSPECTOR_COLUMN_MIN_WIDTH = 1024;

export type ResolveLayoutModeOptions = {
  /**
   * Compact is the Mac narrow-window drawer. Web/Safari (including iPad)
   * keeps the normal desktop page from 768 up.
   */
  allowCompact?: boolean;
};

export function resolveLayoutMode(
  viewportWidth: number,
  options: ResolveLayoutModeOptions = {},
): ShellLayoutMode {
  if (viewportWidth <= PHONE_SHELL_MAX_WIDTH) {
    return 'phone';
  }
  const allowCompact = options.allowCompact ?? true;
  if (allowCompact && viewportWidth <= COMPACT_SHELL_MAX_WIDTH) {
    return 'compact';
  }
  return 'desktop';
}

export function resolveInspectorPlacement(
  viewportWidth: number,
  layoutMode: ShellLayoutMode = resolveLayoutMode(viewportWidth),
): InspectorPlacement {
  if (layoutMode !== 'desktop') {
    return 'overlay';
  }
  return viewportWidth >= DESKTOP_INSPECTOR_COLUMN_MIN_WIDTH ? 'column' : 'overlay';
}

/** Sessions/inspector use overlay drawers instead of in-flow columns. */
export function isOverlayShellLayout(layoutMode: ShellLayoutMode): boolean {
  return layoutMode !== 'desktop';
}

export type ShellLayoutDerived = {
  layoutMode: ShellLayoutMode;
  isCompact: boolean;
  isPhone: boolean;
  inspectorPlacement: InspectorPlacement;
  /** @deprecated Use isOverlayShellLayout(layoutMode) — retained for gradual migration. */
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
  inspectorPlacement: InspectorPlacement = layoutMode === 'desktop' ? 'column' : 'overlay',
): ShellLayoutDerived {
  const overlayLayout = isOverlayShellLayout(layoutMode);
  const isPhone = layoutMode === 'phone';
  const navDrawerOpen = overlayLayout
    ? overlay === 'sessions'
    : !desktopSidebarCollapsed;
  const rightPanelOpen = overlay === 'inspector';
  // No permanent rail; panel chrome only when inspector is open.
  const signalRailVisible = rightPanelOpen;
  const sidebarOverlayOpen = overlayLayout && overlay === 'sessions';
  const inspectorAsOverlay = overlayLayout || inspectorPlacement === 'overlay';
  const inspectorOverlayOpen = overlay === 'inspector' && inspectorAsOverlay;
  const showOverlayScrim =
    overlay === 'none'
      ? false
      : overlayLayout || (inspectorPlacement === 'overlay' && overlay === 'inspector');

  return {
    layoutMode,
    isCompact: overlayLayout,
    isPhone,
    inspectorPlacement,
    isNarrow: overlayLayout,
    navDrawerOpen,
    rightPanelOpen,
    signalRailVisible,
    sidebarOverlayOpen,
    inspectorOverlayOpen,
    showOverlayScrim,
  };
}
