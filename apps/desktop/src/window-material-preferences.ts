/**
 * Per-region opacity of the native window material (styles/window-material.css).
 *
 * Each value is how strongly a region's own surface colour covers the system
 * material behind the WebView: 100 is the solid surface, lower lets more of
 * the desktop through. Panels are painted on top of the backdrop, so a panel
 * can never read clearer than the backdrop under it.
 */
export const WINDOW_MATERIAL_REGIONS = ['backdrop', 'sidebar', 'stage', 'rightPanel'] as const;

export type WindowMaterialRegion = (typeof WINDOW_MATERIAL_REGIONS)[number];

export type WindowMaterialOpacity = Record<WindowMaterialRegion, number>;

/**
 * Both side panels read as glass wings around a mostly solid conversation.
 * The right panel stays a little denser than the sidebar because it carries
 * work content (file trees, diffs) rather than navigation.
 */
export const DEFAULT_WINDOW_MATERIAL_OPACITY: WindowMaterialOpacity = {
  backdrop: 60,
  sidebar: 30,
  stage: 90,
  rightPanel: 45,
};

const REGION_CSS_VARIABLES: Record<WindowMaterialRegion, string> = {
  backdrop: '--window-material-backdrop-opacity',
  sidebar: '--window-material-sidebar-opacity',
  stage: '--window-material-stage-opacity',
  rightPanel: '--window-material-right-panel-opacity',
};

export function normalizeWindowMaterialOpacity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function parseWindowMaterialOpacity(raw: string | null): WindowMaterialOpacity {
  let stored: Partial<Record<WindowMaterialRegion, unknown>> = {};
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        stored = parsed;
      }
    } catch {
      // Malformed preference data restores the built-in material.
    }
  }
  const opacity = { ...DEFAULT_WINDOW_MATERIAL_OPACITY };
  for (const region of WINDOW_MATERIAL_REGIONS) {
    opacity[region] = normalizeWindowMaterialOpacity(stored[region], opacity[region]);
  }
  return opacity;
}

export function windowMaterialCssVars(
  opacity: WindowMaterialOpacity = DEFAULT_WINDOW_MATERIAL_OPACITY,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const region of WINDOW_MATERIAL_REGIONS) {
    vars[REGION_CSS_VARIABLES[region]] = `${opacity[region]}%`;
  }
  return vars;
}

/**
 * Written on the document root, not `.app-shell`: settings and the studio
 * pages mount as siblings of the shell and reuse the same region opacities.
 */
export function applyWindowMaterialToDocument(
  root: HTMLElement,
  opacity: WindowMaterialOpacity | undefined,
): void {
  for (const [name, value] of Object.entries(windowMaterialCssVars(opacity))) {
    root.style.setProperty(name, value);
  }
}
