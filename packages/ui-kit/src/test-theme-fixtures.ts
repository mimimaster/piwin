/**
 * Test-only ThemeManifest fixtures for ui-kit unit tests.
 * Not exported from the package public API; desktop tests use their own
 * appearance-tokens manifests instead of importing this file.
 */
import type { ThemeManifest } from '@piwin/contracts';

/** Minimal dark manifest exercising manifest-derived Mantine values. */
export const TEST_THEME_DARK: ThemeManifest = {
  id: 'test-dark',
  name: 'Test Dark',
  version: '1.0.0',
  mode: 'dark',
  tokens: {
    bg: '#12141a',
    panel: '#181a21',
    panel2: '#1e2128',
    border: 'rgba(255, 255, 255, 0.08)',
    text: '#dde0e5',
    muted: '#8d94a0',
    accent: '#5b9dff',
    accent2: '#7eb0ff',
    danger: '#e5665c',
    ok: '#43c384',
    radius: '8px',
    font: '"Test Sans Dark", sans-serif',
  },
};

/** Minimal light manifest whose derived values differ from TEST_THEME_DARK. */
export const TEST_THEME_LIGHT: ThemeManifest = {
  id: 'test-light',
  name: 'Test Light',
  version: '1.0.0',
  mode: 'light',
  tokens: {
    bg: '#f6f7f8',
    panel: '#ffffff',
    panel2: '#f7f7f8',
    border: 'rgba(0, 0, 0, 0.12)',
    text: '#1d1d1f',
    muted: '#636366',
    accent: '#007aff',
    accent2: '#0a84ff',
    danger: '#d70015',
    ok: '#248a3d',
    radius: '8px',
    font: '"Test Sans Light", sans-serif',
  },
};
