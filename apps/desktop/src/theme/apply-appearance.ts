/**
 * The single runtime authority for color, elevation, and typography CSS
 * variables. Geometry (band heights, column widths, z-layers) stays static in
 * styles/tokens.css so installed themes cannot reshape the shell.
 *
 * Two variable families are emitted:
 *
 *   Deck    `--void`, `--surface-N`, `--text-N`, `--line-N`, `--iris*`,
 *           `--ember` … the system region stylesheets are written against.
 *   Legacy  `--bg`, `--panel`, `--muted`, `--card` … every name the pre-Deck
 *           cascade reads, each mapped onto a Deck role.
 *
 * The legacy family is what makes a palette change reskin the whole product at
 * once: surfaces not yet rewritten still resolve to the active Deck ramp.
 */

import type { ThemeDeckTokens, ThemeManifest } from '@piwin/contracts';
import { getThemeAsset, type InkWashAssetKind } from '../ink-wash-assets.js';
import { alpha, mix } from './color.js';
import { resolveDeckTokens } from './deck-derive.js';
import { FONT_MONO } from './deck-palette.js';

const INKSTONE_THEME_IDS = new Set(['piwin-inkstone-paper', 'piwin-inkstone-ink']);
/** Matches docs/design/inkstone/proto-00-shell.html `.app { --sans / --mono }`. */
const INKSTONE_FONT_SANS =
  'Inter, "PingFang SC", "Noto Sans SC", -apple-system, system-ui, sans-serif';
const INKSTONE_FONT_MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';

type Vars = Record<string, string>;

/**
 * Image-backed variables for the ink-wash theme package. Every other theme
 * clears them, so switching away cannot strand a background image on the shell.
 */
const INK_WASH_ASSET_VARS: ReadonlyArray<readonly [string, InkWashAssetKind]> = [
  ['--ink-wash-hero', 'hero'],
  ['--ink-wash-conversation-texture', 'conversationTexture'],
  ['--ink-wash-sidebar-bg', 'sidebarBg'],
  ['--ink-wash-right-panel-bg', 'rightPanelBg'],
  ['--ink-wash-agent-seal', 'agentSeal'],
  ['--ink-wash-dry-brush-divider', 'dryBrushDivider'],
  ['--ink-wash-empty-session', 'emptySession'],
  ['--ink-wash-empty-files', 'emptyFiles'],
  ['--ink-wash-empty-failure', 'emptyFailure'],
  ['--ink-wash-empty-complete', 'emptyComplete'],
];

function applyInkWashAssets(root: HTMLElement, theme: ThemeManifest): void {
  for (const [varName, kind] of INK_WASH_ASSET_VARS) {
    const asset = getThemeAsset(theme, kind);
    if (asset === undefined) {
      root.style.removeProperty(varName);
    } else {
      root.style.setProperty(varName, `url("${asset}")`);
    }
  }
}

/**
 * Elevation is a rim light plus an outer hairline — never a `border`.
 *
 * The two modes are not symmetric, and pretending otherwise is what made Bone
 * read flat. A white rim over near-black surfaces is the strongest depth cue
 * Obsidian has; over Bone's surfaces it is a no-op on `--surface-3`/`4`
 * (both pure white) and barely visible on the tinted chrome below them. So in
 * light mode the rim is kept for the surfaces it can still catch, and the
 * actual separation is carried by a two-part shadow — a tight contact shadow
 * plus a wide ambient one, which is how a raised sheet reads on paper.
 */
type ElevationLevel = 1 | 2 | 3 | 4;

/**
 * The cast-shadow half of each level, without the rim or edge.
 *
 * Split out because the legacy `--shadow` / `--shadow-overlay` aliases are
 * drop shadows only — regions that read them draw their own border — while
 * `--elev-*` is the whole composite. Deriving both from one table keeps a
 * shadow tweak from landing on only one of them.
 */
function dropShadows(isLight: boolean): Record<ElevationLevel, string> {
  if (isLight) {
    return {
      1: '',
      2: '0 1px 2px -1px rgba(40, 34, 20, 0.1), 0 4px 10px -3px rgba(40, 34, 20, 0.14)',
      3: '0 2px 4px -2px rgba(40, 34, 20, 0.12), 0 16px 32px -12px rgba(40, 34, 20, 0.26)',
      4: '0 4px 8px -4px rgba(40, 34, 20, 0.14), 0 30px 64px -16px rgba(40, 34, 20, 0.34)',
    };
  }
  return {
    1: '',
    2: '0 2px 8px -2px rgba(0, 0, 0, 0.5)',
    3: '0 12px 32px -8px rgba(0, 0, 0, 0.7)',
    4: '0 24px 64px -12px rgba(0, 0, 0, 0.85)',
  };
}

