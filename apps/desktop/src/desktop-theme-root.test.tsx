// @vitest-environment happy-dom
/**
 * DesktopThemeRoot owns the resolved active manifest: its callback must apply
 * document identity attributes + tokens and hand the same manifest to App.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ThemeManifest } from '@piwin/contracts';
import type { AppProps } from './App';
import {
  PIWIN_APPEARANCE_INK_WASH,
  PIWIN_APPEARANCE_LIGHT,
  applyAppearanceToDocument,
} from './appearance-tokens';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// The root is presentation-only; App (host bootstrap, sessions) is out of
// scope here, so capture the props the root passes instead of mounting it.
let capturedProps: AppProps | null = null;
vi.mock('./App', () => ({
  App: (props: AppProps) => {
    capturedProps = props;
    return null;
  },
}));

const { DesktopThemeRoot } = await import('./desktop-theme-root');

describe('DesktopThemeRoot', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    localStorage.setItem('piwin.desktop.appearanceMode', 'dark');
    document.documentElement.removeAttribute('data-theme-id');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    capturedProps = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('starts with the persisted dark Appearance mode and projects it to the document', () => {
    act(() => {
      root.render(<DesktopThemeRoot />);
    });

    expect(capturedProps).not.toBeNull();
    const props = capturedProps as unknown as AppProps;
    expect(props.activeTheme.id).toBe('piwin-dark-appearance');
    expect(props.activeTheme.mode).toBe('dark');

    const documentRoot = document.documentElement;
    expect(documentRoot.dataset.themeId).toBe('piwin-dark-appearance');
    expect(documentRoot.dataset.themeMode).toBe('dark');
    expect(documentRoot.style.getPropertyValue('--canvas')).toBe('#101010');
  });

  it('starts with the cached library theme so cold start matches last session', () => {
    localStorage.setItem('piwin.desktop.lastThemeId', 'piwin-ink-wash');

    act(() => {
      root.render(<DesktopThemeRoot />);
    });

    const props = capturedProps as unknown as AppProps;
    expect(props.activeTheme).toBe(PIWIN_APPEARANCE_INK_WASH);
    expect(document.documentElement.dataset.themeId).toBe('piwin-ink-wash');
    expect(localStorage.getItem('piwin.desktop.lastThemeId')).toBe('piwin-ink-wash');
  });

  it('applies light identity, tokens, and provider manifest through its callback', () => {
    act(() => {
      root.render(<DesktopThemeRoot />);
    });
    const props = capturedProps as unknown as AppProps;

    act(() => {
      props.onThemeApplied(PIWIN_APPEARANCE_LIGHT);
    });

    const documentRoot = document.documentElement;
    expect(documentRoot.dataset.themeId).toBe('piwin-light');
    expect(documentRoot.dataset.themeMode).toBe('light');
    expect(documentRoot.style.getPropertyValue('--canvas')).toBe(PIWIN_APPEARANCE_LIGHT.tokens.bg);
    expect(localStorage.getItem('piwin.desktop.lastThemeId')).toBe('piwin-light');

    // App receives the exact same resolved manifest projected to the document.
    const rerendered = capturedProps as unknown as AppProps;
    expect(rerendered.activeTheme).toBe(PIWIN_APPEARANCE_LIGHT);
  });

  it('skips a host re-apply when document already has the same theme id', () => {
    localStorage.setItem('piwin.desktop.lastThemeId', 'piwin-ink-wash');
    applyAppearanceToDocument(PIWIN_APPEARANCE_INK_WASH);

    act(() => {
      root.render(<DesktopThemeRoot />);
    });
    const props = capturedProps as unknown as AppProps;
    const firstTheme = props.activeTheme;

    act(() => {
      // Host bootstrap re-sends the active library theme after connect.
      props.onThemeApplied({ ...PIWIN_APPEARANCE_INK_WASH, version: '9.9.9' });
    });

    const rerendered = capturedProps as unknown as AppProps;
    // Same id → keep prior React state reference (no second switch cycle).
    expect(rerendered.activeTheme).toBe(firstTheme);
    expect(document.documentElement.dataset.themeId).toBe('piwin-ink-wash');
  });

  it('resolves stale built-in manifests to the desktop-owned appearance', () => {
    act(() => {
      root.render(<DesktopThemeRoot />);
    });
    const props = capturedProps as unknown as AppProps;

    // A stale host copy of a built-in id must not override desktop tokens.
    const staleLight: ThemeManifest = {
      ...PIWIN_APPEARANCE_LIGHT,
      version: '0.0.1',
      tokens: { ...PIWIN_APPEARANCE_LIGHT.tokens, bg: '#123456' },
    };

    act(() => {
      props.onThemeApplied(staleLight);
    });

    const rerendered = capturedProps as unknown as AppProps;
    expect(rerendered.activeTheme).toBe(PIWIN_APPEARANCE_LIGHT);
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(
      PIWIN_APPEARANCE_LIGHT.tokens.bg,
    );
  });
});
