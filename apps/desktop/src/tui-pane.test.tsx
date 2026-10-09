// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { DesktopLocale } from './desktop-locale';

const pty = vi.hoisted(() => ({
  available: true,
  mounts: 0,
  announce: undefined as ((sessionId: string) => void) | undefined,
}));

vi.mock('./tauri-pty', () => ({ isTauriPtyAvailable: () => pty.available }));
vi.mock('./xterm-surface', () => ({
  XtermSurface: (props: {
    tui?: { sessionId?: string };
    projectPath?: string;
    onTuiSession?: (sessionId: string) => void;
  }) => {
    // One id per mounted process: a remount shows as a new id.
    const mount = useRef(0);
    if (mount.current === 0) mount.current = pty.mounts += 1;
    pty.announce = props.onTuiSession;
    return (
      <div
        data-testid="xterm-stub"
        data-session={props.tui?.sessionId ?? 'new'}
        data-project={props.projectPath ?? ''}
        data-mount={mount.current}
      />
    );
  },
}));

import { TuiPane } from './tui-pane';

describe('TuiPane', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pty.mounts = 0;
    pty.announce = undefined;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    pty.available = true;
  });

  function renderPane(
    sessionId: string | null,
    locale: DesktopLocale,
    projectPath?: string,
    onSessionChange?: (sessionId: string) => void,
  ): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TuiPane
            sessionId={sessionId}
            locale={locale}
            {...(projectPath ? { projectPath } : {})}
            {...(onSessionChange ? { onSessionChange } : {})}
          />
        </PiwinUiProvider>,
      );
    });
  }

  const surface = (): HTMLElement | null => container.querySelector('[data-testid="xterm-stub"]');

  it('runs the terminal shell on the active session', () => {
    renderPane('session-1', 'zh-CN');
    expect(surface()?.dataset.session).toBe('session-1');
  });

  it('starts a new conversation in the active project when there is no session', () => {
    renderPane(null, 'zh-CN', '/work/app');
    expect(surface()?.dataset.session).toBe('new');
    expect(surface()?.dataset.project).toBe('/work/app');
  });

  it('tells Desktop which session the terminal shell started, and keeps that process running when Desktop opens it', () => {
    const changed = vi.fn();
    renderPane(null, 'zh-CN', '/work/app', changed);
    const before = surface()?.dataset.mount;
    act(() => pty.announce?.('session-new'));
    expect(changed).toHaveBeenCalledWith('session-new');
    // Desktop opens the session the TUI announced: same process, no restart.
    renderPane('session-new', 'zh-CN', '/work/app', changed);
    expect(surface()?.dataset.mount).toBe(before);
  });

  it('restarts the terminal shell when Desktop moves to a session the shell did not announce', () => {
    renderPane('session-1', 'zh-CN');
    const before = surface()?.dataset.mount;
    renderPane('session-2', 'zh-CN');
    expect(surface()?.dataset.mount).not.toBe(before);
    expect(surface()?.dataset.session).toBe('session-2');
  });

  it('starts a fresh process for a new conversation after the shell adopted one', () => {
    renderPane(null, 'zh-CN', '/work/app');
    act(() => pty.announce?.('session-new'));
    renderPane('session-new', 'zh-CN', '/work/app');
    const adopted = surface()?.dataset.mount;
    renderPane(null, 'zh-CN', '/work/app');
    expect(surface()?.dataset.mount).not.toBe(adopted);
    expect(surface()?.dataset.session).toBe('new');
  });

  it('starts nothing outside the desktop app', () => {
    pty.available = false;
    renderPane('session-1', 'en');
    expect(surface()).toBeNull();
    expect(container.textContent).toContain('runs in the desktop app');
  });
});
