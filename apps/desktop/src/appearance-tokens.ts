/** Built-in dark / light appearance. Shared by shell CSS vars and artifact mapping. */

import type { ThemeManifest } from '@piwin/contracts';

const SHARED_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", system-ui, sans-serif';

/** Product dark — Daybreak "dusk" field: warm ink canvas + sunrise coral accent. */
export const PIWIN_APPEARANCE_DARK: ThemeManifest = {
  id: 'piwin-dark',
  name: 'Piwin Dark',
  version: '5.0.0',
  description: 'Daybreak warm ink field with sunrise coral accent for piwin shell + artifacts',
  mode: 'dark',
  tokens: {
    bg: '#151318',
    panel: '#1a181f',
    panel2: '#211e26',
    border: 'rgba(255, 238, 220, 0.07)',
    text: '#f0eae3',
    muted: '#a8a09f',
    accent: '#ff8359',
    accent2: '#ffb37e',
    danger: '#f0685c',
    ok: '#4fca92',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(33, 30, 38, 0.98)',
    text: '#f0eae3',
    muted: '#a8a09f',
    accent: '#ff8359',
    border: 'rgba(255, 238, 220, 0.09)',
    radius: '0.625rem',
    font: SHARED_FONT,
  },
};

/** Product light — Daybreak "paper" field: warm morning paper + tangerine accent. */
export const PIWIN_APPEARANCE_LIGHT: ThemeManifest = {
  id: 'piwin-light',
  name: 'Piwin Light',
  version: '5.0.0',
  description: 'Daybreak warm paper field with tangerine accent for piwin shell + artifacts',
  mode: 'light',
  tokens: {
    bg: '#f7f3ed',
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
];

export function resolveBuiltinAppearance(themeId: string | undefined): ThemeManifest {
  if (themeId === 'piwin-light') {
    return PIWIN_APPEARANCE_LIGHT;
  }
  return PIWIN_APPEARANCE_DARK;
}

/**
 * Built-in theme ids are product-owned visual contracts. Always use the
 * desktop manifest for them instead of an older copy returned by the host.
 * User-installed themes retain their own validated token manifest.
 */
export function resolveDesktopAppearance(theme: ThemeManifest): ThemeManifest {
  if (theme.id === 'piwin-dark' || theme.id === 'piwin-light') {
    return resolveBuiltinAppearance(theme.id);
  }
  return theme;
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
  root.style.setProperty('--surface-raised', isLight ? '#ffffff' : '#26222b');
  /** Hover state fill for interactive row/item components. */
  root.style.setProperty(
    '--surface-hover',
    isLight ? 'rgba(60, 40, 20, 0.05)' : 'rgba(255, 240, 225, 0.055)',
  );
  /** Sidebar / rail share the unified field (quiet workbench: no hard panel boxes). */
  root.style.setProperty('--sidebar', tokens.bg);
  root.style.setProperty('--rail', tokens.bg);
  root.style.setProperty('--wb-hover', isLight ? 'rgba(60, 40, 20, 0.05)' : 'rgba(255, 240, 225, 0.055)');
  root.style.setProperty('--wb-line', tokens.border);
  root.style.setProperty(
    '--wb-accent-soft',
    `color-mix(in srgb, ${tokens.accent} ${isLight ? 10 : 13}%, transparent)`,
  );
  root.style.setProperty('--wb-send-fg', isLight ? '#ffffff' : '#2b1508');
  root.style.setProperty('--wb-term-bg', isLight ? '#efe9e0' : '#100e12');
  root.style.setProperty('--wb-dim', isLight ? '#a89d8f' : '#736d76');

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
    `color-mix(in srgb, ${tokens.accent} ${isLight ? 13 : 15}%, ${tokens.panel})`,
  );

  // Semantic surface aliases used by older CSS
  /** Alias for --canvas. */
  root.style.setProperty('--surface-canvas', tokens.bg);
  /** Alias for --rail. */
  root.style.setProperty('--surface-rail', tokens.bg);
  /** Alias for --sidebar. */
  root.style.setProperty('--surface-sidebar', tokens.bg);
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
  /** Tertiary / placeholder text, icons in inactive states. */
  root.style.setProperty('--faint', isLight ? '#a89d8f' : '#736d76');
  /** Alias of --faint for semantic readers. */
  root.style.setProperty('--content-muted', isLight ? '#a89d8f' : '#736d76');
  /** Disabled control labels and icons. */
  root.style.setProperty('--content-disabled', isLight ? '#b9b0a2' : '#5f5a64');
  /** Text on solid accent fills — deep roast on bright coral, white on tangerine. */
  root.style.setProperty('--content-on-accent', isLight ? '#ffffff' : '#2b1508');

  // Borders and strokes

  /** Default border for cards, panels, separators. */
  root.style.setProperty('--border', tokens.border);
  /** Alias of --border; some older component CSS uses --line. */
  root.style.setProperty('--line', tokens.border);
  /** Alias of --border for semantic readers. */
  root.style.setProperty('--border-default', tokens.border);
  /** Soft / de-emphasized divider line. */
  root.style.setProperty(
    '--line-soft',
    isLight ? 'rgba(80, 60, 40, 0.06)' : 'rgba(255, 238, 220, 0.045)',
  );
  /** Alias of --line-soft for semantic readers. */
  root.style.setProperty(
    '--border-subtle',
    isLight ? 'rgba(80, 60, 40, 0.06)' : 'rgba(255, 238, 220, 0.045)',
  );
  /** Stronger border for high-contrast separators or elevated containers. */
  root.style.setProperty(
    '--line-strong',
    isLight ? 'rgba(80, 60, 40, 0.22)' : 'rgba(255, 238, 220, 0.22)',
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
  /** Low-opacity accent fill for badge backgrounds and hover overlays. */
  root.style.setProperty(
    '--accent-soft',
    `color-mix(in srgb, ${tokens.accent} ${isLight ? 10 : 14}%, transparent)`,
  );

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
  root.style.setProperty(
    '--mono',
    '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  );
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
  ]) {
    root.style.removeProperty(layoutToken);
  }
}
