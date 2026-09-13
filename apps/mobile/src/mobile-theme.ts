import type { ThemeManifest } from '@piwin/contracts';

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
