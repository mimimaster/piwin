/**
 * Artifact viewer controls (design.md §7): width presets, theme preview,
 * keyboard map and copy. Pure so the toolbar, the fullscreen overlay and the
 * tests share one definition.
 */
import type { ArtifactRenderIntent, ArtifactStyle, ArtifactThemeVariables } from '@piwin/artifact';
import type { ThemeManifest } from '@piwin/contracts';
import { mapThemeToArtifactVariables } from './artifact-theme-map.js';
import {
  PIWIN_APPEARANCE_INKSTONE_INK,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
} from '../theme/deck-palette.js';

export type ArtifactViewerWidth = 'fit' | 'desktop' | 'mobile' | 'wide';
export type ArtifactPreviewTheme = 'follow' | 'paper' | 'ink';
export type ArtifactViewerLocale = 'zh-CN' | 'en';
export type ArtifactViewerFixedWidth = Exclude<ArtifactViewerWidth, 'fit'>;

/** Stage width in CSS px; `fit` follows the container. */
export const ARTIFACT_VIEWER_WIDTH_PX: Record<ArtifactViewerFixedWidth, number> = {
  desktop: 760,
  mobile: 390,
  wide: 1200,
};

/** Canvas offers three widths; fullscreen adds the wide one. */
export function artifactViewerWidths(fullscreen: boolean): ArtifactViewerWidth[] {
  return ['fit', ...artifactViewerFixedWidths(fullscreen)];
}

/** Fixed widths the toolbar shows; `fit` is the state with none pressed. */
export function artifactViewerFixedWidths(fullscreen: boolean): ArtifactViewerFixedWidth[] {
  return fullscreen ? ['wide', 'desktop', 'mobile'] : ['desktop', 'mobile'];
}

/** Pressing the active width again returns to `fit`. */
export function toggleArtifactViewerWidth(
  current: ArtifactViewerWidth,
  pressed: ArtifactViewerFixedWidth,
): ArtifactViewerWidth {
  return current === pressed ? 'fit' : pressed;
}

export function artifactViewerWidthPx(width: ArtifactViewerWidth): number | undefined {
  return width === 'fit' ? undefined : ARTIFACT_VIEWER_WIDTH_PX[width];
}

export const ARTIFACT_PREVIEW_THEMES: readonly ArtifactPreviewTheme[] = ['follow', 'paper', 'ink'];

export function nextArtifactPreviewTheme(current: ArtifactPreviewTheme): ArtifactPreviewTheme {
  const index = ARTIFACT_PREVIEW_THEMES.indexOf(current);
  return ARTIFACT_PREVIEW_THEMES[(index + 1) % ARTIFACT_PREVIEW_THEMES.length] ?? 'follow';
}

/**
 * Variables for one preview: `follow` keeps the host's own theme; paper/ink
 * repaint only this artifact with the Inkstone face. Never persisted and never
 * touches the app theme.
 */
export function resolveArtifactPreviewTheme(
  preview: ArtifactPreviewTheme,
  hostTheme: ArtifactThemeVariables | undefined,
): ArtifactThemeVariables | undefined {
  if (preview === 'follow') return hostTheme;
  const face: ThemeManifest =
    preview === 'paper' ? PIWIN_APPEARANCE_INKSTONE_PAPER : PIWIN_APPEARANCE_INKSTONE_INK;
  const mapped = mapThemeToArtifactVariables(face);
  if (!hostTheme) return mapped;
  // Keep the host's measured typography; only colors switch.
  const typography: Partial<ArtifactThemeVariables> = {};
  for (const key of [
    '--piwin-artifact-font-size',
    '--piwin-artifact-line-height',
    '--piwin-artifact-letter-spacing',
    '--piwin-artifact-font-smoothing',
  ] as const) {
    const value = hostTheme[key];
    if (value !== undefined) typography[key] = value;
  }
  return { ...mapped, ...typography };
}

export function artifactStyleLabel(style: ArtifactStyle | undefined): ArtifactStyle {
  return style ?? 'host';
}

