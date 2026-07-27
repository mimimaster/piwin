import {
  MantineProvider,
  createTheme,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from '@mantine/core';
import type { ReactElement, ReactNode } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import '@mantine/core/styles.css';

/**
 * Neutral gray scale derived from a theme manifest's background tones.
 * The 10-step Mantine scale runs lightest (0) → darkest (9). For dark mode we
 * invert; for light mode we read forward so Mantine's fill directions stay
 * consistent with the color scheme.
 */
function buildGraphiteScale(manifest: ThemeManifest): MantineColorsTuple {
  if (manifest.mode === 'light') {
    return [
      manifest.tokens.bg,     // 0 — lightest (base)
      '#e8e8ed',
      '#d2d2d7',
      '#aeaeb2',
      '#8e8e93',
      manifest.tokens.muted,  // 5 — mid-tone muted from manifest
      '#48484a',
      '#3a3a3c',
      '#2c2c2e',
      '#1c1c1e',              // 9 — darkest
    ];
  }
  // Dark mode: reverse direction so index 0 is the darkest shell background
  // and index 9 is the lightest text tone.
  return [
    '#f5f5f7',
    '#e8e8ed',
    '#d2d2d7',
    '#aeaeb2',
    manifest.tokens.muted,  // 4 — mid-tone muted from manifest
    '#636366',
    '#48484a',
    '#3a3a3c',
    manifest.tokens.panel,  // 8 — primary panel from manifest
    manifest.tokens.bg,     // 9 — base canvas from manifest
  ];
}

/**
 * Blue / accent scale derived from the manifest's accent color.
 * Uses fixed light-end steps and two manifest-anchored mid-range values.
 * The primary-color index Mantine uses for filled components is index 5.
 */
function buildAccentScale(manifest: ThemeManifest): MantineColorsTuple {
  return [
    '#eff6ff',
    '#dcecff',
    '#bdd9ff',
    '#91c1ff',
    manifest.tokens.accent2,  // 4 — secondary accent from manifest
    manifest.tokens.accent,   // 5 — primary accent from manifest (Mantine primary index)
    '#0074e8',
    '#0064ca',
    '#0055ad',
    '#00468f',
  ];
}

/**
 * Build a Mantine theme override from a piwin ThemeManifest.
 * Control geometry (radii, heights) is fixed product spec; color scales are
 * derived from manifest values so theme packages control Mantine fill colors.
 */
export function buildMantineTheme(manifest: ThemeManifest): MantineThemeOverride {
  return createTheme({
    primaryColor: 'piwinAccent',
    colors: {
      piwinGraphite: buildGraphiteScale(manifest),
      piwinAccent: buildAccentScale(manifest),
    },
    defaultRadius: 'sm',
    fontFamily: manifest.tokens.font,
    fontFamilyMonospace:
      'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
    headings: {
      fontFamily: manifest.tokens.font,
      fontWeight: '600',
    },
    components: {
      Button: {
        defaultProps: {
          radius: 'sm',
        },
      },
      ActionIcon: {
        defaultProps: {
          radius: 'sm',
        },
      },
      Modal: {
        defaultProps: {
          radius: 'md',
          centered: true,
        },
      },
    },
  });
}

export type PiwinUiProviderProps = {
  children: ReactNode;
  /**
   * Active theme manifest. When provided, Mantine's color scales are derived
   * from manifest values instead of static fallbacks. Pass the initial dark
   * manifest at startup; update when the user switches themes.
   */
  manifest?: ThemeManifest;
};

/**
 * Shared Mantine provider for piwin's renderer-only UI layer.
 * Color scales are derived from the active theme manifest so product themes
 * stay authoritative; control geometry and behavior are product-owned spec.
 */
export function PiwinUiProvider({ children, manifest }: PiwinUiProviderProps): ReactElement {
  const theme = manifest !== undefined ? buildMantineTheme(manifest) : buildMantineTheme({
    id: 'piwin-dark',
    name: 'Piwin Dark',
    version: '3.0.0',
    mode: 'dark',
    tokens: {
      bg: '#18181a',
      panel: '#222225',
      panel2: '#2a2a2d',
      border: 'rgba(255, 255, 255, 0.12)',
      text: '#f5f5f7',
      muted: '#a1a1a6',
      accent: '#0a84ff',
      accent2: '#64a7ff',
      danger: '#ff6961',
      ok: '#4cd964',
      radius: '8px',
      font: '"Outfit", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
    },
  });

  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      {children}
    </MantineProvider>
  );
}