/** Rim light plus outer hairline, per level. */
function elevationRims(isLight: boolean): Record<ElevationLevel, string> {
  if (isLight) {
    const rim = 'inset 0 1px 0 rgba(255, 255, 255, 0.9)';
    const edge = (a: number): string => `0 0 0 1px rgba(20, 18, 30, ${a})`;
    return {
      1: `${rim}, ${edge(0.1)}`,
      2: `${rim}, ${edge(0.1)}`,
      3: `${rim}, ${edge(0.11)}`,
      4: `${rim}, ${edge(0.12)}`,
    };
  }
  const rim = (a: number): string => `inset 0 1px 0 rgba(255, 255, 255, ${a})`;
  const edge = (a: number): string => `0 0 0 1px rgba(0, 0, 0, ${a})`;
  return {
    1: `${rim(0.05)}, ${edge(0.5)}`,
    2: `${rim(0.06)}, ${edge(0.55)}`,
    3: `${rim(0.07)}, ${edge(0.6)}`,
    4: `${rim(0.08)}, ${edge(0.65)}`,
  };
}

function elevation(isLight: boolean): Vars {
  const rims = elevationRims(isLight);
  const drops = dropShadows(isLight);
  const compose = (level: ElevationLevel): string =>
    drops[level] === '' ? rims[level] : `${rims[level]}, ${drops[level]}`;
  return {
    '--elev-1': compose(1),
    '--elev-2': compose(2),
    '--elev-3': compose(3),
    '--elev-4': compose(4),
  };
}

/** The Deck system variables. New region CSS uses only these. */
function deckVariables(d: ThemeDeckTokens, isLight: boolean): Vars {
  const stroke = isLight ? '#141420' : '#ffffff';
  return {
    '--void': d.void,
    '--surface-1': d.surface1,
    '--surface-2': d.surface2,
    '--surface-3': d.surface3,
    '--surface-4': d.surface4,

    '--text-1': d.text1,
    '--text-2': d.text2,
    '--text-3': d.text3,
    '--text-4': d.text4,

    '--line-1': d.line1,
    '--line-2': d.line2,
    '--line-3': d.line3,

    '--iris': d.iris,
    '--iris-lift': d.irisLift,
    '--iris-press': d.irisPress,
    '--on-iris': d.onIris,
    '--iris-fill': `linear-gradient(180deg, ${d.irisLift}, ${d.iris})`,
    '--iris-wash': alpha(d.iris, isLight ? 0.09 : 0.14),
    '--iris-glow': alpha(d.iris, isLight ? 0.22 : 0.34),

    '--ember': d.ember,
    '--ember-wash': alpha(d.ember, isLight ? 0.1 : 0.13),
    '--mint': d.mint,
    '--amber': d.amber,
    '--coral': d.coral,
    '--sky': d.sky,

    '--hover': alpha(stroke, isLight ? 0.04 : 0.045),
    '--active': alpha(stroke, isLight ? 0.07 : 0.075),

    /*
     * Composer "slab" — the one deliberately dark object on the page
     * (Inkstone increment 2 §5, prototype `proto-02-composer.html`). Each
     * variable defaults to the exact ambient role it substitutes inside the
     * composer card (text1..4, surface3/4, line1, hover, active), so every
     * non-Inkstone theme (Obsidian, Bone, ink-wash) renders byte-identical to
     * before this was introduced. That guarantee outranks the prototype's
     * neutral `data-slab=paper` mapping, which points `--slab-chip`→s1 and
     * `--slab-line`→l2 while the app's own chip fill / shelf divider sit on
     * surface-3 / line-1 — so the defaults follow the app. Inkstone faces
     * drop these inline values in `applyAppearanceToDocument` so
     * `styles/inkstone/tokens.css` can own the prototype dark hex
     * (`--slab` / `--slab-t` / `--slab-ph`). There the prototype's own
     * two-tier scheme collapses `--slab-text-2`/`--slab-text-3` onto the
     * placeholder value, since Deck's four text tiers don't all have a
     * slab-legible equivalent to distinguish.
     */
    '--slab': d.surface3,
    '--slab-text': d.text1,
    '--slab-text-2': d.text2,
    '--slab-text-3': d.text3,
    '--slab-placeholder': d.text4,
    '--slab-chip': d.surface3,
    '--slab-line': d.line1,
    '--slab-raised': d.surface4,
    '--slab-hover': alpha(stroke, isLight ? 0.04 : 0.045),
    '--slab-active': alpha(stroke, isLight ? 0.07 : 0.075),
  };
}