export type ArtifactViewerKeyAction =
  | { kind: 'toggle-fullscreen' }
  | { kind: 'exit-fullscreen' }
  | { kind: 'width'; width: ArtifactViewerWidth }
  | { kind: 'cycle-theme' }
  | { kind: 'open-canvas' };

type ViewerKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
> & { target: EventTarget | null };

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/**
 * Viewer shortcuts (design §7.1). Keys typed inside the iframe never reach the
 * host document, so the map only fires while focus sits on viewer chrome.
 */
export function resolveArtifactViewerKey(
  event: ViewerKeyEvent,
  context: { surface: 'inline' | 'canvas' | 'fullscreen'; presets: boolean },
): ArtifactViewerKeyAction | null {
  if (isEditableTarget(event.target)) return null;
  const key = event.key;
  const command = event.metaKey || event.ctrlKey;
  if (context.surface === 'inline') {
    if (command && event.shiftKey && !event.altKey && key.toLowerCase() === 'o') {
      return { kind: 'open-canvas' };
    }
    return null;
  }
  if (command || event.altKey) return null;
  if (key === 'Escape') return context.surface === 'fullscreen' ? { kind: 'exit-fullscreen' } : null;
  if (key === 'f' || key === 'F') return { kind: 'toggle-fullscreen' };
  if (!context.presets) return null;
  // Canvas has no theme control, so T would change state nobody can see.
  if (context.surface === 'fullscreen' && (key === 't' || key === 'T')) {
    return { kind: 'cycle-theme' };
  }
  const widths = artifactViewerWidths(context.surface === 'fullscreen');
  const order: ArtifactViewerWidth[] =
    context.surface === 'fullscreen' ? ['fit', 'desktop', 'mobile', 'wide'] : widths;
  const index = Number.parseInt(key, 10);
  if (Number.isInteger(index) && index >= 1 && index <= order.length) {
    const width = order[index - 1];
    if (width) return { kind: 'width', width };
  }
  return null;
}

/**
 * A fullscreen or promoted view mounts a second frame next to the Inline one,
 * so it gets its own bridge channel; two frames must never share an id.
 */
export function withArtifactViewerChannel(
  intent: ArtifactRenderIntent,
  suffix: 'canvas' | 'fullscreen',
): ArtifactRenderIntent {
  return {
    ...intent,
    descriptor: { ...intent.descriptor, id: `${intent.descriptor.id}:${suffix}` },
  };
}

export type ArtifactViewerCopy = {
  openCanvas: string;
  fullscreen: string;
  exitFullscreen: string;
  /** Tooltip for one fixed-width button. */
  widthPreset: (px: number) => string;
  theme: Record<ArtifactPreviewTheme, string>;
  widthGroup: string;
  themeGroup: string;
  showCode: string;
  showPreview: string;
  /** Overflow menu holding the less frequent Inline actions. */
  moreActions: string;
  remountNote: string;
};

export function artifactViewerCopy(locale: ArtifactViewerLocale): ArtifactViewerCopy {
  if (locale === 'en') {
    return {
      openCanvas: 'Open in Canvas',
      fullscreen: 'Fullscreen (F)',
      exitFullscreen: 'Exit fullscreen (Esc)',
      widthPreset: (px) => `Preview at ${px}px; press again to fit`,
      theme: { follow: 'Follow', paper: 'Paper', ink: 'Ink' },
      widthGroup: 'Preview width',
      themeGroup: 'Preview theme',
      showCode: 'Show code',
      showPreview: 'Show preview',
      moreActions: 'More actions',
      remountNote: 'Fullscreen reloads the artifact; its state is not kept.',
    };
  }
  return {
    openCanvas: '在画布中打开',
    fullscreen: '全屏（F）',
    exitFullscreen: '退出全屏（Esc）',
    widthPreset: (px) => `按 ${px}px 宽度预览，再点一次恢复自适应`,
    theme: { follow: '跟随', paper: '纸', ink: '墨' },
    widthGroup: '预览宽度',
    themeGroup: '预览主题',
    showCode: '显示代码',
    showPreview: '显示预览',
    moreActions: '更多操作',
    remountNote: '全屏会重新加载 artifact，不保留当前状态。',
  };
}
