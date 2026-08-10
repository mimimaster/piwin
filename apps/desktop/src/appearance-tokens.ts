/** Built-in dark / light appearance. Shared by shell CSS vars and artifact mapping. */

import type { ThemeManifest } from '@piwin/contracts';
import inkWashManifest from '@piwin/theme/bundled/piwin-ink-wash';
import type { AppearanceThemeSettings } from './ui-preferences';
import { getThemeAsset } from './ink-wash-assets';

/** Browser-safe projection of the bundled token-only ink-wash manifest. */
export const PIWIN_APPEARANCE_INK_WASH: ThemeManifest = inkWashManifest as ThemeManifest;

/** UI sans — system first (Cursor uses SF Pro / -apple-system; Inter is optional fallback). */
const SHARED_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, sans-serif';

const SHARED_MONO =
  '"JetBrains Mono", "Fira Code", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Product dark — Noir charcoal workbench (Cursor-like).
 * Soft layered grays + quiet dividers; monochrome inverted accent.
 */
export const PIWIN_APPEARANCE_DARK: ThemeManifest = {
  id: 'piwin-dark',
  name: 'Noir',
  version: '6.4.0',
  description:
    'Noir calm slate workbench with soft non-glare typography and seamless surfaces for piwin shell + artifacts',
  mode: 'dark',
  tokens: {
    // Soft depth: base canvas #141416 · sidebar #141416 · stage #18181b · float cards #1c1c21.
    bg: '#141416',
    panel: '#18181b',
    panel2: '#1c1c20',
    border: 'rgba(255, 255, 255, 0.05)',
    text: '#e4e4e7',
    muted: '#8e8e98',
    accent: '#f4f4f5',
    accent2: '#d4d4d8',
    danger: '#ef4444',
    ok: '#10b981',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(24, 24, 27, 0.98)',
    text: '#e4e4e7',
    muted: '#8e8e98',
    accent: '#f4f4f5',
    border: 'rgba(255, 255, 255, 0.06)',
    radius: '0.625rem',
    font: SHARED_FONT,
  },
};

/** Product light — Paper layered gray shell with white prompt surfaces. */
export const PIWIN_APPEARANCE_LIGHT: ThemeManifest = {
  id: 'piwin-light',
  name: 'Paper',
  version: '6.1.0',
  description:
    'Paper layered gray workbench with white prompt surfaces and restrained blue accent for piwin shell + artifacts',
  mode: 'light',
  tokens: {
    // Three-level depth: side columns gray · conversation soft gray · prompts white.
    bg: '#f6f6f7',
    panel: '#ffffff',
    panel2: '#ececef',
    border: 'rgba(0, 0, 0, 0.08)',
    text: '#1a1a1e',
    muted: '#5c5c66',
    accent: '#2f6bed',
    accent2: '#5b86f0',
    danger: '#d64541',
    ok: '#179b62',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(255, 255, 255, 0.98)',
    text: '#1a1a1e',
    muted: '#5c5c66',
    accent: '#2f6bed',
    border: 'rgba(0, 0, 0, 0.10)',
    radius: '0.625rem',
    font: SHARED_FONT,
  },
};

/** Product warm light — 橙白: warm morning paper field with tangerine accent. */
export const PIWIN_APPEARANCE_ORANGE_WHITE: ThemeManifest = {
  id: 'piwin-orange-white',
  name: '橙白',
  version: '6.0.0',
  description: 'Daybreak warm paper field with tangerine accent for piwin shell + artifacts',
  mode: 'light',
  tokens: {
    // Stage white; sidebar/composer use warm gray via derived --sidebar/--composer.
    bg: '#fffdfa',
    panel: '#fffdfa',
    panel2: '#f2ede5',
    border: 'rgba(80, 60, 40, 0.10)',
    text: '#2f2924',
    muted: '#82776a',
    accent: '#e85d1f',
    accent2: '#f4955c',
    danger: '#d64541',
    ok: '#1f9d63',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(255, 253, 250, 0.98)',
    text: '#2f2924',
    muted: '#82776a',
    accent: '#e85d1f',
    border: 'rgba(80, 60, 40, 0.12)',
    radius: '0.625rem',
    font: SHARED_FONT,
  },
};

