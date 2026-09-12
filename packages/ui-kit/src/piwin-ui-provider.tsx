import {
  MantineProvider,
  createTheme,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMemo, type ReactElement, type ReactNode } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

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
 * Accent scale derived from the manifest's accent color.
 * All steps are srgb mixes with white/black so every Mantine shade stays in
 * the theme's hue family — no hardcoded cross-hue steps that leak foreign
 * colors into hovers, light variants, and shade-indexed fills.
 * The primary-color index Mantine uses for filled components is index 5.
 */
function buildAccentScale(manifest: ThemeManifest): MantineColorsTuple {
  const accent = manifest.tokens.accent;
  const accent2 = manifest.tokens.accent2;
  return [
    mixHex(accent, '#ffffff', 0.93), // 0 — light variant bg
    mixHex(accent, '#ffffff', 0.82), // 1 — light variant hover
    mixHex(accent, '#ffffff', 0.66), // 2
    mixHex(accent, '#ffffff', 0.42), // 3
    accent2, // 4 — secondary accent from manifest
    accent, // 5 — primary accent from manifest (Mantine primary index)
    mixHex(accent, '#000000', 0.14), // 6 — filled hover
    mixHex(accent, '#000000', 0.3), // 7
    mixHex(accent, '#000000', 0.46), // 8
    mixHex(accent, '#000000', 0.6), // 9
  ];
}

/** srgb mix of two #rrggbb colors; weight 0 → a, 1 → b. */
function mixHex(a: string, b: string, weight: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number): number => {
    const ca = (pa >> shift) & 0xff;
    const cb = (pb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * weight);
  };
  const r = channel(16);
  const g = channel(8);
  const bl = channel(0);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * Build a Mantine theme override from a piwin ThemeManifest.
 * Control geometry (radii, heights) is fixed product spec; color scales are
 * derived from manifest values so theme packages control Mantine fill colors.
 */
export function buildMantineTheme(manifest: ThemeManifest): MantineThemeOverride {
  return createTheme({
    primaryColor: 'piwinAccent',
    // Filled components must use the manifest-anchored accent (scale index 5)
    // in both color schemes; Mantine's default shade split ({light: 6, dark: 8})
    // would pick interpolated ramp steps instead of the theme accent. Object
    // form — the number form can be lost when deep-merged with the default
    // {light, dark} object.
    primaryShade: { light: 5, dark: 5 },
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
      TextInput: {
        defaultProps: {
          size: 'sm',
          radius: 'md',
        },
      },
      NumberInput: {
        defaultProps: {
          size: 'sm',
          radius: 'md',
          hideControls: true,
        },
      },
      Textarea: {
        defaultProps: {
          size: 'sm',
          radius: 'md',
        },
      },
      PasswordInput: {
        defaultProps: {
          size: 'sm',
          radius: 'md',
        },
      },
      NativeSelect: {
        defaultProps: {
          size: 'sm',
          radius: 'md',
        },
      },
      Switch: {
        defaultProps: {
          size: 'sm',
          withThumbIndicator: false,
        },
      },
      SegmentedControl: {
        defaultProps: {
          size: 'sm',
          radius: 'md',
        },
      },
    },
  });
}

export type PiwinUiProviderProps = {
  children: ReactNode;
  /**
   * Active theme manifest (required). Mantine color scales, font, and
   * headings derive from it; the mount owner (DesktopThemeRoot in the
   * desktop app) must pass the same resolved manifest it projects to
   * document CSS so both stay in sync.
   */
  manifest: ThemeManifest;
};

/**
 * Shared Mantine provider for piwin's renderer-only UI layer.
 * Color scales are derived from the active theme manifest so product themes
 * stay authoritative; control geometry and behavior are product-owned spec.
 */
export function PiwinUiProvider({ children, manifest }: PiwinUiProviderProps): ReactElement {
  const theme = useMemo(() => buildMantineTheme(manifest), [manifest]);

  // The manifest is the single source of light/dark identity. Following the
  // OS media query here would let Mantine's scheme diverge from the document
  // tokens the mount owner projects from the same manifest.
  return (
    <MantineProvider theme={theme} forceColorScheme={manifest.mode}>
      <Notifications position="top-center" zIndex={80} />
      {children}
    </MantineProvider>
  );
}
