// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { DesktopLocale } from './desktop-locale';

const pty = vi.hoisted(() => ({ available: true }));

vi.mock('./tauri-pty', () => ({ isTauriPtyAvailable: () => pty.available }));
vi.mock('./xterm-surface', () => ({
  XtermSurface: (props: { tuiSessionId?: string }) => (
    <div data-testid="xterm-stub" data-session={props.tuiSessionId} />
  ),
}));

import { TuiPane } from './tui-pane';

describe('TuiPane', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  function renderPane(sessionId: string | null, locale: DesktopLocale): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TuiPane sessionId={sessionId} locale={locale} />
        </PiwinUiProvider>,
      );
    });
  }

  const surface = (): HTMLElement | null => container.querySelector('[data-testid="xterm-stub"]');

  it('runs the terminal shell on the active session', () => {
    renderPane('session-1', 'zh-CN');
    expect(surface()?.dataset.session).toBe('session-1');
  });

  it('starts nothing without a session', () => {
    renderPane(null, 'zh-CN');
    expect(surface()).toBeNull();
    expect(container.textContent).toContain('先打开或开始一个会话');
  });

  it('starts nothing outside the desktop app', () => {
    pty.available = false;
    renderPane('session-1', 'en');
    expect(surface()).toBeNull();
    expect(container.textContent).toContain('runs in the desktop app');
  });
});