export const BUILTIN_APPEARANCES: ThemeManifest[] = [
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
  PIWIN_APPEARANCE_ORANGE_WHITE,
  PIWIN_APPEARANCE_INK_WASH,
];

/** Resolve the browser system preference without making SSR/test assumptions. */
export function resolveSystemThemeMode(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

/** Convert the Appearance settings fields into a validated desktop manifest. */
export function buildAppearanceTheme(
  mode: 'light' | 'dark',
  settings: AppearanceThemeSettings,
): ThemeManifest {
  const baseTheme = mode === 'light' ? PIWIN_APPEARANCE_LIGHT : PIWIN_APPEARANCE_DARK;
  const panel = mode === 'light' ? '#F8F8F8' : '#181818';
  const panel2 = mode === 'light' ? '#E4E4E4' : '#242424';

  return {
    ...baseTheme,
    id: `piwin-${mode}-appearance`,
    name: mode === 'light' ? 'Default Light' : 'Default Dark',
    tokens: {
      ...baseTheme.tokens,
      bg: settings.background,
      panel,
      panel2,
      text: settings.foreground,
      accent: settings.accent,
      accent2: settings.accent,
    },
    artifact: {
      ...baseTheme.artifact,
      bg: settings.background,
      surface: panel,
      text: settings.foreground,
      accent: settings.accent,
    },
  };
}

export function resolveBuiltinAppearance(themeId: string | undefined): ThemeManifest {
  if (themeId === 'piwin-light') {
    return PIWIN_APPEARANCE_LIGHT;
  }
  if (themeId === 'piwin-orange-white') {
    return PIWIN_APPEARANCE_ORANGE_WHITE;
  }
  if (themeId === 'piwin-ink-wash') {
    return PIWIN_APPEARANCE_INK_WASH;
  }
  return PIWIN_APPEARANCE_DARK;
}

/**
 * Built-in theme ids are product-owned visual contracts. Always use the
 * desktop manifest for them instead of an older copy returned by the host.
 * User-installed themes retain their own validated token manifest.
 */
export function resolveDesktopAppearance(theme: ThemeManifest): ThemeManifest {
  if (
    theme.id === 'piwin-dark' ||
    theme.id === 'piwin-light' ||
    theme.id === 'piwin-orange-white' ||
    theme.id === 'piwin-ink-wash'
  ) {
    return resolveBuiltinAppearance(theme.id);
  }
  return theme;
}

const THEME_SWITCHING_CLASS = 'is-theme-switching';
const THEME_SWITCH_SETTLE_MS = 64;
let themeSwitchSettleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Freeze chrome transitions for one paint cycle around a theme flip.
 * Without this, dozens of 120–200ms color/box-shadow transitions smear and
 * make session rows / fonts feel like they are moving.
 */
export function beginThemeSwitch(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.classList.add(THEME_SWITCHING_CLASS);
  // Force style application before token writes in the same turn.
  void root.offsetHeight;
  if (themeSwitchSettleTimer !== null) {
    clearTimeout(themeSwitchSettleTimer);
  }
  const releaseThemeSwitch = (): void => {
    themeSwitchSettleTimer = setTimeout(() => {
      root.classList.remove(THEME_SWITCHING_CLASS);
      themeSwitchSettleTimer = null;
    }, THEME_SWITCH_SETTLE_MS);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(releaseThemeSwitch);
    });
    return;
  }
  releaseThemeSwitch();
}

/**
 * Apply visual theme tokens to document root.
 * This is the single runtime authority for all color/typography CSS variables.
 * Geometry (band heights, sidebar widths, z-layers) stays in styles/tokens.css.
 *
 * Variable naming conventions:
 *   --surface-*   Background fills for regions and layers.
 *   --content-*   Text and icon colors.
 *   --border-*    Stroke / separator colors.
 *   --accent-*    Interactive highlight colors.
 *   --state-*     Semantic status colors (running, success, warning, danger, waiting).
 *   --space-*     Spacing scale (4px increments; layout-only, not padding hacks).
 *   --duration-*  Animation durations.
 */
