import { describe, expect, it } from 'vitest';
import {
  COMPACT_SHELL_MAX_WIDTH,
  deriveShellLayoutState,
  resolveLayoutMode,
} from './shell-layout';

describe('resolveLayoutMode', () => {
  it('uses a single compact threshold at 1023 inclusive', () => {
    expect(COMPACT_SHELL_MAX_WIDTH).toBe(1023);
    expect(resolveLayoutMode(820)).toBe('compact');
    expect(resolveLayoutMode(821)).toBe('compact');
    expect(resolveLayoutMode(980)).toBe('compact');
    expect(resolveLayoutMode(981)).toBe('compact');
    expect(resolveLayoutMode(1023)).toBe('compact');
    expect(resolveLayoutMode(1024)).toBe('desktop');
    expect(resolveLayoutMode(1280)).toBe('desktop');
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

    const inspector = deriveShellLayoutState('desktop', 'inspector');
    expect(inspector.rightPanelOpen).toBe(true);
    expect(inspector.signalRailVisible).toBe(true);
    expect(inspector.inspectorOverlayOpen).toBe(true);
    expect(inspector.showOverlayScrim).toBe(false);
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
});
