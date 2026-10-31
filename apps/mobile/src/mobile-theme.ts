import type { DesktopAppearanceSync, ThemeManifest } from '@piwin/contracts';

export const MOBILE_THEME: ThemeManifest = {
  id: 'piwin-mobile-default',
  name: 'piwin shell',
  version: '0.0.0',
  mode: 'dark',
  tokens: {
    bg: '#111318',
    panel: '#191c23',
    panel2: '#222631',
    border: '#343a47',
    text: '#f3f4f6',
    muted: '#a4aab8',
    accent: '#8fb8ff',
    accent2: '#b4ccff',
    danger: '#ff8d8d',
    ok: '#86d7a3',
    radius: '12px',
    font: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
};

/**
 * Applies synchronized desktop appearance tokens and wallpaper to the mobile shell.
 */
export function applyMobileAppearance(appearance: DesktopAppearanceSync | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (!appearance) {
    delete root.dataset.wallpaper;
    root.style.removeProperty('--wallpaper-image');
    root.style.removeProperty('--wallpaper-blur');
    root.style.removeProperty('--wallpaper-dim');
    document.getElementById('piwin-wallpaper')?.remove();
    return;
  }

  // 1. Theme Mode and Face
  const mode = appearance.appearanceMode ?? 'dark';
  root.dataset.themeMode = mode;
  root.dataset.face = mode === 'light' ? 'paper' : 'ink';

  const themeTokens = mode === 'light' ? appearance.lightTheme : appearance.darkTheme;
  if (themeTokens?.accent) {
    root.style.setProperty('--iris', themeTokens.accent);
    root.style.setProperty('--accent', themeTokens.accent);
  }
  if (themeTokens?.background) {
    root.style.setProperty('--bg', themeTokens.background);
  }
  if (themeTokens?.foreground) {
    root.style.setProperty('--t1', themeTokens.foreground);
    root.style.setProperty('--text', themeTokens.foreground);
  }

  // 2. Adaptive Wallpaper Layer
  if (appearance.wallpaper?.url) {
    let layer = document.getElementById('piwin-wallpaper');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'piwin-wallpaper';
      layer.className = 'app-wallpaper';
      layer.setAttribute('aria-hidden', 'true');
      document.body.prepend(layer);
    }
    root.dataset.wallpaper = 'on';
    root.style.setProperty('--wallpaper-image', `url("${appearance.wallpaper.url}")`);
    root.style.setProperty('--wallpaper-blur', `${appearance.wallpaper.blur ?? 0}px`);
    root.style.setProperty('--wallpaper-dim', `${appearance.wallpaper.dim ?? 30}%`);
  } else {
    delete root.dataset.wallpaper;
    root.style.removeProperty('--wallpaper-image');
    root.style.removeProperty('--wallpaper-blur');
    root.style.removeProperty('--wallpaper-dim');
    document.getElementById('piwin-wallpaper')?.remove();
  }
}