export function applyAppearanceToDocument(theme: ThemeManifest): void {
  const root = document.documentElement;
  const tokens = theme.tokens;
  const isLight = theme.mode === 'light';
  root.dataset.themeId = theme.id;
  root.dataset.themeMode = theme.mode;
  root.dataset.themeVisualStyle = theme.visualStyle ?? 'flat';
  const inkWashHero = getThemeAsset(theme, 'hero');
  const inkWashTexture = getThemeAsset(theme, 'conversationTexture');
  if (inkWashHero) {
    root.style.setProperty('--ink-wash-hero', `url("${inkWashHero}")`);
  } else {
    root.style.removeProperty('--ink-wash-hero');
  }
  if (inkWashTexture) {
    root.style.setProperty('--ink-wash-conversation-texture', `url("${inkWashTexture}")`);
  } else {
    root.style.removeProperty('--ink-wash-conversation-texture');
  }
  /** 橙白 uses warm-tinted derived values (shadows, hover, faint) that differ
   *  from Paper's neutral cool ramp even though both are mode: light. */
  const isWarmLight = theme.id === 'piwin-orange-white';

  // Surfaces — derived from the validated product manifest. Layout stays
  // product-owned (styles/tokens.css) so installed themes cannot reshape the shell.

  /** Base canvas; darkest layer behind all content. */
  root.style.setProperty('--canvas', tokens.bg);
  /** Alias of --canvas; some older component CSS uses --bg. */
  root.style.setProperty('--bg', tokens.bg);

  /** Primary surface — panels, sidebars, cards sitting on the canvas. */
  root.style.setProperty('--panel', tokens.panel);
  /** Secondary surface — inset sections, code blocks, nested panels. */
  root.style.setProperty('--surface-inset', tokens.panel2);
  /** Alias of --surface-inset kept for compatibility until R3 CSS layer removal. */
  root.style.setProperty('--surface', tokens.panel2);

  /** Raised surface — menus, tooltips, dropdown overlays. */
  root.style.setProperty('--surface-raised', isLight ? '#ffffff' : '#2a2a2a');
  /** Hover state fill for interactive row/item components. */
  root.style.setProperty(
    '--surface-hover',
    isLight
      ? isWarmLight
        ? 'rgba(60, 40, 20, 0.05)'
        : 'rgba(0, 0, 0, 0.04)'
      : 'rgba(255, 255, 255, 0.06)',
  );
  /** Rail shares the unified field (quiet workbench: no hard panel boxes). */
  root.style.setProperty('--rail', tokens.bg);
  root.style.setProperty(
    '--wb-hover',
    isLight
      ? isWarmLight
        ? 'rgba(60, 40, 20, 0.05)'
        : 'rgba(0, 0, 0, 0.04)'
      : 'rgba(255, 255, 255, 0.06)',
  );
  root.style.setProperty('--wb-line', tokens.border);
  root.style.setProperty(
    '--wb-accent-soft',
    `color-mix(in srgb, ${tokens.accent} 10%, transparent)`,
  );

  /**
   * Derived control surface colors — used by ui-foundations.css for inputs,
   * buttons, and row backgrounds. Computed here so themes control the values.
   */
  root.style.setProperty(
    '--surface-control',
    `color-mix(in srgb, ${tokens.panel2} 92%, ${tokens.bg})`,
  );
  root.style.setProperty(
    '--surface-control-hover',
    `color-mix(in srgb, ${tokens.panel2} 80%, ${tokens.text})`,
  );
  /** Selection highlight on rows and list items. */
  root.style.setProperty(
    '--surface-selected',
    isLight
      ? `color-mix(in srgb, ${tokens.accent} 13%, ${tokens.panel})`
      : // Dark: quiet charcoal lift — never a bright white/accent wash.
        `color-mix(in srgb, ${tokens.text} 8%, ${tokens.panel})`,
  );

  // Semantic surface aliases used by older CSS
  /** Alias for --canvas. */
  root.style.setProperty('--surface-canvas', tokens.bg);
  /** Alias for --rail. */
  root.style.setProperty('--surface-rail', tokens.bg);
  /** Alias for --sidebar. */
  root.style.setProperty(
    '--surface-sidebar',
    // Sidebar is the darker gray chrome column around the softer conversation stage.
    isLight ? (isWarmLight ? '#f2ede5' : '#ececef') : '#1e1f24',
  );
  /** Alias for --panel (the foreground overlay / popover surface). */
  root.style.setProperty('--surface-overlay', tokens.panel);

  // Content (text + icon) colors

  /** Primary text — headings, code, message content. */
  root.style.setProperty('--text', tokens.text);
  /** Alias of --text for semantic readers. */
  root.style.setProperty('--content-primary', tokens.text);
  /** Secondary text — labels, captions, helper copy. */
  root.style.setProperty('--muted', tokens.muted);
  /** Alias of --muted for semantic readers. */
  root.style.setProperty('--content-secondary', tokens.muted);
  /** Alias of --faint for semantic readers. */
  root.style.setProperty(
    '--content-muted',
    isLight ? (isWarmLight ? '#a89d8f' : '#a0a0a8') : '#585862',
  );
  /** Disabled control labels and icons. */
  root.style.setProperty('--content-disabled', isLight ? '#b9b0a2' : '#5a5a62');
  /**
   * Text/icon on solid accent fills.
   * Must invert with accent luminance: white on blue/orange (light themes),
   * black on Noir's near-white accent. Keep in lockstep with --accent-fg.
   */
  root.style.setProperty('--content-on-accent', isLight ? '#ffffff' : '#141414');

  // Borders and strokes

  /** Default border for cards, panels, separators. */
  root.style.setProperty('--border', tokens.border);
  /** Alias of --border; some older component CSS uses --line. */
  root.style.setProperty('--line', tokens.border);
  /** Alias of --border for semantic readers. */
  root.style.setProperty('--border-default', tokens.border);
  /**
   * Column / band chrome dividers (sidebar | stage | right panel | titleband).
   * Stronger than --border so the workbench columns read clearly without
   * relying on pure-white accent fills.
   */
  root.style.setProperty(
    '--column-divider',
    isLight
      ? isWarmLight
        ? 'rgba(80, 60, 40, 0.12)'
        : 'rgba(0, 0, 0, 0.10)'
      : 'rgba(255, 255, 255, 0.16)',
  );
  /** Soft / de-emphasized divider line. */
  root.style.setProperty(
    '--line-soft',
    isLight
      ? isWarmLight
        ? 'rgba(80, 60, 40, 0.06)'
        : 'rgba(0, 0, 0, 0.05)'
      : 'rgba(255, 255, 255, 0.05)',
  );
  /** Alias of --line-soft for semantic readers. */
  root.style.setProperty(
    '--border-subtle',
    isLight
      ? isWarmLight
        ? 'rgba(80, 60, 40, 0.06)'
        : 'rgba(0, 0, 0, 0.05)'
      : 'rgba(255, 255, 255, 0.05)',
  );
  /** Interactive border that highlights when focused or active. */
  root.style.setProperty(
    '--border-interactive',
    `color-mix(in srgb, ${tokens.accent} 60%, ${tokens.border})`,
  );
  /** Border that tracks --accent; used for focused inputs and selected items. */
  root.style.setProperty('--border-emphasis', tokens.accent);
  /** Focus ring color for keyboard-navigable controls. */
  root.style.setProperty('--focus-ring', tokens.accent);

  // Accent colors

  /** Primary interactive accent — links, focused inputs, active controls. */
  root.style.setProperty('--accent', tokens.accent);
  /** Secondary / lighter accent for gradients and decorative use. */
  root.style.setProperty('--accent-2', tokens.accent2);

  // Semantic colors — purple and teal tones for assistant / status chrome

  /** Purple / violet tone used for AI assistant identity elements. */
  root.style.setProperty('--violet', isLight ? '#8a5cf5' : '#cba6ff');
  /** Teal / sage tone used for secondary status indicators (waiting state). */
  root.style.setProperty('--sage', isLight ? '#0e7d99' : '#6fd3e8');

  // Status / state colors

  /** Active run state indicator — same hue as --accent. */
  root.style.setProperty('--state-running', tokens.accent);
  /** Success / ok state indicator. */
  root.style.setProperty('--state-success', tokens.ok);
  /** Warning / caution state indicator. */
  root.style.setProperty('--state-warning', isLight ? '#b25000' : '#ffb020');
  /** Error / destructive state indicator. */
  root.style.setProperty('--state-danger', tokens.danger);
  /** Waiting / paused state indicator — matches --sage hue. */
  root.style.setProperty('--state-waiting', isLight ? '#0e7d99' : '#6fd3e8');
  /** Alias of --state-danger; used by some older CSS. */
  root.style.setProperty('--danger', tokens.danger);
  /** Alias of --state-success; used by some older CSS. */
  root.style.setProperty('--ok', tokens.ok);

  // Surface chrome — Daybreak uses soft warm shadows instead of a flat field.

  /** Box shadow for elevated surfaces (panels, modals). */
  root.style.setProperty(
    '--shadow',
    isLight ? '0 10px 28px rgba(90, 65, 40, 0.10)' : '0 10px 28px rgba(8, 5, 10, 0.42)',
  );
  /** Shadow for overlay/popover surfaces. */
  root.style.setProperty(
    '--shadow-overlay',
    isLight ? '0 22px 60px rgba(90, 65, 40, 0.18)' : '0 22px 60px rgba(8, 5, 10, 0.55)',
  );
  /** Backdrop for modals and drawers. */
  root.style.setProperty(
    '--overlay-backdrop',
    isLight ? 'rgba(70, 50, 30, 0.28)' : 'rgba(14, 10, 14, 0.55)',
  );

  // Radius

  /** Default corner radius for cards and panels (from manifest). */
  root.style.setProperty('--radius', tokens.radius);
  /** Compact radius for small controls (inputs, chips, buttons). */
  root.style.setProperty('--radius-sm', '7px');
  /** Alias of --radius-sm used in control-level CSS. */
  root.style.setProperty('--radius-control', '8px');
  /** Standard surface radius (same as --radius at 10px). */
  root.style.setProperty('--radius-surface', '10px');
  /** Larger radius for overlays, sheets, modals. */
  root.style.setProperty('--radius-overlay', '14px');

  // Spacing scale — 4px base increment

  /** 4px */
  root.style.setProperty('--space-1', '4px');
  /** 8px */
  root.style.setProperty('--space-2', '8px');
  /** 12px */
  root.style.setProperty('--space-3', '12px');
  /** 16px */
  root.style.setProperty('--space-4', '16px');
  /** 20px */
  root.style.setProperty('--space-5', '20px');
  /** 24px */
  root.style.setProperty('--space-6', '24px');
  /** 32px */
  root.style.setProperty('--space-7', '32px');
  /** 40px */
  root.style.setProperty('--space-8', '40px');

  // Control heights

  /** Compact control height — small chips, badges, icon buttons. */
  root.style.setProperty('--control-height-compact', '28px');
  /** Default control height — standard buttons, inputs, selects. */
  root.style.setProperty('--control-height-default', '32px');
  /** Large control height — toolbar buttons, list rows. */
  root.style.setProperty('--control-height-large', '36px');

  // Motion

  /** Fast transition — tooltips, icon state swaps. */
  root.style.setProperty('--duration-fast', '120ms');
  /** Alias of --duration-fast used in older CSS. */
  root.style.setProperty('--motion-fast', '120ms');
  /** Standard transition — menus, popovers, disclosure. */
  root.style.setProperty('--duration-standard', '200ms');
  /** Alias of --duration-standard used in older CSS. */
  root.style.setProperty('--motion-standard', '200ms');
  root.style.setProperty('--easing-standard', 'cubic-bezier(0.22, 1, 0.36, 1)');

  // Typography

  /** Product UI font stack (from manifest). */
  root.style.setProperty('--font', tokens.font);
  /** Monospace font stack. */
  root.style.setProperty('--mono', SHARED_MONO);
  root.style.fontFamily = tokens.font;

  // Theme identity attributes

  root.dataset.themeMode = theme.mode;
  root.dataset.themeId = theme.id;
  root.style.colorScheme = theme.mode;

  // Remove any layout variables that older builds may have written inline.
  // Canonical geometry values live in styles/tokens.css only.
  for (const layoutToken of [
    '--topbar-height',
    '--titleband-height',
    '--rail-width',
    '--signal-rail-width',
    '--sidebar-width',
    '--right-panel-width',
    '--chat-max',
    '--chat-side-pad',
  ]) {
    root.style.removeProperty(layoutToken);
  }

  // ── Paper/Noir/橙白 derived ramp (§1.2 of docs/plans/2026-07-30-paper-noir-theme-implementation.md)
  // isWarmLight branches restore the original Daybreak warm-paper derived values.
  root.style.setProperty('--card', isLight ? (isWarmLight ? tokens.panel : '#ffffff') : '#1d1e24');
  root.style.setProperty(
    '--control',
    isLight ? (isWarmLight ? tokens.panel2 : '#ececee') : '#1e1e24',
  );
  root.style.setProperty(
    '--sunken',
    isLight ? (isWarmLight ? tokens.panel2 : '#f0f0f2') : '#101012',
  );
  /**
   * Three-level shell surfaces (sidebar · conversation · composer):
   *   dark  → light · deep · light
   *   Paper → gray  · soft gray · white
   *   橙白  → warm gray · warm white · warm gray
   */
  root.style.setProperty('--sidebar', isLight ? (isWarmLight ? '#f2ede5' : '#ececef') : '#1e1f24');
  root.style.setProperty('--composer', isLight ? (isWarmLight ? '#f2ede5' : '#ffffff') : '#1c1c21');
  // History user-message cards share the composer surface (not stage canvas).
  root.style.setProperty(
    '--user-bubble',
    isLight ? (isWarmLight ? '#f2ede5' : '#ffffff') : '#1d1e24',
  );
  root.style.setProperty('--term-bg', isLight ? (isWarmLight ? '#efe9e0' : '#16181d') : '#101012');
  root.style.setProperty(
    '--term-text',
    isLight ? (isWarmLight ? '#6b6358' : '#b0b6c0') : '#a8a8b0',
  );
  root.style.setProperty(
    '--hover',
    isLight
      ? isWarmLight
        ? 'rgba(60, 40, 20, 0.05)'
        : 'rgba(0, 0, 0, 0.04)'
      : 'rgba(255, 255, 255, 0.04)',
  );
  root.style.setProperty(
    '--selected',
    isLight
      ? isWarmLight
        ? 'rgba(232, 93, 31, 0.10)'
        : 'rgba(0, 0, 0, 0.06)'
      : // Match Cursor-like quiet selection (subtle lift, not a bright pill).
        'rgba(255, 255, 255, 0.05)',
  );
  root.style.setProperty('--faint', isLight ? (isWarmLight ? '#a89d8f' : '#a0a0a8') : '#585862');
  root.style.setProperty(
    '--line-strong',
    isLight
      ? isWarmLight
        ? 'rgba(80, 60, 40, 0.22)'
        : 'rgba(0, 0, 0, 0.14)'
      : 'rgba(255, 255, 255, 0.14)',
  );
  root.style.setProperty('--accent-fg', isLight ? '#ffffff' : '#141414');
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${tokens.accent} 10%, transparent)`);
  root.style.setProperty('--accent-ring', `color-mix(in srgb, ${tokens.accent} 18%, transparent)`);
  root.style.setProperty('--warn', isLight ? '#b25000' : '#f5b83d');
  root.style.setProperty('--warn-fg', isLight ? '#ffffff' : '#1d1300');
  root.style.setProperty(
    '--warn-line',
    isLight ? 'rgba(178, 80, 0, 0.3)' : 'rgba(245, 184, 61, 0.3)',
  );
  root.style.setProperty(
    '--add-bg',
    isLight ? 'rgba(23, 155, 98, 0.10)' : 'rgba(62, 207, 142, 0.12)',
  );
  root.style.setProperty('--add-text', isLight ? '#0e7a4c' : '#6fdcab');
  root.style.setProperty(
    '--del-bg',
    isLight ? 'rgba(214, 69, 65, 0.08)' : 'rgba(235, 57, 70, 0.12)',
  );
  root.style.setProperty('--del-text', isLight ? '#c13a36' : '#f08a92');
  // PlanCard done-step checkmark foreground on the --ok (green) background
  root.style.setProperty('--ok-fg', isLight ? '#ffffff' : '#141414');
  // legacy --wb-* aliases repointed at the new ramp (existing CSS still reads them)
  root.style.setProperty(
    '--wb-term-bg',
    isLight ? (isWarmLight ? '#efe9e0' : '#16181d') : '#101010',
  );
  root.style.setProperty('--wb-dim', isLight ? (isWarmLight ? '#a89d8f' : '#a0a0a8') : '#6e6e76');
  root.style.setProperty('--wb-send-fg', isLight ? '#ffffff' : '#141414');
}