/**
 * Pre-Deck variable names, each pointed at a Deck role.
 *
 * Kept as an explicit table rather than CSS `var()` fallbacks so the mapping is
 * reviewable in one place and so `applyAppearanceToDocument` stays the only
 * writer. Entries retire as their region stylesheets are rewritten.
 */
function legacyVariables(d: ThemeDeckTokens, theme: ThemeManifest, isLight: boolean): Vars {
  const stroke = isLight ? '#141420' : '#ffffff';
  return {
    // Surfaces
    '--bg': d.surface2,
    '--canvas': d.surface2,
    '--surface-canvas': d.surface2,
    '--panel': d.surface3,
    '--surface': d.surface3,
    '--surface-inset': d.surface3,
    '--surface-overlay': d.surface3,
    '--surface-raised': d.surface4,
    '--rail': d.surface1,
    '--surface-rail': d.surface1,
    '--sidebar': d.surface1,
    '--surface-sidebar': d.surface1,
    '--card': d.surface3,
    '--composer': d.surface3,
    '--user-bubble': d.surface3,
    '--control': d.surface3,
    '--surface-control': d.surface3,
    '--surface-control-hover': d.surface4,
    '--sunken': d.void,
    '--term-bg': d.void,
    '--wb-term-bg': d.void,
    '--term-text': d.text2,
    '--surface-hover': alpha(stroke, isLight ? 0.04 : 0.045),
    '--wb-hover': alpha(stroke, isLight ? 0.04 : 0.045),
    '--selected': alpha(stroke, isLight ? 0.07 : 0.075),
    '--surface-selected': alpha(stroke, isLight ? 0.07 : 0.075),

    // Content
    '--text': d.text1,
    '--content-primary': d.text1,
    '--muted': d.text2,
    '--content-secondary': d.text2,
    '--faint': d.text3,
    '--content-muted': d.text3,
    '--wb-dim': d.text3,
    '--content-disabled': d.text4,
    '--content-on-accent': d.onIris,

    // Strokes
    '--border': d.line2,
    '--line': d.line2,
    '--border-default': d.line2,
    '--wb-line': d.line2,
    '--line-soft': d.line1,
    '--border-subtle': d.line1,
    '--line-strong': d.line3,
    '--column-divider': d.line3,
    '--border-interactive': alpha(d.iris, 0.6),
    '--border-emphasis': d.iris,
    '--focus-ring': d.iris,

    // Accent
    '--accent': d.iris,
    '--accent-2': d.irisLift,
    '--accent-fg': d.onIris,
    '--accent-soft': alpha(d.iris, isLight ? 0.09 : 0.14),
    '--wb-accent-soft': alpha(d.iris, isLight ? 0.09 : 0.14),
    '--accent-ring': alpha(d.iris, isLight ? 0.16 : 0.2),
    '--wb-send-fg': d.onIris,
    '--violet': d.irisLift,
    '--sage': d.sky,

    // State. `--state-running` is ember, not accent: a warm pixel anywhere in
    // the shell must always mean "the agent is working".
    '--state-running': d.ember,
    '--state-success': d.mint,
    '--state-warning': d.amber,
    '--state-danger': d.coral,
    '--state-waiting': d.sky,
    '--ok': d.mint,
    '--ok-fg': d.onIris,
    '--danger': d.coral,
    '--warn': d.amber,
    '--warn-fg': isLight ? '#ffffff' : '#1d1300',
    '--warn-line': alpha(d.amber, 0.3),
    '--add-bg': alpha(d.mint, isLight ? 0.1 : 0.12),
    '--add-text': isLight ? mix(d.mint, '#000000', 0.14) : mix(d.mint, '#ffffff', 0.28),
    '--del-bg': alpha(d.coral, isLight ? 0.08 : 0.12),
    '--del-text': isLight ? mix(d.coral, '#000000', 0.1) : mix(d.coral, '#ffffff', 0.36),

    // Chrome
    '--shadow': dropShadows(isLight)[3],
    '--shadow-overlay': dropShadows(isLight)[4],
    '--overlay-backdrop': isLight ? 'rgba(70, 60, 40, 0.24)' : 'rgba(6, 6, 9, 0.62)',

    // Radius
    '--radius': theme.tokens.radius,
    '--radius-sm': '7px',
    '--radius-control': '7px',
    '--radius-surface': '10px',
    '--radius-overlay': '18px',

    // Spacing (4px base)
    '--space-1': '4px',
    '--space-2': '8px',
    '--space-3': '12px',
    '--space-4': '16px',
    '--space-5': '20px',
    '--space-6': '24px',
    '--space-7': '32px',
    '--space-8': '40px',

    // Control heights
    '--control-height-compact': '28px',
    '--control-height-default': '32px',
    '--control-height-large': '38px',

    // Motion
    '--duration-fast': '90ms',
    '--motion-fast': '90ms',
    '--duration-standard': '150ms',
    '--motion-standard': '150ms',
    '--easing-standard': 'cubic-bezier(0.16, 1, 0.3, 1)',

    // Typography. `--font-mono` is the canonical name, pairing with `--font`
    // and with the pre-boot `--font-sans` / `--font-mono` fallbacks in
    // tokens.css; `--mono` is the legacy alias for regions not yet rewritten.
    '--font': theme.tokens.font,
    '--font-mono': FONT_MONO,
    '--mono': FONT_MONO,
  };
}

