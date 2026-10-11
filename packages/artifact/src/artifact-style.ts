/**
 * Effective style mode for one render (design.md §6).
 *
 * Precedence: report kit (always host) > internal host-only switch / user
 * "view as host" > fence `style` > legacy Canvas cover-scene heuristic > host.
 */
import { paintsOwnScene } from './scene-palette.js';
import type { ArtifactDescriptor, ArtifactStyle, ArtifactSurface } from './types.js';

/**
 * - `host`: theme guard + full soft repair.
 * - `stage`: expressive; only the outer shell is guarded and repaired.
 * - `own`: a legacy Canvas scene that paints itself; no guard, no color repair.
 */
export type ArtifactPalette = 'host' | 'stage' | 'own';

/** Internal switch (not user-visible): `host-only` turns expressive off. */
export type ArtifactStyleModes = 'model' | 'host-only';

export type ResolveArtifactPaletteInput = {
  descriptor: Pick<ArtifactDescriptor, 'style'>;
  presentation: ArtifactSurface;
  source: string;
  styleModes?: ArtifactStyleModes;
  /** The user picked "view as host" for this artifact. */
  forceHost?: boolean;
};

const REPORT_KIT_ROOT_PATTERN = /<[a-z][\w-]*\b[^>]*\bclass\s*=\s*["'](?:[^"']*\s)?piwin-report(?=[\s"'])/i;

/** Report-kit documents are host-styled by contract. */
export function usesArtifactReportKit(source: string): boolean {
  return REPORT_KIT_ROOT_PATTERN.test(source);
}

export function resolveArtifactPalette(input: ResolveArtifactPaletteInput): ArtifactPalette {
  if (usesArtifactReportKit(input.source)) return 'host';
  const declared: ArtifactStyle | undefined = input.descriptor.style;
  if (input.forceHost === true) return 'host';
  if (declared === 'expressive') return input.styleModes === 'host-only' ? 'host' : 'stage';
  if (declared === 'host') return 'host';
  // Legacy fences (no style): keep the pre-v14 cover-scene behavior.
  return input.presentation === 'canvas' && paintsOwnScene(input.source) ? 'own' : 'host';
}

/** `data-piwin-style` value on the document root. */
export function artifactPaletteStyleAttribute(palette: ArtifactPalette): ArtifactStyle {
  return palette === 'host' ? 'host' : 'expressive';
}

/** Palettes whose colors the host does not control get the contrast probe. */
export function artifactPaletteNeedsContrastProbe(palette: ArtifactPalette): boolean {
  return palette !== 'host';
}
