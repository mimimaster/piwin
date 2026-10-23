import { describe, expect, it } from 'vitest';
import {
  COMPACT_SHELL_MAX_WIDTH,
  DESKTOP_INSPECTOR_COLUMN_MIN_WIDTH,
  PHONE_SHELL_MAX_WIDTH,
  deriveShellLayoutState,
  isOverlayShellLayout,
  resolveInspectorPlacement,
  resolveLayoutMode,
} from './shell-layout';

describe('resolveLayoutMode', () => {
  it('uses phone, compact, and desktop thresholds', () => {
    expect(PHONE_SHELL_MAX_WIDTH).toBe(767);
    expect(COMPACT_SHELL_MAX_WIDTH).toBe(1023);
    expect(resolveLayoutMode(360)).toBe('phone');
    expect(resolveLayoutMode(390)).toBe('phone');
    expect(resolveLayoutMode(440)).toBe('phone');
    expect(resolveLayoutMode(767)).toBe('phone');
    expect(resolveLayoutMode(768)).toBe('compact');
    expect(resolveLayoutMode(820)).toBe('compact');
    expect(resolveLayoutMode(1023)).toBe('compact');
    expect(resolveLayoutMode(1024)).toBe('desktop');
    expect(resolveLayoutMode(1280)).toBe('desktop');
  });

  it('skips compact on the Web shell so iPad uses the desktop page', () => {
    const web = { allowCompact: false } as const;
    expect(resolveLayoutMode(767, web)).toBe('phone');
    expect(resolveLayoutMode(768, web)).toBe('desktop');
    expect(resolveLayoutMode(820, web)).toBe('desktop');
    expect(resolveLayoutMode(1023, web)).toBe('desktop');
    expect(resolveLayoutMode(1024, web)).toBe('desktop');
  });
});

describe('resolveInspectorPlacement', () => {
  it('squeezes the inspector as a column once the three-pane floor fits', () => {
    expect(DESKTOP_INSPECTOR_COLUMN_MIN_WIDTH).toBe(1024);
    expect(resolveInspectorPlacement(390)).toBe('overlay');
    expect(resolveInspectorPlacement(820)).toBe('overlay');
    expect(resolveInspectorPlacement(1023, 'desktop')).toBe('overlay');
    expect(resolveInspectorPlacement(1024)).toBe('column');
    expect(resolveInspectorPlacement(1279)).toBe('column');
    expect(resolveInspectorPlacement(1280)).toBe('column');
    expect(resolveInspectorPlacement(1440)).toBe('column');
  });
});

describe('isOverlayShellLayout', () => {
  it('treats phone and compact as overlay shells', () => {
    expect(isOverlayShellLayout('phone')).toBe(true);
    expect(isOverlayShellLayout('compact')).toBe(true);
    expect(isOverlayShellLayout('desktop')).toBe(false);
  });
});

describe('deriveShellLayoutState', () => {
  it('keeps sidebar open; right panel closed by default on desktop', () => {
    const idle = deriveShellLayoutState('desktop', 'none');
    expect(idle.navDrawerOpen).toBe(true);
    expect(idle.rightPanelOpen).toBe(false);
    expect(idle.signalRailVisible).toBe(false);
    expect(idle.sidebarOverlayOpen).toBe(false);
    expect(idle.inspectorOverlayOpen).toBe(false);
    expect(idle.showOverlayScrim).toBe(false);
    expect(idle.isPhone).toBe(false);
    expect(idle.isCompact).toBe(false);

    const inspector = deriveShellLayoutState('desktop', 'inspector');
    expect(inspector.rightPanelOpen).toBe(true);
    expect(inspector.signalRailVisible).toBe(true);
    expect(inspector.inspectorPlacement).toBe('column');
    expect(inspector.inspectorOverlayOpen).toBe(false);
    expect(inspector.showOverlayScrim).toBe(false);

    const narrow = deriveShellLayoutState('desktop', 'inspector', false, 'overlay');
    expect(narrow.rightPanelOpen).toBe(true);
    expect(narrow.inspectorPlacement).toBe('overlay');
    expect(narrow.inspectorOverlayOpen).toBe(true);
    expect(narrow.showOverlayScrim).toBe(true);
  });

  it('allows desktop titlebar to collapse the left navigator', () => {
    const collapsed = deriveShellLayoutState('desktop', 'none', true);
    expect(collapsed.navDrawerOpen).toBe(false);
    expect(collapsed.sidebarOverlayOpen).toBe(false);

    const expanded = deriveShellLayoutState('desktop', 'none', false);
    expect(expanded.navDrawerOpen).toBe(true);
  });

  it('requires explicit overlay open on compact and shows one scrim', () => {
    const idle = deriveShellLayoutState('compact', 'none');
    expect(idle.navDrawerOpen).toBe(false);
    expect(idle.rightPanelOpen).toBe(false);
    expect(idle.signalRailVisible).toBe(false);
    expect(idle.showOverlayScrim).toBe(false);
    expect(idle.isCompact).toBe(true);
    expect(idle.isPhone).toBe(false);

    const sessions = deriveShellLayoutState('compact', 'sessions');
    expect(sessions.navDrawerOpen).toBe(true);
    expect(sessions.sidebarOverlayOpen).toBe(true);
    expect(sessions.inspectorOverlayOpen).toBe(false);
    expect(sessions.showOverlayScrim).toBe(true);

    const inspector = deriveShellLayoutState('compact', 'inspector');
    expect(inspector.rightPanelOpen).toBe(true);
    expect(inspector.signalRailVisible).toBe(true);
    expect(inspector.sidebarOverlayOpen).toBe(false);
    expect(inspector.inspectorOverlayOpen).toBe(true);
    expect(inspector.showOverlayScrim).toBe(true);
  });

  it('reuses compact overlay ownership on phone', () => {
    const idle = deriveShellLayoutState('phone', 'none');
    expect(idle.isPhone).toBe(true);
    expect(idle.isCompact).toBe(true);
    expect(idle.navDrawerOpen).toBe(false);
    expect(idle.showOverlayScrim).toBe(false);

    const sessions = deriveShellLayoutState('phone', 'sessions');
    expect(sessions.navDrawerOpen).toBe(true);
    expect(sessions.sidebarOverlayOpen).toBe(true);
    expect(sessions.showOverlayScrim).toBe(true);

    const inspector = deriveShellLayoutState('phone', 'inspector');
    expect(inspector.rightPanelOpen).toBe(true);
    expect(inspector.inspectorOverlayOpen).toBe(true);
    expect(inspector.showOverlayScrim).toBe(true);
  });
});