/**
 * Slab tokens Inkstone owns in `styles/inkstone/tokens.css`.
 * Deck defaults (`--slab` → surface-3, etc.) are written inline first; if they
 * stay, they beat the stylesheet and the paper face loses the dark slab.
 */
const INKSTONE_STYLESHEET_SLAB_VARS = [
  '--slab',
  '--slab-text',
  '--slab-text-2',
  '--slab-text-3',
  '--slab-placeholder',
  '--slab-chip',
  '--slab-line',
  '--slab-raised',
  '--slab-hover',
  '--slab-active',
] as const;

/** Geometry the runtime must never write; older builds set these inline. */
const GEOMETRY_VARIABLES = [
  '--topbar-height',
  '--titleband-height',
  '--signal-rail-width',
  '--sidebar-width',
  '--right-panel-width',
  '--chat-max',
  '--chat-side-pad',
] as const;

/** Every variable name this module emits, for tests and tooling. */
export function appearanceVariableNames(theme: ThemeManifest): string[] {
  const deck = resolveDeckTokens(theme);
  const isLight = theme.mode === 'light';
  return [
    ...Object.keys(deckVariables(deck, isLight)),
    ...Object.keys(elevation(isLight)),
    ...Object.keys(legacyVariables(deck, theme, isLight)),
  ].sort();
}

/** Apply a theme manifest to the document root. */
export function applyAppearanceToDocument(theme: ThemeManifest): void {
  const root = document.documentElement;
  const deck = resolveDeckTokens(theme);
  const isLight = theme.mode === 'light';

  const vars: Vars = {
    ...deckVariables(deck, isLight),
    ...elevation(isLight),
    ...legacyVariables(deck, theme, isLight),
  };
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  for (const name of GEOMETRY_VARIABLES) {
    root.style.removeProperty(name);
  }
  applyInkWashAssets(root, theme);

  root.dataset.themeId = theme.id;
  root.dataset.themeMode = theme.mode;
  root.dataset.themeVisualStyle = theme.visualStyle ?? 'flat';
  root.style.colorScheme = theme.mode;
  if (INKSTONE_THEME_IDS.has(theme.id)) {
    for (const name of INKSTONE_STYLESHEET_SLAB_VARS) {
      root.style.removeProperty(name);
    }
    root.style.setProperty('--font', INKSTONE_FONT_SANS);
    root.style.setProperty('--font-sans', INKSTONE_FONT_SANS);
    root.style.setProperty('--font-mono', INKSTONE_FONT_MONO);
    root.style.setProperty('--mono', INKSTONE_FONT_MONO);
    root.style.fontFamily = INKSTONE_FONT_SANS;
  } else {
    root.style.fontFamily = theme.tokens.font;
  }
}
